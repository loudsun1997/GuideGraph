import { createWorkflowServer } from "@flowforge/server";
import { MemoryWorkflowStorage } from "@flowforge/storage-memory";
import type { WorkflowClient } from "@flowforge/react";

export function createLocalWorkflowClient(): WorkflowClient {
  return createWorkflowServer({
    storage: new MemoryWorkflowStorage()
  });
}
