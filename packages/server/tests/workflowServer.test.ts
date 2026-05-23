import { describe, expect, it } from "vitest";
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("createWorkflowServer", () => {
  it("creates and saves an instance in memory storage", async () => {
    const { server, storage } = createTestServer();

    const result = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1",
      actorId: "user_1",
      now: "2026-01-01T00:00:00.000Z"
    });

    const storedInstance = await storage.getInstance("instance_1");

    expect(result.instance.status).toBe("active");
    expect(storedInstance?.id).toBe("instance_1");
    expect(storedInstance?.activeStepIds.sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
  });

  it("loads an existing instance", async () => {
    const { server } = createTestServer();

    await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const instance = await server.getInstance("instance_1");

    expect(instance.id).toBe("instance_1");
    expect(instance.workflowId).toBe("permit_application");
  });

  it("sends an event through the core engine and persists state changes", async () => {
    const { server, storage } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const result = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      event: workflowEvent(createResult.instance, "fillForm")
    });
    const storedInstance = await storage.getInstance("instance_1");

    expect(result.instance.stepStates.fillForm?.status).toBe("completed");
    expect(result.instance.revision).toBe(1);
    expect(result.changedStepIds).toContain("fillForm");
    expect(result.changedStepIds).toContain("submitApplication");
    expect(storedInstance?.stepStates.fillForm?.status).toBe("completed");
    expect(storedInstance?.revision).toBe(1);
  });

  it("appends events and history entries", async () => {
    const { server, storage } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const result = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      event: workflowEvent(createResult.instance, "fillForm", {
        id: "event_1"
      })
    });
    const events = await storage.listEvents("instance_1");
    const history = await server.getHistory("instance_1");

    expect(events).toHaveLength(1);
    expect(events[0]?.event.id).toBe("event_1");
    expect(result.historyEntry.eventId).toBe("event_1");
    expect(history.map((entry) => entry.eventId)).toEqual(["instance_1:created", "event_1"]);
  });

  it("returns available actions for the persisted instance", async () => {
    const { server } = createTestServer();

    await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const actions = await server.getAvailableActions(permitWorkflow, "instance_1");

    expect(actions.map((action) => action.stepId).sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
  });

  it("does not double-apply duplicate idempotency keys", async () => {
    const { server, storage } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(createResult.instance, "fillForm", {
      id: "event_1"
    });

    const firstResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      idempotencyKey: "request_1",
      event
    });
    const secondResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      idempotencyKey: "request_1",
      event
    });
    const storedEvents = await storage.listEvents("instance_1");
    const history = await server.getHistory("instance_1");

    expect(firstResult.instance.revision).toBe(1);
    expect(secondResult.instance.revision).toBe(1);
    expect(secondResult).toEqual(firstResult);
    expect(storedEvents).toHaveLength(1);
    expect(history.map((entry) => entry.eventId)).toEqual(["instance_1:created", "event_1"]);
  });

  it("returns cached idempotency results before checking stale expected revisions", async () => {
    const { server, storage } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    let instance = createResult.instance;

    instance = (
      await server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        expectedRevision: 0,
        event: workflowEvent(instance, "fillForm", {
          id: "event_1"
        })
      })
    ).instance;

    const idempotentEvent = workflowEvent(instance, "uploadDocuments", {
      id: "event_2"
    });
    const firstResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 1,
      idempotencyKey: "abc",
      event: idempotentEvent
    });
    const secondResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 1,
      idempotencyKey: "abc",
      event: idempotentEvent
    });
    const storedEvents = await storage.listEvents("instance_1");

    expect(firstResult.instance.revision).toBe(2);
    expect(secondResult).toEqual(firstResult);
    expect(storedEvents.map((event) => event.event.id)).toEqual(["event_1", "event_2"]);
  });

  it("rejects idempotency key reuse with a different event payload", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(createResult.instance, "fillForm", {
      id: "event_1"
    });

    await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      idempotencyKey: "request_1",
      event
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        idempotencyKey: "request_1",
        event: {
          ...event,
          stepId: "uploadDocuments"
        }
      })
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("does not mutate the previously loaded instance by reference", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const previousInstance = await server.getInstance("instance_1");

    await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      event: workflowEvent(createResult.instance, "fillForm")
    });

    expect(previousInstance.revision).toBe(0);
    expect(previousInstance.stepStates.fillForm?.status).toBe("active");
    expect(previousInstance.activeStepIds).toContain("fillForm");
  });

  it("calculates available actions from persisted state", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      event: workflowEvent(createResult.instance, "fillForm")
    });

    const actions = await server.getAvailableActions(permitWorkflow, "instance_1");

    expect(actions.map((action) => action.stepId).sort()).toEqual(
      ["payFee", "uploadDocuments"].sort()
    );
    expect(actions.map((action) => action.stepId)).not.toContain("fillForm");
  });

  it("fails cleanly on revision conflict", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        expectedRevision: 42,
        event: workflowEvent(createResult.instance, "fillForm")
      })
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT"
    });
  });

  it("fails cleanly for unknown instances", async () => {
    const { server } = createTestServer();

    await expect(server.getInstance("missing_instance")).rejects.toMatchObject({
      code: "INSTANCE_NOT_FOUND"
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "missing_instance",
        event: {
          id: "event_1",
          instanceId: "missing_instance",
          type: "COMPLETE_STEP",
          stepId: "fillForm",
          occurredAt: "2026-01-01T00:00:01.000Z"
        }
      })
    ).rejects.toMatchObject({
      code: "INSTANCE_NOT_FOUND"
    });
  });

  it("fails cleanly for invalid events", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        event: workflowEvent(createResult.instance, "submitApplication")
      })
    ).rejects.toMatchObject({
      code: "INVALID_EVENT"
    });
  });

  it("fails cleanly for workflow definition mismatches", async () => {
    const { server } = createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      server.sendEvent({
        definition: {
          ...permitWorkflow,
          id: "different_workflow"
        },
        instanceId: "instance_1",
        event: workflowEvent(createResult.instance, "fillForm")
      })
    ).rejects.toMatchObject({
      code: "INVALID_EVENT"
    });
  });
});

function createTestServer() {
  const storage = new MemoryWorkflowStorage();
  const server = createWorkflowServer({ storage });

  return { server, storage };
}
