import type { WorkflowId } from "@guidegraph/core";

export type GuideGraphDevtoolEventType =
  | "workflow:started"
  | "workflow:completed"
  | "workflow:failed"
  | "step:started"
  | "step:completed"
  | "step:failed";

export interface GuideGraphDevtoolEvent {
  readonly type: GuideGraphDevtoolEventType;
  readonly workflowId: WorkflowId;
  readonly stepId?: string;
  readonly timestamp: number;
  readonly data?: unknown;
}

export class GuideGraphEventRecorder {
  readonly #events: GuideGraphDevtoolEvent[] = [];

  record(event: Omit<GuideGraphDevtoolEvent, "timestamp">): GuideGraphDevtoolEvent {
    const nextEvent = {
      ...event,
      timestamp: Date.now()
    };

    this.#events.push(nextEvent);
    return nextEvent;
  }

  list(): GuideGraphDevtoolEvent[] {
    return [...this.#events];
  }

  clear(): void {
    this.#events.length = 0;
  }
}
