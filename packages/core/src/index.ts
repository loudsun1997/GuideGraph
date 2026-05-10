export type WorkflowId = string;
export type WorkflowInstanceStatus = "active" | "completed" | "failed";
export type WorkflowStepStatus = "not_started" | "blocked" | "active" | "completed";
export type WorkflowEventType = "COMPLETE_STEP" | string;

export interface WorkflowContext<TInput = unknown> {
  readonly input: TInput;
  readonly results: Record<string, unknown>;
}

export interface RunnableWorkflowStep<TInput = unknown, TResult = unknown> {
  readonly id: string;
  readonly name?: string;
  readonly run: (context: WorkflowContext<TInput>) => TResult | Promise<TResult>;
}

export type WorkflowDependencyRule =
  | {
      readonly type: "all";
      readonly stepIds: readonly string[];
    }
  | {
      readonly type: "any";
      readonly stepIds: readonly string[];
    }
  | {
      readonly type: "atLeast";
      readonly count: number;
      readonly stepIds: readonly string[];
    };

export interface WorkflowStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly dependencies?: readonly WorkflowDependencyRule[];
}

export interface WorkflowTransition {
  readonly from: string;
  readonly to: string;
  readonly event?: WorkflowEventType;
  readonly label?: string;
}

export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly name: string;
  readonly version: string;
  readonly startStepIds: readonly string[];
  readonly steps: readonly WorkflowStepDefinition[];
  readonly transitions?: readonly WorkflowTransition[];
}

export interface WorkflowRunResult {
  readonly workflowId: WorkflowId;
  readonly status: "completed" | "failed";
  readonly results: Record<string, unknown>;
  readonly error?: Error;
}

export interface WorkflowStore {
  save(workflow: WorkflowDefinition): Promise<void>;
  find(id: WorkflowId): Promise<WorkflowDefinition | undefined>;
  list(): Promise<WorkflowDefinition[]>;
  delete(id: WorkflowId): Promise<boolean>;
}

export interface WorkflowStepState {
  readonly status: WorkflowStepStatus;
  readonly completedAt?: string;
  readonly blockedReason?: string;
  readonly missingStepIds?: readonly string[];
}

export interface WorkflowHistoryEntry {
  readonly id: string;
  readonly eventId: string;
  readonly instanceId: string;
  readonly eventType: WorkflowEventType;
  readonly message: string;
  readonly occurredAt: string;
  readonly actorId?: string;
  readonly stepId?: string;
}

export interface WorkflowInstance {
  readonly id: string;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: string;
  readonly status: WorkflowInstanceStatus;
  readonly revision: number;
  readonly activeStepIds: readonly string[];
  readonly stepStates: Readonly<Record<string, WorkflowStepState>>;
  readonly history: readonly WorkflowHistoryEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowEvent {
  readonly id: string;
  readonly instanceId: string;
  readonly type: WorkflowEventType;
  readonly stepId?: string;
  readonly actorId?: string;
  readonly occurredAt: string;
}

export interface AvailableWorkflowAction {
  readonly type: WorkflowEventType;
  readonly stepId: string;
  readonly label: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface CreateWorkflowInstanceOptions {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly now?: string;
}

export interface ApplyWorkflowEventOptions {
  readonly definition: WorkflowDefinition;
  readonly instance: WorkflowInstance;
  readonly event: WorkflowEvent;
}

export interface ApplyWorkflowEventResult {
  readonly instance: WorkflowInstance;
  readonly availableActions: readonly AvailableWorkflowAction[];
}

export function createWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  assertValidWorkflowDefinition(definition);
  return definition;
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): ValidationResult {
  const errors: string[] = [];
  const stepIds = new Set<string>();

  if (!isNonEmptyString(definition.id)) {
    errors.push("Workflow id is required.");
  }

  if (!isNonEmptyString(definition.version)) {
    errors.push("Workflow version is required.");
  }

  if (!Array.isArray(definition.startStepIds) || definition.startStepIds.length === 0) {
    errors.push("Workflow startStepIds must include at least one step id.");
  }

  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    errors.push("Workflow steps must include at least one step.");
  }

  for (const step of definition.steps ?? []) {
    if (!isValidId(step.id)) {
      errors.push(`Invalid step id: ${String(step.id)}`);
      continue;
    }

    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }

    stepIds.add(step.id);
  }

  for (const startStepId of definition.startStepIds ?? []) {
    if (!stepIds.has(startStepId)) {
      errors.push(`startStepIds references unknown step: ${startStepId}`);
    }
  }

  for (const transition of definition.transitions ?? []) {
    if (!stepIds.has(transition.from)) {
      errors.push(`Transition references unknown from step: ${transition.from}`);
    }

    if (!stepIds.has(transition.to)) {
      errors.push(`Transition references unknown to step: ${transition.to}`);
    }
  }

  for (const step of definition.steps ?? []) {
    for (const dependency of step.dependencies ?? []) {
      validateDependencyRule(step.id, dependency, stepIds, errors);
    }
  }

  errors.push(...getCircularDependencyErrors(definition));

  return {
    valid: errors.length === 0,
    errors
  };
}

export function assertValidWorkflowDefinition(definition: WorkflowDefinition): void {
  const result = validateWorkflowDefinition(definition);

  if (!result.valid) {
    throw new Error(result.errors.join("\n"));
  }
}

export function createWorkflowInstance(options: CreateWorkflowInstanceOptions): WorkflowInstance {
  assertValidWorkflowDefinition(options.definition);

  const now = options.now ?? new Date().toISOString();
  const stepStates: Record<string, WorkflowStepState> = {};

  for (const step of options.definition.steps) {
    if (options.definition.startStepIds.includes(step.id)) {
      stepStates[step.id] = { status: "active" };
      continue;
    }

    stepStates[step.id] = getInitialInactiveStepState(step, stepStates);
  }

  const createdHistoryEntry: WorkflowHistoryEntry = {
    id: `${options.instanceId}:created`,
    eventId: `${options.instanceId}:created`,
    instanceId: options.instanceId,
    eventType: "INSTANCE_CREATED",
    message: `Created workflow instance for ${options.definition.name}.`,
    occurredAt: now,
    ...(options.actorId ? { actorId: options.actorId } : {})
  };

  const instance: WorkflowInstance = {
    id: options.instanceId,
    workflowId: options.definition.id,
    workflowVersion: options.definition.version,
    status: "active",
    revision: 0,
    activeStepIds: [...options.definition.startStepIds],
    stepStates,
    history: [createdHistoryEntry],
    createdAt: now,
    updatedAt: now
  };

  return recalculateBlockedSteps(options.definition, instance);
}

export function applyWorkflowEvent(options: ApplyWorkflowEventOptions): ApplyWorkflowEventResult {
  assertValidWorkflowDefinition(options.definition);
  assertValidWorkflowEvent(options.instance, options.event);

  if (options.instance.workflowId !== options.definition.id) {
    throw new Error("Event definition does not match the workflow instance.");
  }

  const stepById = getStepById(options.definition);
  const stepId = resolveEventStepId(options.definition, options.instance, options.event);
  const step = stepById.get(stepId);

  if (!step) {
    throw new Error(`Event references unknown step: ${stepId}`);
  }

  if (!options.instance.activeStepIds.includes(stepId)) {
    throw new Error(`Cannot apply ${options.event.type} to inactive step: ${stepId}`);
  }

  const matchingTransitions = getMatchingTransitions(options.definition, stepId, options.event.type);

  if (options.event.type !== "COMPLETE_STEP" && matchingTransitions.length === 0) {
    throw new Error(`No transition found for event ${options.event.type} from step ${stepId}.`);
  }

  let nextInstance = cloneInstanceForUpdate(options.instance, options.event.occurredAt);
  nextInstance.stepStates[stepId] = {
    status: "completed",
    completedAt: options.event.occurredAt
  };
  nextInstance.activeStepIds = nextInstance.activeStepIds.filter((id) => id !== stepId);

  for (const transition of matchingTransitions) {
    nextInstance = activateTransitionTarget(options.definition, nextInstance, transition.to);
  }

  nextInstance = recalculateBlockedSteps(options.definition, nextInstance);
  nextInstance = completeInstanceWhenSettled(nextInstance);
  nextInstance.history = [
    ...nextInstance.history,
    createHistoryEntry(options.definition, step, options.event)
  ];

  return {
    instance: nextInstance,
    availableActions: getAvailableActions(options.definition, nextInstance)
  };
}

export function getAvailableActions(
  definition: WorkflowDefinition,
  instance: WorkflowInstance
): AvailableWorkflowAction[] {
  const stepById = getStepById(definition);
  const actions: AvailableWorkflowAction[] = [];

  for (const stepId of instance.activeStepIds) {
    const step = stepById.get(stepId);

    if (!step) {
      continue;
    }

    const branchTransitions = (definition.transitions ?? []).filter(
      (transition) => transition.from === stepId && transition.event && transition.event !== "COMPLETE_STEP"
    );

    if (branchTransitions.length > 0) {
      actions.push(
        ...branchTransitions.map((transition) => ({
          type: transition.event ?? "COMPLETE_STEP",
          stepId,
          label: transition.label ?? transition.event ?? `Complete ${step.name}`
        }))
      );
      continue;
    }

    actions.push({
      type: "COMPLETE_STEP",
      stepId,
      label: `Complete ${step.name}`
    });
  }

  return actions;
}

export async function runWorkflow<TInput = unknown>(
  workflow: {
    readonly id: WorkflowId;
    readonly steps: readonly RunnableWorkflowStep<TInput>[];
  },
  input: TInput = undefined as TInput
): Promise<WorkflowRunResult> {
  const results: Record<string, unknown> = {};

  try {
    for (const step of workflow.steps) {
      results[step.id] = await step.run({ input, results });
    }

    return {
      workflowId: workflow.id,
      status: "completed",
      results
    };
  } catch (cause) {
    return {
      workflowId: workflow.id,
      status: "failed",
      results,
      error: cause instanceof Error ? cause : new Error(String(cause))
    };
  }
}

function validateDependencyRule(
  stepId: string,
  dependency: WorkflowDependencyRule,
  stepIds: ReadonlySet<string>,
  errors: string[]
): void {
  if (dependency.stepIds.length === 0) {
    errors.push(`Dependency on ${stepId} must reference at least one step.`);
  }

  for (const dependencyStepId of dependency.stepIds) {
    if (!stepIds.has(dependencyStepId)) {
      errors.push(`Dependency references unknown step: ${dependencyStepId}`);
    }
  }

  if (dependency.type === "atLeast" && (dependency.count < 1 || dependency.count > dependency.stepIds.length)) {
    errors.push(`Dependency on ${stepId} has invalid atLeast count: ${dependency.count}`);
  }
}

function getCircularDependencyErrors(definition: WorkflowDefinition): string[] {
  const stepById = getStepById(definition);
  const errors: string[] = [];
  const visited = new Set<string>();

  for (const step of definition.steps ?? []) {
    visitDependency(step.id, [], visited, stepById, errors);
  }

  return errors;
}

function visitDependency(
  stepId: string,
  path: readonly string[],
  visited: Set<string>,
  stepById: ReadonlyMap<string, WorkflowStepDefinition>,
  errors: string[]
): void {
  const cycleStartIndex = path.indexOf(stepId);

  if (cycleStartIndex >= 0) {
    const cycle = [...path.slice(cycleStartIndex), stepId];
    errors.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
    return;
  }

  if (visited.has(stepId)) {
    return;
  }

  const step = stepById.get(stepId);

  if (!step) {
    return;
  }

  for (const dependency of step.dependencies ?? []) {
    for (const dependencyStepId of dependency.stepIds) {
      visitDependency(dependencyStepId, [...path, stepId], visited, stepById, errors);
    }
  }

  visited.add(stepId);
}

function assertValidWorkflowEvent(instance: WorkflowInstance, event: WorkflowEvent): void {
  if (!isNonEmptyString(event.id)) {
    throw new Error("Workflow event id is required.");
  }

  if (event.instanceId !== instance.id) {
    throw new Error("Workflow event instanceId does not match the instance.");
  }

  if (!isNonEmptyString(event.type)) {
    throw new Error("Workflow event type is required.");
  }

  if (!isNonEmptyString(event.occurredAt)) {
    throw new Error("Workflow event occurredAt is required.");
  }
}

function getInitialInactiveStepState(
  step: WorkflowStepDefinition,
  stepStates: Readonly<Record<string, WorkflowStepState>>
): WorkflowStepState {
  const blocked = getBlockedState(step, stepStates);
  return blocked ?? { status: "not_started" };
}

function activateTransitionTarget(
  definition: WorkflowDefinition,
  instance: MutableWorkflowInstance,
  stepId: string
): MutableWorkflowInstance {
  const step = getRequiredStep(definition, stepId);
  const blocked = getBlockedState(step, instance.stepStates);

  if (blocked) {
    instance.stepStates[stepId] = blocked;
    return instance;
  }

  instance.stepStates[stepId] = { status: "active" };

  if (!instance.activeStepIds.includes(stepId)) {
    instance.activeStepIds = [...instance.activeStepIds, stepId];
  }

  return instance;
}

function recalculateBlockedSteps(
  definition: WorkflowDefinition,
  instance: WorkflowInstance | MutableWorkflowInstance
): MutableWorkflowInstance {
  const next = cloneMutableInstance(instance);

  for (const step of definition.steps) {
    const state = next.stepStates[step.id];

    if (!state || state.status === "active" || state.status === "completed") {
      continue;
    }

    next.stepStates[step.id] = getBlockedState(step, next.stepStates) ?? { status: "not_started" };
  }

  return next;
}

function completeInstanceWhenSettled(instance: MutableWorkflowInstance): MutableWorkflowInstance {
  if (instance.activeStepIds.length === 0) {
    instance.status = "completed";
  }

  return instance;
}

function getBlockedState(
  step: WorkflowStepDefinition,
  stepStates: Readonly<Record<string, WorkflowStepState>>
): WorkflowStepState | undefined {
  const missingStepIds = getMissingDependencyStepIds(step, stepStates);

  if (missingStepIds.length === 0) {
    return undefined;
  }

  return {
    status: "blocked",
    blockedReason: `Waiting for ${missingStepIds.join(", ")}.`,
    missingStepIds
  };
}

function getMissingDependencyStepIds(
  step: WorkflowStepDefinition,
  stepStates: Readonly<Record<string, WorkflowStepState>>
): string[] {
  const missingStepIds = new Set<string>();

  for (const dependency of step.dependencies ?? []) {
    const completedStepIds = dependency.stepIds.filter(
      (stepId) => stepStates[stepId]?.status === "completed"
    );

    if (dependency.type === "all") {
      for (const dependencyStepId of dependency.stepIds) {
        if (!completedStepIds.includes(dependencyStepId)) {
          missingStepIds.add(dependencyStepId);
        }
      }
    }

    if (dependency.type === "any" && completedStepIds.length === 0) {
      for (const dependencyStepId of dependency.stepIds) {
        missingStepIds.add(dependencyStepId);
      }
    }

    if (dependency.type === "atLeast" && completedStepIds.length < dependency.count) {
      for (const dependencyStepId of dependency.stepIds) {
        if (!completedStepIds.includes(dependencyStepId)) {
          missingStepIds.add(dependencyStepId);
        }
      }
    }
  }

  return [...missingStepIds];
}

function getMatchingTransitions(
  definition: WorkflowDefinition,
  stepId: string,
  eventType: WorkflowEventType
): WorkflowTransition[] {
  return (definition.transitions ?? []).filter((transition) => {
    const transitionEventType = transition.event ?? "COMPLETE_STEP";
    return transition.from === stepId && transitionEventType === eventType;
  });
}

function resolveEventStepId(
  definition: WorkflowDefinition,
  instance: WorkflowInstance,
  event: WorkflowEvent
): string {
  if (event.stepId) {
    return event.stepId;
  }

  const activeTransition = (definition.transitions ?? []).find(
    (transition) => instance.activeStepIds.includes(transition.from) && transition.event === event.type
  );

  if (activeTransition) {
    return activeTransition.from;
  }

  throw new Error(`Workflow event ${event.type} requires a stepId.`);
}

function createHistoryEntry(
  definition: WorkflowDefinition,
  step: WorkflowStepDefinition,
  event: WorkflowEvent
): WorkflowHistoryEntry {
  return {
    id: `${event.instanceId}:${event.id}`,
    eventId: event.id,
    instanceId: event.instanceId,
    eventType: event.type,
    message: getHistoryMessage(definition, step, event),
    occurredAt: event.occurredAt,
    ...(event.actorId ? { actorId: event.actorId } : {}),
    stepId: step.id
  };
}

function getHistoryMessage(
  definition: WorkflowDefinition,
  step: WorkflowStepDefinition,
  event: WorkflowEvent
): string {
  const matchingTransition = getMatchingTransitions(definition, step.id, event.type)[0];

  if (event.type === "COMPLETE_STEP") {
    return `Completed ${step.name}.`;
  }

  if (matchingTransition?.label) {
    return `${matchingTransition.label} from ${step.name}.`;
  }

  return `Applied ${event.type} to ${step.name}.`;
}

function getRequiredStep(definition: WorkflowDefinition, stepId: string): WorkflowStepDefinition {
  const step = getStepById(definition).get(stepId);

  if (!step) {
    throw new Error(`Unknown workflow step: ${stepId}`);
  }

  return step;
}

function getStepById(definition: WorkflowDefinition): Map<string, WorkflowStepDefinition> {
  return new Map(definition.steps.map((step) => [step.id, step]));
}

type MutableWorkflowInstance = {
  -readonly [Key in keyof WorkflowInstance]: WorkflowInstance[Key];
} & {
  stepStates: Record<string, WorkflowStepState>;
  history: WorkflowHistoryEntry[];
  activeStepIds: string[];
};

function cloneInstanceForUpdate(instance: WorkflowInstance, updatedAt: string): MutableWorkflowInstance {
  return {
    ...cloneMutableInstance(instance),
    revision: instance.revision + 1,
    updatedAt
  };
}

function cloneMutableInstance(instance: WorkflowInstance | MutableWorkflowInstance): MutableWorkflowInstance {
  return {
    ...instance,
    activeStepIds: [...instance.activeStepIds],
    stepStates: { ...instance.stepStates },
    history: [...instance.history]
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}
