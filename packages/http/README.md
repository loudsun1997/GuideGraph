# @guidegraph/http

HTTP transport for GuideGraph.

Use this package when a browser or frontend app needs to talk to a backend GuideGraph runtime over HTTP:

```text
React UI
  -> createHttpWorkflowClient()
  -> createGuideGraphHttpHandler()
  -> @guidegraph/server
  -> @guidegraph/storage-memory or @guidegraph/storage-postgres
```

`@guidegraph/http` does not depend on React, and `@guidegraph/react` does not depend on HTTP. The React package remains transport-agnostic.

## HTTP Client

```ts
import { createHttpWorkflowClient } from "@guidegraph/http";

const client = createHttpWorkflowClient({
  baseUrl: "/api/guidegraph",
  getHeaders: async () => ({
    Authorization: `Bearer ${token}`,
  }),
});
```

The returned client structurally satisfies the `WorkflowClient` interface used by `@guidegraph/react`:

- `createInstance()`
- `getInstance()`
- `sendEvent()`
- `getHistory()`
- `getAvailableActions()`
- optional `resetInstance()`

The client sends only `workflowId` and `workflowVersion` over HTTP. The server-side handler resolves those ids against trusted backend workflow definitions.

## HTTP Handler

```ts
import { createGuideGraphHttpHandler } from "@guidegraph/http";
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";

const workflowServer = createWorkflowServer({
  storage: new MemoryWorkflowStorage(),
});

const handler = createGuideGraphHttpHandler({
  workflowServer,
  definitions: [permitWorkflow],
  basePath: "/api/guidegraph",
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

The HTTP client throws `GuideGraphHttpError` with:

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
STORAGE_ERROR -> 500
INTERNAL_ERROR -> 500
```

Unknown server errors return a safe `INTERNAL_ERROR` message without stack traces.
