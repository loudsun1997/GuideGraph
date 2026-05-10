# FlowForge

FlowForge is a developer toolkit for building, running, storing, and inspecting workflows.

This repository is organized as a small npm workspace:

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
npm install
npm run build
```

For a detailed list of supported features, unsupported features, package responsibilities, and usage examples, read [FlowForge Capabilities Guide](docs/CAPABILITIES.md).

## Packages

- `@flowforge/core`: workflow definitions, execution primitives, and storage contracts.
- `@flowforge/react`: React hooks for running workflows from UI code.
- `@flowforge/server`: a tiny HTTP adapter for exposing workflow health and metadata.
- `@flowforge/storage-memory`: in-memory workflow storage for tests and local development.
- `@flowforge/storage-postgres`: Postgres-backed workflow storage adapter.
- `@flowforge/devtools`: event collection helpers for workflow debugging tools.

## Example App

Run the permit workflow example:

```sh
npm run dev:permit
```

Then open:

```text
http://127.0.0.1:5173/
```

The example demonstrates concurrent steps, merge blocking, branch decisions, retry loops, history, revisions, server runtime usage, memory storage, and React bindings.

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
