import { createRequire } from "node:module";
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

export interface ManagedPostgresConnection {
  readonly connection: PostgresConnection;
  readonly dispose?: () => Promise<void>;
}

export interface PostgresWorkflowStorageConfig {
  readonly connection?: PostgresConnection;
  readonly connectionString?: string;
  readonly autoMigrate?: boolean;
  readonly schema?: string;
}

export type PostgresWorkflowStorageInput = PostgresConnection | PostgresWorkflowStorageConfig;

export interface FlowForgePostgresMigration {
  readonly version: string;
  readonly sql: string;
}

export interface FlowForgePostgresSetupOptions {
  readonly connection?: PostgresConnection;
  readonly connectionString?: string;
  readonly schema?: string;
}

export interface FlowForgePostgresSchemaCheckResult {
  readonly ok: boolean;
  readonly missingTables: readonly string[];
}

export class FlowForgePostgresSchemaError extends Error {
  readonly missingTables: readonly string[];

  constructor(missingTables: readonly string[]) {
    super(
      `FlowForge Postgres schema is not installed.\n\nMissing tables: ${missingTables.join(", ")}.\n\nRun one of:\n\nnpx flowforge postgres init\n\nor:\n\npsql "$DATABASE_URL" -f node_modules/@flowforge/storage-postgres/schema.sql`
    );
    this.name = "FlowForgePostgresSchemaError";
    this.missingTables = missingTables;
  }
}

const FLOWFORGE_POSTGRES_SCHEMA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workflow_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);
`;

const FLOWFORGE_POSTGRES_BASE_SCHEMA_SQL = `
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
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS workflow_instances_workflow_id_updated_at_idx
  ON workflow_instances (workflow_id, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS workflow_instances_status_updated_at_idx
  ON workflow_instances (status, updated_at DESC, id);
`;

export const FLOWFORGE_POSTGRES_MIGRATIONS: readonly FlowForgePostgresMigration[] = [
  {
    version: "0001_init",
    sql: FLOWFORGE_POSTGRES_BASE_SCHEMA_SQL
  }
];

export const POSTGRES_WORKFLOW_SCHEMA_SQL = `${FLOWFORGE_POSTGRES_SCHEMA_TABLE_SQL}
${FLOWFORGE_POSTGRES_BASE_SCHEMA_SQL}
INSERT INTO workflow_schema_migrations (version, applied_at)
VALUES ('0001_init', now())
ON CONFLICT (version) DO NOTHING;
`;

const REQUIRED_FLOWFORGE_POSTGRES_TABLES = [
  "workflow_schema_migrations",
  "workflow_instances",
  "workflow_events",
  "workflow_history",
  "workflow_idempotency_results"
] as const;

export class PostgresWorkflowStorage implements WorkflowStorage {
  readonly #connection: Promise<ManagedPostgresConnection>;
  readonly #schema: string;
  readonly #ready: Promise<void>;

  constructor(input: PostgresWorkflowStorageInput, options: PostgresWorkflowStorageConfig = {}) {
    const config = isPostgresConnection(input) ? { ...options, connection: input } : input;

    this.#schema = config.schema ?? "public";
    this.#connection = resolveManagedConnection(config);
    this.#ready = config.autoMigrate
      ? this.#connection.then(({ connection }) =>
          runFlowForgePostgresMigrations({
            connection,
            schema: this.#schema
          })
        )
      : Promise.resolve();
  }

  async commitInstanceCreation(input: CommitWorkflowInstanceCreationInput): Promise<void> {
    const db = await this.#db();

    await withTransaction(db, async (client) => {
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
    const db = await this.#db();
    const result = await db.query<WorkflowInstanceRow>(
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
    const db = await this.#db();

    await withTransaction(db, async (client) => {
      await updateInstanceForEvent(client, input.instance, input.event.revisionBefore);
      await insertWorkflowEvent(client, input.event);
      await insertHistoryEntry(client, input.historyEntry);

      if (input.idempotencyKey && input.idempotencyRecord) {
        await upsertIdempotencyRecord(client, input.instance.id, input.idempotencyKey, input.idempotencyRecord);
      }
    });
  }

  async listEvents(instanceId: string): Promise<StoredWorkflowEvent[]> {
    const db = await this.#db();
    const result = await db.query<WorkflowEventRow>(
      `select id, instance_id, type, step_id, actor_id, metadata, idempotency_key, occurred_at
       from workflow_events
       where instance_id = $1
       order by occurred_at asc, id asc`,
      [instanceId]
    );

    return result.rows.map(rowToStoredWorkflowEvent);
  }

  async listHistory(instanceId: string): Promise<WorkflowHistoryEntry[]> {
    const db = await this.#db();
    const result = await db.query<WorkflowHistoryRow>(
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
    const db = await this.#db();
    const result = await db.query<IdempotencyRecordRow>(
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

  async checkSchema(): Promise<FlowForgePostgresSchemaCheckResult> {
    const db = await this.#db();
    return checkFlowForgePostgresSchema({
      connection: db,
      schema: this.#schema
    });
  }

  async #db(): Promise<PostgresConnection> {
    await this.#ready;
    return (await this.#connection).connection;
  }
}

export function createPostgresWorkflowStorage(input: PostgresWorkflowStorageInput): WorkflowStorage {
  return new PostgresWorkflowStorage(input);
}

export async function runFlowForgePostgresMigrations(
  options: FlowForgePostgresSetupOptions
): Promise<void> {
  const managed = await resolveManagedConnection(options);

  try {
    await withTransaction(managed.connection, async (client) => {
      await client.query(FLOWFORGE_POSTGRES_SCHEMA_TABLE_SQL);

      for (const migration of FLOWFORGE_POSTGRES_MIGRATIONS) {
        const applied = await client.query<{ version: string }>(
          "select version from workflow_schema_migrations where version = $1",
          [migration.version]
        );

        if (applied.rows.length > 0) {
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          "insert into workflow_schema_migrations (version, applied_at) values ($1, now())",
          [migration.version]
        );
      }
    });
  } finally {
    await managed.dispose?.();
  }
}

export async function checkFlowForgePostgresSchema(
  options: FlowForgePostgresSetupOptions
): Promise<FlowForgePostgresSchemaCheckResult> {
  const managed = await resolveManagedConnection(options);
  const schema = options.schema ?? "public";

  try {
    const result = await managed.connection.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = $1
         and table_name in (
           'workflow_schema_migrations',
           'workflow_instances',
           'workflow_events',
           'workflow_history',
           'workflow_idempotency_results'
         )`,
      [schema]
    );
    const existingTables = new Set(result.rows.map((row) => row.table_name));
    const missingTables = REQUIRED_FLOWFORGE_POSTGRES_TABLES.filter(
      (tableName) => !existingTables.has(tableName)
    );

    if (missingTables.length > 0) {
      throw new FlowForgePostgresSchemaError(missingTables);
    }

    return {
      ok: true,
      missingTables: []
    };
  } finally {
    await managed.dispose?.();
  }
}

async function withTransaction<T>(
  db: PostgresConnection,
  work: (client: PostgresQueryable) => Promise<T>
): Promise<T> {
  const client = db.connect ? await db.connect() : db;

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

function isPostgresConnection(input: PostgresWorkflowStorageInput): input is PostgresConnection {
  return typeof (input as PostgresConnection).query === "function";
}

async function resolveManagedConnection(
  options: FlowForgePostgresSetupOptions
): Promise<ManagedPostgresConnection> {
  if (options.connection) {
    return { connection: options.connection };
  }

  if (options.connectionString) {
    return createPgConnection(options.connectionString);
  }

  throw new Error("PostgresWorkflowStorage requires either a connection or a connectionString.");
}

async function createPgConnection(connectionString: string): Promise<ManagedPostgresConnection> {
  const require = createRequire(import.meta.url);
  let pg: { Pool?: new (options: { connectionString: string }) => PostgresConnection & { end?: () => Promise<void> } };

  try {
    pg = require("pg") as typeof pg;
  } catch (error) {
    throw new Error(
      "The pg package is required when using a connectionString. Install it with: pnpm add pg",
      { cause: error }
    );
  }

  if (!pg.Pool) {
    throw new Error("The pg package did not export Pool.");
  }

  const pool = new pg.Pool({ connectionString });

  return {
    connection: pool,
    ...(pool.end ? { dispose: () => pool.end?.() ?? Promise.resolve() } : {})
  };
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
