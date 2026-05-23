# GuideGraph Developer and AI Agent Guide

This guide is for developers and coding agents integrating GuideGraph into another app.

Use it as the implementation contract. When in doubt, follow the package boundaries here.

## Mental Model

GuideGraph turns this:

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
@guidegraph/core
  Pure workflow engine.
  Defines workflows, validates definitions, creates instances, applies events,
  calculates blocked steps and available actions, and generates history.

@guidegraph/builder
  Framework-agnostic workflow definition builder utilities.
  Provides the preferred code-first fluent builder API, reusable workflow factories,
  draft definition editing, builder-only canvas metadata, validation/publish conversion,
  and preview simulations through core.

@guidegraph/mcp
  Optional AI tooling adapter.
  Exposes MCP tools for validating, building, summarizing, and simulating workflows
  through the real @guidegraph/builder and @guidegraph/core packages.

@guidegraph/server
  Backend runtime.
  Loads instances from storage, checks idempotency and revision conflicts,
  calls @guidegraph/core, and commits results through WorkflowStorage.

@guidegraph/storage-memory
  In-memory storage for demos, tests, and local development.

@guidegraph/storage-postgres
  Production-shaped durable storage.
  Persists instances, events, history, and idempotency records transactionally.

@guidegraph/http
  Optional HTTP transport.
  Provides a fetch client and a standard Web Request/Response handler.

@guidegraph/react
  Optional React provider, hooks, and simple workflow UI components.
  Depends on a WorkflowClient interface, not on a specific server transport.

@guidegraph/graph
  Optional renderer-agnostic graph data conversion.
  No React, React Flow, ELK, server, HTTP, or storage dependency.

@guidegraph/react-graph
  Optional React Flow + ELK graph renderer.
  Provides <WorkflowGraph /> and graph inspector UI.

@guidegraph/react-builder
  Optional React Flow workflow builder UI.
  Provides <WorkflowBuilder /> for draft definition editing and publishes plain WorkflowDefinition output.

examples/permit-app
  End-to-end example and visual showcase.

examples/builder-app
  Builder example app and manual visual playground.
```

## Correct Integration Path

For a backend app:

```ts
import { createWorkflowServer } from "@guidegraph/server";
import { PostgresWorkflowStorage } from "@guidegraph/storage-postgres";

const storage = new PostgresWorkflowStorage({
  connectionString: process.env.DATABASE_URL!,
  autoMigrate: false
});

await storage.checkSchema();

const workflowServer = createWorkflowServer({ storage });
```

For a browser app using HTTP:

```ts
import { createHttpWorkflowClient } from "@guidegraph/http";

const client = createHttpWorkflowClient({
  baseUrl: "/api/guidegraph",
  getHeaders: async () => ({
    Authorization: `Bearer ${token}`
  })
});
```

For a React app:

```tsx
import { WorkflowProvider } from "@guidegraph/react";

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

Always send events through GuideGraph:

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

## Preferred Code-First Authoring

When an app or AI agent authors a workflow in code, prefer `@guidegraph/builder` over hand-writing raw JSON.

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
  .step("approved", "Approved", (step) => step.requiresAll("cityReview"))
  .step("fixIssues", "Fix Issues", (step) => step.requiresAll("cityReview"))
  .transition("fillForm", "submitApplication")
  .transition("uploadDocuments", "submitApplication")
  .transition("payFee", "submitApplication")
  .transition("submitApplication", "cityReview", { label: "Submit" })
  .transition("cityReview", "approved", {
    event: "REVIEW_APPROVED",
    label: "Approve"
  })
  .transition("cityReview", "fixIssues", {
    event: "REVIEW_REJECTED",
    label: "Reject"
  })
  .transition("fixIssues", "submitApplication", { label: "Resubmit" })
  .build();
```

Use `createWorkflowFactory()` when an app has reusable templates with app-specific parameters.

## Extensibility Contract

GuideGraph now supports the extension points most real apps need, but the ownership boundary is strict:

```text
GuideGraph owns:
  state, dependencies, transitions, history, revisions, idempotency, actions

Host app owns:
  uploads, app database rows, auth, permissions, external APIs, custom execution
```

Attach app behavior through:

```text
step metadata
event guards
lifecycle hooks
context/data binding
assignment metadata
timers/deadlines/escalation metadata
human task input schemas
artifact/file references
outbox side-effect records
compensation metadata
audit metadata
version migration metadata
```

Example:

```ts
const definition = workflow("permit-application", "Permit Application")
  .version("1.0.0")
  .startStep("uploadDocuments", "Upload Documents", (step) =>
    step
      .metadata({ kind: "upload" })
      .assignment({ role: "applicant" })
      .timer({ kind: "deadline", after: "P3D" })
      .input({ required: ["sitePlan"] })
      .artifact({ id: "sitePlan", kind: "document", required: true })
      .effect({ type: "notification", target: "applicant" })
      .compensation({ effect: { type: "custom", target: "delete-uploaded-files" } })
  )
  .step("review", "Review", (step) =>
    step.requiresAll("uploadDocuments").assignment({ role: "reviewer" })
  )
  .transition("uploadDocuments", "review", {
    effects: [{ type: "webhook", target: "https://example.test/workflow" }]
  })
  .migration({
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    description: "Add inspection step later"
  })
  .build();
```

Server guard and hook example:

```ts
const server = createWorkflowServer({
  storage,
  guards: [
    async ({ event }) => {
      if (event.stepId === "uploadDocuments" && event.payload?.allow !== true) {
        return "Required uploads are missing.";
      }
    }
  ],
  hooks: {
    onStepCompleted: async ({ step }) => [
      { type: "notification", target: step?.id }
    ],
    onAfterEvent: async () => [
      { type: "outbox", target: "external-sync" }
    ]
  }
});
```

Events can patch workflow context and append artifact ids:

```ts
await server.sendEvent({
  definition,
  instanceId: "permit_1",
  event: {
    id: "event_1",
    instanceId: "permit_1",
    type: "COMPLETE_STEP",
    stepId: "uploadDocuments",
    occurredAt: new Date().toISOString(),
    payload: {
      allow: true,
      context: { uploaded: true }
    },
    artifactIds: ["site_plan"],
    metadata: { source: "document-upload-ui" }
  }
});
```

## AI Authoring Path

For AI-assisted workflow authoring:

```text
agent prompt / app form / visual builder
  -> @guidegraph/builder fluent API or compact MCP build input
  -> WorkflowDefinition
  -> validateWorkflowDefinition()
  -> simulate with @guidegraph/core
  -> persist/publish in the host app
```

MCP tools available from `@guidegraph/mcp`:

```text
guidegraph_validate_workflow
guidegraph_build_workflow
guidegraph_simulate_workflow
guidegraph_summarize_workflow
```

Agents should call `guidegraph_validate_workflow` and usually `guidegraph_simulate_workflow` before proposing a generated definition as done.

## Server Event Flow

`server.sendEvent()` must stay shaped like this:

```text
load instance from storage
check idempotency key
check expected revision
call applyWorkflowEvent() from @guidegraph/core
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

Use `@guidegraph/http` when browser code should not directly hold the server object.

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
psql "$DATABASE_URL" -f node_modules/@guidegraph/storage-postgres/schema.sql
```

Or from code:

```ts
import { runGuideGraphPostgresMigrations } from "@guidegraph/storage-postgres";

await runGuideGraphPostgresMigrations({
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

`@guidegraph/react` exposes:

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

It should not import `@guidegraph/http`, `@guidegraph/server`, or storage packages directly.

## Graph UI

Use `@guidegraph/graph` for generic graph data:

```ts
import { buildWorkflowGraph } from "@guidegraph/graph";

const graph = buildWorkflowGraph({
  definition,
  instance,
  history
});
```

Use `@guidegraph/react-graph` for the built-in React graph:

```tsx
import { WorkflowGraph } from "@guidegraph/react-graph";

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

Do not put React Flow or ELK into `@guidegraph/react`. They belong only in `@guidegraph/react-graph`.

## Workflow Builder

Use `@guidegraph/builder` when an app needs to create or edit workflow definitions without hand-writing every `WorkflowDefinition`.

The builder package is framework-agnostic and exports utilities for:

- creating blank or template-based builder drafts
- converting runtime definitions into builder definitions
- converting builder definitions back to plain runtime definitions
- adding, updating, deleting, and renaming steps
- marking start steps
- creating dependency edges
- creating grouped dependency rules for `all`, `any`, and `atLeast` merge gates
- creating transition/action edges
- storing canvas node positions as builder-only metadata
- storing action label positions/icons as builder-only metadata
- validating through `@guidegraph/core`
- generating summaries and warnings
- running preview simulations through the core engine

Builder-only metadata lives under:

```ts
definition.builder
```

Publishing should use:

```ts
import { builderDefinitionToWorkflowDefinition } from "@guidegraph/builder";

const runtimeDefinition = builderDefinitionToWorkflowDefinition(builderDraft);
```

The runtime output intentionally excludes builder-only canvas metadata.

Use `@guidegraph/react-builder` for the optional built-in editor:

```tsx
import { WorkflowBuilder } from "@guidegraph/react-builder";

<WorkflowBuilder
  initialDefinition={builderDraft}
  onChange={setBuilderDraft}
  onPublish={(definition, builderDefinition) => {
    saveRuntimeDefinition(definition);
    saveBuilderDraft(builderDefinition);
  }}
/>;
```

The current builder UI supports:

- React Flow canvas editor
- step cards
- dependency edges
- grouped `all`, `any`, and `atLeast` requirement rules
- transition/action edges
- action label nodes
- requirement gate nodes
- step inspector
- edge inspector
- editable step id/title/description/start status
- action event/label/icon editing
- validation and warnings
- preview/simulation tab
- generated runtime JSON preview
- read-only behavior for published drafts

The builder is an MVP reusable builder, not a complete production no-code studio. Host apps still own workflow definition persistence, publish approval flows, auth, permissions, version lifecycle, and domain-specific form configuration.

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

## Builder App Showcase

Run:

```sh
pnpm dev:builder
```

Use the builder app to manually check:

- loading the permit workflow template
- creating a blank draft
- adding steps
- editing step metadata
- editing requirement/action edges
- switching between canvas, form, and preview tabs
- publishing a valid runtime definition
- seeing published/read-only behavior
- confirming generated JSON excludes builder metadata

Run the component workbench:

```sh
pnpm stories:builder
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
- framework-agnostic builder utilities
- optional React workflow builder
- permit app visual showcase

Not supported yet:

- undo
- redo
- full production no-code studio
- builder-backed definition persistence
- publish approval workflow
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
pnpm test:builder
pnpm test:postgres
```

Real Postgres test:

```sh
pnpm test:postgres:real
```

`pnpm test:postgres:real` expects a working `DATABASE_URL` from the shell or `.env.local`. The real Postgres test is intentionally excluded from the default test scripts, so regular test runs do not report a skipped local-database test.
