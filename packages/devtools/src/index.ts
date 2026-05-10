import type { WorkflowId } from "@flowforge/core";

export type FlowForgeDevtoolEventType =
  | "workflow:started"
  | "workflow:completed"
  | "workflow:failed"
  | "step:started"
  | "step:completed"
  | "step:failed";

export interface FlowForgeDevtoolEvent {
  readonly type: FlowForgeDevtoolEventType;
  readonly workflowId: WorkflowId;
  readonly stepId?: string;
  readonly timestamp: number;
  readonly data?: unknown;
}

export class FlowForgeEventRecorder {
  readonly #events: FlowForgeDevtoolEvent[] = [];

  record(event: Omit<FlowForgeDevtoolEvent, "timestamp">): FlowForgeDevtoolEvent {
    const nextEvent = {
      ...event,
      timestamp: Date.now()
    };

    this.#events.push(nextEvent);
    return nextEvent;
  }

  list(): FlowForgeDevtoolEvent[] {
    return [...this.#events];
  }

  clear(): void {
    this.#events.length = 0;
  }
}
