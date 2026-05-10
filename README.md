# FlowForge

FlowForge is a developer toolkit for building, running, storing, and inspecting workflows.

This repository is organized as a small pnpm workspace:

```text
@flowforge/core
@flowforge/react
@flowforge/server
@flowforge/storage-memory
@flowforge/storage-postgres
@flowforge/devtools
```

## Getting Started

```sh
pnpm install
pnpm build
```

For a detailed list of supported features, unsupported features, package responsibilities, and usage examples, read [FlowForge Capabilities Guide](docs/CAPABILITIES.md).

## Packages

- `@flowforge/core`: workflow definitions, execution primitives, and storage contracts.
- `@flowforge/react`: React hooks for running workflows from UI code.
- `@flowforge/server`: runtime API that creates instances, sends events, enforces revisions, and calls the core engine.
- `@flowforge/storage-memory`: in-memory workflow storage for tests and local development.
- `@flowforge/storage-postgres`: Postgres-backed workflow storage adapter.
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

The example demonstrates concurrent steps, merge blocking, branch decisions, retry loops, history, revisions, server runtime usage, memory storage, and React bindings.

## Postgres Storage

`@flowforge/storage-postgres` adds production-shaped persistence for workflow instances, events, history entries, and idempotency results. The adapter implements the `WorkflowStorage` interface from `@flowforge/server`; it does not duplicate workflow engine behavior.

The schema lives in `packages/storage-postgres/schema.sql` and is also exported as `POSTGRES_WORKFLOW_SCHEMA_SQL`.

Run the adapter tests with:

```sh
pnpm test:postgres
```

The current tests use `pg-mem`, so they do not require a local Postgres service.

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
