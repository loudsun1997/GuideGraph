import type { WorkflowHistoryEntry, WorkflowInstance, WorkflowStepState } from "@flowforge/core";
import type {
  CommitWorkflowEventInput,
  CommitWorkflowInstanceCreationInput,
  SendWorkflowEventResult,
  StoredIdempotencyRecord,
  StoredWorkflowEvent,
  WorkflowStorage
} from "@flowforge/server";

export class MemoryWorkflowStorage implements WorkflowStorage {
  readonly #instances = new Map<string, WorkflowInstance>();
  readonly #events = new Map<string, StoredWorkflowEvent[]>();
  readonly #history = new Map<string, WorkflowHistoryEntry[]>();
  readonly #idempotencyRecords = new Map<string, StoredIdempotencyRecord>();

  async commitInstanceCreation(input: CommitWorkflowInstanceCreationInput): Promise<void> {
    const snapshot = this.#snapshot();

    try {
      this.#instances.set(input.instance.id, cloneInstance(input.instance));
      this.#history.set(input.instance.id, input.historyEntries.map(cloneHistoryEntry));
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
  }

  async getInstance(instanceId: string): Promise<WorkflowInstance | undefined> {
    const instance = this.#instances.get(instanceId);
    return instance ? cloneInstance(instance) : undefined;
  }

  async commitEvent(input: CommitWorkflowEventInput): Promise<void> {
    const snapshot = this.#snapshot();
    const instanceId = input.instance.id;

    try {
      this.#instances.set(instanceId, cloneInstance(input.instance));
      this.#events.set(instanceId, [
        ...(this.#events.get(instanceId) ?? []),
        cloneStoredEvent(input.event)
      ]);
      this.#history.set(instanceId, [
        ...(this.#history.get(instanceId) ?? []),
        cloneHistoryEntry(input.historyEntry)
      ]);

      if (input.idempotencyKey && input.idempotencyRecord) {
        this.#idempotencyRecords.set(
          getIdempotencyKey(instanceId, input.idempotencyKey),
          cloneIdempotencyRecord(input.idempotencyRecord)
        );
      }
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
  }

  async listEvents(instanceId: string): Promise<StoredWorkflowEvent[]> {
    return (this.#events.get(instanceId) ?? []).map(cloneStoredEvent);
  }

  async listHistory(instanceId: string): Promise<WorkflowHistoryEntry[]> {
    return (this.#history.get(instanceId) ?? []).map(cloneHistoryEntry);
  }

  async getIdempotencyRecord(
    instanceId: string,
    idempotencyKey: string
  ): Promise<StoredIdempotencyRecord | undefined> {
    const record = this.#idempotencyRecords.get(getIdempotencyKey(instanceId, idempotencyKey));
    return record ? cloneIdempotencyRecord(record) : undefined;
  }

  #snapshot(): MemoryWorkflowStorageSnapshot {
    return {
      instances: new Map([...this.#instances].map(([key, instance]) => [key, cloneInstance(instance)])),
      events: new Map([...this.#events].map(([key, events]) => [key, events.map(cloneStoredEvent)])),
      history: new Map([...this.#history].map(([key, history]) => [key, history.map(cloneHistoryEntry)])),
      idempotencyRecords: new Map(
        [...this.#idempotencyRecords].map(([key, record]) => [key, cloneIdempotencyRecord(record)])
      )
    };
  }

  #restore(snapshot: MemoryWorkflowStorageSnapshot): void {
    this.#instances.clear();
    this.#events.clear();
    this.#history.clear();
    this.#idempotencyRecords.clear();

    for (const [key, instance] of snapshot.instances) {
      this.#instances.set(key, instance);
    }

    for (const [key, events] of snapshot.events) {
      this.#events.set(key, events);
    }

    for (const [key, history] of snapshot.history) {
      this.#history.set(key, history);
    }

    for (const [key, record] of snapshot.idempotencyRecords) {
      this.#idempotencyRecords.set(key, record);
    }
  }
}

export function createMemoryWorkflowStorage(): WorkflowStorage {
  return new MemoryWorkflowStorage();
}

function getIdempotencyKey(instanceId: string, idempotencyKey: string): string {
  return `${instanceId}:${idempotencyKey}`;
}

function cloneInstance(instance: WorkflowInstance): WorkflowInstance {
  return {
    ...instance,
    activeStepIds: [...instance.activeStepIds],
    stepStates: cloneStepStates(instance.stepStates),
    history: instance.history.map(cloneHistoryEntry)
  };
}

function cloneStoredEvent(event: StoredWorkflowEvent): StoredWorkflowEvent {
  return {
    ...event,
    event: { ...event.event }
  };
}

function cloneHistoryEntry(entry: WorkflowHistoryEntry): WorkflowHistoryEntry {
  return { ...entry };
}

function cloneStepStates(
  stepStates: Readonly<Record<string, WorkflowStepState>>
): Record<string, WorkflowStepState> {
  return Object.fromEntries(
    Object.entries(stepStates).map(([stepId, state]) => [
      stepId,
      {
        ...state,
        ...(state.missingStepIds ? { missingStepIds: [...state.missingStepIds] } : {})
      }
    ])
  );
}

function cloneIdempotencyRecord(record: StoredIdempotencyRecord): StoredIdempotencyRecord {
  return {
    event: { ...record.event },
    result: cloneSendResult(record.result)
  };
}

function cloneSendResult(result: SendWorkflowEventResult): SendWorkflowEventResult {
  return {
    ...result,
    instance: cloneInstance(result.instance),
    historyEntry: { ...result.historyEntry },
    changedStepIds: [...result.changedStepIds],
    availableActions: [...result.availableActions],
    warnings: [...result.warnings]
  };
}

interface MemoryWorkflowStorageSnapshot {
  readonly instances: Map<string, WorkflowInstance>;
  readonly events: Map<string, StoredWorkflowEvent[]>;
  readonly history: Map<string, WorkflowHistoryEntry[]>;
  readonly idempotencyRecords: Map<string, StoredIdempotencyRecord>;
}
