import { createGuideGraphHttpHandler, createHttpWorkflowClient } from "@guidegraph/http";
import { createWorkflowServer } from "@guidegraph/server";
import { MemoryWorkflowStorage } from "@guidegraph/storage-memory";
import type { WorkflowClient } from "@guidegraph/react";
import { permitWorkflow } from "./permitWorkflow.js";

export function createLocalWorkflowClient(): WorkflowClient {
  return createWorkflowServer({
    storage: new MemoryWorkflowStorage()
  });
}

export function createHttpDemoWorkflowClient(): WorkflowClient {
  const workflowServer = createWorkflowServer({
    storage: new MemoryWorkflowStorage()
  });
  const handler = createGuideGraphHttpHandler({
    workflowServer,
    definitions: [permitWorkflow],
    basePath: "/api/guidegraph",
    getActorId() {
      return "demo_http_user";
    }
  });

  return createHttpWorkflowClient({
    baseUrl: "http://guidegraph.local/api/guidegraph",
    fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return handler(request);
    }
  });
}
