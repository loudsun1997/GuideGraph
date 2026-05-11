# FlowForge Developer and AI Agent Guide

This guide is for developers and coding agents integrating FlowForge into another app.

Use it as the implementation contract. When in doubt, follow the package boundaries here.

## Mental Model

FlowForge turns this:

```text
workflow definition + current instance + event
```

into this:

```text
next instance + history + available actions
```

Apps should not mutate workflow state directly. Apps should create instances, send events, and render the returned state.

## Package Responsibilities

```text
@flowforge/core
  Pure workflow engine.
  Defines workflows, validates definitions, creates instances, applies events,
  calculates blocked steps and available actions, and generates history.

@flowforge/server
  Backend runtime.
  Loads instances from storage, checks idempotency and revision conflicts,
  calls @flowforge/core, and commits results through WorkflowStorage.

@flowforge/storage-memory
  In-memory storage for demos, tests, and local development.

@flowforge/storage-postgres
  Production-shaped durable storage.
  Persists instances, events, history, and idempotency records transactionally.

@flowforge/http
  Optional HTTP transport.
  Provides a fetch client and a standard Web Request/Response handler.

@flowforge/react
  Optional React provider, hooks, and simple workflow UI components.
  Depends on a WorkflowClient interface, not on a specific server transport.

@flowforge/graph
  Optional renderer-agnostic graph data conversion.
  No React, React Flow, ELK, server, HTTP, or storage dependency.

@flowforge/react-graph
  Optional React Flow + ELK graph renderer.
  Provides <WorkflowGraph /> and graph inspector UI.

examples/permit-app
  End-to-end example and visual showcase.
```

## Correct Integration Path

For a backend app:

```ts
import { createWorkflowServer } from "@flowforge/server";
import { PostgresWorkflowStorage } from "@flowforge/storage-postgres";

const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: false
});

await storage.checkSchema();

const workflowServer = createWorkflowServer({ storage });
```

For a browser app using HTTP:

```ts
import { createHttpWorkflowClient } from "@flowforge/http";

const client = createHttpWorkflowClient({
  baseUrl: "/api/flowforge",
  getHeaders: async () => ({
    Authorization: `Bearer ${token}`
  })
});
```

For a React app:

```tsx
import { WorkflowProvider } from "@flowforge/react";

<WorkflowProvider
  actorId="user_1"
  client={client}
  definition={permitWorkflow}
  instanceId="permit_1"
>
  <PermitWorkflow />
</WorkflowProvider>;
```

## Runtime Rules

Always send events through FlowForge:

```tsx
const { availableActions, sendAction } = useWorkflowActions();

return availableActions.map((action) => (
  <button
    key={`${action.stepId}:${action.type}`}
    onClick={() =>
      void sendAction({
        stepId: action.stepId,
        type: action.type
      })
    }
    type="button"
  >
    {action.label}
  </button>
));
```

Do not manually set:

```text
instance.activeStepIds
instance.stepStates
instance.revision
instance.history
```

Those are framework-owned.

## Workflow Definitions

Definitions are static workflow structure.

Supported today:

- workflow id
- workflow version
- multiple start steps
- steps
- dependencies
- transitions
- transition event types
- transition labels

Dependency rules:

```text
all
any
atLeast
```

Transition loops are supported. Dependency cycles are rejected.

## Server Event Flow

`server.sendEvent()` must stay shaped like this:

```text
load instance from storage
check idempotency key
check expected revision
call applyWorkflowEvent() from @flowforge/core
persist updated instance
append workflow event
append history entry
cache idempotency result
return updated instance, history entry, changed step ids, actions, warnings
```

The server must not reimplement workflow logic.

## Idempotency and Revisions

Use `expectedRevision` to prevent stale writes.

Use `idempotencyKey` for safe retries.

Important behavior:

```text
same instance + same idempotency key + same event
  -> returns original cached result

same instance + same idempotency key + different event
  -> IDEMPOTENCY_CONFLICT

same idempotency key retry with stale expectedRevision
  -> returns cached result, not REVISION_CONFLICT
```

That last rule is intentional because clients often retry the exact same request with the old revision.

## HTTP API

Use `@flowforge/http` when browser code should not directly hold the server object.

Routes:

```text
POST /instances
GET /instances/:instanceId
POST /instances/:instanceId/events
GET /instances/:instanceId/history
GET /instances/:instanceId/actions
POST /instances/:instanceId/reset
```

The HTTP handler resolves workflow definitions server-side. The client sends `workflowId` and `workflowVersion`, not trusted full definitions.

Actor identity should come from:

```ts
getActorId(request)
```

The host app owns authentication and authorization.

## Storage

Use memory storage for:

- tests
- local demos
- examples
- quick prototypes

Use Postgres storage for production-shaped persistence.

Postgres setup:

```sh
psql "$DATABASE_URL" -f node_modules/@flowforge/storage-postgres/schema.sql
```

Or from code:

```ts
import { runFlowForgePostgresMigrations } from "@flowforge/storage-postgres";

await runFlowForgePostgresMigrations({
  connectionString: process.env.DATABASE_URL!
});
```

Production default:

```ts
new PostgresWorkflowStorage({
  connectionString,
  autoMigrate: false
});
```

Only use `autoMigrate: true` for local development and tests.

## React UI

`@flowforge/react` exposes:

- `WorkflowProvider`
- `useWorkflow()`
- `useOptionalWorkflow()`
- `useWorkflowActions()`
- `useWorkflowHistory()`
- `CurrentStepCard`
- `NextActions`
- `BlockedSteps`
- `WorkflowTimeline`
- `DocumentChecklist`
- `WorkflowStatusList`

The React package depends on the `WorkflowClient` interface. It can work with:

- a local server adapter
- the HTTP client
- a custom app client

It should not import `@flowforge/http`, `@flowforge/server`, or storage packages directly.

## Graph UI

Use `@flowforge/graph` for generic graph data:

```ts
import { buildWorkflowGraph } from "@flowforge/graph";

const graph = buildWorkflowGraph({
  definition,
  instance,
  history
});
```

Use `@flowforge/react-graph` for the built-in React graph:

```tsx
import { WorkflowGraph } from "@flowforge/react-graph";

<WorkflowGraph />;
```

The built-in graph currently supports:

- React Flow canvas
- ELK layered layout
- active/completed/blocked/waiting/not-started visual states
- dependency and transition edges
- branch labels
- loop/retry edge markers
- selected-node inspector
- blocked reason panel
- dependency progress
- possible outcomes panel
- available actions for selected step
- history panel
- legend

Do not put React Flow or ELK into `@flowforge/react`. They belong only in `@flowforge/react-graph`.

## Permit App Showcase

The example app contains both:

1. A live workflow demo.
2. A static graph use-case showcase.

The showcase demonstrates:

- concurrent active intake steps
- blocked merge state
- branch outcomes from review
- retry loop and history view

The live demo demonstrates:

- create/reset instance
- complete parallel intake steps
- unlock `submitApplication`
- submit to `cityReview`
- approve path
- reject/fix/resubmit/review path
- history updates
- revision updates
- local and HTTP transport modes

Run:

```sh
pnpm dev:permit
```

Open:

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/?transport=http
```

## Supported Today

Supported:

- definition validation
- instance creation
- concurrent active steps
- dependency rules: `all`, `any`, `atLeast`
- merge blocking/unlocking
- blocked reasons
- branch transitions
- retry loops
- available actions
- append-only history
- revision increments
- idempotency
- stable server errors
- memory storage
- Postgres storage
- HTTP client/handler
- React provider/hooks/components
- renderer-agnostic graph data
- optional React graph renderer
- permit app visual showcase

Not supported yet:

- undo
- redo
- no-code editor
- visual workflow editor
- definition persistence/version migration
- auth/permissions
- timers/scheduled events
- async job queues
- webhooks
- SLA/deadline handling
- form schema system
- file storage integrations

## Verification Commands

Run the full local confidence pass:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm build:examples
```

Focused tests:

```sh
pnpm test:core
pnpm test:server
pnpm test:http
pnpm test:graph
pnpm test:postgres
```

Real Postgres test:

```sh
pnpm test:postgres:real
```

`pnpm test:postgres:real` expects a working `DATABASE_URL` from the shell or `.env.local`.
