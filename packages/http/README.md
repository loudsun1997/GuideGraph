# @flowforge/http

HTTP transport for FlowForge.

Use this package when a browser or frontend app needs to talk to a backend FlowForge runtime over HTTP:

```text
React UI
  -> createHttpWorkflowClient()
  -> createFlowForgeHttpHandler()
  -> @flowforge/server
  -> @flowforge/storage-memory or @flowforge/storage-postgres
```

`@flowforge/http` does not depend on React, and `@flowforge/react` does not depend on HTTP. The React package remains transport-agnostic.

## HTTP Client

```ts
import { createHttpWorkflowClient } from "@flowforge/http";

const client = createHttpWorkflowClient({
  baseUrl: "/api/flowforge",
  getHeaders: async () => ({
    Authorization: `Bearer ${token}`,
  }),
});
```

The returned client structurally satisfies the `WorkflowClient` interface used by `@flowforge/react`:

- `createInstance()`
- `getInstance()`
- `sendEvent()`
- `getHistory()`
- `getAvailableActions()`
- optional `resetInstance()`

The client sends only `workflowId` and `workflowVersion` over HTTP. The server-side handler resolves those ids against trusted backend workflow definitions.

## HTTP Handler

```ts
import { createFlowForgeHttpHandler } from "@flowforge/http";
import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";

const workflowServer = createWorkflowServer({
  storage: new MemoryWorkflowStorage(),
});

const handler = createFlowForgeHttpHandler({
  workflowServer,
  definitions: [permitWorkflow],
  basePath: "/api/flowforge",
  getActorId: async (request) => {
    return "demo_user";
  },
});

const response = await handler.handle(request);
```

The handler uses standard Web `Request` and `Response` objects so host apps can adapt it to Next.js, Remix, Express, Hono, Workers, or other runtimes.

## Routes

The handler supports:

```text
POST /instances
GET /instances/:instanceId
POST /instances/:instanceId/events
GET /instances/:instanceId/history
GET /instances/:instanceId/actions
POST /instances/:instanceId/reset
```

If `basePath` is set, the handler strips it before matching routes. If the host app mounts the handler at a prefix itself, omit `basePath`.

## Actor Identity

Actor identity is injected on the server through `getActorId(request)`.

The HTTP client does not need to send a trusted `actorId`. Host apps should authenticate the request however they normally do, then return the actor id from `getActorId`.

Full authentication and authorization are host-app responsibilities.

## Error Shape

Errors return JSON:

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

The HTTP client throws `FlowForgeHttpError` with:

- `code`
- `message`
- `status`
- `details`

Known status mappings include:

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
INTERNAL_ERROR -> 500
```

Unknown server errors return a safe `INTERNAL_ERROR` message without stack traces.
