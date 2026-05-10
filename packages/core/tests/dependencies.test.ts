import { describe, expect, it } from "vitest";
import {
  applyWorkflowEvent,
  createWorkflowInstance,
  type WorkflowDefinition
} from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("dependency rules", () => {
  it("keeps a merge blocked until all prerequisites are complete", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fillForm")
    });

    const submitApplication = result.instance.stepStates.submitApplication;

    expect(submitApplication?.status).toBe("blocked");
    expect(submitApplication?.blockedReason).toContain("uploadDocuments");
    expect(submitApplication?.blockedReason).toContain("payFee");
    expect(result.instance.activeStepIds).not.toContain("submitApplication");
  });

  it("unlocks a merge when all prerequisites are complete", () => {
    let instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    for (const stepId of ["fillForm", "uploadDocuments", "payFee"]) {
      instance = applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, stepId)
      }).instance;
    }

    expect(instance.stepStates.submitApplication?.status).toBe("active");
    expect(instance.stepStates.submitApplication?.blockedReason).toBeUndefined();
    expect(instance.activeStepIds).toContain("submitApplication");
  });

  it("supports any dependencies", () => {
    let instance = createWorkflowInstance({
      definition: dependencyWorkflow({
        type: "any",
        stepIds: ["alpha", "beta"]
      }),
      instanceId: "instance_1"
    });

    instance = applyWorkflowEvent({
      definition: dependencyWorkflow({
        type: "any",
        stepIds: ["alpha", "beta"]
      }),
      instance,
      event: workflowEvent(instance, "alpha")
    }).instance;

    expect(instance.stepStates.target?.status).toBe("active");
  });

  it("supports atLeast dependencies", () => {
    const definition = dependencyWorkflow({
      type: "atLeast",
      count: 2,
      stepIds: ["alpha", "beta", "gamma"]
    });
    let instance = createWorkflowInstance({
      definition,
      instanceId: "instance_1"
    });

    instance = applyWorkflowEvent({
      definition,
      instance,
      event: workflowEvent(instance, "alpha")
    }).instance;

    expect(instance.stepStates.target?.status).toBe("blocked");

    instance = applyWorkflowEvent({
      definition,
      instance,
      event: workflowEvent(instance, "beta")
    }).instance;

    expect(instance.stepStates.target?.status).toBe("active");
  });
});

function dependencyWorkflow(
  dependency: WorkflowDefinition["steps"][number]["dependencies"][number]
): WorkflowDefinition {
  const startStepIds = dependency.stepIds;

  return {
    id: "dependency_workflow",
    name: "Dependency Workflow",
    version: "1.0.0",
    startStepIds,
    steps: [
      {
        id: "alpha",
        name: "Alpha"
      },
      {
        id: "beta",
        name: "Beta"
      },
      {
        id: "gamma",
        name: "Gamma"
      },
      {
        id: "target",
        name: "Target",
        dependencies: [dependency]
      }
    ],
    transitions: startStepIds.map((stepId) => ({
      from: stepId,
      to: "target"
    }))
  };
}
