import { existsSync, readFileSync } from "node:fs";
import { createWorkflowServer } from "@guidegraph/server";
import { describe, expect, it } from "vitest";
import { PostgresWorkflowStorage } from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("PostgresWorkflowStorage against real Postgres", () => {
  it("migrates, writes, and reloads workflow state", async () => {
    const connectionString = getDatabaseUrl();
    const storage = new PostgresWorkflowStorage({
      connectionString,
      autoMigrate: true
    });
    const server = createWorkflowServer({ storage });
    const instanceId = `guidegraph_real_${Date.now()}`;

    await expect(storage.checkSchema()).resolves.toEqual({
      ok: true,
      missingTables: []
    });

    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId,
      actorId: "real_postgres_test",
      now: "2026-01-01T00:00:00.000Z"
    });
    const event = workflowEvent(createResult.instance, "fillForm", {
      id: `${instanceId}_event_1`
    });

    const firstResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId,
      expectedRevision: 0,
      idempotencyKey: `${instanceId}_request_1`,
      event
    });
    const retryResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId,
      expectedRevision: 0,
      idempotencyKey: `${instanceId}_request_1`,
      event
    });
    const reloadedStorage = new PostgresWorkflowStorage({
      connectionString,
      autoMigrate: false
    });
    const reloadedInstance = await reloadedStorage.getInstance(instanceId);
    const reloadedEvents = await reloadedStorage.listEvents(instanceId);
    const reloadedHistory = await reloadedStorage.listHistory(instanceId);

    expect(firstResult.instance.revision).toBe(1);
    expect(retryResult).toEqual(firstResult);
    expect(reloadedInstance?.revision).toBe(1);
    expect(reloadedInstance?.stepStates.fillForm?.status).toBe("completed");
    expect(reloadedEvents.map((storedEvent) => storedEvent.event.id)).toEqual([event.id]);
    expect(reloadedHistory.map((entry) => entry.eventId)).toEqual([
      `${instanceId}:created`,
      event.id
    ]);
  });
});

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (existsSync(".env.local")) {
    const envFile = readFileSync(".env.local", "utf8");
    const match = envFile.match(/^DATABASE_URL=(.+)$/m);

    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error(
    "Real Postgres tests require DATABASE_URL or a .env.local file with DATABASE_URL."
  );
}
