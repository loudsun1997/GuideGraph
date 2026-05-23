import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@guidegraph/core";
import {
  addCanvasStep,
  applyCanvasDependencyEdge,
  applyCanvasDependencyRule,
  applyCanvasTransitionEdge,
  assertDraftCanPublish,
  autoLayoutCanvas,
  builderDefinitionToWorkflowDefinition,
  canEditBuilder,
  createWorkflowFactory,
  createBuilderDefinition,
  createDefinitionSummary,
  createEmptyWorkflowSkeleton,
  createPreviewSimulation,
  definitionToCanvasModel,
  deleteStep,
  flattenDependencies,
  getBuilderWarnings,
  getCanvasActionLabelLayout,
  getDefaultActionIcon,
  normalizeBuilderDefinition,
  sendPreviewSimulationAction,
  setCanvasActionLabelIcon,
  setCanvasActionLabelPosition,
  setCanvasNodePosition,
  setDependencies,
  setStartStep,
  suggestPatchVersion,
  toTransitionDrafts,
  updateCanvasEdge,
  updateStep,
  workflow
} from "../src/index.ts";

describe("@guidegraph/builder", () => {
  it("builds workflow definitions with the fluent builder API", () => {
    const definition = workflow("permit-application", "Permit Application")
      .version("1.0.0")
      .description("Permit application review flow")
      .start(["fillForm", "uploadDocuments", "payFee"])
      .step("fillForm", "Fill Form")
      .step("uploadDocuments", "Upload Documents")
      .step("payFee", "Pay Fee")
      .step("submitApplication", "Submit Application", (step) =>
        step.requiresAll(["fillForm", "uploadDocuments", "payFee"])
      )
      .step("cityReview", "City Review", (step) => step.requiresAll("submitApplication"))
      .step("approved", "Approved", (step) => step.requiresAll("cityReview"))
      .step("fixIssues", "Fix Issues", (step) => step.requiresAll("cityReview"))
      .transition("submitApplication", "cityReview", { label: "Submit" })
      .transition("cityReview", "approved", { event: "REVIEW_APPROVED", label: "Approve" })
      .transition("cityReview", "fixIssues", { event: "REVIEW_REJECTED", label: "Reject" })
      .transition("fixIssues", "submitApplication", { label: "Resubmit" })
      .build();

    expect(definition).toMatchObject({
      id: "permit-application",
      name: "Permit Application",
      version: "1.0.0",
      startStepIds: ["fillForm", "uploadDocuments", "payFee"]
    });
    expect(definition.steps.find((step) => step.id === "submitApplication")?.dependencies).toEqual([
      { type: "all", stepIds: ["fillForm", "uploadDocuments", "payFee"] }
    ]);
    expect(definition.transitions).toContainEqual({
      from: "cityReview",
      to: "approved",
      event: "REVIEW_APPROVED",
      label: "Approve"
    });
  });

  it("supports reusable workflow factories", () => {
    const createReviewWorkflow = createWorkflowFactory((options: { readonly workflowId: string; readonly reviewer: string }) =>
      workflow(options.workflowId, "Review Flow")
        .version("1.0.0")
        .startStep("draft", "Draft")
        .step(options.reviewer, "Reviewer", (step) => step.requiresAll("draft"))
        .step("approved", "Approved", (step) => step.requiresAll(options.reviewer))
        .transition("draft", options.reviewer)
        .transition(options.reviewer, "approved", { event: "APPROVE", label: "Approve" })
        .build()
    );

    expect(createReviewWorkflow({ workflowId: "city-review", reviewer: "cityReview" })).toMatchObject({
      id: "city-review",
      startStepIds: ["draft"]
    });
  });

  it("authors extension metadata with the fluent builder API", () => {
    const definition = workflow("extensible-permit", "Extensible Permit")
      .version("1.0.0")
      .contextSchema({ required: ["permitId"] })
      .startStep("uploadDocuments", "Upload Documents", (step) =>
        step
          .metadata({ kind: "upload" })
          .assignment({ role: "applicant" })
          .timer({ kind: "deadline", after: "P3D" })
          .input({ required: ["sitePlan"] })
          .artifact({ id: "sitePlan", kind: "document", required: true })
          .effect({ type: "notification", target: "applicant" })
          .compensation({ effect: { type: "custom", target: "delete-uploaded-files" } })
      )
      .step("review", "Review", (step) => step.requiresAll("uploadDocuments").assignment({ role: "reviewer" }))
      .transition("uploadDocuments", "review", {
        effects: [{ type: "webhook", target: "https://example.test/workflow" }]
      })
      .effect({ type: "outbox", target: "workflow-events" })
      .migration({ fromVersion: "1.0.0", toVersion: "1.1.0", description: "Add inspection" })
      .build();

    expect(definition.contextSchema).toEqual({ required: ["permitId"] });
    expect(definition.steps[0]).toMatchObject({
      metadata: { kind: "upload" },
      assignment: { role: "applicant" },
      timers: [{ kind: "deadline", after: "P3D" }],
      input: { required: ["sitePlan"] },
      artifacts: [{ id: "sitePlan", kind: "document", required: true }],
      effects: [{ type: "notification", target: "applicant" }],
      compensation: { effect: { type: "custom", target: "delete-uploaded-files" } }
    });
    expect(definition.transitions?.[0]?.effects).toEqual([
      { type: "webhook", target: "https://example.test/workflow" }
    ]);
    expect(definition.effects).toEqual([{ type: "outbox", target: "workflow-events" }]);
    expect(definition.migrations).toEqual([
      { fromVersion: "1.0.0", toVersion: "1.1.0", description: "Add inspection" }
    ]);
  });

  it("creates empty and template-backed builder definitions", () => {
    const empty = createBuilderDefinition({
      id: "new-permit",
      name: "New Permit",
      version: "1.0.0"
    });
    const templated = createBuilderDefinition({
      id: "copied-permit",
      name: "Copied Permit",
      version: "2.0.0",
      template: permitWorkflow
    });

    expect(empty.steps).toEqual([{ id: "start", name: "Start" }]);
    expect(templated.id).toBe("copied-permit");
    expect(templated.steps.map((step) => step.id)).toContain("fillForm");
    expect(assertDraftCanPublish(templated).valid).toBe(true);
  });

  it("normalizes metadata while exporting runtime definitions without builder fields", () => {
    const definition = normalizeBuilderDefinition({
      id: " permit ",
      name: " Permit ",
      version: " 1 ",
      description: " Test ",
      startStepIds: [" start ", "start"],
      steps: [{ id: " start ", name: " Start ", description: " Begin " }],
      transitions: []
    });
    const runtimeDefinition = builderDefinitionToWorkflowDefinition(definition);

    expect(definition).toMatchObject({
      id: "permit",
      name: "Permit",
      version: "1",
      description: "Test",
      startStepIds: ["start"]
    });
    expect("description" in runtimeDefinition.steps[0]!).toBe(false);
  });

  it("summarizes definitions and returns warnings", () => {
    const definition = createBuilderDefinition({
      id: "permit",
      name: "Permit",
      version: "1.0.0",
      template: permitWorkflow
    });
    const summary = createDefinitionSummary({ definition, status: "draft" });
    const warnings = getBuilderWarnings({ definition, hasPublishedVersions: false });

    expect(summary).toMatchObject({
      dependencyCount: 4,
      loopTransitionCount: 1,
      startStepCount: 3,
      transitionCount: 7,
      valid: true
    });
    expect(warnings.map((warning) => warning.code)).toContain("no-published-versions");
  });

  it("edits steps, start step ids, and canvas positions", () => {
    let definition = createEmptyWorkflowSkeleton("test", "1", "Test");

    definition = addCanvasStep(definition, { x: 300, y: 100 }, { name: "Review" });
    const reviewStep = definition.steps.at(-1)!;
    definition = updateStep(definition, reviewStep.id, {
      id: "review",
      name: "Review",
      description: "Review the application"
    });
    definition = setStartStep(definition, "review", true);
    definition = setCanvasNodePosition(definition, "review", { x: 420, y: 240 });

    expect(definition.startStepIds).toContain("review");
    expect(definition.builder?.canvas?.nodes?.review).toEqual({ x: 420, y: 240 });
    expect(definition.steps.find((step) => step.id === "review")?.description).toBe("Review the application");
  });

  it("blocks deleting referenced steps", () => {
    const definition = applyCanvasDependencyEdge(
      {
        ...createEmptyWorkflowSkeleton("test", "1", "Test"),
        steps: [
          { id: "start", name: "Start" },
          { id: "review", name: "Review" }
        ]
      },
      { source: "start", target: "review" }
    ).definition;
    const result = deleteStep(definition, "start");

    expect(result.changed).toBe(false);
    expect(result.error).toContain("Cannot delete start");
  });

  it("creates, converts, updates, and deletes canvas edges", () => {
    const baseDefinition = {
      ...createEmptyWorkflowSkeleton("test", "1", "Test"),
      steps: [
        { id: "start", name: "Start" },
        { id: "review", name: "Review" }
      ]
    };
    const dependencyResult = applyCanvasDependencyEdge(baseDefinition, {
      source: "start",
      target: "review"
    });
    const dependencyEdge = definitionToCanvasModel(dependencyResult.definition).edges.find((edge) => edge.kind === "dependency")!;
    const updated = updateCanvasEdge(dependencyResult.definition, dependencyEdge, {
      kind: "transition",
      source: "start",
      target: "review",
      event: "SUBMIT",
      label: "Submit"
    });
    const canvas = definitionToCanvasModel(updated.definition);

    expect(dependencyResult.changed).toBe(true);
    expect(updated.error).toBeUndefined();
    expect(canvas.edges).toContainEqual(
      expect.objectContaining({ kind: "transition", event: "SUBMIT", label: "Submit" })
    );
    expect(canvas.edges.some((edge) => edge.kind === "dependency")).toBe(false);
  });

  it("creates grouped dependency rules for merge gates", () => {
    const baseDefinition = {
      ...createEmptyWorkflowSkeleton("test", "1", "Test"),
      startStepIds: ["fillForm", "uploadDocuments", "payFee"],
      steps: [
        { id: "fillForm", name: "Fill Form" },
        { id: "uploadDocuments", name: "Upload Documents" },
        { id: "payFee", name: "Pay Fee" },
        { id: "submitApplication", name: "Submit Application" }
      ]
    };
    const allRule = applyCanvasDependencyRule(baseDefinition, {
      sourceStepIds: ["fillForm", "uploadDocuments", "payFee"],
      target: "submitApplication",
      type: "all"
    });
    const atLeastRule = applyCanvasDependencyRule(baseDefinition, {
      sourceStepIds: ["fillForm", "uploadDocuments", "payFee"],
      target: "submitApplication",
      type: "atLeast",
      count: 2
    });

    expect(allRule.error).toBeUndefined();
    expect(allRule.definition.steps.find((step) => step.id === "submitApplication")?.dependencies).toEqual([
      { type: "all", stepIds: ["fillForm", "uploadDocuments", "payFee"] }
    ]);
    expect(atLeastRule.definition.steps.find((step) => step.id === "submitApplication")?.dependencies).toEqual([
      { type: "atLeast", count: 2, stepIds: ["fillForm", "uploadDocuments", "payFee"] }
    ]);
    expect(
      applyCanvasDependencyRule(baseDefinition, {
        sourceStepIds: ["fillForm", "submitApplication"],
        target: "submitApplication"
      }).error
    ).toContain("cannot depend on itself");
  });

  it("persists action label layout metadata separately from transitions", () => {
    const definition = applyCanvasTransitionEdge(
      {
        ...createEmptyWorkflowSkeleton("test", "1", "Test"),
        steps: [
          { id: "start", name: "Start" },
          { id: "review", name: "Review" }
        ]
      },
      { source: "start", target: "review", event: "SUBMIT", label: "Submit" }
    ).definition;
    const edge = definitionToCanvasModel(definition).edges.find((entry) => entry.kind === "transition")!;
    const positioned = setCanvasActionLabelPosition(definition, edge, { x: 200, y: 120 });
    const withIcon = setCanvasActionLabelIcon(positioned, edge, "send");

    expect(getCanvasActionLabelLayout(withIcon, edge)).toEqual({
      icon: "send",
      position: { x: 200, y: 120 }
    });
    expect(withIcon.transitions).toEqual(definition.transitions);
  });

  it("round-trips dependency drafts and transition drafts", () => {
    const definition = createEmptyWorkflowSkeleton("test", "1", "Test");
    const withDependencies = setDependencies(
      {
        ...definition,
        steps: [
          { id: "start", name: "Start" },
          { id: "a", name: "A" },
          { id: "review", name: "Review" }
        ]
      },
      [{ targetStepId: "review", sourceStepIds: ["start", "a"], type: "atLeast", count: 2 }]
    );

    expect(flattenDependencies(withDependencies)).toEqual([
      { targetStepId: "review", sourceStepIds: ["start", "a"], type: "atLeast", count: 2 }
    ]);
    expect(toTransitionDrafts({ ...withDependencies, transitions: [{ from: "review", to: "a" }] })).toEqual([
      { from: "review", to: "a", event: "COMPLETE_STEP", label: "" }
    ]);
  });

  it("runs preview simulations through the core engine", () => {
    const definition = createBuilderDefinition({
      id: "permit",
      name: "Permit",
      version: "1.0.0",
      template: permitWorkflow
    });
    const simulation = createPreviewSimulation(definition);
    const nextSimulation = sendPreviewSimulationAction({
      definition,
      simulation,
      action: simulation.availableActions[0]!
    });

    expect(nextSimulation.instance.revision).toBe(1);
    expect(nextSimulation.history.length).toBeGreaterThan(simulation.history.length);
  });

  it("auto-layouts deterministically and exposes utility helpers", () => {
    const definition = autoLayoutCanvas(
      createBuilderDefinition({
        id: "permit",
        name: "Permit",
        version: "1.0.0",
        template: permitWorkflow
      })
    );

    expect(definition.builder?.canvas?.nodes?.fillForm).toEqual({ x: 80, y: 100 });
    expect(definition.builder?.canvas?.nodes?.submitApplication).toEqual({ x: 420, y: 290 });
    expect(definition.builder?.canvas?.nodes?.cityReview).toEqual({ x: 760, y: 290 });
    expect(definition.builder?.canvas?.nodes?.approved?.x).toBeGreaterThan(definition.builder?.canvas?.nodes?.cityReview?.x ?? 0);
    expect(definition.builder?.canvas?.actionLabels?.["cityReview:approved:REVIEW_APPROVED"]?.position?.y).toBeLessThan(
      definition.builder?.canvas?.actionLabels?.["cityReview:fixIssues:REVIEW_REJECTED"]?.position?.y ?? 0
    );
    expect(definition.builder?.canvas?.actionLabels?.["fixIssues:submitApplication:COMPLETE_STEP"]?.position?.y).toBeGreaterThan(
      definition.builder?.canvas?.nodes?.fixIssues?.y ?? 0
    );
    expect(suggestPatchVersion("1.0.0")).toBe("1.0.1");
    expect(suggestPatchVersion("2026-05")).toBeUndefined();
    expect(canEditBuilder("draft")).toBe(true);
    expect(canEditBuilder("published")).toBe(false);
    expect(getDefaultActionIcon({ event: "REVIEW_REJECTED", label: "Reject" })).toBe("x");
  });
});

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
      dependencies: [{ type: "all", stepIds: ["fillForm", "uploadDocuments", "payFee"] }]
    },
    {
      id: "cityReview",
      name: "City Review",
      dependencies: [{ type: "all", stepIds: ["submitApplication"] }]
    },
    {
      id: "approved",
      name: "Approved",
      dependencies: [{ type: "all", stepIds: ["cityReview"] }]
    },
    {
      id: "fixIssues",
      name: "Fix Issues",
      dependencies: [{ type: "all", stepIds: ["cityReview"] }]
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
