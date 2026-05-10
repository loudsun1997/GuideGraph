import { describe, expect, it } from "vitest";
import { createWorkflowInstance, getAvailableActions } from "../src/index.ts";
import { permitWorkflow } from "./fixtures/permitWorkflow.ts";

describe("createWorkflowInstance", () => {
  it("starts permit applications with parallel active steps", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1",
      actorId: "user_1",
      now: "2026-01-01T00:00:00.000Z"
    });

    expect(instance.status).toBe("active");
    expect([...instance.activeStepIds].sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
    expect(instance.stepStates.fillForm?.status).toBe("active");
    expect(instance.stepStates.uploadDocuments?.status).toBe("active");
    expect(instance.stepStates.payFee?.status).toBe("active");
    expect(instance.stepStates.submitApplication?.status).toBe("blocked");
    expect(instance.stepStates.cityReview?.status).toBe("blocked");
  });

  it("returns available actions only for active start steps", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1",
      actorId: "user_1"
    });

    const actions = getAvailableActions(permitWorkflow, instance);

    expect(actions.map((action) => action.stepId).sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
    expect(actions).not.toContainEqual(
      expect.objectContaining({
        stepId: "submitApplication"
      })
    );
  });
});
