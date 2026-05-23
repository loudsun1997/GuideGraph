# @guidegraph/builder

Framework-agnostic workflow definition builder utilities for GuideGraph.

Use this package when an app needs to create or edit workflow definitions without hand-writing raw `WorkflowDefinition` objects.

## What It Does

`@guidegraph/builder` provides pure TypeScript helpers for:

- authoring workflows with a fluent code-first builder API
- creating reusable workflow factories/templates
- creating blank builder drafts
- converting runtime definitions into editable builder definitions
- converting builder definitions back into plain runtime definitions
- adding, updating, deleting, and renaming steps
- marking start steps
- creating dependency edges
- creating transition/action edges
- storing builder-only canvas positions
- storing builder-only action label positions and icons
- validating drafts through `@guidegraph/core`
- generating summaries and warnings
- running preview simulations through the core engine

Builder metadata is stored under `definition.builder`. Runtime conversion strips that metadata.

## Basic Usage

### Code-First Builder API

Use the fluent API when developers or AI agents are authoring workflows in code.

```ts
import { workflow } from "@guidegraph/builder";

export const permitWorkflow = workflow("permit-application", "Permit Application")
  .version("1.0.0")
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
  .transition("fillForm", "submitApplication")
  .transition("uploadDocuments", "submitApplication")
  .transition("payFee", "submitApplication")
  .transition("submitApplication", "cityReview", { label: "Submit" })
  .transition("cityReview", "approved", {
    event: "REVIEW_APPROVED",
    label: "Approve"
  })
  .transition("cityReview", "fixIssues", {
    event: "REVIEW_REJECTED",
    label: "Reject"
  })
  .transition("fixIssues", "submitApplication", { label: "Resubmit" })
  .build();
```

The fluent builder validates through `@guidegraph/core` and returns a plain `WorkflowDefinition`.

The fluent API also supports real-app extension metadata:

```ts
workflow("permit-application", "Permit Application")
  .version("1.0.0")
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
  .step("review", "Review", (step) =>
    step.requiresAll("uploadDocuments").assignment({ role: "reviewer" })
  )
  .transition("uploadDocuments", "review", {
    effects: [{ type: "webhook", target: "https://example.test/workflow" }]
  })
  .contextSchema({ required: ["permitId"] })
  .migration({
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    description: "Add inspection step later"
  })
  .build();
```

Use factories when an app has reusable workflow templates:

```ts
import { createWorkflowFactory, workflow } from "@guidegraph/builder";

export const createReviewWorkflow = createWorkflowFactory(
  (options: { workflowId: string; reviewerStepId: string }) =>
    workflow(options.workflowId, "Review Workflow")
      .version("1.0.0")
      .startStep("draft", "Draft")
      .step(options.reviewerStepId, "Review", (step) => step.requiresAll("draft"))
      .step("approved", "Approved", (step) => step.requiresAll(options.reviewerStepId))
      .transition("draft", options.reviewerStepId)
      .transition(options.reviewerStepId, "approved", {
        event: "APPROVE",
        label: "Approve"
      })
      .build()
);
```

### Draft/Canvas Utilities

```ts
import {
  addCanvasStep,
  applyCanvasDependencyEdge,
  builderDefinitionToWorkflowDefinition,
  createBuilderDefinition
} from "@guidegraph/builder";

let draft = createBuilderDefinition({
  id: "permit-application",
  name: "Permit Application",
  version: "0.1.0"
});

draft = addCanvasStep(draft, { x: 360, y: 120 }, { name: "Review Application" });
draft = applyCanvasDependencyEdge(draft, {
  source: "start",
  target: "review_application"
}).definition;

const runtimeDefinition = builderDefinitionToWorkflowDefinition(draft);
```

## Key Exports

- `createBuilderDefinition()`
- `workflow()`
- `defineWorkflow()`
- `createWorkflowFactory()`
- `workflowDefinitionToBuilderDefinition()`
- `builderDefinitionToWorkflowDefinition()`
- `validateBuilderDefinition()`
- `createDefinitionSummary()`
- `getBuilderWarnings()`
- `createPreviewSimulation()`
- `sendPreviewSimulationAction()`
- `addStep()`
- `addCanvasStep()`
- `updateStep()`
- `setStartStep()`
- `deleteStep()`
- `definitionToCanvasModel()`
- `autoLayoutCanvas()`
- `applyCanvasDependencyEdge()`
- `applyCanvasTransitionEdge()`
- `updateCanvasEdge()`
- `deleteCanvasEdge()`

## Design Notes

This package does not depend on React, React Flow, HTTP, server, or storage packages. Host apps own definition persistence, publish workflow, permissions, and domain-specific configuration.
