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

## Packages

- `@flowforge/core`: workflow definitions, execution primitives, and storage contracts.
- `@flowforge/react`: React hooks for running workflows from UI code.
- `@flowforge/server`: a tiny HTTP adapter for exposing workflow health and metadata.
- `@flowforge/storage-memory`: in-memory workflow storage for tests and local development.
- `@flowforge/storage-postgres`: Postgres-backed workflow storage adapter.
- `@flowforge/devtools`: event collection helpers for workflow debugging tools.

## Example

```ts
import { createWorkflow, runWorkflow } from "@flowforge/core";

const workflow = createWorkflow({
  id: "publish-post",
  name: "Publish post",
  steps: [
    {
      id: "draft",
      run: async () => ({ title: "Hello FlowForge" })
    },
    {
      id: "publish",
      run: async (context) => ({
        ...context.results.draft,
        published: true
      })
    }
  ]
});

const result = await runWorkflow(workflow);
console.log(result.status);
```
