# Phase 5 Summary: Postgres Storage Adapter

Phase 5 added production-shaped persistence for GuideGraph through `@guidegraph/storage-postgres`.

## What Was Built

- `PostgresWorkflowStorage`, implementing the `WorkflowStorage` interface from `@guidegraph/server`
- `schema.sql` for simple setup
- `migrations/0001_init.sql` for versioned setup
- `workflow_schema_migrations` tracking table
- `runGuideGraphPostgresMigrations()`
- `checkGuideGraphPostgresSchema()`
- `storage.checkSchema()`
- explicit `autoMigrate: true` for local development and tests
- optional real Postgres integration test path

## What It Persists

- workflow instances
- workflow events
- workflow history entries
- idempotency results

`commitEvent()` writes the updated instance, event, history entry, and idempotency result transactionally.

## Production Behavior

GuideGraph does not silently create Postgres tables by default.

Production should use:

```ts
const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: false,
});

await storage.checkSchema();
```

If tables are missing, GuideGraph throws a clear setup error telling the developer to run:

```sh
npx guidegraph postgres init
```

or:

```sh
psql "$DATABASE_URL" -f node_modules/@guidegraph/storage-postgres/schema.sql
```

## Local And Test Behavior

Local development and tests can opt into automatic migrations:

```ts
const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: true,
});
```

The repo also has a disposable local Postgres 17 test database documented in `packages/storage-postgres/REAL_POSTGRES_TESTS.md`.

## Schema Notes

The schema includes:

- `workflow_instances`
- `workflow_events`
- `workflow_history`
- `workflow_idempotency_results`
- `workflow_schema_migrations`

Important integrity and performance details:

- idempotency rows cascade when an instance is deleted
- event/history reads are indexed by `(instance_id, occurred_at, id)`
- instance listing is indexed by workflow and status
- SQL-level optimistic concurrency checks the previous revision during event commits

The history table does not yet enforce `event_id` as a foreign key because the initial `INSTANCE_CREATED` history entry is not currently stored as a workflow event.

## Known Design Decision

`workflow_history.event_id` is intentionally not a foreign key in Phase 5.

Reason: GuideGraph currently creates an initial `INSTANCE_CREATED` history entry when an instance is created, but it does not yet persist a matching `INSTANCE_CREATED` row in `workflow_events`. Adding a foreign key now would make instance creation fail unless the event model changes too.

Long term, GuideGraph should prefer this stricter model:

```text
every workflow_history entry is caused by exactly one workflow_events row
```

That means `INSTANCE_CREATED` should become a real stored workflow event. Once that is true, the schema should enforce:

```sql
workflow_history.event_id REFERENCES workflow_events(id)
```

This would give stronger audit integrity and make history/event relationships easier to verify.

## Test Coverage

Phase 5 tests cover:

- create and load instance
- persist instance after event
- persist event log
- persist history log
- return history entries
- revision conflict
- stale-revision idempotent retry
- idempotency conflict
- unknown instance
- invalid event
- workflow definition mismatch
- transaction behavior
- persistence across a new storage adapter instance
- migration runner
- schema checker
- missing schema error
- explicit auto migration
- real Postgres 17 integration

## Full Verification Commands

Run:

```sh
pnpm test
pnpm test:postgres:real
pnpm typecheck
pnpm build
```

If `pnpm test:postgres:real` is run from Codex, it may need local network permission to connect to `localhost:5432`. The real Postgres test is intentionally excluded from the default test scripts, so normal test runs do not report a skipped local-database test.
