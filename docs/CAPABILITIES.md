# FlowForge Capabilities Guide

This guide documents what FlowForge supports today, how the pieces fit together, and which features are intentionally not supported yet.

FlowForge is currently a developer toolkit for building workflow-driven products. It is not a no-code workflow editor yet. The supported path is:

```text
workflow definition
  -> create workflow instance
  -> send workflow events
  -> core engine calculates next state
  -> server persists instance, events, history, idempotency records
  -> React renders persisted state and sends actions back through the server
```

The most important rule is that applications should not mutate workflow state directly. Apps should send events through the server/runtime and render the returned instance.

## Package Map

```text
@flowforge/core
@flowforge/server
@flowforge/storage-memory
@flowforge/react
@flowforge/storage-postgres
@flowforge/devtools
examples/permit-app
```

### `@flowforge/core`

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

The core package is pure TypeScript. It does not import React, storage, HTTP, or database code.

### `@flowforge/server`

Owns runtime orchestration around the core engine.

Use this package when you need to:

- create a workflow server/runtime
- create workflow instances
- load instances
- send events
- check expected revisions
- enforce idempotency
- persist event results through a storage interface
- retrieve history
- retrieve available actions from persisted state

The server package does not reimplement workflow logic. It calls `applyWorkflowEvent()` from `@flowforge/core`.

### `@flowforge/storage-memory`

Provides an in-memory implementation of the server storage interface.

Use this package for:

- local development
- examples
- integration tests
- demos
- fast prototyping

It is not meant for production persistence.

### `@flowforge/react`

Provides React bindings and simple workflow UI components.

Use this package when you want to:

- create workflow-driven React UIs
- use a `WorkflowProvider`
- read workflow state with hooks
- render current active steps
- render available actions
- render blocked steps
- render workflow history
- render a simple status list

React is optional. Core and server do not depend on React.

### `@flowforge/storage-postgres`

Placeholder package for a future Postgres storage adapter.

The package exists, but full Postgres persistence is not implemented yet.

### `@flowforge/devtools`

Provides early event recording helpers for workflow debugging tools.

This is not a full visual devtools panel yet.

### `examples/permit-app`

A Vite React example that demonstrates the current FlowForge runtime end to end.

The permit app demonstrates:

- creating an instance
- concurrent start steps
- merge blocking
- merge unlocking
- review branching
- rejection retry loop
- history
- revisions
- React rendering through `@flowforge/react`
- server/runtime calls through `@flowforge/server`
- memory persistence through `@flowforge/storage-memory`

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

FlowForge validates workflow definitions before creating instances or applying events.

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

This is how FlowForge supports concurrent work.

## Concurrent Steps

FlowForge supports multiple active steps at the same time.

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

FlowForge supports merge gates through dependencies.

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

FlowForge supports branching through transition event types.

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

FlowForge supports retry loops as normal forward workflow transitions.

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

## Available Actions

FlowForge can calculate what the user can do next.

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

FlowForge supports append-only workflow history.

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
import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";

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

In future Postgres storage, this should be implemented with a real database transaction.

## Error Types

The server exports stable error codes.

Current error codes:

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

## React Usage

Wrap your UI with `WorkflowProvider`.

```tsx
import { WorkflowProvider } from "@flowforge/react";
import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";

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
import { useWorkflow } from "@flowforge/react";

function DebugPanel() {
  const { instance } = useWorkflow();

  return <p>Revision: {instance?.revision ?? "none"}</p>;
}
```

Use available actions:

```tsx
import { useWorkflowActions } from "@flowforge/react";

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
import { useWorkflowHistory } from "@flowforge/react";

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

`@flowforge/react` includes simple MVP components.

Available components:

- `WorkflowProvider`
- `CurrentStepCard`
- `NextActions`
- `BlockedSteps`
- `WorkflowTimeline`
- `DocumentChecklist`
- `WorkflowStatusList`

These are intentionally simple. They are meant to prove the API is usable from a frontend, not to be a final design system.

## Example App

Run the permit app:

```sh
npm run dev:permit
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

## Supported Today

FlowForge currently supports:

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
- memory storage
- conceptually transactional event commits
- idempotency handling
- revision conflict handling
- stable server error codes
- React provider and hooks
- simple React workflow components
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
- Postgres-backed storage
- no-code workflow editor
- visual graph editor
- drag-and-drop workflow builder
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

FlowForge does not support undo/redo yet.

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

Run all tests:

```sh
npm test
```

Run core tests:

```sh
npm run test:core
```

Run server/storage tests:

```sh
npm run test:server
```

## Build and Verification

Useful commands:

```sh
npm install
npm test
npm run typecheck
npm run build
npm run build:examples
npm run dev:permit
```

The expected healthy state is:

```text
npm test passes
npm run typecheck passes
npm run build passes
npm run build:examples passes
permit app runs locally
approval path works
rejection/retry path works
```

## Design Principles

FlowForge is currently guided by these rules:

1. Core owns workflow semantics.
2. Server owns runtime orchestration.
3. Storage owns persistence.
4. React owns rendering and user interaction.
5. Apps should send events, not mutate workflow state directly.
6. History should be framework-owned.
7. Retry loops are normal workflow transitions.
8. Undo/redo should be framework-owned when implemented.
9. Memory storage is for local development and tests.
10. Postgres storage should eventually provide real transactional persistence.
