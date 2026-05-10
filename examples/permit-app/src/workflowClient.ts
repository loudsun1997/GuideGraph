import { createFlowForgeHttpHandler, createHttpWorkflowClient } from "@flowforge/http";
import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";
import type { WorkflowClient } from "@flowforge/react";
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
  const handler = createFlowForgeHttpHandler({
    workflowServer,
    definitions: [permitWorkflow],
    basePath: "/api/flowforge",
    getActorId() {
      return "demo_http_user";
    }
  });

  return createHttpWorkflowClient({
    baseUrl: "http://flowforge.local/api/flowforge",
    fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return handler(request);
    }
  });
}
