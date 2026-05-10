import { describe, expect, it } from "vitest";
import { applyWorkflowEvent, createWorkflowInstance } from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("history generation", () => {
  it("creates a history entry for every applied event", () => {
    const instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const event = workflowEvent(instance, "fillForm", {
      id: "event_1",
      actorId: "user_1",
      occurredAt: "2026-01-01T00:00:01.000Z"
    });
    const result = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event
    });
    const historyEntry = result.instance.history.at(-1);

    expect(historyEntry).toEqual({
      id: "instance_1:event_1",
      eventId: "event_1",
      instanceId: "instance_1",
      eventType: "COMPLETE_STEP",
      message: "Completed Fill Form.",
      occurredAt: "2026-01-01T00:00:01.000Z",
      actorId: "user_1",
      stepId: "fillForm"
    });
  });

  it("increments revision once per applied event", () => {
    let instance = createWorkflowInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(instance.revision).toBe(0);

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "fillForm")
    }).instance;

    expect(instance.revision).toBe(1);

    instance = applyWorkflowEvent({
      definition: permitWorkflow,
      instance,
      event: workflowEvent(instance, "uploadDocuments")
    }).instance;

    expect(instance.revision).toBe(2);
  });
});
