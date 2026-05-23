import { describe, expect, it } from "vitest";
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";
import type { WorkflowDefinition } from "@guidegraph/core";

describe("workflow server extensibility", () => {
  it("runs guards, lifecycle hooks, outbox effects, compensation effects, context updates, and artifact tracking", async () => {
    const storage = new MemoryWorkflowStorage();
    const hookCalls: string[] = [];
    const server = createWorkflowServer({
      storage,
      guards: [
        ({ event }) => {
          if (event.payload?.allow !== true) {
            return "Upload has not passed app validation.";
          }
        }
      ],
      hooks: {
        onInstanceCreated: ({ instance }) => {
          hookCalls.push(`created:${instance.id}`);
        },
        onBeforeEvent: ({ event }) => {
          hookCalls.push(`before:${event.id}`);
        },
        onStepCompleted: ({ step }) => {
          hookCalls.push(`completed:${step?.id}`);
          return [{ type: "notification", target: "audit-log" }];
        },
        onStepActivated: ({ step }) => {
          hookCalls.push(`activated:${step?.id}`);
          return [{ type: "webhook", target: `activated:${step?.id}` }];
        },
        onAfterEvent: () => [{ type: "outbox", target: "external-sync" }]
      }
    });

    await server.createInstance({
      definition: extensibleWorkflow,
      instanceId: "instance_1",
      context: { permitId: "permit_1" }
    });

    await expect(
      server.sendEvent({
        definition: extensibleWorkflow,
        instanceId: "instance_1",
        event: {
          id: "event_denied",
          instanceId: "instance_1",
          type: "COMPLETE_STEP",
          stepId: "uploadDocuments",
          occurredAt: "2026-05-22T00:00:01.000Z",
          payload: { allow: false }
        }
      })
    ).rejects.toMatchObject({ code: "GUARD_REJECTED" });

    const result = await server.sendEvent({
      definition: extensibleWorkflow,
      instanceId: "instance_1",
      event: {
        id: "event_1",
        instanceId: "instance_1",
        type: "COMPLETE_STEP",
        stepId: "uploadDocuments",
        actorId: "user_1",
        occurredAt: "2026-05-22T00:00:02.000Z",
        payload: {
          allow: true,
          context: { uploaded: true }
        },
        artifactIds: ["site_plan"]
      }
    });
    const storedEffects = await storage.listSideEffects("instance_1");

    expect(result.instance.context).toEqual({ permitId: "permit_1", uploaded: true });
    expect(result.instance.artifactIds).toEqual(["site_plan"]);
    expect(result.availableActions[0]).toMatchObject({
      stepId: "review",
      assignment: { role: "reviewer" }
    });
    expect(result.sideEffects.map((effect) => effect.type).sort()).toEqual(
      ["custom", "notification", "notification", "outbox", "webhook", "webhook"].sort()
    );
    expect(storedEffects).toEqual(result.sideEffects);
    expect(hookCalls).toEqual([
      "created:instance_1",
      "before:event_denied",
      "before:event_1",
      "completed:uploadDocuments",
      "activated:review"
    ]);
  });

  it("returns hook failures as stable errors", async () => {
    const server = createWorkflowServer({
      storage: new MemoryWorkflowStorage(),
      hooks: {
        onAfterEvent: () => {
          throw new Error("webhook queue unavailable");
        }
      }
    });

    await server.createInstance({
      definition: extensibleWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      server.sendEvent({
        definition: extensibleWorkflow,
        instanceId: "instance_1",
        event: {
          id: "event_1",
          instanceId: "instance_1",
          type: "COMPLETE_STEP",
          stepId: "uploadDocuments",
          occurredAt: "2026-05-22T00:00:02.000Z"
        }
      })
    ).rejects.toMatchObject({
      code: "HOOK_FAILED",
      message: "webhook queue unavailable"
    });
  });
});

const extensibleWorkflow: WorkflowDefinition = {
  id: "extensible_permit",
  name: "Extensible Permit",
  version: "1.0.0",
  startStepIds: ["uploadDocuments"],
  steps: [
    {
      id: "uploadDocuments",
      name: "Upload Documents",
      assignment: { role: "applicant" },
      effects: [{ type: "notification", target: "applicant" }],
      compensation: { effect: { type: "custom", target: "delete-uploaded-files" } }
    },
    {
      id: "review",
      name: "Review",
      dependencies: [{ type: "all", stepIds: ["uploadDocuments"] }],
      assignment: { role: "reviewer" }
    }
  ],
  transitions: [
    {
      from: "uploadDocuments",
      to: "review",
      effects: [{ type: "webhook", target: "https://example.test/workflow" }]
    }
  ]
};
