# @flowforge/storage-postgres

Postgres-backed workflow persistence for FlowForge.

This adapter implements the `WorkflowStorage` interface from `@flowforge/server`. It does not run workflow logic itself; the server loads persisted state, calls `@flowforge/core`, then asks this adapter to commit the resulting instance, event, history entry, and optional idempotency result.

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
- `POSTGRES_WORKFLOW_SCHEMA_SQL`

Apply the SQL before constructing `PostgresWorkflowStorage`.

```ts
import { Pool } from "pg";
import {
  POSTGRES_WORKFLOW_SCHEMA_SQL,
  PostgresWorkflowStorage,
} from "@flowforge/storage-postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(POSTGRES_WORKFLOW_SCHEMA_SQL);

const storage = new PostgresWorkflowStorage(pool);
```

## Usage With The Server

```ts
import { createWorkflowServer } from "@flowforge/server";
import { PostgresWorkflowStorage } from "@flowforge/storage-postgres";

const storage = new PostgresWorkflowStorage(pool);
const server = createWorkflowServer({ storage });
```

The server still owns:

- Revision checks
- Idempotency checks
- Definition mismatch handling through the core engine
- Invalid event handling through the core engine
- Available action calculation through the core engine

The storage adapter owns durable reads and transactional commits.

## Running Tests

The default Postgres adapter tests use `pg-mem`, so they do not require a local Postgres service.

```sh
pnpm test:postgres
```

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
