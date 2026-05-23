import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions,
  type AvailableWorkflowAction,
  type WorkflowDefinition,
  type WorkflowEffectDefinition,
  type WorkflowEvent,
  type WorkflowHistoryEntry,
  type WorkflowInstance,
  type WorkflowStepDefinition,
  type WorkflowStepState
} from "@guidegraph/core";

export type WorkflowServerErrorCode =
  | "INSTANCE_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT"
  | "GUARD_REJECTED"
  | "INVALID_EVENT"
  | "HOOK_FAILED"
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
  readonly sideEffects?: readonly WorkflowSideEffect[];
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
  readonly sideEffects?: readonly WorkflowSideEffect[];
  readonly idempotencyKey?: string;
  readonly idempotencyRecord?: StoredIdempotencyRecord;
}

export interface CreateWorkflowInstanceInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly now?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly artifactIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
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
  readonly sideEffects: readonly WorkflowSideEffect[];
  readonly warnings: readonly string[];
}

export interface WorkflowSideEffect {
  readonly id: string;
  readonly instanceId: string;
  readonly eventId: string;
  readonly type: string;
  readonly status: "pending";
  readonly trigger: string;
  readonly stepId?: string;
  readonly target?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface WorkflowGuardContext {
  readonly definition: WorkflowDefinition;
  readonly instance: WorkflowInstance;
  readonly event: WorkflowEvent;
  readonly step: WorkflowStepDefinition | undefined;
}

export interface WorkflowLifecycleContext {
  readonly definition: WorkflowDefinition;
  readonly previousInstance?: WorkflowInstance;
  readonly instance: WorkflowInstance;
  readonly event?: WorkflowEvent;
  readonly step?: WorkflowStepDefinition;
  readonly historyEntry?: WorkflowHistoryEntry;
  readonly result?: SendWorkflowEventResult;
}

export interface WorkflowGuardDecision {
  readonly allowed: boolean;
  readonly message?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type WorkflowEventGuard = (
  context: WorkflowGuardContext
) => boolean | string | WorkflowGuardDecision | void | Promise<boolean | string | WorkflowGuardDecision | void>;

export type WorkflowLifecycleHook = (
  context: WorkflowLifecycleContext
) => void | readonly WorkflowEffectDefinition[] | Promise<void | readonly WorkflowEffectDefinition[]>;

export interface WorkflowLifecycleHooks {
  readonly onInstanceCreated?: WorkflowLifecycleHook;
  readonly onBeforeEvent?: WorkflowEventGuard;
  readonly onAfterEvent?: WorkflowLifecycleHook;
  readonly onStepActivated?: WorkflowLifecycleHook;
  readonly onStepCompleted?: WorkflowLifecycleHook;
  readonly onWorkflowCompleted?: WorkflowLifecycleHook;
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
  readonly guards?: readonly WorkflowEventGuard[];
  readonly hooks?: WorkflowLifecycleHooks;
}

export function createWorkflowServer(options: WorkflowServerOptions): WorkflowServer {
  return new DefaultWorkflowServer(options);
}

class DefaultWorkflowServer implements WorkflowServer {
  readonly #storage: WorkflowStorage;
  readonly #guards: readonly WorkflowEventGuard[];
  readonly #hooks: WorkflowLifecycleHooks;

  constructor(options: WorkflowServerOptions) {
    this.#storage = options.storage;
    this.#guards = options.guards ?? [];
    this.#hooks = options.hooks ?? {};
  }

  async createInstance(input: CreateWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult> {
    const instance = createWorkflowInstance({
      definition: input.definition,
      instanceId: input.instanceId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.artifactIds ? { artifactIds: input.artifactIds } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    });

    await this.#storage.commitInstanceCreation({
      instance,
      historyEntries: instance.history
    });

    await runLifecycleHook(this.#hooks.onInstanceCreated, {
      definition: input.definition,
      instance
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
      await this.#runGuards(input.definition, instance, input.event);
      const result = applyWorkflowEvent({
        definition: input.definition,
        instance,
        event: input.event
      });
      const historyEntry = getLatestHistoryEntry(result.instance);
      const completedStep = getStep(input.definition, result.completedStepId);
      const sideEffects = [
        ...collectDefinitionSideEffects({
          definition: input.definition,
          previousInstance: instance,
          instance: result.instance,
          event: input.event,
          completedStepId: result.completedStepId,
          activatedStepIds: result.activatedStepIds,
          occurredAt: input.event.occurredAt
        }),
        ...toSideEffects(
          input.event,
          input.event.occurredAt,
          await runLifecycleHook(this.#hooks.onStepCompleted, {
            definition: input.definition,
            previousInstance: instance,
            instance: result.instance,
            event: input.event,
            ...(completedStep ? { step: completedStep } : {}),
            historyEntry
          }),
          "hook:onStepCompleted",
          result.completedStepId
        )
      ];

      for (const activatedStepId of result.activatedStepIds) {
        const activatedStep = getStep(input.definition, activatedStepId);
        sideEffects.push(
          ...toSideEffects(
            input.event,
            input.event.occurredAt,
            await runLifecycleHook(this.#hooks.onStepActivated, {
              definition: input.definition,
              previousInstance: instance,
              instance: result.instance,
              event: input.event,
              ...(activatedStep ? { step: activatedStep } : {}),
              historyEntry
            }),
            "hook:onStepActivated",
            activatedStepId
          )
        );
      }

      if (result.instance.status === "completed" && instance.status !== "completed") {
        sideEffects.push(
          ...toSideEffects(
            input.event,
            input.event.occurredAt,
            await runLifecycleHook(this.#hooks.onWorkflowCompleted, {
              definition: input.definition,
              previousInstance: instance,
              instance: result.instance,
              event: input.event,
              historyEntry
            }),
            "hook:onWorkflowCompleted"
          )
        );
      }

      const sendResult: SendWorkflowEventResult = {
        instance: result.instance,
        historyEntry,
        changedStepIds: getChangedStepIds(instance, result.instance),
        availableActions: result.availableActions,
        sideEffects,
        warnings: []
      };

      sideEffects.push(
        ...toSideEffects(
          input.event,
          input.event.occurredAt,
          await runLifecycleHook(this.#hooks.onAfterEvent, {
            definition: input.definition,
            previousInstance: instance,
            instance: result.instance,
            event: input.event,
            historyEntry,
            result: sendResult
          }),
          "hook:onAfterEvent"
        )
      );

      await this.#storage.commitEvent({
        instance: result.instance,
        event: {
          event: input.event,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
          revisionBefore: instance.revision,
          revisionAfter: result.instance.revision,
          ...(sideEffects.length ? { sideEffects } : {})
        },
        historyEntry,
        ...(sideEffects.length ? { sideEffects } : {}),
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

  async #runGuards(definition: WorkflowDefinition, instance: WorkflowInstance, event: WorkflowEvent): Promise<void> {
    const step = event.stepId ? getStep(definition, event.stepId) : undefined;
    const guards = [this.#hooks.onBeforeEvent, ...this.#guards].filter(Boolean) as WorkflowEventGuard[];

    for (const guard of guards) {
      const decision = normalizeGuardDecision(await guard({ definition, instance, event, step }));
      if (!decision.allowed) {
        throw new WorkflowServerError("GUARD_REJECTED", decision.message ?? "Workflow event was rejected by a guard.");
      }
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

function normalizeGuardDecision(
  decision: boolean | string | WorkflowGuardDecision | void
): WorkflowGuardDecision {
  if (decision === undefined || decision === true) {
    return { allowed: true };
  }

  if (decision === false) {
    return { allowed: false };
  }

  if (typeof decision === "string") {
    return { allowed: false, message: decision };
  }

  return decision;
}

async function runLifecycleHook(
  hook: WorkflowLifecycleHook | undefined,
  context: WorkflowLifecycleContext
): Promise<readonly WorkflowEffectDefinition[]> {
  if (!hook) {
    return [];
  }

  try {
    return (await hook(context)) ?? [];
  } catch (error) {
    throw new WorkflowServerError(
      "HOOK_FAILED",
      error instanceof Error ? error.message : "Workflow lifecycle hook failed."
    );
  }
}

function collectDefinitionSideEffects(input: {
  readonly definition: WorkflowDefinition;
  readonly previousInstance: WorkflowInstance;
  readonly instance: WorkflowInstance;
  readonly event: WorkflowEvent;
  readonly completedStepId: string;
  readonly activatedStepIds: readonly string[];
  readonly occurredAt: string;
}): WorkflowSideEffect[] {
  const effects: WorkflowSideEffect[] = [];
  const completedStep = getStep(input.definition, input.completedStepId);

  effects.push(
    ...toSideEffects(input.event, input.occurredAt, input.definition.effects, "definition:event_applied"),
    ...toSideEffects(input.event, input.occurredAt, completedStep?.effects, "step:completed", input.completedStepId)
  );

  for (const activatedStepId of input.activatedStepIds) {
    const activatedStep = getStep(input.definition, activatedStepId);
    effects.push(...toSideEffects(input.event, input.occurredAt, activatedStep?.effects, "step:activated", activatedStepId));
  }

  const matchingTransitions = (input.definition.transitions ?? []).filter(
    (transition) =>
      transition.from === input.completedStepId &&
      (transition.event ?? "COMPLETE_STEP") === input.event.type
  );

  for (const transition of matchingTransitions) {
    effects.push(...toSideEffects(input.event, input.occurredAt, transition.effects, "transition:event_applied", transition.to));

    if (transition.compensation?.effect) {
      effects.push(
        ...toSideEffects(
          input.event,
          input.occurredAt,
          [transition.compensation.effect],
          "transition:compensation_registered",
          transition.to
        )
      );
    }
  }

  if (input.instance.status === "completed" && input.previousInstance.status !== "completed") {
    effects.push(...toSideEffects(input.event, input.occurredAt, input.definition.effects, "definition:workflow_completed"));
  }

  if (completedStep?.compensation?.effect) {
    effects.push(
      ...toSideEffects(
        input.event,
        input.occurredAt,
        [completedStep.compensation.effect],
        "step:compensation_registered",
        input.completedStepId
      )
    );
  }

  return dedupeSideEffects(effects);
}

function toSideEffects(
  event: WorkflowEvent,
  createdAt: string,
  effects: readonly WorkflowEffectDefinition[] | undefined,
  trigger: string,
  stepId?: string
): WorkflowSideEffect[] {
  return (effects ?? []).map((effect, index) => ({
    id: `${event.id}:${trigger}:${effect.id ?? effect.type}:${index}`,
    instanceId: event.instanceId,
    eventId: event.id,
    type: effect.type,
    status: "pending",
    trigger: effect.trigger ?? trigger,
    ...(stepId ? { stepId } : {}),
    ...(effect.target ? { target: effect.target } : {}),
    ...(effect.metadata ? { metadata: effect.metadata } : {}),
    createdAt
  }));
}

function dedupeSideEffects(effects: readonly WorkflowSideEffect[]): WorkflowSideEffect[] {
  return [...new Map(effects.map((effect) => [effect.id, effect])).values()];
}

function getStep(definition: WorkflowDefinition, stepId: string): WorkflowStepDefinition | undefined {
  return definition.steps.find((step) => step.id === stepId);
}
