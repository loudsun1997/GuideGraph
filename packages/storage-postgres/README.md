# @guidegraph/storage-postgres

Postgres-backed workflow persistence for GuideGraph.

This adapter implements the `WorkflowStorage` interface from `@guidegraph/server`. It does not run workflow logic itself; the server loads persisted state, calls `@guidegraph/core`, then asks this adapter to commit the resulting instance, event, history entry, and optional idempotency result.

## What It Persists

- Workflow instances
- Workflow event log entries
- Workflow history timeline entries
- Idempotency results for safe retries

`commitInstanceCreation()` and `commitEvent()` run inside database transactions. For `commitEvent()`, these writes succeed or fail together:

- Updated workflow instance
- Appended workflow event
- Appended workflow history entry
- Cached idempotency result, when an idempotency key is supplied

## Schema

The package ships with:

- `schema.sql`
- `migrations/0001_init.sql`
- `POSTGRES_WORKFLOW_SCHEMA_SQL`
- `runGuideGraphPostgresMigrations()`
- `checkGuideGraphPostgresSchema()`

For production, apply the schema or run migrations explicitly before starting the app:

```sh
psql "$DATABASE_URL" -f node_modules/@guidegraph/storage-postgres/schema.sql
```

Or run migrations from setup/test code:

```ts
import { runGuideGraphPostgresMigrations } from "@guidegraph/storage-postgres";

await runGuideGraphPostgresMigrations({
  connectionString: process.env.DATABASE_URL!,
});
```

`schema.sql` includes the migration tracking table:

```sql
CREATE TABLE IF NOT EXISTS workflow_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);
```

## Schema Checks

Check the schema at app startup to fail with a useful setup message:

```ts
import { PostgresWorkflowStorage } from "@guidegraph/storage-postgres";

const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: false,
});

await storage.checkSchema();
```

If tables are missing, GuideGraph throws `GuideGraphPostgresSchemaError` with:

```text
GuideGraph Postgres schema is not installed.

Run one of:

npx guidegraph postgres init

or:

psql "$DATABASE_URL" -f node_modules/@guidegraph/storage-postgres/schema.sql
```

## Local Development

```ts
import { Pool } from "pg";
import {
  POSTGRES_WORKFLOW_SCHEMA_SQL,
  PostgresWorkflowStorage,
} from "@guidegraph/storage-postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(POSTGRES_WORKFLOW_SCHEMA_SQL);

const storage = new PostgresWorkflowStorage(pool);
```

For local development and tests only, you can opt into automatic migrations:

```ts
const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: true,
});
```

Do not use `autoMigrate: true` as the production default. Production deployments should run migrations explicitly.

## Usage With The Server

```ts
import { createWorkflowServer } from "@guidegraph/server";
import { PostgresWorkflowStorage } from "@guidegraph/storage-postgres";

const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: false,
});

await storage.checkSchema();

const server = createWorkflowServer({ storage });
```

The server still owns:

- Revision checks
- Idempotency checks
- Definition mismatch handling through the core engine
- Invalid event handling through the core engine
- Available action calculation through the core engine

The storage adapter owns durable reads and transactional commits.

## Known Schema Decision

`workflow_history.event_id` is not a foreign key in Phase 5 because `INSTANCE_CREATED` is currently stored as a history entry but not as a row in `workflow_events`.

Long term, every history entry should be caused by a workflow event. Once `INSTANCE_CREATED` is persisted as a real workflow event, `workflow_history.event_id` should reference `workflow_events(id)` for stronger audit integrity.

## Running Tests

The default Postgres adapter tests use `pg-mem`, so they do not require a local Postgres service.

```sh
pnpm test:postgres
```

To test against a real local Postgres server, create `.env.local` with `DATABASE_URL`, then run:

```sh
pnpm test:postgres:real
```

The real Postgres test is intentionally excluded from the default test scripts. Normal test runs do not report a skipped local-database test when Postgres is unavailable.

See [REAL_POSTGRES_TESTS.md](./REAL_POSTGRES_TESTS.md) for the local test database setup.

Run the full workspace checks with:

```sh
pnpm test
pnpm typecheck
pnpm build
```

When adding tests against a real local Postgres instance later, keep the same behavioral contract:

- Data must survive a new `PostgresWorkflowStorage` instance.
- `commitEvent()` must be atomic.
- Reusing the same idempotency key with the same event must return the cached result.
- Reusing the same idempotency key with a different event must fail as an idempotency conflict.
