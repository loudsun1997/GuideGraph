import { describe, expect, it } from "vitest";
import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions
} from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("applyWorkflowEvent", () => {
  it("completes an active step and updates instance metadata", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1",
      actorId: "user_1"
    });

    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fillForm", {
        id: "event_1",
        occurredAt: "2026-01-01T00:00:01.000Z"
      })
    });

    expect(result.instance.stepStates.fillForm?.status).toBe("completed");
    expect(result.instance.stepStates.fillForm?.completedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(result.instance.revision).toBe(instance.revision + 1);
    expect(result.instance.history).toHaveLength(instance.history.length + 1);
    expect(result.instance.activeStepIds).not.toContain("fillForm");
    expect(result.availableActions.map((action) => action.stepId).sort()).toEqual(
      ["payFee", "uploadDocuments"].sort()
    );
  });

  it("keeps other active steps active when one parallel step completes", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fillForm")
    });

    expect(result.instance.stepStates.uploadDocuments?.status).toBe("active");
    expect(result.instance.stepStates.payFee?.status).toBe("active");
    expect(result.instance.activeStepIds).toContain("uploadDocuments");
    expect(result.instance.activeStepIds).toContain("payFee");
  });

  it("rejects invalid events", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(() =>
      applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, "submitApplication")
      })
    ).toThrow("Cannot apply COMPLETE_STEP to inactive step: submitApplication");

    expect(() =>
      applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, "fillForm", {
          instanceId: "different_instance"
        })
      })
    ).toThrow("Workflow event instanceId does not match the instance.");

    expect(() =>
      applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, "fillForm", {
          type: "UNKNOWN_EVENT"
        })
      })
    ).toThrow("No transition found for event UNKNOWN_EVENT from step fillForm.");
  });

  it("rejects completing an already completed step", () => {
    let instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fillForm")
    }).instance;

    expect(instance.stepStates.fillForm?.status).toBe("completed");

    expect(() =>
      applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, "fillForm")
      })
    ).toThrow("Cannot apply COMPLETE_STEP to inactive step: fillForm");
  });

  it("rejects events applied with a different workflow definition", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(() =>
      applyWorkflowEvent({
        definition: {
          ...permitWorkflow,
          id: "different_workflow"
        },
        instance,
        event: workflowEvent(instance, "fillForm")
      })
    ).toThrow("Event definition does not match the workflow instance.");
  });

  it("updates available actions after each event", () => {
    let instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(getAvailableActions(permitWorkflow, instance)).not.toContainEqual(
      expect.objectContaining({
        stepId: "submitApplication"
      })
    );

    for (const stepId of ["fillForm", "uploadDocuments", "payFee"]) {
      instance = applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, stepId)
      }).instance;
    }

    expect(getAvailableActions(permitWorkflow, instance)).toContainEqual(
      expect.objectContaining({
        type: "COMPLETE_STEP",
        stepId: "submitApplication"
      })
    );
  });
});
