import { applyWorkflowEvent, createWorkflowInstance, type WorkflowDefinition, type WorkflowInstance } from "@flowforge/core";
import { describe, expect, it } from "vitest";
import { buildWorkflowGraph } from "../src/index.ts";

describe("buildWorkflowGraph", () => {
  it("creates a linear workflow graph", () => {
    const definition: WorkflowDefinition = {
      id: "linear",
      name: "Linear",
      version: "1",
      startStepIds: ["draft"],
      steps: [
        { id: "draft", name: "Draft" },
        { id: "review", name: "Review" }
      ],
      transitions: [{ from: "draft", to: "review" }]
    };

    const graph = buildWorkflowGraph({ definition });

    expect(graph.nodes.map((node) => node.id)).toEqual(["draft", "review"]);
    expect(graph.edges).toMatchObject([
      {
        source: "draft",
        target: "review",
        kind: "transition",
        loop: false
      }
    ]);
    expect(graph.nodes.find((node) => node.id === "review")?.terminal).toBe(true);
  });

  it("maps parallel start steps to active graph nodes", () => {
    const graph = buildWorkflowGraph({
      definition: permitWorkflow,
      instance: createPermitInstance()
    });

    expect(graph.nodes.filter((node) => node.status === "active").map((node) => node.id).sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
  });

  it("creates merge dependency edges into submitApplication", () => {
    const graph = buildWorkflowGraph({
      definition: permitWorkflow,
      instance: createPermitInstance()
    });
    const dependencyEdges = graph.edges.filter(
      (edge) => edge.kind === "dependency" && edge.target === "submitApplication"
    );

    expect(dependencyEdges.map((edge) => edge.source).sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
    expect(dependencyEdges.every((edge) => edge.status === "blocked")).toBe(true);
  });

  it("does not duplicate dependency-backed completion transitions", () => {
    const graph = buildWorkflowGraph({ definition: permitWorkflow });

    expect(
      graph.edges.some(
        (edge) =>
          edge.kind === "transition" &&
          edge.source === "fillForm" &&
          edge.target === "submitApplication"
      )
    ).toBe(false);
  });

  it("creates approval and rejection branch edges", () => {
    const graph = buildWorkflowGraph({ definition: permitWorkflow });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "cityReview",
        target: "approved",
        label: "Approve",
        kind: "transition"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "cityReview",
        target: "fixIssues",
        label: "Reject",
        kind: "transition"
      })
    );
  });

  it("marks the rejection retry edge as a loop", () => {
    const graph = buildWorkflowGraph({ definition: permitWorkflow });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "fixIssues",
        target: "submitApplication",
        loop: true
      })
    );
  });

  it("maps completed, active, and blocked statuses from instance state", () => {
    const initial = createPermitInstance();
    const next = applyWorkflowEvent({
      definition: permitWorkflow,
      instance: initial,
      event: event(initial, "fillForm", "event_1")
    }).instance;
    const graph = buildWorkflowGraph({
      definition: permitWorkflow,
      instance: next
    });
    const statusById = new Map(graph.nodes.map((node) => [node.id, node.status]));

    expect(statusById.get("fillForm")).toBe("completed");
    expect(statusById.get("uploadDocuments")).toBe("active");
    expect(statusById.get("submitApplication")).toBe("blocked");
  });

  it("shows submitApplication as active after all merge prerequisites complete", () => {
    let instance = createPermitInstance();

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: event(instance, "fillForm", "event_1")
    }).instance;
    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: event(instance, "uploadDocuments", "event_2")
    }).instance;
    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: event(instance, "payFee", "event_3")
    }).instance;

    const graph = buildWorkflowGraph({
      definition: permitWorkflow,
      instance
    });

    expect(graph.nodes.find((node) => node.id === "submitApplication")?.status).toBe("active");
  });
});

function createPermitInstance(): WorkflowInstance {
  return createWorkflowInstance({
    definition: permitWorkflow,
    instanceId: "instance_1",
    now: "2026-01-01T00:00:00.000Z"
  });
}

function event(instance: WorkflowInstance, stepId: string, id: string) {
  return {
    id,
    instanceId: instance.id,
    type: "COMPLETE_STEP",
    stepId,
    occurredAt: `2026-01-01T00:00:0${instance.revision + 1}.000Z`
  };
}

const permitWorkflow: WorkflowDefinition = {
  id: "permit_application",
  name: "Permit Application",
  version: "1.0.0",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    { id: "fillForm", name: "Fill Form" },
    { id: "uploadDocuments", name: "Upload Documents" },
    { id: "payFee", name: "Pay Fee" },
    {
      id: "submitApplication",
      name: "Submit Application",
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
      dependencies: [
        {
          type: "all",
          stepIds: ["cityReview"]
        }
      ]
    }
  ],
  transitions: [
    { from: "fillForm", to: "submitApplication" },
    { from: "uploadDocuments", to: "submitApplication" },
    { from: "payFee", to: "submitApplication" },
    { from: "submitApplication", to: "cityReview" },
    { from: "cityReview", to: "approved", event: "REVIEW_APPROVED", label: "Approve" },
    { from: "cityReview", to: "fixIssues", event: "REVIEW_REJECTED", label: "Reject" },
    { from: "fixIssues", to: "submitApplication" }
  ]
};
