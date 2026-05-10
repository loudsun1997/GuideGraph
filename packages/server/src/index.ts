import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions,
  type AvailableWorkflowAction,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowHistoryEntry,
  type WorkflowInstance,
  type WorkflowStepState
} from "@flowforge/core";

export type WorkflowServerErrorCode =
  | "INSTANCE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT"
  | "INVALID_EVENT"
  | "STORAGE_ERROR";

export class WorkflowServerError extends Error {
  readonly code: WorkflowServerErrorCode;

  constructor(code: WorkflowServerErrorCode, message: string) {
    super(message);
    this.name = "WorkflowServerError";
    this.code = code;
  }
}

export interface StoredWorkflowEvent {
  readonly event: WorkflowEvent;
  readonly idempotencyKey?: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
}

export interface StoredIdempotencyRecord {
  readonly event: WorkflowEvent;
  readonly result: SendWorkflowEventResult;
}

export interface CommitWorkflowInstanceCreationInput {
  readonly instance: WorkflowInstance;
  readonly historyEntries: readonly WorkflowHistoryEntry[];
}

export interface CommitWorkflowEventInput {
  readonly instance: WorkflowInstance;
  readonly event: StoredWorkflowEvent;
  readonly historyEntry: WorkflowHistoryEntry;
  readonly idempotencyKey?: string;
  readonly idempotencyRecord?: StoredIdempotencyRecord;
}

export interface CreateWorkflowInstanceInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly now?: string;
}

export interface CreateWorkflowInstanceResult {
  readonly instance: WorkflowInstance;
  readonly availableActions: readonly AvailableWorkflowAction[];
}

export interface SendWorkflowEventInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly event: WorkflowEvent;
  readonly expectedRevision?: number;
  readonly idempotencyKey?: string;
}

export interface SendWorkflowEventResult {
  readonly instance: WorkflowInstance;
  readonly historyEntry: WorkflowHistoryEntry;
  readonly changedStepIds: readonly string[];
  readonly availableActions: readonly AvailableWorkflowAction[];
  readonly warnings: readonly string[];
}

export interface WorkflowStorage {
  commitInstanceCreation(input: CommitWorkflowInstanceCreationInput): Promise<void>;
  getInstance(instanceId: string): Promise<WorkflowInstance | undefined>;
  commitEvent(input: CommitWorkflowEventInput): Promise<void>;
  listEvents(instanceId: string): Promise<StoredWorkflowEvent[]>;
  listHistory(instanceId: string): Promise<WorkflowHistoryEntry[]>;
  getIdempotencyRecord(
    instanceId: string,
    idempotencyKey: string
  ): Promise<StoredIdempotencyRecord | undefined>;
}

export interface WorkflowServer {
  createInstance(input: CreateWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult>;
  getInstance(instanceId: string): Promise<WorkflowInstance>;
  sendEvent(input: SendWorkflowEventInput): Promise<SendWorkflowEventResult>;
  getHistory(instanceId: string): Promise<WorkflowHistoryEntry[]>;
  getAvailableActions(
    definition: WorkflowDefinition,
    instanceId: string
  ): Promise<AvailableWorkflowAction[]>;
}

export interface WorkflowServerOptions {
  readonly storage: WorkflowStorage;
}

export function createWorkflowServer(options: WorkflowServerOptions): WorkflowServer {
  return new DefaultWorkflowServer(options.storage);
}

class DefaultWorkflowServer implements WorkflowServer {
  readonly #storage: WorkflowStorage;

  constructor(storage: WorkflowStorage) {
    this.#storage = storage;
  }

  async createInstance(input: CreateWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult> {
    const instance = createWorkflowInstance({
      definition: input.definition,
      instanceId: input.instanceId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.now ? { now: input.now } : {})
    });

    await this.#storage.commitInstanceCreation({
      instance,
      historyEntries: instance.history
    });

    return {
      instance,
      availableActions: getAvailableActions(input.definition, instance)
    };
  }

  async getInstance(instanceId: string): Promise<WorkflowInstance> {
    const instance = await this.#storage.getInstance(instanceId);

    if (!instance) {
      throw new WorkflowServerError("INSTANCE_NOT_FOUND", `Unknown workflow instance: ${instanceId}`);
    }

    return instance;
  }

  async sendEvent(input: SendWorkflowEventInput): Promise<SendWorkflowEventResult> {
    const instance = await this.getInstance(input.instanceId);

    if (input.idempotencyKey) {
      const existingRecord = await this.#storage.getIdempotencyRecord(instance.id, input.idempotencyKey);

      if (existingRecord) {
        if (!areEventsEqual(existingRecord.event, input.event)) {
          throw new WorkflowServerError(
            "IDEMPOTENCY_CONFLICT",
            `Idempotency key ${input.idempotencyKey} was already used with a different event payload.`
          );
        }

        return existingRecord.result;
      }
    }

    if (input.expectedRevision !== undefined && input.expectedRevision !== instance.revision) {
      throw new WorkflowServerError(
        "REVISION_CONFLICT",
        `Expected revision ${input.expectedRevision}, but instance ${instance.id} is at revision ${instance.revision}.`
      );
    }

    try {
      const result = applyWorkflowEvent({
        definition: input.definition,
        instance,
        event: input.event
      });
      const historyEntry = getLatestHistoryEntry(result.instance);
      const sendResult: SendWorkflowEventResult = {
        instance: result.instance,
        historyEntry,
        changedStepIds: getChangedStepIds(instance, result.instance),
        availableActions: result.availableActions,
        warnings: []
      };

      await this.#storage.commitEvent({
        instance: result.instance,
        event: {
          event: input.event,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
          revisionBefore: instance.revision,
          revisionAfter: result.instance.revision
        },
        historyEntry,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.idempotencyKey
          ? {
              idempotencyRecord: {
                event: input.event,
                result: sendResult
              }
            }
          : {})
      });

      return sendResult;
    } catch (error) {
      if (error instanceof WorkflowServerError) {
        throw error;
      }

      throw new WorkflowServerError(
        "INVALID_EVENT",
        error instanceof Error ? error.message : "Invalid workflow event."
      );
    }
  }

  async getHistory(instanceId: string): Promise<WorkflowHistoryEntry[]> {
    await this.getInstance(instanceId);
    return this.#storage.listHistory(instanceId);
  }

  async getAvailableActions(
    definition: WorkflowDefinition,
    instanceId: string
  ): Promise<AvailableWorkflowAction[]> {
    const instance = await this.getInstance(instanceId);
    return getAvailableActions(definition, instance);
  }
}

function areEventsEqual(left: WorkflowEvent, right: WorkflowEvent): boolean {
  return JSON.stringify(sortObject(left)) === JSON.stringify(sortObject(right));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, sortObject(entryValue)])
    );
  }

  return value;
}

function getLatestHistoryEntry(instance: WorkflowInstance): WorkflowHistoryEntry {
  const historyEntry = instance.history.at(-1);

  if (!historyEntry) {
    throw new WorkflowServerError("STORAGE_ERROR", "Workflow event did not produce a history entry.");
  }

  return historyEntry;
}

function getChangedStepIds(previous: WorkflowInstance, next: WorkflowInstance): string[] {
  const stepIds = new Set([...Object.keys(previous.stepStates), ...Object.keys(next.stepStates)]);

  return [...stepIds].filter((stepId) => {
    const previousState = previous.stepStates[stepId];
    const nextState = next.stepStates[stepId];

    return !areStepStatesEqual(previousState, nextState);
  });
}

function areStepStatesEqual(
  previous: WorkflowStepState | undefined,
  next: WorkflowStepState | undefined
): boolean {
  return (
    previous?.status === next?.status &&
    previous?.completedAt === next?.completedAt &&
    previous?.blockedReason === next?.blockedReason &&
    JSON.stringify(previous?.missingStepIds ?? []) === JSON.stringify(next?.missingStepIds ?? [])
  );
}
