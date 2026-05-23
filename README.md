# GuideGraph

GuideGraph is a developer toolkit for building, running, storing, and inspecting workflows.

This repository is organized as a small pnpm workspace:

```text
@guidegraph/core
@guidegraph/react
@guidegraph/server
@guidegraph/http
@guidegraph/graph
@guidegraph/builder
@guidegraph/mcp
@guidegraph/storage-memory
@guidegraph/storage-postgres
@guidegraph/react-graph
@guidegraph/react-builder
@guidegraph/devtools
```

## Getting Started

```sh
pnpm install
pnpm build
```

For a detailed list of supported features, unsupported features, package responsibilities, and usage examples, read:

- [GuideGraph Capabilities Guide](docs/CAPABILITIES.md)
- [Developer and AI Agent Guide](docs/AGENT_GUIDE.md)
- [Permit App Manual Test Plan](examples/permit-app/MANUAL_TEST.md)

## Packages

- `@guidegraph/core`: workflow definitions, execution primitives, and storage contracts.
- `@guidegraph/react`: React hooks and workflow UI components.
- `@guidegraph/server`: runtime API that creates instances, sends events, enforces revisions, and calls the core engine.
- `@guidegraph/http`: fetch client and standard Web Request/Response handler for full-stack apps.
- `@guidegraph/graph`: renderer-agnostic workflow graph conversion utilities.
- `@guidegraph/builder`: code-first workflow builder API plus framework-agnostic draft/canvas editing utilities.
- `@guidegraph/mcp`: optional MCP server tools for AI agents to validate, build, summarize, and simulate workflows.
- `@guidegraph/storage-memory`: in-memory workflow storage for tests and local development.
- `@guidegraph/storage-postgres`: Postgres-backed workflow storage adapter.
- `@guidegraph/react-graph`: optional React Flow + ELK workflow graph renderer.
- `@guidegraph/react-builder`: optional React Flow workflow builder UI for draft definitions.
- `@guidegraph/devtools`: event collection helpers for workflow debugging tools.

## Example Apps

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

Run the workflow builder example:

```sh
pnpm dev:builder
```

The builder app demonstrates draft definition editing, React Flow canvas editing, dependency/action edge creation, validation, preview simulation through `@guidegraph/core`, publish output, and generated `WorkflowDefinition` JSON.

Run the builder component workbench:

```sh
pnpm stories:builder
```

## Code-First Workflow Authoring

Use `@guidegraph/builder` when you want a safer authoring API than hand-written JSON:

```ts
import { workflow } from "@guidegraph/builder";

export const permitWorkflow = workflow("permit-application", "Permit Application")
  .version("1.0.0")
  .start(["fillForm", "uploadDocuments", "payFee"])
  .step("fillForm", "Fill Form")
  .step("uploadDocuments", "Upload Documents")
  .step("payFee", "Pay Fee")
  .step("submitApplication", "Submit Application", (step) =>
    step.requiresAll(["fillForm", "uploadDocuments", "payFee"])
  )
  .step("cityReview", "City Review", (step) => step.requiresAll("submitApplication"))
  .transition("fillForm", "submitApplication")
  .transition("uploadDocuments", "submitApplication")
  .transition("payFee", "submitApplication")
  .transition("submitApplication", "cityReview")
  .build();
```

The builder returns the same plain `WorkflowDefinition` used by `@guidegraph/core`, `@guidegraph/server`, storage adapters, HTTP, React, and graph packages.

## Extensibility Runtime

GuideGraph now supports the extension points apps usually need around a workflow engine:

- step metadata
- event guards
- lifecycle hooks
- context/data binding
- assignment and ownership metadata
- timers/deadlines/escalation metadata
- human task input schemas
- artifact/file references
- external effect/outbox records
- compensation metadata
- audit metadata
- version migration metadata

GuideGraph still does not own your app database, uploaded files, auth system, or external APIs. Those stay in the host app. GuideGraph provides the workflow state, extension metadata, guard/hook execution points, and side-effect records that let the host app connect its own behavior cleanly.

## AI Agent Integration

`@guidegraph/mcp` provides MCP tools for AI agents:

- `guidegraph_validate_workflow`
- `guidegraph_build_workflow`
- `guidegraph_simulate_workflow`
- `guidegraph_summarize_workflow`

Build and smoke-test the MCP server locally:

```sh
pnpm --filter @guidegraph/mcp build
node packages/mcp/dist/stdio.js
```

## Postgres Storage

`@guidegraph/storage-postgres` adds production-shaped persistence for workflow instances, events, history entries, and idempotency results. The adapter implements the `WorkflowStorage` interface from `@guidegraph/server`; it does not duplicate workflow engine behavior.

The schema lives in `packages/storage-postgres/schema.sql`, versioned migrations live in `packages/storage-postgres/migrations`, and the package exports setup helpers:

- `runGuideGraphPostgresMigrations()`
- `checkGuideGraphPostgresSchema()`
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
pnpm build:stories
```

Run the optional real Postgres adapter test with:

```sh
pnpm test:postgres:real
```

`pnpm test:postgres:real` uses the local `DATABASE_URL` in `.env.local` when one is not exported in the shell. The real Postgres test is intentionally excluded from the default test scripts, so regular test runs do not report a skipped local-database test. See [Phase 5 Summary](docs/PHASE_5_SUMMARY.md) for the Postgres storage checkpoint.

## Core Example

```ts
import { createWorkflowInstance, applyWorkflowEvent } from "@guidegraph/core";

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
