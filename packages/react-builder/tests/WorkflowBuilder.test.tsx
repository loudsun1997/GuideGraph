// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkflowBuilder, type WorkflowBuilderProps } from "../src";
import type { BuilderWorkflowDefinition } from "@guidegraph/builder";
import { validateWorkflowDefinition } from "@guidegraph/core";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");

  function MockReactFlow(props: {
    readonly nodes: Array<{ readonly id: string; readonly type?: string; readonly data: Record<string, unknown> }>;
    readonly edges: Array<{ readonly id: string; readonly data?: Record<string, unknown> }>;
    readonly nodeTypes?: Record<string, (nodeProps: { readonly data: Record<string, unknown> }) => ReactNode>;
    readonly children?: ReactNode;
    readonly onEdgeClick?: (event: unknown, edge: { readonly id: string; readonly data?: Record<string, unknown> }) => void;
    readonly onNodeClick?: (
      event: unknown,
      node: { readonly id: string; readonly type?: string; readonly data: Record<string, unknown> }
    ) => void;
  }) {
    return React.createElement(
      "div",
      { "data-testid": "react-flow" },
      props.nodes.map((node) => {
        const Component = node.type ? props.nodeTypes?.[node.type] : undefined;
        return React.createElement(
          "button",
          {
            "data-testid": `node-${node.id}`,
            key: node.id,
            type: "button",
            onClick: (event: unknown) => props.onNodeClick?.(event, node)
          },
          Component
            ? React.createElement(Component, { data: node.data })
            : String(node.data.label ?? node.id)
        );
      }),
      props.edges.map((edge) =>
        React.createElement(
          "button",
          {
            "data-testid": `edge-${edge.id}`,
            key: edge.id,
            type: "button",
            onClick: (event: unknown) => props.onEdgeClick?.(event, edge)
          },
          edge.id
        )
      ),
      props.children
    );
  }

  return {
    Background: () => React.createElement("div", { "data-testid": "flow-background" }),
    Controls: () => React.createElement("div", { "data-testid": "flow-controls" }),
    Handle: () => React.createElement("span", { "data-testid": "flow-handle" }),
    MarkerType: { ArrowClosed: "arrowclosed" },
    MiniMap: () => React.createElement("div", { "data-testid": "flow-minimap" }),
    Position: { Left: "left", Right: "right" },
    ReactFlow: MockReactFlow,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes
  };
});

afterEach(() => cleanup());

describe("WorkflowBuilder", () => {
  it("renders summary, canvas nodes, and the selected step inspector", () => {
    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} />);

    expect(screen.getByRole("heading", { name: "Permit Application" })).toBeTruthy();
    expect(screen.getByLabelText("Workflow definition summary").textContent).toContain("Steps");
    expect(screen.getByTestId("react-flow").textContent).toContain("Fill Form");
    expect(screen.getByTestId("react-flow").textContent).toContain("Submit Application");
    expect(screen.getByLabelText("Workflow builder inspector").textContent).toContain("Step");
    expect(screen.getByDisplayValue("fillForm")).toBeTruthy();
  });

  it("adds a new canvas step and reports the changed definition", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add step" }));

    expect(screen.getByTestId("react-flow").textContent).toContain("New step");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0].steps.at(-1)?.id).toBe("new_step");
  });

  it("edits selected step metadata through the inspector", () => {
    const onChange = vi.fn();
    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue("Fill Form"), { target: { value: "Complete Form" } });

    expect(screen.getByTestId("react-flow").textContent).toContain("Complete Form");
    expect(onChange.mock.lastCall?.[0].steps[0]).toMatchObject({ id: "fillForm", name: "Complete Form" });
  });

  it("opens an edge inspector from the canvas edge and edits action metadata", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} onChange={onChange} />);

    await user.click(screen.getByTestId("edge-transition:submitApplication:cityReview:COMPLETE_STEP:0:action-input"));
    const inspector = screen.getByLabelText("Workflow builder inspector");
    expect(inspector.textContent).toContain("Edge");

    fireEvent.change(within(inspector).getByDisplayValue("COMPLETE_STEP"), {
      target: { value: "APPLICATION_SUBMITTED" }
    });
    fireEvent.change(within(inspector).getByDisplayValue("Complete"), {
      target: { value: "Submit Application" }
    });
    await user.click(within(inspector).getByRole("button", { name: "Apply" }));

    expect(onChange.mock.lastCall?.[0].transitions).toContainEqual({
      from: "submitApplication",
      to: "cityReview",
      event: "APPLICATION_SUBMITTED",
      label: "Submit Application"
    });
  });

  it("creates grouped merge requirements from the step inspector", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkflowBuilder initialDefinition={mergeDraftWorkflow} onChange={onChange} />);

    await user.click(screen.getByTestId("node-submitApplication"));
    await user.selectOptions(screen.getByLabelText("Prerequisite steps"), [
      "fillForm",
      "uploadDocuments",
      "payFee"
    ]);
    await user.click(screen.getByRole("button", { name: "Add requirement rule" }));

    expect(
      onChange.mock.lastCall?.[0].steps.find((step: { readonly id: string }) => step.id === "submitApplication")
    ).toMatchObject({
      dependencies: [
        {
          type: "all",
          stepIds: ["fillForm", "uploadDocuments", "payFee"]
        }
      ]
    });
  });

  it("creates atLeast dependency rules from the step inspector", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorkflowBuilder initialDefinition={mergeDraftWorkflow} onChange={onChange} />);

    await user.click(screen.getByTestId("node-submitApplication"));
    await user.selectOptions(screen.getByLabelText("Prerequisite steps"), [
      "fillForm",
      "uploadDocuments",
      "payFee"
    ]);
    fireEvent.change(screen.getByLabelText("Requirement rule"), { target: { value: "atLeast" } });
    fireEvent.change(screen.getByLabelText("Required count"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Add requirement rule" }));

    expect(
      onChange.mock.lastCall?.[0].steps.find((step: { readonly id: string }) => step.id === "submitApplication")
    ).toMatchObject({
      dependencies: [
        {
          type: "atLeast",
          count: 2,
          stepIds: ["fillForm", "uploadDocuments", "payFee"]
        }
      ]
    });
  });

  it("blocks publishing invalid definitions and shows validation errors", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    const invalidDefinition = {
      ...permitBuilderWorkflow,
      startStepIds: []
    };

    render(<WorkflowBuilder initialDefinition={invalidDefinition} onPublish={onPublish} />);
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(onPublish).not.toHaveBeenCalled();
    expect(screen.getByText("Fix validation errors before publishing.")).toBeTruthy();
    expect(screen.getAllByText(/startStepIds/i).some((element) => element.tagName.toLowerCase() === "li")).toBe(true);
  });

  it("publishes the runtime WorkflowDefinition without builder-only metadata", async () => {
    const user = userEvent.setup();
    const onPublish: WorkflowBuilderProps["onPublish"] = vi.fn();

    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} onPublish={onPublish} />);
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    const [runtimeDefinition, builderDefinition] = vi.mocked(onPublish).mock.lastCall ?? [];
    expect(runtimeDefinition?.id).toBe("permit");
    expect(runtimeDefinition).not.toHaveProperty("builder");
    expect(builderDefinition?.builder?.canvas?.nodes?.fillForm).toEqual({ x: 80, y: 80 });
  });

  it("runs the preview simulation using core workflow actions", async () => {
    const user = userEvent.setup();

    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} />);
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByText(/Revision 0/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Complete Fill Form" }));

    expect(screen.getByText(/Revision 1/)).toBeTruthy();
    expect(screen.getByText(/Completed Fill Form/i)).toBeTruthy();
  });

  it("renders read-only published definitions without edit affordances enabled", () => {
    render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} status="published" />);

    expect((screen.getByRole("button", { name: "Auto-layout" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add step" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Requirement" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Read only")).toBeTruthy();
  });

  it("shows publish errors without leaving the builder in a pending state", async () => {
    const user = userEvent.setup();

    render(
      <WorkflowBuilder
        initialDefinition={permitBuilderWorkflow}
        onPublish={() => {
          throw new Error("Save failed");
        }}
      />
    );
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Save failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("selects a valid step when a different definition is loaded", () => {
    const { rerender } = render(<WorkflowBuilder initialDefinition={permitBuilderWorkflow} />);

    rerender(<WorkflowBuilder initialDefinition={blankBuilderWorkflow} />);

    expect(screen.getByDisplayValue("start")).toBeTruthy();
    expect(screen.getByDisplayValue("Start")).toBeTruthy();
  });

  it("builds a merge, branch, and retry-loop workflow through UI controls", async () => {
    const user = userEvent.setup();
    const onPublish: WorkflowBuilderProps["onPublish"] = vi.fn();
    render(<WorkflowBuilder initialDefinition={blankBuilderWorkflow} onPublish={onPublish} />);

    renameSelectedStep("fillForm", "Fill Form");
    await addStepThroughUi(user, "uploadDocuments", "Upload Documents", true);
    await addStepThroughUi(user, "payFee", "Pay Fee", true);
    await addStepThroughUi(user, "submitApplication", "Submit Application");
    await addStepThroughUi(user, "cityReview", "City Review");
    await addStepThroughUi(user, "approved", "Approved");
    await addStepThroughUi(user, "fixIssues", "Fix Issues");

    await addRequirementThroughUi(user, "submitApplication", ["fillForm", "uploadDocuments", "payFee"], "all");
    await addRequirementThroughUi(user, "cityReview", ["submitApplication"], "all");

    await addActionThroughUi(user, "submitApplication", "cityReview", "COMPLETE_STEP", "Submit");
    await addActionThroughUi(user, "cityReview", "approved", "REVIEW_APPROVED", "Approve");
    await addActionThroughUi(user, "cityReview", "fixIssues", "REVIEW_REJECTED", "Reject");
    await addActionThroughUi(user, "fixIssues", "submitApplication", "COMPLETE_STEP", "Resubmit");

    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
    const [runtimeDefinition] = vi.mocked(onPublish).mock.lastCall ?? [];

    expect(validateWorkflowDefinition(runtimeDefinition!).valid).toBe(true);
    expect(runtimeDefinition?.startStepIds.sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
    expect(runtimeDefinition?.steps.find((step) => step.id === "submitApplication")?.dependencies).toEqual([
      { type: "all", stepIds: ["fillForm", "uploadDocuments", "payFee"] }
    ]);
    expect(runtimeDefinition?.transitions).toEqual(
      expect.arrayContaining([
        { from: "submitApplication", to: "cityReview", label: "Submit" },
        { from: "cityReview", to: "approved", event: "REVIEW_APPROVED", label: "Approve" },
        { from: "cityReview", to: "fixIssues", event: "REVIEW_REJECTED", label: "Reject" },
        { from: "fixIssues", to: "submitApplication", label: "Resubmit" }
      ])
    );
  });
});

function renameSelectedStep(stepId: string, name: string): void {
  fireEvent.change(screen.getByLabelText("Step id"), { target: { value: stepId } });
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: name } });
}

async function addStepThroughUi(
  user: ReturnType<typeof userEvent.setup>,
  stepId: string,
  name: string,
  isStart = false
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Add step" }));
  renameSelectedStep(stepId, name);
  if (isStart) {
    await user.click(screen.getByLabelText("Start step"));
  }
}

async function addRequirementThroughUi(
  user: ReturnType<typeof userEvent.setup>,
  targetStepId: string,
  sourceStepIds: readonly string[],
  rule: "all" | "any" | "atLeast",
  count?: number
): Promise<void> {
  await user.click(screen.getByTestId(`node-${targetStepId}`));
  await user.selectOptions(screen.getByLabelText("Prerequisite steps"), [...sourceStepIds]);
  fireEvent.change(screen.getByLabelText("Requirement rule"), { target: { value: rule } });
  if (rule === "atLeast") {
    fireEvent.change(screen.getByLabelText("Required count"), { target: { value: String(count ?? 1) } });
  }
  await user.click(screen.getByRole("button", { name: "Add requirement rule" }));
}

async function addActionThroughUi(
  user: ReturnType<typeof userEvent.setup>,
  sourceStepId: string,
  targetStepId: string,
  event: string,
  label: string
): Promise<void> {
  await user.click(screen.getByTestId(`node-${sourceStepId}`));
  fireEvent.change(screen.getByLabelText("Action target"), { target: { value: targetStepId } });
  fireEvent.change(screen.getByLabelText("Action event"), { target: { value: event } });
  fireEvent.change(screen.getByLabelText("Action label"), { target: { value: label } });
  await user.click(screen.getByRole("button", { name: "Add action / outcome" }));
}

const permitBuilderWorkflow = {
  id: "permit",
  name: "Permit Application",
  version: "1.0.0",
  description: "Builder fixture for a permit approval workflow.",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    {
      id: "fillForm",
      name: "Fill Form",
      description: "Applicant completes the main permit form."
    },
    {
      id: "uploadDocuments",
      name: "Upload Documents",
      description: "Applicant uploads supporting documents."
    },
    {
      id: "payFee",
      name: "Pay Fee",
      description: "Applicant pays the required fee."
    },
    {
      id: "submitApplication",
      name: "Submit Application",
      description: "Applicant submits once all prerequisites are done.",
      dependencies: [
        {
          type: "all",
          stepIds: ["fillForm", "uploadDocuments", "payFee"]
        }
      ]
    },
    {
      id: "cityReview",
      name: "City Review",
      description: "Reviewer accepts or rejects the application.",
      dependencies: [
        {
          type: "all",
          stepIds: ["submitApplication"]
        }
      ]
    },
    {
      id: "approved",
      name: "Approved",
      description: "Permit is approved.",
      dependencies: [
        {
          type: "all",
          stepIds: ["cityReview"]
        }
      ]
    },
    {
      id: "fixIssues",
      name: "Fix Issues",
      description: "Applicant fixes reviewer comments.",
      dependencies: [
        {
          type: "all",
          stepIds: ["cityReview"]
        }
      ]
    }
  ],
  transitions: [
    {
      from: "submitApplication",
      to: "cityReview"
    },
    {
      from: "cityReview",
      to: "approved",
      event: "REVIEW_APPROVED",
      label: "Approve"
    },
    {
      from: "cityReview",
      to: "fixIssues",
      event: "REVIEW_REJECTED",
      label: "Reject"
    },
    {
      from: "fixIssues",
      to: "submitApplication",
      label: "Resubmit"
    }
  ],
  builder: {
    canvas: {
      nodes: {
        fillForm: { x: 80, y: 80 },
        uploadDocuments: { x: 80, y: 240 },
        payFee: { x: 80, y: 400 },
        submitApplication: { x: 420, y: 240 },
        cityReview: { x: 760, y: 240 },
        approved: { x: 1100, y: 120 },
        fixIssues: { x: 760, y: 420 }
      }
    }
  }
} satisfies BuilderWorkflowDefinition;

const blankBuilderWorkflow = {
  id: "blank",
  name: "Blank Workflow",
  version: "0.1.0",
  startStepIds: ["start"],
  steps: [
    {
      id: "start",
      name: "Start",
      description: "First step."
    }
  ],
  transitions: []
} satisfies BuilderWorkflowDefinition;

const mergeDraftWorkflow = {
  id: "merge",
  name: "Merge Draft",
  version: "0.1.0",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    { id: "fillForm", name: "Fill Form" },
    { id: "uploadDocuments", name: "Upload Documents" },
    { id: "payFee", name: "Pay Fee" },
    { id: "submitApplication", name: "Submit Application" }
  ],
  transitions: [],
  builder: {
    canvas: {
      nodes: {
        fillForm: { x: 80, y: 80 },
        uploadDocuments: { x: 80, y: 240 },
        payFee: { x: 80, y: 400 },
        submitApplication: { x: 420, y: 240 }
      }
    }
  }
} satisfies BuilderWorkflowDefinition;
