import { describe, expect, it } from "vitest";
import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions
} from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("getAvailableActions", () => {
  it("does not enable submit before prerequisites are complete", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(getAvailableActions(permitWorkflow, instance)).not.toContainEqual(
      expect.objectContaining({
        stepId: "submitApplication"
      })
    );
  });

  it("enables submit after prerequisites are complete", () => {
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

    expect(getAvailableActions(permitWorkflow, instance)).toEqual([
      expect.objectContaining({
        type: "COMPLETE_STEP",
        stepId: "submitApplication",
        label: "Complete Submit Application"
      })
    ]);
  });

  it("returns branch actions for review", () => {
    let instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    for (const stepId of ["fillForm", "uploadDocuments", "payFee", "submitApplication"]) {
      instance = applyWorkflowEvent({
        definition: permitWorkflow,
        instance,
        event: workflowEvent(instance, stepId)
      }).instance;
    }

    expect(getAvailableActions(permitWorkflow, instance)).toEqual([
      {
        type: "REVIEW_APPROVED",
        stepId: "cityReview",
        label: "Approve"
      },
      {
        type: "REVIEW_REJECTED",
        stepId: "cityReview",
        label: "Reject"
      }
    ]);
  });
});
