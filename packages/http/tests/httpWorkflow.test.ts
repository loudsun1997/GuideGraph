import type { WorkflowEvent, WorkflowInstance } from "@flowforge/core";
import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";
import { describe, expect, it } from "vitest";
import {
  createFlowForgeHttpHandler,
  createHttpWorkflowClient,
  type FlowForgeHttpHandler
} from "../src/index.ts";
import { permitWorkflow } from "./fixtures/permitWorkflow.ts";

describe("@flowforge/http", () => {
  it("creates an instance over HTTP", async () => {
    const { client } = createTestClient();

    const result = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1",
      now: "2026-01-01T00:00:00.000Z"
    });

    expect(result.instance.id).toBe("instance_1");
    expect(result.instance.activeStepIds.sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
  });

  it("gets an instance over HTTP", async () => {
    const { client } = createTestClient();

    await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const instance = await client.getInstance("instance_1");

    expect(instance.workflowId).toBe("permit_application");
    expect(instance.id).toBe("instance_1");
  });

  it("sends an event over HTTP and persists state changes", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const result = await sendStep(client, created.instance, "fillForm", "event_1");
    const reloaded = await client.getInstance("instance_1");

    expect(result.instance.revision).toBe(1);
    expect(result.instance.stepStates.fillForm?.status).toBe("completed");
    expect(reloaded.stepStates.fillForm?.status).toBe("completed");
  });

  it("gets history over HTTP", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await sendStep(client, created.instance, "fillForm", "event_1");

    const history = await client.getHistory("instance_1");

    expect(history.map((entry) => entry.eventId)).toEqual(["instance_1:created", "event_1"]);
  });

  it("gets available actions over HTTP", async () => {
    const { client } = createTestClient();

    await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    const actions = await client.getAvailableActions(permitWorkflow, "instance_1");

    expect(actions.map((action) => action.stepId).sort()).toEqual(
      ["fillForm", "payFee", "uploadDocuments"].sort()
    );
  });

  it("unlocks a merge over HTTP", async () => {
    const { client } = createTestClient();
    let instance = (
      await client.createInstance({
        definition: permitWorkflow,
        instanceId: "instance_1"
      })
    ).instance;

    instance = (await sendStep(client, instance, "fillForm", "event_1")).instance;
    expect(instance.stepStates.submitApplication?.status).toBe("blocked");

    instance = (await sendStep(client, instance, "uploadDocuments", "event_2")).instance;
    instance = (await sendStep(client, instance, "payFee", "event_3")).instance;

    expect(instance.stepStates.submitApplication?.status).toBe("active");
    expect(instance.activeStepIds).toContain("submitApplication");
  });

  it("supports rejection and retry over HTTP", async () => {
    const { client } = createTestClient();
    let instance = (
      await client.createInstance({
        definition: permitWorkflow,
        instanceId: "instance_1"
      })
    ).instance;

    instance = await completeIntake(client, instance);
    instance = (await sendStep(client, instance, "submitApplication", "event_4")).instance;
    instance = (
      await sendStep(client, instance, "cityReview", "event_5", {
        type: "REVIEW_REJECTED"
      })
    ).instance;

    expect(instance.activeStepIds).toContain("fixIssues");

    instance = (await sendStep(client, instance, "fixIssues", "event_6")).instance;
    expect(instance.activeStepIds).toContain("submitApplication");

    instance = (await sendStep(client, instance, "submitApplication", "event_7")).instance;
    instance = (
      await sendStep(client, instance, "cityReview", "event_8", {
        type: "REVIEW_APPROVED"
      })
    ).instance;

    expect(instance.activeStepIds).toContain("approved");
  });

  it("returns cached results for idempotent HTTP retries", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(created.instance, "fillForm", "event_1");

    const first = await client.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      idempotencyKey: "request_1",
      event
    });
    const second = await client.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      idempotencyKey: "request_1",
      event
    });

    expect(second).toEqual(first);
  });

  it("returns IDEMPOTENCY_CONFLICT for key reuse with a different event", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(created.instance, "fillForm", "event_1");

    await client.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      idempotencyKey: "request_1",
      event
    });

    await expect(
      client.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        idempotencyKey: "request_1",
        event: {
          ...event,
          stepId: "uploadDocuments"
        }
      })
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409
    });
  });

  it("returns cached idempotency results before stale expectedRevision conflicts", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(created.instance, "fillForm", "event_1");

    const first = await client.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      idempotencyKey: "abc",
      event
    });
    const second = await client.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      idempotencyKey: "abc",
      event
    });

    expect(first.instance.revision).toBe(1);
    expect(second).toEqual(first);
  });

  it("maps revision conflict to a structured 409 error", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      client.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        expectedRevision: 42,
        event: workflowEvent(created.instance, "fillForm", "event_1")
      })
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409
    });
  });

  it("maps unknown instances to a structured 404 error", async () => {
    const { client } = createTestClient();

    await expect(client.getInstance("missing")).rejects.toMatchObject({
      code: "INSTANCE_NOT_FOUND",
      status: 404
    });
  });

  it("maps invalid events to a structured 400 error", async () => {
    const { client } = createTestClient();
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      client.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        event: workflowEvent(created.instance, "submitApplication", "event_1")
      })
    ).rejects.toMatchObject({
      code: "INVALID_EVENT",
      status: 400
    });
  });

  it("returns 404 for unknown routes", async () => {
    const { handler } = createTestClient();

    const response = await handler(
      new Request("http://localhost/api/flowforge/nope", {
        method: "GET"
      })
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 405 for unsupported methods", async () => {
    const { handler } = createTestClient();

    const response = await handler(
      new Request("http://localhost/api/flowforge/instances", {
        method: "GET"
      })
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("calls getHeaders and sends headers to the HTTP handler", async () => {
    const seenHeaders: string[] = [];
    const { client } = createTestClient({
      getActorId(request) {
        seenHeaders.push(request.headers.get("authorization") ?? "");
        return "demo_user";
      },
      getHeaders() {
        return {
          authorization: "Bearer test-token"
        };
      }
    });

    await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(seenHeaders).toEqual(["Bearer test-token"]);
  });

  it("injects actorId server-side through getActorId", async () => {
    const { client } = createTestClient({
      getActorId() {
        return "server_actor";
      }
    });
    const created = await client.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await sendStep(client, created.instance, "fillForm", "event_1");

    const history = await client.getHistory("instance_1");

    expect(history.map((entry) => entry.actorId)).toEqual(["server_actor", "server_actor"]);
  });

  it("supports explicit reset over HTTP", async () => {
    const { client } = createTestClient();
    let instance = (
      await client.createInstance({
        definition: permitWorkflow,
        instanceId: "instance_1"
      })
    ).instance;

    instance = (await sendStep(client, instance, "fillForm", "event_1")).instance;
    expect(instance.revision).toBe(1);

    const reset = await client.resetInstance?.({
      definition: permitWorkflow,
      instanceId: "instance_1",
      now: "2026-01-02T00:00:00.000Z"
    });

    expect(reset?.instance.revision).toBe(0);
    expect(reset?.instance.stepStates.fillForm?.status).toBe("active");
  });
});

function createTestClient(options: Partial<TestClientOptions> = {}) {
  const workflowServer = createWorkflowServer({
    storage: new MemoryWorkflowStorage()
  });
  const handler = createFlowForgeHttpHandler({
    workflowServer,
    definitions: [permitWorkflow],
    basePath: "/api/flowforge",
    getActorId: options.getActorId
  });
  const client = createHttpWorkflowClient({
    baseUrl: "http://localhost/api/flowforge",
    fetch: createHandlerFetch(handler),
    ...(options.getHeaders ? { getHeaders: options.getHeaders } : {})
  });

  return { client, handler };
}

function createHandlerFetch(handler: FlowForgeHttpHandler): typeof fetch {
  return async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input, init);

    return handler(request);
  };
}

async function completeIntake(client: ReturnType<typeof createTestClient>["client"], instance: WorkflowInstance) {
  instance = (await sendStep(client, instance, "fillForm", "event_1")).instance;
  instance = (await sendStep(client, instance, "uploadDocuments", "event_2")).instance;
  instance = (await sendStep(client, instance, "payFee", "event_3")).instance;
  return instance;
}

async function sendStep(
  client: ReturnType<typeof createTestClient>["client"],
  instance: WorkflowInstance,
  stepId: string,
  eventId: string,
  overrides: Partial<WorkflowEvent> = {}
) {
  return client.sendEvent({
    definition: permitWorkflow,
    instanceId: instance.id,
    expectedRevision: instance.revision,
    event: workflowEvent(instance, stepId, eventId, overrides)
  });
}

function workflowEvent(
  instance: WorkflowInstance,
  stepId: string,
  eventId: string,
  overrides: Partial<WorkflowEvent> = {}
): WorkflowEvent {
  return {
    id: eventId,
    instanceId: instance.id,
    type: "COMPLETE_STEP",
    stepId,
    occurredAt: `2026-01-01T00:00:${String(instance.revision + 1).padStart(2, "0")}.000Z`,
    ...overrides
  };
}

interface TestClientOptions {
  readonly getActorId: (request: Request) => string | undefined;
  readonly getHeaders: () => HeadersInit;
}
