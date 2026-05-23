import type { WorkflowHistoryEntry, WorkflowInstance, WorkflowStepState } from "@guidegraph/core";
import type {
  CommitWorkflowEventInput,
  CommitWorkflowInstanceCreationInput,
  SendWorkflowEventResult,
  StoredIdempotencyRecord,
  StoredWorkflowEvent,
  WorkflowSideEffect,
  WorkflowStorage
} from "@guidegraph/server";

export class MemoryWorkflowStorage implements WorkflowStorage {
  readonly #instances = new Map<string, WorkflowInstance>();
  readonly #events = new Map<string, StoredWorkflowEvent[]>();
  readonly #history = new Map<string, WorkflowHistoryEntry[]>();
  readonly #sideEffects = new Map<string, WorkflowSideEffect[]>();
  readonly #idempotencyRecords = new Map<string, StoredIdempotencyRecord>();

  async commitInstanceCreation(input: CommitWorkflowInstanceCreationInput): Promise<void> {
    const snapshot = this.#snapshot();

    try {
      this.#instances.set(input.instance.id, cloneInstance(input.instance));
      this.#history.set(input.instance.id, input.historyEntries.map(cloneHistoryEntry));
      this.#events.set(input.instance.id, []);
      this.#sideEffects.set(input.instance.id, []);
      this.#deleteIdempotencyRecordsForInstance(input.instance.id);
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

      if (input.sideEffects?.length) {
        this.#sideEffects.set(instanceId, [
          ...(this.#sideEffects.get(instanceId) ?? []),
          ...input.sideEffects.map(cloneSideEffect)
        ]);
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

  async listSideEffects(instanceId: string): Promise<WorkflowSideEffect[]> {
    return (this.#sideEffects.get(instanceId) ?? []).map(cloneSideEffect);
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
      sideEffects: new Map([...this.#sideEffects].map(([key, effects]) => [key, effects.map(cloneSideEffect)])),
      idempotencyRecords: new Map(
        [...this.#idempotencyRecords].map(([key, record]) => [key, cloneIdempotencyRecord(record)])
      )
    };
  }

  #restore(snapshot: MemoryWorkflowStorageSnapshot): void {
    this.#instances.clear();
    this.#events.clear();
    this.#history.clear();
    this.#sideEffects.clear();
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

    for (const [key, effects] of snapshot.sideEffects) {
      this.#sideEffects.set(key, effects);
    }

    for (const [key, record] of snapshot.idempotencyRecords) {
      this.#idempotencyRecords.set(key, record);
    }
  }

  #deleteIdempotencyRecordsForInstance(instanceId: string): void {
    const prefix = `${instanceId}:`;

    for (const key of this.#idempotencyRecords.keys()) {
      if (key.startsWith(prefix)) {
        this.#idempotencyRecords.delete(key);
      }
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
    history: instance.history.map(cloneHistoryEntry),
    context: cloneRecord(instance.context),
    artifactIds: [...instance.artifactIds],
    metadata: cloneRecord(instance.metadata)
  };
}

function cloneStoredEvent(event: StoredWorkflowEvent): StoredWorkflowEvent {
  return {
    ...event,
    event: cloneRecord(event.event) as StoredWorkflowEvent["event"],
    ...(event.sideEffects ? { sideEffects: event.sideEffects.map(cloneSideEffect) } : {})
  };
}

function cloneHistoryEntry(entry: WorkflowHistoryEntry): WorkflowHistoryEntry {
  return cloneRecord(entry) as WorkflowHistoryEntry;
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
    event: cloneRecord(record.event) as StoredIdempotencyRecord["event"],
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
    sideEffects: result.sideEffects.map(cloneSideEffect),
    warnings: [...result.warnings]
  };
}

function cloneSideEffect(effect: WorkflowSideEffect): WorkflowSideEffect {
  return cloneRecord(effect) as WorkflowSideEffect;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface MemoryWorkflowStorageSnapshot {
  readonly instances: Map<string, WorkflowInstance>;
  readonly events: Map<string, StoredWorkflowEvent[]>;
  readonly history: Map<string, WorkflowHistoryEntry[]>;
  readonly sideEffects: Map<string, WorkflowSideEffect[]>;
  readonly idempotencyRecords: Map<string, StoredIdempotencyRecord>;
}
