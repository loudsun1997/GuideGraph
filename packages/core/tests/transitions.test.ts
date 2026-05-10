import { describe, expect, it } from "vitest";
import { applyWorkflowEvent, createWorkflowInstance } from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("transitions", () => {
  it("follows the approval branch", () => {
    const instance = advanceToCityReview();

    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "cityReview", {
        type: "REVIEW_APPROVED"
      })
    });

    expect(result.instance.stepStates.cityReview?.status).toBe("completed");
    expect(result.instance.stepStates.approved?.status).toBe("active");
    expect(result.instance.activeStepIds).toContain("approved");
    expect(result.instance.activeStepIds).not.toContain("fixIssues");
  });

  it("follows the rejection branch", () => {
    const instance = advanceToCityReview();

    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "cityReview", {
        type: "REVIEW_REJECTED"
      })
    });

    expect(result.instance.stepStates.cityReview?.status).toBe("completed");
    expect(result.instance.stepStates.fixIssues?.status).toBe("active");
    expect(result.instance.activeStepIds).toContain("fixIssues");
    expect(result.instance.activeStepIds).not.toContain("approved");
  });

  it("supports rejection loops back to resubmission and review", () => {
    let instance = advanceToCityReview();

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "cityReview", {
        type: "REVIEW_REJECTED"
      })
    }).instance;

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fixIssues")
    }).instance;

    expect(instance.stepStates.submitApplication?.status).toBe("active");
    expect(instance.activeStepIds).toContain("submitApplication");

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "submitApplication")
    }).instance;

    expect(instance.stepStates.cityReview?.status).toBe("active");
    expect(instance.activeStepIds).toContain("cityReview");
  });
});

function advanceToCityReview() {
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

  expect(instance.stepStates.cityReview?.status).toBe("active");

  return instance;
}
