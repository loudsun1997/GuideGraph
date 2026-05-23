# GuideGraph Capabilities Guide

This guide documents what GuideGraph supports today, how the pieces fit together, and which features are intentionally not supported yet.

GuideGraph is currently a developer toolkit for building workflow-driven products. It now includes an MVP reusable builder, but it is not a complete production no-code workflow studio yet. The supported runtime path is:

```text
workflow definition
  -> create workflow instance
  -> send workflow events
  -> core engine calculates next state
  -> server persists instance, events, history, idempotency records
  -> optional HTTP transport exposes the runtime to browser clients
  -> React renders persisted state and sends actions back through the server
```

The most important rule is that applications should not mutate workflow state directly. Apps should send events through the server/runtime and render the returned instance.

## Package Map

```text
@guidegraph/core
@guidegraph/server
@guidegraph/http
@guidegraph/graph
@guidegraph/builder
@guidegraph/mcp
@guidegraph/storage-memory
@guidegraph/react
@guidegraph/storage-postgres
@guidegraph/react-graph
@guidegraph/react-builder
@guidegraph/devtools
examples/permit-app
examples/builder-app
```

### `@guidegraph/core`

Owns workflow definitions and the workflow engine.

Use this package when you need to:

- define workflows
- validate workflow definitions
- create workflow instances
- apply workflow events
- calculate active steps
- calculate blocked steps
- calculate available actions
- generate workflow history entries
- increment workflow revisions
- carry workflow context and artifact references
- define step metadata, assignments, timers, human-task input schemas, effects, compensation, and migration metadata

The core package is pure TypeScript. It does not import React, storage, HTTP, or database code.

### `@guidegraph/server`

Owns runtime orchestration around the core engine.

Use this package when you need to:

- create a workflow server/runtime
- create workflow instances
- load instances
- send events
- check expected revisions
- enforce idempotency
- run app-specific event guards
- run lifecycle hooks
- collect outbox-style side effects
- persist event results through a storage interface
- retrieve history
- retrieve available actions from persisted state

The server package does not reimplement workflow logic. It calls `applyWorkflowEvent()` from `@guidegraph/core`.

### `@guidegraph/http`

Owns HTTP transport between frontend clients and backend GuideGraph runtimes.

Use this package when you need to:

- create a fetch-based workflow client
- expose a GuideGraph backend over standard Web `Request` and `Response`
- keep React transport-agnostic
- inject actor identity on the server
- return structured GuideGraph error responses

The HTTP package does not import React. React does not import the HTTP package.

### `@guidegraph/builder`

Provides framework-agnostic builder utilities for workflow definitions.

Use this package when you want to:

- author workflows with a fluent code-first builder API
- create reusable workflow factories/templates
- create blank workflow drafts
- clone runtime definitions into editable builder definitions
- convert builder definitions back into plain runtime definitions
- add, update, delete, and rename steps
- mark start steps
- create dependency edges
- create grouped dependency rules for `all`, `any`, and `atLeast` merge gates
- create transition/action edges
- keep canvas positions as builder-only metadata
- keep action label layout/icons as builder-only metadata
- validate drafts through `@guidegraph/core`
- generate summaries and warnings
- run preview simulations through the core engine

Builder-only metadata is stored on `definition.builder`. `builderDefinitionToWorkflowDefinition()` strips this metadata before runtime use.

## Extensibility Model

GuideGraph now supports the main extension points real apps usually need. The important split is:

```text
GuideGraph owns workflow state and transitions.
The host app owns domain behavior and external systems.
```

Supported extension areas:

1. Step metadata
2. Event/action guards
3. Lifecycle hooks
4. Workflow context/data binding
5. Assignment and ownership
6. Timers, deadlines, reminders, and escalations
7. Human task input schemas
8. Artifacts and file references
9. External effects/outbox records
10. Compensation/rollback metadata
11. Observability/audit metadata
12. Versioning/migration metadata

### Step Metadata

Attach app-specific display or behavior hints to workflow definitions:

```ts
step.metadata({
  kind: "upload",
  requiredDocuments: ["sitePlan", "proofOfOwnership"]
});
```

GuideGraph persists and exposes metadata, but the host app decides how to render or enforce it.

### Event Guards

Guards run before `applyWorkflowEvent()`:

```ts
const server = createWorkflowServer({
  storage,
  guards: [
    async ({ event }) => {
      if (event.stepId === "uploadDocuments" && event.payload?.allow !== true) {
        return "Required uploads are missing.";
      }
    }
  ]
});
```

Rejected guards throw stable `GUARD_REJECTED` errors.

### Lifecycle Hooks

Hooks let apps react to workflow changes:

```ts
createWorkflowServer({
  storage,
  hooks: {
    onInstanceCreated: async ({ instance }) => {},
    onBeforeEvent: async ({ event }) => {},
    onStepCompleted: async ({ step }) => [{ type: "notification", target: step?.id }],
    onStepActivated: async ({ step }) => [{ type: "webhook", target: step?.id }],
    onWorkflowCompleted: async ({ instance }) => {},
    onAfterEvent: async ({ result }) => [{ type: "outbox", target: "external-sync" }]
  }
});
```

Hook failures throw stable `HOOK_FAILED` errors.

### Context And Artifacts

Instances can carry app-owned references:

```ts
await server.createInstance({
  definition,
  instanceId: "permit_1",
  context: { permitId: "permit_123" },
  artifactIds: ["doc_1"]
});
```

Events can patch context and append artifact ids:

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
      context: { uploaded: true }
    },
    artifactIds: ["site_plan"]
  }
});
```

### Assignments, Timers, Inputs, Artifacts

Steps can describe who owns work, when it is due, which structured input is expected, and which artifacts are required:

```ts
step("uploadDocuments", "Upload Documents", (step) =>
  step
    .assignment({ role: "applicant" })
    .timer({ kind: "deadline", after: "P3D" })
    .input({ required: ["sitePlan"] })
    .artifact({ id: "sitePlan", kind: "document", required: true })
);
```

These fields flow into active step state and available actions.

### Effects And Outbox

Effects are structured side-effect records. GuideGraph collects them, returns them from `sendEvent()`, and memory storage stores them for tests/demos.

```ts
step.effect({ type: "notification", target: "applicant" });
transition("review", "approved", {
  event: "APPROVE",
  effects: [{ type: "webhook", target: "https://example.test" }]
});
```

Production apps should process effects with an outbox worker rather than doing unreliable network calls inline.

### Compensation

Steps and transitions can register compensation metadata:

```ts
step.compensation({
  effect: { type: "custom", target: "refund-payment" }
});
```

GuideGraph records the compensation effect. The host app decides how and when to execute it.

### Audit Metadata

Events support `metadata` and `payload`; history entries include that data for audit visibility.

### Version Migrations

Workflow definitions can carry migration metadata:

```ts
migration({
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  description: "Add inspection step"
});
```

GuideGraph validates migration metadata. Automatic live-instance migration is still a future feature.

Example code-first authoring:

```ts
import { workflow } from "@guidegraph/builder";

const definition = workflow("permit-application", "Permit Application")
  .version("1.0.0")
  .start(["fillForm", "uploadDocuments", "payFee"])
  .step("fillForm", "Fill Form")
  .step("uploadDocuments", "Upload Documents")
  .step("payFee", "Pay Fee")
  .step("submitApplication", "Submit Application", (step) =>
    step.requiresAll(["fillForm", "uploadDocuments", "payFee"])
  )
  .transition("fillForm", "submitApplication")
  .transition("uploadDocuments", "submitApplication")
  .transition("payFee", "submitApplication")
  .build();
```

### `@guidegraph/mcp`

Provides MCP tools for AI agents and editor integrations.

Use this package when you want an AI agent to:

- validate a `WorkflowDefinition`
- build a workflow from a compact AI-friendly spec
- simulate workflow events through the real core engine
- summarize workflow structure

Available tools:

```text
guidegraph_validate_workflow
guidegraph_build_workflow
guidegraph_simulate_workflow
guidegraph_summarize_workflow
```

The MCP package does not import React, HTTP, server, or storage packages.

### `@guidegraph/storage-memory`

Provides an in-memory implementation of the server storage interface.

Use this package for:

- local development
- examples
- integration tests
- demos
- fast prototyping

It is not meant for production persistence.

### `@guidegraph/react`

Provides React bindings and simple workflow UI components.

Use this package when you want to:

- create workflow-driven React UIs
- use a `WorkflowProvider`
- use `useWorkflow()`, `useWorkflowActions()`, `useWorkflowHistory()`, and `useOptionalWorkflow()`
- read workflow state with hooks
- render current active steps
- render available actions
- render blocked steps
- render workflow history
- render a simple status list

React is optional. Core and server do not depend on React.

### `@guidegraph/graph`

Provides renderer-agnostic workflow graph data.

Use this package when you want to:

- convert workflow definitions and instances into graph nodes and edges
- distinguish dependency edges from transition edges
- map step state to graph status
- expose blocked reasons and missing prerequisite ids
- mark terminal steps, visited nodes, and loop edges
- feed your own renderer, such as React Flow, Cytoscape, Mermaid, D3, or custom SVG

This package does not depend on React, React Flow, or ELK.

### `@guidegraph/react-graph`

Provides the optional drop-in graph renderer for React apps.

Use this package when you want to:

- render `<WorkflowGraph />`
- use React Flow for pan, zoom, controls, nodes, and edges
- use ELK.js for automatic layered layout
- visualize active, completed, blocked, waiting, failed, skipped, and not-started states
- inspect selected step details, blockers, dependency progress, outcomes, actions, and history
- keep graph dependencies out of the base `@guidegraph/react` package

This package depends on `@guidegraph/graph`, `@guidegraph/react`, `@xyflow/react`, and `elkjs`. Install it only when you want the built-in graph UI.

### `@guidegraph/react-builder`

Provides the optional React builder UI.

Use this package when you want to render:

- `<WorkflowBuilder />`
- React Flow canvas editing
- step cards
- dependency edges
- grouped `all`, `any`, and `atLeast` requirement rules
- transition/action edges
- action label nodes
- requirement gate nodes
- step and edge inspectors
- validation and warning panels
- preview/simulation tab
- generated runtime JSON preview
- read-only mode for published definitions

This package depends on `@guidegraph/builder`, `@guidegraph/core`, `@xyflow/react`, React, and React DOM. It is optional and should not be imported by core/server/http packages.

### `@guidegraph/storage-postgres`

Provides a Postgres implementation of the server storage interface.

Use this package when you need:

- durable workflow instance persistence
- durable event logs
- durable history logs
- idempotency result caching for retries
- transactional event commits
- data that survives process restarts

### `@guidegraph/devtools`

Provides early event recording helpers for workflow debugging tools.

This is not a full visual devtools panel yet.

### `examples/permit-app`

A Vite React example that demonstrates the current GuideGraph runtime end to end.

The permit app demonstrates:

- creating an instance
- concurrent start steps
- merge blocking
- merge unlocking
- workflow graph visualization
- dedicated graph use-case showcase
- graph selected-step inspector
- graph blocked-reason panel
- graph branch/outcome panel
- graph history/visited-path panel
- review branching
- rejection retry loop
- history
- revisions
- React rendering through `@guidegraph/react`
- HTTP client/handler mode through `?transport=http`
- server/runtime calls through `@guidegraph/server`
- memory persistence through `@guidegraph/storage-memory`
- explicit reset behavior through `resetInstance()`

Manual validation steps are documented in [examples/permit-app/MANUAL_TEST.md](../examples/permit-app/MANUAL_TEST.md).

### `examples/builder-app`

A Vite React example dedicated to the workflow builder.

The builder app demonstrates:

- loading the permit template
- creating a blank draft
- editing draft workflow structure
- adding steps
- editing step metadata
- editing requirements and actions
- validating drafts
- previewing/simulating the draft through core
- publishing to a plain runtime `WorkflowDefinition`
- inspecting generated runtime JSON

Run it with:

```sh
pnpm dev:builder
```

## Workflow Definitions

A workflow definition describes the static shape of a workflow.

Supported definition fields:

```ts
interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  startStepIds: readonly string[];
  steps: readonly WorkflowStepDefinition[];
  transitions?: readonly WorkflowTransition[];
}
```

Example:

```ts
const permitWorkflow = {
  id: "permit_application",
  name: "Permit Application",
  version: "1.0.0",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    { id: "fillForm", name: "Fill Form" },
    { id: "uploadDocuments", name: "Upload Documents" },
    { id: "payFee", name: "Pay Fee" },
    {
      id: "submitApplication",
      name: "Submit Application",
      dependencies: [
        {
          type: "all",
          stepIds: ["fillForm", "uploadDocuments", "payFee"]
        }
      ]
    }
  ],
  transitions: [
    { from: "fillForm", to: "submitApplication" },
    { from: "uploadDocuments", to: "submitApplication" },
    { from: "payFee", to: "submitApplication" }
  ]
};
```

## Workflow Definition Validation

GuideGraph validates workflow definitions before creating instances or applying events.

Supported validation:

- workflow id is required
- workflow version is required
- `startStepIds` is required and must not be empty
- workflow steps are required and must not be empty
- start steps must reference known steps
- transition `from` steps must exist
- transition `to` steps must exist
- dependency step ids must exist
- duplicate step ids are rejected
- invalid step ids are rejected
- invalid `atLeast` dependency counts are rejected
- circular dependencies are rejected

Circular transition loops are allowed. Circular dependencies are rejected.

Why: transition loops represent valid business processes, such as retrying a rejected permit. Dependency cycles make a blocked step impossible to satisfy.

## Workflow Instances

A workflow instance is the runtime state of one workflow execution.

Supported instance fields include:

- instance id
- workflow id
- workflow version
- status
- revision
- active step ids
- per-step state
- history
- created timestamp
- updated timestamp

Instance statuses:

```text
active
completed
failed
```

Step statuses:

```text
not_started
blocked
active
completed
```

Creating an instance activates all configured `startStepIds`.

For example, the permit workflow starts with three active steps:

```json
{
  "status": "active",
  "activeStepIds": ["fillForm", "uploadDocuments", "payFee"]
}
```

This is how GuideGraph supports concurrent work.

## Concurrent Steps

GuideGraph supports multiple active steps at the same time.

Example:

```text
fillForm
uploadDocuments
payFee
```

All three can be active together. Completing one does not automatically complete or deactivate the others.

This is useful for real workflows where different people or systems can work in parallel.

## Dependencies

Dependencies control when a step is blocked or available.

Supported dependency rules:

```text
all
any
atLeast
```

### `all`

The step unlocks only when every dependency is completed.

```ts
{
  type: "all",
  stepIds: ["fillForm", "uploadDocuments", "payFee"]
}
```

Use this for merge gates.

### `any`

The step unlocks when at least one dependency is completed.

```ts
{
  type: "any",
  stepIds: ["managerApproval", "adminOverride"]
}
```

Use this for alternative prerequisites.

### `atLeast`

The step unlocks when a minimum number of dependencies are completed.

```ts
{
  type: "atLeast",
  count: 2,
  stepIds: ["reviewerA", "reviewerB", "reviewerC"]
}
```

Use this for quorum-style workflows.

## Merge Gates

GuideGraph supports merge gates through dependencies.

Permit example:

```text
fillForm ------------\
uploadDocuments -----+--> submitApplication
payFee --------------/
```

`submitApplication` remains blocked until all three prerequisite steps complete.

The engine also calculates blocked reasons:

```text
Waiting for uploadDocuments, payFee.
```

This is framework-owned behavior, not something the React app manually calculates.

## Branching and Divergence

GuideGraph supports branching through transition event types.

Example:

```text
cityReview
  -> REVIEW_APPROVED -> approved
  -> REVIEW_REJECTED -> fixIssues
```

Definition:

```ts
{
  from: "cityReview",
  to: "approved",
  event: "REVIEW_APPROVED",
  label: "Approve"
}

{
  from: "cityReview",
  to: "fixIssues",
  event: "REVIEW_REJECTED",
  label: "Reject"
}
```

When `cityReview` is active, `getAvailableActions()` returns the appropriate branch actions:

```text
Approve
Reject
```

## Retry Loops

GuideGraph supports retry loops as normal forward workflow transitions.

Permit rejection example:

```text
submitApplication
  -> cityReview
  -> REVIEW_REJECTED
  -> fixIssues
  -> submitApplication
  -> cityReview
```

This is supported today.

Important distinction:

- retry loops are supported
- history of retry loops is supported
- undo is not supported yet
- redo is not supported yet

A government rejecting a permit is not an undo operation. It is a forward transition into a rejection path.

## Events

Events are how workflow instances move.

Supported event shape:

```ts
interface WorkflowEvent {
  id: string;
  instanceId: string;
  type: string;
  stepId?: string;
  actorId?: string;
  occurredAt: string;
}
```

Common event:

```ts
{
  id: "event_1",
  instanceId: "instance_1",
  type: "COMPLETE_STEP",
  stepId: "fillForm",
  actorId: "user_1",
  occurredAt: new Date().toISOString()
}
```

Branch event:

```ts
{
  id: "event_5",
  instanceId: "instance_1",
  type: "REVIEW_REJECTED",
  stepId: "cityReview",
  actorId: "reviewer_1",
  occurredAt: new Date().toISOString()
}
```

## Event Application

The core engine applies events using:

```ts
applyWorkflowEvent({
  definition,
  instance,
  event
});
```

This returns:

- updated instance
- updated available actions

The server wraps this with persistence, idempotency, revision checking, and history storage.

## HTTP Transport

`@guidegraph/http` lets browser clients talk to a backend GuideGraph runtime over HTTP.

The intended architecture is:

```text
React UI
  -> createHttpWorkflowClient()
  -> createGuideGraphHttpHandler()
  -> @guidegraph/server
  -> @guidegraph/storage-memory or @guidegraph/storage-postgres
```

Create a browser client:

```ts
import { createHttpWorkflowClient } from "@guidegraph/http";

const client = createHttpWorkflowClient({
  baseUrl: "/api/guidegraph",
  getHeaders: async () => ({
    Authorization: `Bearer ${token}`
  })
});
```

Create a backend handler:

```ts
import { createGuideGraphHttpHandler } from "@guidegraph/http";
import { createWorkflowServer } from "@guidegraph/server";

const workflowServer = createWorkflowServer({ storage });

const handler = createGuideGraphHttpHandler({
  workflowServer,
  definitions: [permitWorkflow],
  basePath: "/api/guidegraph",
  getActorId: async (request) => {
    return "demo_user";
  }
});

const response = await handler.handle(request);
```

Supported routes:

```text
POST /instances
GET /instances/:instanceId
POST /instances/:instanceId/events
GET /instances/:instanceId/history
GET /instances/:instanceId/actions
POST /instances/:instanceId/reset
```

Actor identity is injected server-side through `getActorId(request)`. The host app owns real authentication and authorization.

HTTP errors use this shape:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Expected revision 1, but instance wf_123 is at revision 2.",
    "details": {
      "instanceId": "wf_123"
    }
  }
}
```

The HTTP client throws `GuideGraphHttpError` with `code`, `message`, `status`, and optional `details`.

## Available Actions

GuideGraph can calculate what the user can do next.

Use:

```ts
getAvailableActions(definition, instance);
```

The server also exposes:

```ts
server.getAvailableActions(definition, instanceId);
```

Available actions are calculated from persisted instance state.

Examples:

Before prerequisites are complete:

```text
Complete Fill Form
Complete Upload Documents
Complete Pay Fee
```

After all prerequisites complete:

```text
Complete Submit Application
```

During review:

```text
Approve
Reject
```

## History

GuideGraph supports append-only workflow history.

History entries are generated by the core engine and persisted by the server/storage layer.

History entries include:

- history entry id
- original event id
- instance id
- event type
- human-readable message
- occurrence timestamp
- actor id when available
- step id when relevant

Example:

```json
{
  "id": "instance_1:event_1",
  "eventId": "event_1",
  "instanceId": "instance_1",
  "eventType": "COMPLETE_STEP",
  "message": "Completed Fill Form.",
  "occurredAt": "2026-01-01T00:00:01.000Z",
  "actorId": "user_1",
  "stepId": "fillForm"
}
```

History is supported for:

- instance creation
- normal step completion
- merge progression
- branch decisions
- retry loops
- review approval/rejection

History is an audit trail. It is not the same thing as undo/redo.

## Revisions

Every successfully applied event increments the instance revision.

Revisions help with:

- optimistic concurrency
- debugging
- showing workflow progression
- future undo/redo support

The server can check an expected revision:

```ts
await server.sendEvent({
  definition,
  instanceId: "instance_1",
  expectedRevision: 3,
  event
});
```

If the stored instance is not at the expected revision, the server throws a stable `REVISION_CONFLICT` error.

## Idempotency

The server supports idempotency keys for safe retries.

Use idempotency when a client might retry the same request after a network issue.

```ts
await server.sendEvent({
  definition,
  instanceId: "instance_1",
  idempotencyKey: "request_123",
  expectedRevision: 1,
  event
});
```

Supported behavior:

- same instance + same idempotency key + same event returns the original cached result
- same instance + same idempotency key + different event throws `IDEMPOTENCY_CONFLICT`
- idempotency is checked before revision conflicts

That means this retry works:

```text
send event with idempotencyKey "abc" and expectedRevision 1
event succeeds, instance revision becomes 2

retry same event with idempotencyKey "abc" and expectedRevision 1
returns cached result instead of failing revision conflict
```

## Server Runtime

Create a server:

```ts
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";

const server = createWorkflowServer({
  storage: new MemoryWorkflowStorage()
});
```

Create an instance:

```ts
const { instance, availableActions } = await server.createInstance({
  definition: permitWorkflow,
  instanceId: "permit_1",
  actorId: "user_1"
});
```

Send an event:

```ts
const result = await server.sendEvent({
  definition: permitWorkflow,
  instanceId: "permit_1",
  expectedRevision: instance.revision,
  idempotencyKey: "complete_fill_form_1",
  event: {
    id: "event_1",
    instanceId: "permit_1",
    type: "COMPLETE_STEP",
    stepId: "fillForm",
    actorId: "user_1",
    occurredAt: new Date().toISOString()
  }
});
```

`sendEvent()` returns:

- updated instance
- history entry
- changed step ids
- available actions
- warnings

## Storage

The server uses a `WorkflowStorage` interface.

The storage interface is designed around conceptual transactions.

Current methods include:

- `commitInstanceCreation()`
- `getInstance()`
- `commitEvent()`
- `listEvents()`
- `listHistory()`
- `getIdempotencyRecord()`

The important method is `commitEvent()`.

It commits these together:

```text
save updated instance
append event
append history entry
cache idempotency result
```

In memory storage, this is implemented with snapshot/restore behavior.

In Postgres storage, this is implemented with a real database transaction.

`@guidegraph/storage-postgres` persists:

- workflow instances
- workflow events
- workflow history
- idempotency results

The package ships with:

- `packages/storage-postgres/schema.sql`
- `packages/storage-postgres/migrations/0001_init.sql`
- `POSTGRES_WORKFLOW_SCHEMA_SQL`
- `runGuideGraphPostgresMigrations()`
- `checkGuideGraphPostgresSchema()`
- `storage.checkSchema()`

GuideGraph does not silently create Postgres tables by default. Production apps should run migrations explicitly and start storage with `autoMigrate: false`. Local development and tests can opt into `autoMigrate: true`.

## Error Types

The server exports stable runtime error codes.

Current server error codes:

```text
INSTANCE_NOT_FOUND
IDEMPOTENCY_CONFLICT
REVISION_CONFLICT
INVALID_EVENT
STORAGE_ERROR
```

Use `WorkflowServerError` to check errors:

```ts
try {
  await server.sendEvent(input);
} catch (error) {
  if (error instanceof WorkflowServerError) {
    console.log(error.code);
  }
}
```

`@guidegraph/http` adds transport-level error codes:

```text
UNKNOWN_WORKFLOW_DEFINITION
DEFINITION_VERSION_MISMATCH
INVALID_REQUEST
METHOD_NOT_ALLOWED
NOT_FOUND
SCHEMA_NOT_INSTALLED
STORAGE_COMMIT_FAILED
INTERNAL_ERROR
```

Known HTTP status mappings include:

```text
INSTANCE_NOT_FOUND -> 404
UNKNOWN_WORKFLOW_DEFINITION -> 404
INVALID_REQUEST -> 400
INVALID_EVENT -> 400
REVISION_CONFLICT -> 409
IDEMPOTENCY_CONFLICT -> 409
DEFINITION_VERSION_MISMATCH -> 409
METHOD_NOT_ALLOWED -> 405
NOT_FOUND -> 404
STORAGE_ERROR -> 500
INTERNAL_ERROR -> 500
```

## React Usage

Wrap your UI with `WorkflowProvider`.

```tsx
import { WorkflowProvider } from "@guidegraph/react";
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";

const client = createWorkflowServer({
  storage: new MemoryWorkflowStorage()
});

<WorkflowProvider
  actorId="user_1"
  client={client}
  definition={permitWorkflow}
  instanceId="permit_1"
>
  <PermitWorkflow />
</WorkflowProvider>;
```

Use workflow state:

```tsx
import { useWorkflow } from "@guidegraph/react";

function DebugPanel() {
  const { instance, resetInstance } = useWorkflow();

  return (
    <>
      <p>Revision: {instance?.revision ?? "none"}</p>
      <button onClick={() => void resetInstance()} type="button">
        Reset Instance
      </button>
    </>
  );
}
```

`resetInstance()` intentionally creates a fresh instance for the provider's current `instanceId`. In the memory-storage demo, this replaces the old in-memory instance, clears event/idempotency records for that id, and starts again at revision `0`.

Use available actions:

```tsx
import { useWorkflowActions } from "@guidegraph/react";

function Actions() {
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
}
```

Use history:

```tsx
import { useWorkflowHistory } from "@guidegraph/react";

function History() {
  const history = useWorkflowHistory();

  return (
    <ol>
      {history.map((entry) => (
        <li key={entry.id}>{entry.message}</li>
      ))}
    </ol>
  );
}
```

## React Components

`@guidegraph/react` includes simple MVP components.

Available components:

- `WorkflowProvider`
- `CurrentStepCard`
- `NextActions`
- `BlockedSteps`
- `WorkflowTimeline`
- `DocumentChecklist`
- `WorkflowStatusList`

These are intentionally simple. They are meant to prove the API is usable from a frontend, not to be a final design system.

The React package depends on a `WorkflowClient` interface. It does not depend on the server implementation. The permit app uses a local client adapter that wraps `createWorkflowServer()` for demo purposes.

## Graph Packages

GuideGraph graph support is split into two layers.

### Graph Data

Use `@guidegraph/graph` when you want renderer-agnostic graph data:

```ts
import { buildWorkflowGraph } from "@guidegraph/graph";

const graph = buildWorkflowGraph({
  definition: permitWorkflow,
  instance,
  history
});
```

The graph model includes:

- step nodes
- dependency edges
- transition edges
- active/completed/blocked/waiting/not-started/failed/skipped statuses
- blocked reasons
- missing prerequisite ids
- terminal step markers
- visited node/edge hints
- retry loop markers

`@guidegraph/graph` does not depend on React, React Flow, or ELK.

### React Graph UI

Use `@guidegraph/react-graph` when you want the built-in graph UI:

```tsx
import { WorkflowGraph } from "@guidegraph/react-graph";

<WorkflowGraph />;
```

`<WorkflowGraph />` can read from `WorkflowProvider`, or you can pass `definition`, `instance`, `history`, and `availableActions` directly.

It currently provides:

- React Flow canvas
- ELK layered layout
- selected-node inspector
- blocked-step explanation
- dependency progress display
- available actions for the selected step
- branch/outcome panel
- history panel
- visited/loop edge styling
- status and edge legend

The graph renderer is optional. Apps that do not need it can use only `@guidegraph/react`, or they can use `@guidegraph/graph` with their own renderer.

## Builder Packages

GuideGraph builder support is split into a framework-agnostic builder layer and an optional React UI layer.

### Builder Data

Use `@guidegraph/builder` when you want to build or edit workflow definitions as drafts:

```ts
import {
  addCanvasStep,
  applyCanvasDependencyEdge,
  builderDefinitionToWorkflowDefinition,
  createBuilderDefinition
} from "@guidegraph/builder";

let draft = createBuilderDefinition({
  id: "permit-application",
  name: "Permit Application",
  version: "0.1.0"
});

draft = addCanvasStep(draft, { x: 360, y: 120 }, { name: "Review Application" });
draft = applyCanvasDependencyEdge(draft, {
  source: "start",
  target: "review_application"
}).definition;

const runtimeDefinition = builderDefinitionToWorkflowDefinition(draft);
```

`@guidegraph/builder` currently includes:

- `createBuilderDefinition()`
- `createEmptyWorkflowSkeleton()`
- `workflowDefinitionToBuilderDefinition()`
- `builderDefinitionToWorkflowDefinition()`
- `normalizeBuilderDefinition()`
- `validateBuilderDefinition()`
- `assertDraftCanPublish()`
- `createDefinitionSummary()`
- `getBuilderWarnings()`
- `createPreviewSimulation()`
- `sendPreviewSimulationAction()`
- `addStep()`
- `addCanvasStep()`
- `updateStep()`
- `setStartStep()`
- `deleteStep()`
- `getStepReferences()`
- `flattenDependencies()`
- `setDependencies()`
- `normalizeTransitions()`
- `toTransitionDrafts()`
- `definitionToCanvasModel()`
- `setCanvasNodePosition()`
- `setCanvasNodePositions()`
- `setCanvasActionLabelPosition()`
- `setCanvasActionLabelIcon()`
- `autoLayoutCanvas()`
- `autoLayoutDefinition()`
- `applyCanvasDependencyEdge()`
- `applyCanvasTransitionEdge()`
- `deleteCanvasEdge()`
- `updateCanvasEdge()`
- `canEditBuilder()`
- `getDefaultActionIcon()`

The package is intentionally renderer-agnostic. It does not depend on React Flow.

### React Builder UI

Use `@guidegraph/react-builder` when you want a ready-made builder surface:

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

`<WorkflowBuilder />` currently supports:

- canvas/form/preview tabs
- React Flow canvas
- draggable step nodes
- requirement gate nodes
- action label nodes
- dependency edge creation
- transition/action edge creation
- step inspector
- edge inspector
- action event/label/icon editing
- validation errors
- builder warnings
- preview simulation with available actions
- generated runtime JSON preview
- publish callback with both runtime and builder definitions
- read-only behavior for non-draft statuses

The builder UI is optional. Apps can use `@guidegraph/builder` and build their own UI if they need a different product experience.

Current builder limitations:

- no bundled backend persistence for definitions
- no publish approval workflow
- no role-based builder permissions
- no domain-specific form schema builder
- no drag-to-connect test automation beyond component-level behavior
- no built-in migration system for published definition versions

## Example App

Run the permit app:

```sh
pnpm dev:permit
```

Open:

```text
http://127.0.0.1:5173/
```

The app demonstrates:

1. Create permit workflow instance.
2. See `fillForm`, `uploadDocuments`, and `payFee` active in parallel.
3. Complete one step while the others remain active.
4. Complete all three intake steps.
5. See `submitApplication` unlock.
6. Submit the application.
7. Enter `cityReview`.
8. Approve and complete the approved state.
9. Reset and test rejection.
10. Reject in `cityReview`.
11. Complete `fixIssues`.
12. Return to `submitApplication`.
13. Resubmit and approve.

The app also includes a static graph use-case showcase above the live workflow area. It demonstrates:

1. Concurrent active intake steps.
2. Blocked merge with missing prerequisites and dependency progress.
3. City Review approve/reject branch outcomes.
4. Retry loop with workflow history and visited path.

The demo uses in-memory storage. Refreshing the page clears the workflow state.

Run the builder app:

```sh
pnpm dev:builder
```

The builder app demonstrates:

1. Load the permit workflow template.
2. Create a blank builder draft.
3. Add and edit workflow steps.
4. Create and edit dependency requirements.
5. Create and edit transition/action outcomes.
6. Validate the draft.
7. Preview/simulate actions through the core engine.
8. Publish a plain runtime `WorkflowDefinition`.
9. Confirm generated JSON excludes builder-only metadata.
10. Toggle published/read-only behavior.

Run the builder component workbench:

```sh
pnpm stories:builder
```

## Supported Today

GuideGraph currently supports:

- workflow definition validation
- workflow instance creation
- multiple active steps
- concurrent workflow branches
- dependency rules: `all`, `any`, `atLeast`
- merge blocking
- merge unlocking
- blocked reason calculation
- branch transitions
- retry loops
- available action calculation
- event application through the core engine
- history generation
- revision incrementing
- invalid event rejection
- server runtime wrapper
- HTTP client
- HTTP handler
- standard Web `Request`/`Response` transport
- actor id injection through HTTP handler
- memory storage
- conceptually transactional event commits
- Postgres-backed storage
- transactional Postgres event commits
- idempotency handling
- revision conflict handling
- stable server error codes
- React provider and hooks
- simple React workflow components
- optional React workflow graph
- graph model conversion utility
- graph selected-node inspector
- graph blocked-reason/outcome/history panels
- dedicated permit graph use-case showcase
- framework-agnostic workflow builder utilities
- optional React workflow builder UI
- builder draft validation
- builder preview simulation
- builder canvas metadata
- builder action label metadata
- builder publish-to-runtime conversion
- builder app example
- end-to-end permit app example

## Not Supported Yet

These features are not currently supported:

- undo
- redo
- redo stack persistence
- rewinding to an arbitrary revision
- per-step undo
- per-branch undo
- compensating actions
- full production no-code workflow studio
- bundled definition persistence service
- publish approval workflow
- builder role/permission model
- domain form schema designer
- workflow definition persistence
- workflow definition version migration
- role-based permissions
- timers and scheduled events
- async jobs
- external task queues
- webhooks
- SLA/deadline handling
- form schemas
- file upload/storage integrations
- production authentication
- production authorization

## Undo and Redo Clarification

GuideGraph does not support undo/redo yet.

Current history is append-only audit history. It answers:

```text
What happened?
Who did it?
When did it happen?
Which step did it affect?
```

Undo/redo requires more than audit history. It needs framework-level semantics for:

- storing prior instance snapshots or patches
- reversing state transitions
- managing redo stacks
- invalidating redo when new events happen
- handling concurrency and merge gates correctly
- handling branch decisions safely
- handling retry loops safely

This should eventually be a framework feature, not app-specific state mutation.

Recommended future API shape:

```ts
await server.undo({
  instanceId: "permit_1",
  expectedRevision: 6,
  actorId: "user_1"
});

await server.redo({
  instanceId: "permit_1",
  expectedRevision: 7,
  actorId: "user_1"
});
```

Recommended first version:

```text
linear instance-level undo/redo
```

Avoid starting with per-step or per-branch undo. Those are more complex and should come later.

## Retry Loop vs Undo

A retry loop is not undo.

Example:

```text
submitApplication
  -> cityReview
  -> rejected
  -> fixIssues
  -> submitApplication
```

This is supported today because the workflow is moving forward through defined transitions.

Undo would mean reversing a previously applied event, such as:

```text
undo the rejection
restore the instance before cityReview
redo the rejection
```

That is not supported yet.

## Testing Coverage

Current tests cover:

- workflow definition validation
- instance creation
- active step completion
- dependency rules
- blocked step calculation
- merge unlocking
- branching transitions
- rejection retry loop
- multiple active steps
- available action calculation
- history generation
- revision incrementing
- invalid event rejection
- server instance creation
- server instance loading
- server event sending
- persisted state changes
- history appending
- idempotency
- idempotency conflict
- stale-revision idempotent retry
- revision conflict
- unknown instance
- invalid event
- workflow definition mismatch
- old instance immutability
- available actions from persisted state
- Postgres instance creation/loading
- Postgres event log persistence
- Postgres history persistence
- Postgres idempotency caching
- Postgres transactional rollback
- Postgres persistence across a new storage adapter instance
- workflow graph conversion
- graph status mapping
- graph loops and branch edges
- graph selected-node React Flow mapping
- graph dependency/loop edge class mapping
- builder draft creation and normalization
- builder step editing
- builder dependency/action edge editing
- builder canvas metadata
- builder preview simulation through core
- builder React component rendering
- builder React step editing
- builder React publish behavior
- builder React preview behavior
- builder React read-only behavior
- HTTP create/get/send/history/actions/reset routes
- HTTP structured error handling
- HTTP idempotency and revision behavior

Run all tests:

```sh
pnpm test
```

Run core tests:

```sh
pnpm test:core
```

Run server/storage tests:

```sh
pnpm test:server
```

Run Postgres storage tests:

```sh
pnpm test:postgres
```

Run HTTP tests:

```sh
pnpm test:http
```

Run graph tests:

```sh
pnpm test:graph
pnpm test:builder
```

## Build and Verification

Useful commands:

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm build:examples
pnpm dev:permit
```

The expected healthy state is:

```text
pnpm test passes
pnpm typecheck passes
pnpm build passes
pnpm build:examples passes
permit app runs locally
approval path works
rejection/retry path works
```

## Design Principles

GuideGraph is currently guided by these rules:

1. Core owns workflow semantics.
2. Server owns runtime orchestration.
3. Storage owns persistence.
4. React owns rendering and user interaction.
5. HTTP owns transport, not workflow behavior.
6. Graph packages own visualization, not workflow behavior.
7. Apps should send events, not mutate workflow state directly.
8. History should be framework-owned.
9. Retry loops are normal workflow transitions.
10. Undo/redo should be framework-owned when implemented.
11. Memory storage is for local development and tests.
12. Postgres storage provides durable transactional persistence.
