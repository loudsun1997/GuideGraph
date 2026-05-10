import type { WorkflowDefinition, WorkflowId, WorkflowStore } from "@flowforge/core";

export interface PostgresQueryable {
  query<T = unknown>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface WorkflowRow {
  id: string;
  definition: WorkflowDefinition;
}

export interface PostgresWorkflowStoreOptions {
  readonly tableName?: string;
}

export class PostgresWorkflowStore implements WorkflowStore {
  readonly #db: PostgresQueryable;
  readonly #tableName: string;

  constructor(db: PostgresQueryable, options: PostgresWorkflowStoreOptions = {}) {
    this.#db = db;
    this.#tableName = options.tableName ?? "flowforge_workflows";
  }

  async save(workflow: WorkflowDefinition): Promise<void> {
    await this.#db.query(
      `insert into ${this.#tableName} (id, definition)
       values ($1, $2)
       on conflict (id) do update set definition = excluded.definition`,
      [workflow.id, workflow]
    );
  }

  async find(id: WorkflowId): Promise<WorkflowDefinition | undefined> {
    const result = await this.#db.query<WorkflowRow>(
      `select definition from ${this.#tableName} where id = $1 limit 1`,
      [id]
    );

    return result.rows[0]?.definition;
  }

  async list(): Promise<WorkflowDefinition[]> {
    const result = await this.#db.query<WorkflowRow>(
      `select definition from ${this.#tableName} order by id`
    );

    return result.rows.map((row) => row.definition);
  }

  async delete(id: WorkflowId): Promise<boolean> {
    const result = await this.#db.query(
      `delete from ${this.#tableName} where id = $1`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export function createPostgresWorkflowTableSql(tableName = "flowforge_workflows"): string {
  return `create table if not exists ${tableName} (
  id text primary key,
  definition jsonb not null
)`;
}
