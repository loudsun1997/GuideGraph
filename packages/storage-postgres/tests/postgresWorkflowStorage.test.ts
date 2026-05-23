import { applyWorkflowEvent } from "@guidegraph/core";
import { createWorkflowServer, type CommitWorkflowEventInput, type WorkflowStorage } from "@guidegraph/server";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import {
  checkGuideGraphPostgresSchema,
  GuideGraphPostgresSchemaError,
  POSTGRES_WORKFLOW_SCHEMA_SQL,
  PostgresWorkflowStorage,
  runGuideGraphPostgresMigrations,
  type PostgresConnection,
  type PostgresQueryResult,
  type PostgresQueryable,
  type PostgresTransactionClient
} from "../src/index.ts";
import { permitWorkflow, workflowEvent } from "./fixtures/permitWorkflow.ts";

describe("PostgresWorkflowStorage", () => {
  it("creates and loads an instance", async () => {
    const { server, storage } = await createTestServer();

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
    expect(storedInstance?.history.map((entry) => entry.eventId)).toEqual(["instance_1:created"]);
  });

  it("persists state changes after sendEvent", async () => {
    const { server, storage } = await createTestServer();
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
    expect(storedInstance?.stepStates.fillForm?.status).toBe("completed");
    expect(storedInstance?.revision).toBe(1);
  });

  it("persists the event log and history log", async () => {
    const { server, storage } = await createTestServer();
    const definition = {
      ...permitWorkflow,
      effects: [
        {
          type: "webhook",
          target: "https://example.test/guidegraph"
        }
      ]
    };
    const createResult = await server.createInstance({
      definition,
      instanceId: "instance_1"
    });

    const result = await server.sendEvent({
      definition,
      instanceId: "instance_1",
      event: workflowEvent(createResult.instance, "fillForm", {
        id: "event_1",
        payload: {
          context: {
            parcelId: "parcel_1"
          }
        },
        metadata: {
          source: "postgres_test"
        },
        artifactIds: ["artifact_1"]
      })
    });
    const events = await storage.listEvents("instance_1");
    const history = await server.getHistory("instance_1");

    expect(events).toHaveLength(1);
    expect(events[0]?.event.id).toBe("event_1");
    expect(events[0]?.event.payload).toEqual({
      context: {
        parcelId: "parcel_1"
      }
    });
    expect(events[0]?.event.metadata).toEqual({
      source: "postgres_test"
    });
    expect(events[0]?.event.artifactIds).toEqual(["artifact_1"]);
    expect(events[0]?.sideEffects?.map((effect) => effect.type)).toEqual(["webhook"]);
    expect(events[0]?.revisionBefore).toBe(0);
    expect(events[0]?.revisionAfter).toBe(1);
    expect(result.historyEntry.eventId).toBe("event_1");
    expect(history.map((entry) => entry.eventId)).toEqual(["instance_1:created", "event_1"]);
    expect(history[1]?.metadata).toMatchObject({
      payload: {
        context: {
          parcelId: "parcel_1"
        }
      }
    });
  });

  it("returns available actions from persisted state", async () => {
    const { server } = await createTestServer();
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
  });

  it("returns cached idempotency results before checking stale expected revisions", async () => {
    const { server, storage } = await createTestServer();
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
      expectedRevision: 0,
      idempotencyKey: "abc",
      event
    });
    const secondResult = await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      expectedRevision: 0,
      idempotencyKey: "abc",
      event
    });
    const events = await storage.listEvents("instance_1");

    expect(firstResult.instance.revision).toBe(1);
    expect(secondResult).toEqual(firstResult);
    expect(events.map((storedEvent) => storedEvent.event.id)).toEqual(["event_1"]);
  });

  it("rejects the same idempotency key with a different event payload", async () => {
    const { server } = await createTestServer();
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
      idempotencyKey: "abc",
      event
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        idempotencyKey: "abc",
        event: {
          ...event,
          stepId: "uploadDocuments"
        }
      })
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("cascades idempotency records when an instance is deleted", async () => {
    const { pool, server } = await createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      idempotencyKey: "abc",
      event: workflowEvent(createResult.instance, "fillForm", {
        id: "event_1"
      })
    });

    const beforeDelete = await pool.query(
      "select instance_id from workflow_idempotency_results where instance_id = $1",
      ["instance_1"]
    );

    await pool.query("delete from workflow_instances where id = $1", ["instance_1"]);

    const afterDelete = await pool.query(
      "select instance_id from workflow_idempotency_results where instance_id = $1",
      ["instance_1"]
    );

    expect(beforeDelete.rows).toHaveLength(1);
    expect(afterDelete.rows).toHaveLength(0);
  });

  it("runs migrations and checks the installed schema", async () => {
    const pool = createPostgresPool();

    await runGuideGraphPostgresMigrations({ connection: pool });

    const result = await checkGuideGraphPostgresSchema({ connection: pool });
    const migrations = await pool.query<{ version: string }>(
      "select version from workflow_schema_migrations order by version"
    );

    expect(result).toEqual({
      ok: true,
      missingTables: []
    });
    expect(migrations.rows.map((row) => row.version)).toEqual(["0001_init"]);
  });

  it("throws a clear schema error when tables are missing", async () => {
    const pool = createPostgresPool();
    const storage = new PostgresWorkflowStorage(pool);

    await expect(storage.checkSchema()).rejects.toThrow(GuideGraphPostgresSchemaError);
    await expect(storage.checkSchema()).rejects.toThrow("npx guidegraph postgres init");
  });

  it("auto-migrates only when explicitly enabled", async () => {
    const pool = createPostgresPool();
    const storage = new PostgresWorkflowStorage({
      connection: pool,
      autoMigrate: true
    });
    const server = createWorkflowServer({ storage });

    const result = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    expect(result.instance.id).toBe("instance_1");
    await expect(storage.checkSchema()).resolves.toEqual({
      ok: true,
      missingTables: []
    });
  });

  it("fails cleanly on revision conflict", async () => {
    const { server } = await createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await expect(
      server.sendEvent({
        definition: permitWorkflow,
        instanceId: "instance_1",
        expectedRevision: 12,
        event: workflowEvent(createResult.instance, "fillForm")
      })
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT"
    });
  });

  it("fails cleanly for unknown instances", async () => {
    const { server } = await createTestServer();

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
    const { server } = await createTestServer();
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
    const { server } = await createTestServer();
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

  it("commits event writes atomically", async () => {
    const { server } = await createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });
    const event = workflowEvent(createResult.instance, "fillForm", {
      id: "event_1"
    });
    const next = applyWorkflowEvent({
      definition: permitWorkflow,
      instance: createResult.instance,
      event
    });
    const historyEntry = next.instance.history.at(-1);

    if (!historyEntry) {
      throw new Error("Expected the core engine to produce a history entry.");
    }

    const connection = new RecordingFailingConnection();
    const failingStorage = new PostgresWorkflowStorage(connection);

    await expect(
      failingStorage.commitEvent({
        instance: next.instance,
        event: {
          event,
          revisionBefore: createResult.instance.revision,
          revisionAfter: next.instance.revision
        },
        historyEntry
      })
    ).rejects.toThrow("forced history insert failure");

    expect(connection.statements).toEqual([
      "begin",
      "update workflow_instances",
      "insert into workflow_events",
      "insert into workflow_history",
      "rollback"
    ]);
    expect(connection.statements).not.toContain("commit");
  });

  it("survives creating a new PostgresWorkflowStorage instance", async () => {
    const { pool, server } = await createTestServer();
    const createResult = await server.createInstance({
      definition: permitWorkflow,
      instanceId: "instance_1"
    });

    await server.sendEvent({
      definition: permitWorkflow,
      instanceId: "instance_1",
      event: workflowEvent(createResult.instance, "fillForm", {
        id: "event_1"
      })
    });

    const nextStorage = new PostgresWorkflowStorage(pool);
    const storedInstance = await nextStorage.getInstance("instance_1");
    const storedEvents = await nextStorage.listEvents("instance_1");
    const storedHistory = await nextStorage.listHistory("instance_1");

    expect(storedInstance?.revision).toBe(1);
    expect(storedInstance?.stepStates.fillForm?.status).toBe("completed");
    expect(storedEvents.map((event) => event.event.id)).toEqual(["event_1"]);
    expect(storedHistory.map((entry) => entry.eventId)).toEqual(["instance_1:created", "event_1"]);
  });
});

async function createTestServer(): Promise<{
  pool: PostgresConnection;
  server: ReturnType<typeof createWorkflowServer>;
  storage: WorkflowStorage;
}> {
  const pool = createPostgresPool();

  await pool.query(POSTGRES_WORKFLOW_SCHEMA_SQL);

  const storage = new PostgresWorkflowStorage(pool);
  const server = createWorkflowServer({ storage });

  return { pool, server, storage };
}

function createPostgresPool(): PostgresConnection {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();
  return new Pool() as PostgresConnection;
}

class RecordingFailingConnection implements PostgresConnection {
  readonly statements: string[] = [];

  async query<T = unknown>(
    sql: string,
    _values?: readonly unknown[]
  ): Promise<PostgresQueryResult<T>> {
    this.statements.push(normalizeStatement(sql));
    return { rows: [], rowCount: 1 };
  }

  async connect(): Promise<PostgresTransactionClient> {
    return new RecordingFailingClient(this.statements);
  }
}

class RecordingFailingClient implements PostgresTransactionClient {
  readonly #statements: string[];

  constructor(statements: string[]) {
    this.#statements = statements;
  }

  async query<T = unknown>(
    sql: string,
    _values?: readonly unknown[]
  ): Promise<PostgresQueryResult<T>> {
    const statement = normalizeStatement(sql);
    this.#statements.push(statement);

    if (statement === "insert into workflow_history") {
      throw new Error("forced history insert failure");
    }

    return { rows: [], rowCount: 1 };
  }

  release(): void {
    return undefined;
  }
}

function normalizeStatement(sql: string): string {
  const compactSql = sql.trim().replace(/\s+/g, " ").toLowerCase();

  if (compactSql.startsWith("insert into workflow_instances")) {
    return "insert into workflow_instances";
  }

  if (compactSql.startsWith("update workflow_instances")) {
    return "update workflow_instances";
  }

  if (compactSql.startsWith("insert into workflow_events")) {
    return "insert into workflow_events";
  }

  if (compactSql.startsWith("insert into workflow_history")) {
    return "insert into workflow_history";
  }

  if (compactSql.startsWith("insert into workflow_idempotency_results")) {
    return "insert into workflow_idempotency_results";
  }

  return compactSql;
}
