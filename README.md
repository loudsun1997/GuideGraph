# FlowForge

FlowForge is a developer toolkit for building, running, storing, and inspecting workflows.

This repository is organized as a small pnpm workspace:

```text
@flowforge/core
@flowforge/react
@flowforge/server
@flowforge/http
@flowforge/graph
@flowforge/storage-memory
@flowforge/storage-postgres
@flowforge/react-graph
@flowforge/devtools
```

## Getting Started

```sh
pnpm install
pnpm build
```

For a detailed list of supported features, unsupported features, package responsibilities, and usage examples, read:

- [FlowForge Capabilities Guide](docs/CAPABILITIES.md)
- [Developer and AI Agent Guide](docs/AGENT_GUIDE.md)
- [Permit App Manual Test Plan](examples/permit-app/MANUAL_TEST.md)

## Packages

- `@flowforge/core`: workflow definitions, execution primitives, and storage contracts.
- `@flowforge/react`: React hooks and workflow UI components.
- `@flowforge/server`: runtime API that creates instances, sends events, enforces revisions, and calls the core engine.
- `@flowforge/http`: fetch client and standard Web Request/Response handler for full-stack apps.
- `@flowforge/graph`: renderer-agnostic workflow graph conversion utilities.
- `@flowforge/storage-memory`: in-memory workflow storage for tests and local development.
- `@flowforge/storage-postgres`: Postgres-backed workflow storage adapter.
- `@flowforge/react-graph`: optional React Flow + ELK workflow graph renderer.
- `@flowforge/devtools`: event collection helpers for workflow debugging tools.

## Example App

Run the permit workflow example:

```sh
pnpm dev:permit
```

Then open:

```text
http://127.0.0.1:5173/
```

The example demonstrates concurrent steps, merge blocking, branch decisions, retry loops, optional graph visualization, graph inspector panels, history, revisions, server runtime usage, memory storage, and React bindings.

It also includes a dedicated graph use-case showcase for:

- concurrent active steps
- blocked merge state
- branching approval/rejection outcomes
- retry loop and history view

To run the example through the HTTP client/handler transport path, open:

```text
http://127.0.0.1:5173/?transport=http
```

## Postgres Storage

`@flowforge/storage-postgres` adds production-shaped persistence for workflow instances, events, history entries, and idempotency results. The adapter implements the `WorkflowStorage` interface from `@flowforge/server`; it does not duplicate workflow engine behavior.

The schema lives in `packages/storage-postgres/schema.sql`, versioned migrations live in `packages/storage-postgres/migrations`, and the package exports setup helpers:

- `runFlowForgePostgresMigrations()`
- `checkFlowForgePostgresSchema()`
- `storage.checkSchema()`

Production apps should run migrations explicitly and use `autoMigrate: false`. Local development and tests can opt into `autoMigrate: true`.

Run the adapter tests with:

```sh
pnpm test:postgres
```

The current tests use `pg-mem`, so they do not require a local Postgres service.

## Full Verification

Run the full confidence pass with:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm build:examples
```

Run the optional real Postgres adapter test with:

```sh
pnpm test:postgres:real
```

`pnpm test:postgres:real` uses the local `DATABASE_URL` in `.env.local` when one is not exported in the shell. See [Phase 5 Summary](docs/PHASE_5_SUMMARY.md) for the Postgres storage checkpoint.

## Core Example

```ts
import { createWorkflowInstance, applyWorkflowEvent } from "@flowforge/core";

const instance = createWorkflowInstance({
  definition: permitWorkflow,
  instanceId: "permit_1",
  actorId: "user_1"
});

const result = applyWorkflowEvent({
  definition: permitWorkflow,
  instance,
  event: {
    id: "event_1",
    instanceId: "permit_1",
    type: "COMPLETE_STEP",
    stepId: "fillForm",
    actorId: "user_1",
    occurredAt: new Date().toISOString()
  }
});

console.log(result.instance.revision);
```
