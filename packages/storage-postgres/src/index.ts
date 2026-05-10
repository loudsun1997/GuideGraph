import type { WorkflowEvent, WorkflowHistoryEntry, WorkflowInstance, WorkflowStepState } from "@flowforge/core";
import {
  WorkflowServerError,
  type CommitWorkflowEventInput,
  type CommitWorkflowInstanceCreationInput,
  type SendWorkflowEventResult,
  type StoredIdempotencyRecord,
  type StoredWorkflowEvent,
  type WorkflowStorage
} from "@flowforge/server";

export interface PostgresQueryResult<T = unknown> {
  readonly rows: T[];
  readonly rowCount: number | null;
}

export interface PostgresQueryable {
  query<T = unknown>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<PostgresQueryResult<T>>;
}

export interface PostgresTransactionClient extends PostgresQueryable {
  release?: () => void;
}

export interface PostgresConnection extends PostgresQueryable {
  connect?: () => Promise<PostgresTransactionClient>;
}

export interface PostgresWorkflowStorageOptions {
  readonly schema?: string;
}

export const POSTGRES_WORKFLOW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_instances (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  status TEXT NOT NULL,
  active_step_ids JSONB NOT NULL DEFAULT '[]',
  step_states JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  artifact_ids JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  step_id TEXT,
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  step_id TEXT,
  actor_id TEXT,
  message TEXT NOT NULL,
  before JSONB,
  after JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_idempotency_results (
  instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instance_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS workflow_events_instance_id_occurred_at_idx
  ON workflow_events (instance_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS workflow_history_instance_id_occurred_at_idx
  ON workflow_history (instance_id, occurred_at, id);
`;

export class PostgresWorkflowStorage implements WorkflowStorage {
  readonly #db: PostgresConnection;

  constructor(db: PostgresConnection, _options: PostgresWorkflowStorageOptions = {}) {
    this.#db = db;
  }

  async commitInstanceCreation(input: CommitWorkflowInstanceCreationInput): Promise<void> {
    await this.#transaction(async (client) => {
      await upsertInstance(client, input.instance);
      await client.query("delete from workflow_events where instance_id = $1", [input.instance.id]);
      await client.query("delete from workflow_history where instance_id = $1", [input.instance.id]);
      await client.query("delete from workflow_idempotency_results where instance_id = $1", [
        input.instance.id
      ]);

      for (const historyEntry of input.historyEntries) {
        await insertHistoryEntry(client, historyEntry);
      }
    });
  }

  async getInstance(instanceId: string): Promise<WorkflowInstance | undefined> {
    const result = await this.#db.query<WorkflowInstanceRow>(
      `select id, workflow_id, workflow_version, status, active_step_ids, step_states,
        created_at, updated_at, revision
       from workflow_instances
       where id = $1`,
      [instanceId]
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return rowToInstance(row, await this.listHistory(instanceId));
  }

  async commitEvent(input: CommitWorkflowEventInput): Promise<void> {
    await this.#transaction(async (client) => {
      await updateInstanceForEvent(client, input.instance, input.event.revisionBefore);
      await insertWorkflowEvent(client, input.event);
      await insertHistoryEntry(client, input.historyEntry);

      if (input.idempotencyKey && input.idempotencyRecord) {
        await upsertIdempotencyRecord(client, input.instance.id, input.idempotencyKey, input.idempotencyRecord);
      }
    });
  }

  async listEvents(instanceId: string): Promise<StoredWorkflowEvent[]> {
    const result = await this.#db.query<WorkflowEventRow>(
      `select id, instance_id, type, step_id, actor_id, metadata, idempotency_key, occurred_at
       from workflow_events
       where instance_id = $1
       order by occurred_at asc, id asc`,
      [instanceId]
    );

    return result.rows.map(rowToStoredWorkflowEvent);
  }

  async listHistory(instanceId: string): Promise<WorkflowHistoryEntry[]> {
    const result = await this.#db.query<WorkflowHistoryRow>(
      `select id, event_id, instance_id, type, step_id, actor_id, message, occurred_at
       from workflow_history
       where instance_id = $1
       order by
         case when event_id = instance_id || ':created' then 0 else 1 end,
         occurred_at asc,
         id asc`,
      [instanceId]
    );

    return result.rows.map(rowToHistoryEntry);
  }

  async getIdempotencyRecord(
    instanceId: string,
    idempotencyKey: string
  ): Promise<StoredIdempotencyRecord | undefined> {
    const result = await this.#db.query<IdempotencyRecordRow>(
      `select result
       from workflow_idempotency_results
       where instance_id = $1 and idempotency_key = $2`,
      [instanceId, idempotencyKey]
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return jsonValue<StoredIdempotencyRecord>(row.result);
  }

  async #transaction<T>(work: (client: PostgresQueryable) => Promise<T>): Promise<T> {
    const client = this.#db.connect ? await this.#db.connect() : this.#db;

    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      if ("release" in client) {
        client.release?.();
      }
    }
  }
}

export function createPostgresWorkflowStorage(db: PostgresConnection): WorkflowStorage {
  return new PostgresWorkflowStorage(db);
}

async function upsertInstance(client: PostgresQueryable, instance: WorkflowInstance): Promise<void> {
  await client.query(
    `insert into workflow_instances (
      id, workflow_id, workflow_version, status, active_step_ids, step_states,
      context, artifact_ids, metadata, created_by, created_at, updated_at, revision
    )
    values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
      $7, $8, $9, $10)
    on conflict (id) do update set
      workflow_id = excluded.workflow_id,
      workflow_version = excluded.workflow_version,
      status = excluded.status,
      active_step_ids = excluded.active_step_ids,
      step_states = excluded.step_states,
      updated_at = excluded.updated_at,
      revision = excluded.revision`,
    [
      instance.id,
      instance.workflowId,
      instance.workflowVersion,
      instance.status,
      JSON.stringify(instance.activeStepIds),
      JSON.stringify(instance.stepStates),
      instance.history[0]?.actorId ?? null,
      instance.createdAt,
      instance.updatedAt,
      instance.revision
    ]
  );
}

async function updateInstanceForEvent(
  client: PostgresQueryable,
  instance: WorkflowInstance,
  revisionBefore: number
): Promise<void> {
  const result = await client.query(
    `update workflow_instances set
      workflow_id = $2,
      workflow_version = $3,
      status = $4,
      active_step_ids = $5::jsonb,
      step_states = $6::jsonb,
      updated_at = $7,
      revision = $8
    where id = $1 and revision = $9`,
    [
      instance.id,
      instance.workflowId,
      instance.workflowVersion,
      instance.status,
      JSON.stringify(instance.activeStepIds),
      JSON.stringify(instance.stepStates),
      instance.updatedAt,
      instance.revision,
      revisionBefore
    ]
  );

  if (result.rowCount !== 1) {
    throw new WorkflowServerError(
      "REVISION_CONFLICT",
      `Expected revision ${revisionBefore}, but instance ${instance.id} changed before the event could be committed.`
    );
  }
}

async function insertWorkflowEvent(client: PostgresQueryable, storedEvent: StoredWorkflowEvent): Promise<void> {
  const metadata = {
    revisionBefore: storedEvent.revisionBefore,
    revisionAfter: storedEvent.revisionAfter
  };

  await client.query(
    `insert into workflow_events (
      id, instance_id, type, step_id, actor_id, payload, metadata, idempotency_key, occurred_at
    )
    values ($1, $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, $7, $8)`,
    [
      storedEvent.event.id,
      storedEvent.event.instanceId,
      storedEvent.event.type,
      storedEvent.event.stepId ?? null,
      storedEvent.event.actorId ?? null,
      JSON.stringify(metadata),
      storedEvent.idempotencyKey ?? null,
      storedEvent.event.occurredAt
    ]
  );
}

async function insertHistoryEntry(client: PostgresQueryable, entry: WorkflowHistoryEntry): Promise<void> {
  await client.query(
    `insert into workflow_history (
      id, event_id, instance_id, type, step_id, actor_id, message, before, after, metadata, occurred_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, null, null, '{}'::jsonb, $8)`,
    [
      entry.id,
      entry.eventId,
      entry.instanceId,
      entry.eventType,
      entry.stepId ?? null,
      entry.actorId ?? null,
      entry.message,
      entry.occurredAt
    ]
  );
}

async function upsertIdempotencyRecord(
  client: PostgresQueryable,
  instanceId: string,
  idempotencyKey: string,
  record: StoredIdempotencyRecord
): Promise<void> {
  await client.query(
    `insert into workflow_idempotency_results (
      instance_id, idempotency_key, event_fingerprint, result, created_at
    )
    values ($1, $2, $3, $4::jsonb, $5)
    on conflict (instance_id, idempotency_key) do update set
      event_fingerprint = excluded.event_fingerprint,
      result = excluded.result`,
    [
      instanceId,
      idempotencyKey,
      fingerprintEvent(record.event),
      JSON.stringify(record),
      record.result.historyEntry.occurredAt
    ]
  );
}

function rowToInstance(row: WorkflowInstanceRow, history: WorkflowHistoryEntry[]): WorkflowInstance {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    status: row.status,
    revision: row.revision,
    activeStepIds: jsonValue<string[]>(row.active_step_ids),
    stepStates: jsonValue<Record<string, WorkflowStepState>>(row.step_states),
    history,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  };
}

function rowToStoredWorkflowEvent(row: WorkflowEventRow): StoredWorkflowEvent {
  const metadata = jsonValue<WorkflowEventMetadata>(row.metadata, {
    revisionBefore: 0,
    revisionAfter: 0
  });

  return {
    event: rowToWorkflowEvent(row),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    revisionBefore: metadata.revisionBefore,
    revisionAfter: metadata.revisionAfter
  };
}

function rowToWorkflowEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    instanceId: row.instance_id,
    type: row.type,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    occurredAt: timestampToIso(row.occurred_at)
  };
}

function rowToHistoryEntry(row: WorkflowHistoryRow): WorkflowHistoryEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    instanceId: row.instance_id,
    eventType: row.type,
    message: row.message,
    occurredAt: timestampToIso(row.occurred_at),
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    ...(row.step_id ? { stepId: row.step_id } : {})
  };
}

function jsonValue<T>(value: unknown, fallback?: T): T {
  if (value === null || value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error("Expected a JSON value.");
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

function timestampToIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function fingerprintEvent(event: WorkflowEvent): string {
  return stableStringify(event);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

interface WorkflowInstanceRow {
  readonly id: string;
  readonly workflow_id: string;
  readonly workflow_version: string;
  readonly status: WorkflowInstance["status"];
  readonly active_step_ids: unknown;
  readonly step_states: unknown;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly revision: number;
}

interface WorkflowEventRow {
  readonly id: string;
  readonly instance_id: string;
  readonly type: string;
  readonly step_id: string | null;
  readonly actor_id: string | null;
  readonly metadata: unknown;
  readonly idempotency_key: string | null;
  readonly occurred_at: string | Date;
}

interface WorkflowHistoryRow {
  readonly id: string;
  readonly event_id: string;
  readonly instance_id: string;
  readonly type: string;
  readonly step_id: string | null;
  readonly actor_id: string | null;
  readonly message: string;
  readonly occurred_at: string | Date;
}

interface WorkflowEventMetadata {
  readonly revisionBefore: number;
  readonly revisionAfter: number;
}

interface IdempotencyRecordRow {
  readonly result: unknown;
}
