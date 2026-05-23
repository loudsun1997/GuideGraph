import {
  applyWorkflowEvent,
  createWorkflow,
  createWorkflowInstance,
  getAvailableActions,
  validateWorkflowDefinition,
  type AvailableWorkflowAction,
  type ValidationResult,
  type WorkflowAssignmentDefinition,
  type WorkflowDefinition,
  type WorkflowDependencyRule,
  type WorkflowEffectDefinition,
  type WorkflowHistoryEntry,
  type WorkflowInputDefinition,
  type WorkflowInstance,
  type WorkflowStepDefinition,
  type WorkflowTimerDefinition,
  type WorkflowTransition,
  type WorkflowArtifactDefinition,
  type WorkflowCompensationDefinition,
  type WorkflowData,
  type WorkflowVersionMigrationDefinition
} from "@guidegraph/core";

export const workflowDraftStatusOptions = ["draft", "published", "archived"] as const;
export type WorkflowDraftStatus = (typeof workflowDraftStatusOptions)[number];

export interface BuilderWorkflowStep extends WorkflowStepDefinition {
  readonly description?: string;
}

export interface BuilderWorkflowDefinition extends Omit<WorkflowDefinition, "steps"> {
  readonly description?: string;
  readonly steps: readonly BuilderWorkflowStep[];
  readonly builder?: BuilderMetadata;
}

export interface BuilderMetadata {
  readonly canvas?: BuilderCanvasMetadata;
}

export interface BuilderCanvasMetadata {
  readonly nodes?: Readonly<Record<string, CanvasPosition>>;
  readonly actionLabels?: Readonly<Record<string, CanvasActionLabelLayout>>;
}

export interface CanvasPosition {
  readonly x: number;
  readonly y: number;
}

export const canvasActionIconOptions = ["arrow", "check", "x", "rotate", "send", "alert"] as const;
export type CanvasActionIcon = (typeof canvasActionIconOptions)[number];

export interface CanvasActionLabelLayout {
  readonly position?: CanvasPosition;
  readonly icon?: CanvasActionIcon;
}

export interface DependencyDraft {
  readonly targetStepId: string;
  readonly sourceStepIds: readonly string[];
  readonly type: WorkflowDependencyRule["type"];
  readonly count?: number;
}

export interface TransitionDraft {
  readonly from: string;
  readonly to: string;
  readonly event: string;
  readonly label: string;
  readonly metadata?: WorkflowData;
  readonly effects?: readonly WorkflowEffectDefinition[];
  readonly compensation?: WorkflowCompensationDefinition;
}

export interface DefinitionSummary {
  readonly stepCount: number;
  readonly startStepCount: number;
  readonly dependencyCount: number;
  readonly transitionCount: number;
  readonly loopTransitionCount: number;
  readonly valid: boolean;
  readonly status: WorkflowDraftStatus;
  readonly workflowId: string;
  readonly workflowVersion: string;
}

export interface BuilderWarning {
  readonly code: string;
  readonly message: string;
}

export interface PreviewSimulation {
  readonly instance: WorkflowInstance;
  readonly history: readonly WorkflowHistoryEntry[];
  readonly availableActions: readonly AvailableWorkflowAction[];
}

export interface BuilderCanvasNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly position: CanvasPosition;
  readonly isStart: boolean;
  readonly validationHints: readonly string[];
}

export type BuilderCanvasEdgeKind = "dependency" | "transition";

export interface BuilderCanvasEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: BuilderCanvasEdgeKind;
  readonly label?: string;
  readonly event?: string;
  readonly dependencyIndex?: number;
}

export interface CanvasEdgeUpdateInput {
  readonly kind: BuilderCanvasEdgeKind;
  readonly source: string;
  readonly target: string;
  readonly event?: string;
  readonly label?: string;
  readonly dependencyType?: WorkflowDependencyRule["type"];
  readonly dependencyCount?: number;
}

export interface BuilderCanvasModel {
  readonly nodes: readonly BuilderCanvasNode[];
  readonly edges: readonly BuilderCanvasEdge[];
}

export interface CreateBuilderDefinitionInput {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly template?: WorkflowDefinition;
}

export interface WorkflowBuilderOptions {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

export interface StepBuilderOptions {
  readonly name?: string;
  readonly description?: string;
  readonly start?: boolean;
  readonly dependencies?: readonly WorkflowDependencyRule[];
  readonly metadata?: WorkflowData;
  readonly assignment?: WorkflowAssignmentDefinition;
  readonly timers?: readonly WorkflowTimerDefinition[];
  readonly input?: WorkflowInputDefinition;
  readonly artifacts?: readonly WorkflowArtifactDefinition[];
  readonly effects?: readonly WorkflowEffectDefinition[];
  readonly compensation?: WorkflowCompensationDefinition;
}

export interface TransitionBuilderOptions {
  readonly event?: string;
  readonly label?: string;
  readonly metadata?: WorkflowData;
  readonly effects?: readonly WorkflowEffectDefinition[];
  readonly compensation?: WorkflowCompensationDefinition;
}

export interface WorkflowBuilderFactory<TOptions> {
  (options: TOptions): WorkflowDefinition;
}

export interface BuilderMutationResult {
  readonly definition: BuilderWorkflowDefinition;
  readonly changed: boolean;
  readonly error?: string;
}

export class WorkflowStepBuilder {
  readonly #dependencies: WorkflowDependencyRule[] = [];
  readonly #effects: WorkflowEffectDefinition[] = [];
  readonly #timers: WorkflowTimerDefinition[] = [];
  readonly #artifacts: WorkflowArtifactDefinition[] = [];
  #description: string | undefined;
  #metadata: WorkflowData | undefined;
  #assignment: WorkflowAssignmentDefinition | undefined;
  #input: WorkflowInputDefinition | undefined;
  #compensation: WorkflowCompensationDefinition | undefined;

  constructor(
    public readonly id: string,
    public readonly name: string
  ) {}

  description(description: string): this {
    this.#description = description.trim() || undefined;
    return this;
  }

  requiresAll(stepIds: readonly string[] | string, ...restStepIds: string[]): this {
    this.#dependencies.push({ type: "all", stepIds: normalizeStepIdList(stepIds, restStepIds) });
    return this;
  }

  requiresAny(stepIds: readonly string[] | string, ...restStepIds: string[]): this {
    this.#dependencies.push({ type: "any", stepIds: normalizeStepIdList(stepIds, restStepIds) });
    return this;
  }

  requiresAtLeast(count: number, stepIds: readonly string[] | string, ...restStepIds: string[]): this {
    this.#dependencies.push({ type: "atLeast", count, stepIds: normalizeStepIdList(stepIds, restStepIds) });
    return this;
  }

  dependency(rule: WorkflowDependencyRule): this {
    this.#dependencies.push(clonePlain(rule));
    return this;
  }

  metadata(metadata: WorkflowData): this {
    this.#metadata = cloneData(metadata);
    return this;
  }

  assignment(assignment: WorkflowAssignmentDefinition): this {
    this.#assignment = clonePlain(assignment);
    return this;
  }

  timer(timer: WorkflowTimerDefinition): this {
    this.#timers.push(clonePlain(timer));
    return this;
  }

  input(input: WorkflowInputDefinition): this {
    this.#input = clonePlain(input);
    return this;
  }

  artifact(artifact: WorkflowArtifactDefinition): this {
    this.#artifacts.push(clonePlain(artifact));
    return this;
  }

  effect(effect: WorkflowEffectDefinition): this {
    this.#effects.push(clonePlain(effect));
    return this;
  }

  compensation(compensation: WorkflowCompensationDefinition): this {
    this.#compensation = clonePlain(compensation);
    return this;
  }

  toStepDefinition(): BuilderWorkflowStep {
    return {
      id: this.id,
      name: this.name,
      ...(this.#description ? { description: this.#description } : {}),
      ...(this.#dependencies.length ? { dependencies: this.#dependencies.map((dependency) => clonePlain(dependency)) } : {}),
      ...(this.#metadata ? { metadata: this.#metadata } : {}),
      ...(this.#assignment ? { assignment: this.#assignment } : {}),
      ...(this.#timers.length ? { timers: this.#timers.map(clonePlain) } : {}),
      ...(this.#input ? { input: this.#input } : {}),
      ...(this.#artifacts.length ? { artifacts: this.#artifacts.map(clonePlain) } : {}),
      ...(this.#effects.length ? { effects: this.#effects.map(clonePlain) } : {}),
      ...(this.#compensation ? { compensation: this.#compensation } : {})
    };
  }
}

export class WorkflowDefinitionBuilder {
  readonly #steps = new Map<string, WorkflowStepBuilder>();
  readonly #transitions: WorkflowTransition[] = [];
  readonly #startStepIds = new Set<string>();
  readonly #effects: WorkflowEffectDefinition[] = [];
  readonly #migrations: WorkflowVersionMigrationDefinition[] = [];
  #name: string;
  #version: string;
  #description: string | undefined;
  #metadata: WorkflowData | undefined;
  #contextSchema: WorkflowData | undefined;

  constructor(public readonly id: string, options: Omit<WorkflowBuilderOptions, "id"> = {}) {
    this.#name = options.name?.trim() || humanizeId(id);
    this.#version = options.version?.trim() || "0.1.0";
    this.#description = options.description?.trim() || undefined;
  }

  name(name: string): this {
    this.#name = name.trim();
    return this;
  }

  version(version: string): this {
    this.#version = version.trim();
    return this;
  }

  description(description: string): this {
    this.#description = description.trim() || undefined;
    return this;
  }

  metadata(metadata: WorkflowData): this {
    this.#metadata = cloneData(metadata);
    return this;
  }

  contextSchema(schema: WorkflowData): this {
    this.#contextSchema = cloneData(schema);
    return this;
  }

  effect(effect: WorkflowEffectDefinition): this {
    this.#effects.push(clonePlain(effect));
    return this;
  }

  migration(migration: WorkflowVersionMigrationDefinition): this {
    this.#migrations.push(clonePlain(migration));
    return this;
  }

  start(stepIds: readonly string[] | string, ...restStepIds: string[]): this {
    this.#startStepIds.clear();
    for (const stepId of normalizeStepIdList(stepIds, restStepIds)) {
      this.#startStepIds.add(stepId);
    }
    return this;
  }

  startStep(
    id: string,
    nameOrConfigure?: string | StepBuilderOptions | ((step: WorkflowStepBuilder) => void),
    configure?: (step: WorkflowStepBuilder) => void
  ): this {
    this.step(id, nameOrConfigure, configure);
    this.#startStepIds.add(id.trim());
    return this;
  }

  step(
    id: string,
    nameOrConfigure?: string | StepBuilderOptions | ((step: WorkflowStepBuilder) => void),
    configure?: (step: WorkflowStepBuilder) => void
  ): this {
    const stepId = id.trim();
    const options = typeof nameOrConfigure === "object" && nameOrConfigure !== null ? nameOrConfigure : {};
    const stepName =
      typeof nameOrConfigure === "string" ? nameOrConfigure.trim() : options.name?.trim() || humanizeId(stepId);
    const step = new WorkflowStepBuilder(stepId, stepName);

    if (options.description) {
      step.description(options.description);
    }

    if (options.metadata) step.metadata(options.metadata);
    if (options.assignment) step.assignment(options.assignment);
    if (options.input) step.input(options.input);
    if (options.compensation) step.compensation(options.compensation);

    for (const dependency of options.dependencies ?? []) {
      step.dependency(dependency);
    }

    for (const timer of options.timers ?? []) step.timer(timer);
    for (const artifact of options.artifacts ?? []) step.artifact(artifact);
    for (const effect of options.effects ?? []) step.effect(effect);

    const stepConfigure = typeof nameOrConfigure === "function" ? nameOrConfigure : configure;
    stepConfigure?.(step);
    this.#steps.set(stepId, step);

    if (options.start === true) {
      this.#startStepIds.add(stepId);
    } else if (options.start === false) {
      this.#startStepIds.delete(stepId);
    }

    return this;
  }

  transition(from: string, to: string, options: TransitionBuilderOptions = {}): this {
    this.#transitions.push({
      from: from.trim(),
      to: to.trim(),
      ...(options.event?.trim() && options.event.trim() !== "COMPLETE_STEP" ? { event: options.event.trim() } : {}),
      ...(options.label?.trim() ? { label: options.label.trim() } : {}),
      ...(options.metadata ? { metadata: cloneData(options.metadata) } : {}),
      ...(options.effects ? { effects: options.effects.map(clonePlain) } : {}),
      ...(options.compensation ? { compensation: clonePlain(options.compensation) } : {})
    });
    return this;
  }

  action(from: string, to: string, options: TransitionBuilderOptions = {}): this {
    return this.transition(from, to, options);
  }

  toBuilderDefinition(): BuilderWorkflowDefinition {
    return normalizeBuilderDefinition({
      id: this.id,
      name: this.#name,
      version: this.#version,
      ...(this.#description ? { description: this.#description } : {}),
      startStepIds: [...this.#startStepIds],
      steps: [...this.#steps.values()].map((step) => step.toStepDefinition()),
      transitions: this.#transitions.map((transition) => clonePlain(transition)),
      ...(this.#metadata ? { metadata: this.#metadata } : {}),
      ...(this.#contextSchema ? { contextSchema: this.#contextSchema } : {}),
      ...(this.#effects.length ? { effects: this.#effects.map(clonePlain) } : {}),
      ...(this.#migrations.length ? { migrations: this.#migrations.map(clonePlain) } : {})
    });
  }

  validate(): ValidationResult {
    return validateBuilderDefinition(this.toBuilderDefinition());
  }

  build(): WorkflowDefinition {
    return createWorkflow(builderDefinitionToWorkflowDefinition(this.toBuilderDefinition()));
  }
}

export function workflow(
  idOrOptions: string | WorkflowBuilderOptions,
  nameOrOptions?: string | Omit<WorkflowBuilderOptions, "id">
): WorkflowDefinitionBuilder {
  if (typeof idOrOptions === "object") {
    return new WorkflowDefinitionBuilder(idOrOptions.id, idOrOptions);
  }

  const options = typeof nameOrOptions === "string" ? { name: nameOrOptions } : nameOrOptions;
  return new WorkflowDefinitionBuilder(idOrOptions, options);
}

export function defineWorkflow(configure: (builder: WorkflowDefinitionBuilder) => void, options: WorkflowBuilderOptions): WorkflowDefinition;
export function defineWorkflow(id: string, configure: (builder: WorkflowDefinitionBuilder) => void): WorkflowDefinition;
export function defineWorkflow(
  idOrConfigure: string | ((builder: WorkflowDefinitionBuilder) => void),
  configureOrOptions: WorkflowBuilderOptions | ((builder: WorkflowDefinitionBuilder) => void)
): WorkflowDefinition {
  const builder =
    typeof idOrConfigure === "string"
      ? workflow(idOrConfigure)
      : workflow(configureOrOptions as WorkflowBuilderOptions);
  const configure = typeof idOrConfigure === "function" ? idOrConfigure : (configureOrOptions as (builder: WorkflowDefinitionBuilder) => void);
  configure(builder);
  return builder.build();
}

export function createWorkflowFactory<TOptions>(
  factory: WorkflowBuilderFactory<TOptions>
): WorkflowBuilderFactory<TOptions> {
  return (options) => createWorkflow(factory(options));
}

export function createBuilderDefinition(input: CreateBuilderDefinitionInput): BuilderWorkflowDefinition {
  const base = input.template
    ? workflowDefinitionToBuilderDefinition(input.template)
    : createEmptyWorkflowSkeleton(input.id, input.version, input.name);

  return normalizeBuilderDefinition({
    ...base,
    id: input.id,
    name: input.name,
    version: input.version,
    ...(input.description?.trim() ? { description: input.description } : {})
  });
}

export function createEmptyWorkflowSkeleton(
  workflowId: string,
  version: string,
  name: string
): BuilderWorkflowDefinition {
  return {
    id: workflowId,
    name,
    version,
    startStepIds: ["start"],
    steps: [{ id: "start", name: "Start" }],
    transitions: []
  };
}

export function workflowDefinitionToBuilderDefinition(definition: WorkflowDefinition): BuilderWorkflowDefinition {
  return cloneDefinition(definition);
}

export function builderDefinitionToWorkflowDefinition(definition: BuilderWorkflowDefinition): WorkflowDefinition {
  const normalized = normalizeBuilderDefinition(definition);

  return {
    id: normalized.id,
    name: normalized.name,
    version: normalized.version,
    startStepIds: normalized.startStepIds,
    steps: normalized.steps.map((step) => ({
      id: step.id,
      name: step.name,
      ...(step.dependencies?.length ? { dependencies: step.dependencies } : {}),
      ...(step.metadata ? { metadata: step.metadata } : {}),
      ...(step.assignment ? { assignment: step.assignment } : {}),
      ...(step.timers ? { timers: step.timers } : {}),
      ...(step.input ? { input: step.input } : {}),
      ...(step.artifacts ? { artifacts: step.artifacts } : {}),
      ...(step.effects ? { effects: step.effects } : {}),
      ...(step.compensation ? { compensation: step.compensation } : {})
    })),
    ...(normalized.transitions?.length ? { transitions: normalized.transitions } : {}),
    ...(normalized.metadata ? { metadata: normalized.metadata } : {}),
    ...(normalized.contextSchema ? { contextSchema: normalized.contextSchema } : {}),
    ...(normalized.effects ? { effects: normalized.effects } : {}),
    ...(normalized.migrations ? { migrations: normalized.migrations } : {})
  };
}

export function normalizeBuilderDefinition(definition: BuilderWorkflowDefinition): BuilderWorkflowDefinition {
  return {
    ...definition,
    id: definition.id.trim(),
    name: definition.name.trim(),
    version: definition.version.trim(),
    ...(definition.description?.trim() ? { description: definition.description.trim() } : {}),
    startStepIds: [...new Set(definition.startStepIds.map((stepId) => stepId.trim()).filter(Boolean))],
    steps: definition.steps.map((step) => ({
      ...step,
      id: step.id.trim(),
      name: step.name.trim(),
      ...(step.description?.trim() ? { description: step.description.trim() } : {}),
      ...(step.dependencies?.length ? { dependencies: step.dependencies } : {})
    })),
    transitions: normalizeTransitions(toTransitionDrafts(definition))
  };
}

export function validateBuilderDefinition(definition: BuilderWorkflowDefinition): ValidationResult {
  return validateWorkflowDefinition(builderDefinitionToWorkflowDefinition(definition));
}

export function assertDraftCanPublish(definition: BuilderWorkflowDefinition): ValidationResult {
  return validateBuilderDefinition(definition);
}

export function suggestPatchVersion(version: string): string | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version.trim());

  if (!match) {
    return undefined;
  }

  const [, major, minor, patch, suffix] = match;
  return `${major}.${minor}.${Number(patch) + 1}${suffix ?? ""}`;
}

export function createDefinitionSummary(input: {
  readonly definition: BuilderWorkflowDefinition;
  readonly status?: WorkflowDraftStatus;
}): DefinitionSummary {
  const validation = validateBuilderDefinition(input.definition);
  const dependencyCount = input.definition.steps.reduce((count, step) => count + (step.dependencies?.length ?? 0), 0);
  const stepIds = new Set(input.definition.steps.map((step) => step.id));

  return {
    stepCount: input.definition.steps.length,
    startStepCount: input.definition.startStepIds.length,
    dependencyCount,
    transitionCount: input.definition.transitions?.length ?? 0,
    loopTransitionCount: (input.definition.transitions ?? []).filter((transition) =>
      isLoopTransition(transition, stepIds)
    ).length,
    valid: validation.valid,
    status: input.status ?? "draft",
    workflowId: input.definition.id,
    workflowVersion: input.definition.version
  };
}

export function getBuilderWarnings(input: {
  readonly definition: BuilderWorkflowDefinition;
  readonly hasPublishedVersions?: boolean;
}): BuilderWarning[] {
  const warnings: BuilderWarning[] = [];
  const outgoingCountByStep = new Map<string, number>();
  const labelCount = new Map<string, number>();
  const branchSteps = new Set<string>();
  const branchLabels: string[] = [];

  for (const step of input.definition.steps) {
    if (!step.description?.trim()) {
      warnings.push({
        code: `missing-description:${step.id}`,
        message: `Step "${step.name}" has no builder description metadata.`
      });
    }

    labelCount.set(step.name.trim().toLowerCase(), (labelCount.get(step.name.trim().toLowerCase()) ?? 0) + 1);
  }

  for (const transition of input.definition.transitions ?? []) {
    outgoingCountByStep.set(transition.from, (outgoingCountByStep.get(transition.from) ?? 0) + 1);

    if (transition.event && transition.event !== "COMPLETE_STEP") {
      branchSteps.add(transition.from);
      if (transition.label?.trim()) {
        branchLabels.push(transition.label);
      }
    }
  }

  const dependencySourceIds = new Set(
    input.definition.steps.flatMap((step) => (step.dependencies ?? []).flatMap((dependency) => dependency.stepIds))
  );

  for (const step of input.definition.steps) {
    const isTerminal = !dependencySourceIds.has(step.id);
    const hasOutgoingTransition = (outgoingCountByStep.get(step.id) ?? 0) > 0;

    if (!isTerminal && !hasOutgoingTransition) {
      warnings.push({
        code: `no-outgoing:${step.id}`,
        message: `Non-terminal step "${step.name}" has no outgoing transition.`
      });
    }
  }

  if (branchSteps.size > 0 && branchLabels.length === 0) {
    warnings.push({
      code: "missing-branch-labels",
      message: "Workflow has branching actions, but none of the branch transitions have labels."
    });
  }

  if (input.definition.startStepIds.length === 0) {
    warnings.push({
      code: "no-start-steps",
      message: "Workflow has no start steps."
    });
  }

  if (input.hasPublishedVersions === false) {
    warnings.push({
      code: "no-published-versions",
      message: "This workflow definition has no published versions yet."
    });
  }

  for (const [label, count] of labelCount) {
    if (label && count > 1) {
      warnings.push({
        code: `duplicate-label:${label}`,
        message: `Multiple steps use the title "${label}".`
      });
    }
  }

  return warnings;
}

export function createPreviewSimulation(definition: BuilderWorkflowDefinition): PreviewSimulation {
  const instance = createWorkflowInstance({
    definition: builderDefinitionToWorkflowDefinition(definition),
    instanceId: `preview-${createRandomId()}`
  });

  return {
    instance,
    history: instance.history,
    availableActions: getAvailableActions(builderDefinitionToWorkflowDefinition(definition), instance)
  };
}

export function sendPreviewSimulationAction(input: {
  readonly definition: BuilderWorkflowDefinition;
  readonly simulation: PreviewSimulation;
  readonly action: AvailableWorkflowAction;
}): PreviewSimulation {
  const definition = builderDefinitionToWorkflowDefinition(input.definition);
  const result = applyWorkflowEvent({
    definition,
    instance: input.simulation.instance,
    event: {
      id: createRandomId(),
      instanceId: input.simulation.instance.id,
      type: input.action.type,
      stepId: input.action.stepId,
      actorId: "preview_user",
      occurredAt: new Date().toISOString()
    }
  });

  return {
    instance: result.instance,
    history: result.instance.history,
    availableActions: result.availableActions
  };
}

export function addStep(definition: BuilderWorkflowDefinition, input: {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
} = {}): BuilderWorkflowDefinition {
  const nextId = getUniqueStepId(definition, input.id?.trim() || "new_step");

  return {
    ...definition,
    steps: [
      ...definition.steps,
      {
        id: nextId,
        name: input.name?.trim() || "New step",
        ...(input.description?.trim() ? { description: input.description.trim() } : {})
      }
    ]
  };
}

export function addCanvasStep(
  definition: BuilderWorkflowDefinition,
  position?: CanvasPosition,
  input?: { readonly name?: string; readonly description?: string }
): BuilderWorkflowDefinition {
  const next = addStep(definition, input);
  const step = next.steps.at(-1);

  if (!step) {
    return next;
  }

  return setCanvasNodePosition(next, step.id, position ?? { x: 80, y: 80 });
}

export function updateStep(
  definition: BuilderWorkflowDefinition,
  originalStepId: string,
  input: { readonly id: string; readonly name: string; readonly description?: string }
): BuilderWorkflowDefinition {
  const nextStepId = input.id.trim();
  const nextBuilder = renameCanvasMetadataStep(definition.builder, originalStepId, nextStepId);

  return {
    ...definition,
    startStepIds: definition.startStepIds.map((stepId) => (stepId === originalStepId ? nextStepId : stepId)),
    steps: definition.steps.map((step) =>
      step.id === originalStepId
        ? {
            ...step,
            id: nextStepId,
            name: input.name,
            ...(input.description?.trim() ? { description: input.description } : {})
          }
        : step
    ),
    transitions: (definition.transitions ?? []).map((transition) => ({
      ...transition,
      from: transition.from === originalStepId ? nextStepId : transition.from,
      to: transition.to === originalStepId ? nextStepId : transition.to
    })),
    ...(nextBuilder ? { builder: nextBuilder } : {})
  };
}

export function setStartStep(
  definition: BuilderWorkflowDefinition,
  stepId: string,
  isStart: boolean
): BuilderWorkflowDefinition {
  const startStepIds = isStart
    ? [...new Set([...definition.startStepIds, stepId])]
    : definition.startStepIds.filter((candidate) => candidate !== stepId);

  return {
    ...definition,
    startStepIds
  };
}

export function deleteStep(definition: BuilderWorkflowDefinition, stepId: string): BuilderMutationResult {
  const references = getStepReferences(definition, stepId);
  const nextBuilder = deleteCanvasMetadataStep(definition.builder, stepId);

  if (references.length > 0) {
    return {
      definition,
      changed: false,
      error: `Cannot delete ${stepId}; it is referenced by ${references.join(", ")}.`
    };
  }

  return {
    changed: true,
    definition: {
      ...definition,
      startStepIds: definition.startStepIds.filter((id) => id !== stepId),
      steps: definition.steps.filter((step) => step.id !== stepId),
      ...(nextBuilder ? { builder: nextBuilder } : {})
    }
  };
}

export function getStepReferences(definition: BuilderWorkflowDefinition, stepId: string): string[] {
  const references: string[] = [];

  if (definition.startStepIds.includes(stepId)) {
    references.push("start steps");
  }

  for (const step of definition.steps) {
    for (const dependency of step.dependencies ?? []) {
      if (dependency.stepIds.includes(stepId)) {
        references.push(`dependency for ${step.id}`);
      }
    }
  }

  for (const transition of definition.transitions ?? []) {
    if (transition.from === stepId || transition.to === stepId) {
      references.push(`transition ${transition.from} to ${transition.to}`);
    }
  }

  return references;
}

export function flattenDependencies(definition: BuilderWorkflowDefinition): DependencyDraft[] {
  return definition.steps.flatMap((step) =>
    (step.dependencies ?? []).map((dependency) => ({
      targetStepId: step.id,
      sourceStepIds: dependency.stepIds,
      type: dependency.type,
      ...(dependency.type === "atLeast" ? { count: dependency.count } : {})
    }))
  );
}

export function setDependencies(
  definition: BuilderWorkflowDefinition,
  dependencies: readonly DependencyDraft[]
): BuilderWorkflowDefinition {
  const dependencyByTarget = new Map<string, WorkflowDependencyRule[]>();

  for (const dependency of dependencies) {
    const sourceStepIds = dependency.sourceStepIds.map((stepId) => stepId.trim()).filter(Boolean);

    if (!dependency.targetStepId.trim() || sourceStepIds.length === 0) {
      continue;
    }

    const rule = createDependencyRule(dependency.type, sourceStepIds, dependency.count);
    const current = dependencyByTarget.get(dependency.targetStepId) ?? [];
    dependencyByTarget.set(dependency.targetStepId, [...current, rule]);
  }

  return {
    ...definition,
    steps: definition.steps.map((step) => ({
      ...step,
      dependencies: dependencyByTarget.get(step.id) ?? []
    }))
  };
}

export function normalizeTransitions(transitions: readonly TransitionDraft[]): WorkflowTransition[] {
  return transitions
    .map((transition) => ({
      from: transition.from.trim(),
      to: transition.to.trim(),
      event: transition.event.trim(),
      label: transition.label.trim(),
      ...(transition.metadata ? { metadata: cloneData(transition.metadata) } : {}),
      ...(transition.effects ? { effects: transition.effects.map(clonePlain) } : {}),
      ...(transition.compensation ? { compensation: clonePlain(transition.compensation) } : {})
    }))
    .filter((transition) => transition.from && transition.to)
    .map((transition) => ({
      from: transition.from,
      to: transition.to,
      ...(transition.event && transition.event !== "COMPLETE_STEP" ? { event: transition.event } : {}),
      ...(transition.label ? { label: transition.label } : {}),
      ...(transition.metadata ? { metadata: transition.metadata } : {}),
      ...(transition.effects ? { effects: transition.effects } : {}),
      ...(transition.compensation ? { compensation: transition.compensation } : {})
    }));
}

export function toTransitionDrafts(definition: BuilderWorkflowDefinition): TransitionDraft[] {
  return (definition.transitions ?? []).map((transition) => ({
    from: transition.from,
    to: transition.to,
    event: transition.event ?? "COMPLETE_STEP",
    label: transition.label ?? "",
    ...(transition.metadata ? { metadata: transition.metadata } : {}),
    ...(transition.effects ? { effects: transition.effects } : {}),
    ...(transition.compensation ? { compensation: transition.compensation } : {})
  }));
}

export function cloneDefinition(definition: WorkflowDefinition): BuilderWorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as BuilderWorkflowDefinition;
}

export function definitionToCanvasModel(definition: BuilderWorkflowDefinition): BuilderCanvasModel {
  const positions = definition.builder?.canvas?.nodes ?? {};
  const fallbackPositions = autoLayoutDefinition(definition);
  const validation = validateBuilderDefinition(definition);

  return {
    nodes: definition.steps.map((step) => ({
      id: step.id,
      label: step.name,
      ...(step.description ? { description: step.description } : {}),
      position: positions[step.id] ?? fallbackPositions[step.id] ?? { x: 0, y: 0 },
      isStart: definition.startStepIds.includes(step.id),
      validationHints: validation.errors.filter((error) => error.includes(step.id))
    })),
    edges: [
      ...definition.steps.flatMap((step) =>
        (step.dependencies ?? []).flatMap((dependency, dependencyIndex) =>
          dependency.stepIds.map((sourceStepId) => ({
            id: getCanvasEdgeId("dependency", sourceStepId, step.id, dependencyIndex),
            source: sourceStepId,
            target: step.id,
            kind: "dependency" as const,
            label: getDependencyEdgeLabel(dependency),
            dependencyIndex
          }))
        )
      ),
      ...(definition.transitions ?? []).map((transition, index) => ({
        id: getCanvasEdgeId("transition", transition.from, transition.to, index, transition.event),
        source: transition.from,
        target: transition.to,
        kind: "transition" as const,
        label: transition.label ?? transition.event ?? "Complete",
        event: transition.event ?? "COMPLETE_STEP"
      }))
    ]
  };
}

export function setCanvasNodePosition(
  definition: BuilderWorkflowDefinition,
  stepId: string,
  position: CanvasPosition
): BuilderWorkflowDefinition {
  return {
    ...definition,
    builder: {
      ...definition.builder,
      canvas: {
        ...definition.builder?.canvas,
        nodes: {
          ...(definition.builder?.canvas?.nodes ?? {}),
          [stepId]: position
        }
      }
    }
  };
}

export function setCanvasNodePositions(
  definition: BuilderWorkflowDefinition,
  positions: Readonly<Record<string, CanvasPosition>>
): BuilderWorkflowDefinition {
  return {
    ...definition,
    builder: {
      ...definition.builder,
      canvas: {
        ...definition.builder?.canvas,
        nodes: {
          ...(definition.builder?.canvas?.nodes ?? {}),
          ...positions
        }
      }
    }
  };
}

export function getCanvasActionLabelKey(edge: Pick<BuilderCanvasEdge, "source" | "target" | "event">): string {
  return `${edge.source}:${edge.target}:${edge.event ?? "COMPLETE_STEP"}`;
}

export function getCanvasActionLabelLayout(
  definition: BuilderWorkflowDefinition,
  edge: Pick<BuilderCanvasEdge, "source" | "target" | "event">
): CanvasActionLabelLayout | undefined {
  return definition.builder?.canvas?.actionLabels?.[getCanvasActionLabelKey(edge)];
}

export function setCanvasActionLabelPosition(
  definition: BuilderWorkflowDefinition,
  edge: Pick<BuilderCanvasEdge, "source" | "target" | "event">,
  position: CanvasPosition
): BuilderWorkflowDefinition {
  const key = getCanvasActionLabelKey(edge);
  const current = definition.builder?.canvas?.actionLabels?.[key] ?? {};

  return setCanvasActionLabelLayout(definition, key, {
    ...current,
    position
  });
}

export function setCanvasActionLabelIcon(
  definition: BuilderWorkflowDefinition,
  edge: Pick<BuilderCanvasEdge, "source" | "target" | "event">,
  icon: CanvasActionIcon
): BuilderWorkflowDefinition {
  const key = getCanvasActionLabelKey(edge);
  const current = definition.builder?.canvas?.actionLabels?.[key] ?? {};

  return setCanvasActionLabelLayout(definition, key, {
    ...current,
    icon
  });
}

export function autoLayoutCanvas(definition: BuilderWorkflowDefinition): BuilderWorkflowDefinition {
  const positions = autoLayoutDefinition(definition);
  const actionLabels = autoLayoutActionLabels(definition, positions);

  return {
    ...definition,
    builder: {
      ...definition.builder,
      canvas: {
        ...definition.builder?.canvas,
        nodes: {
          ...(definition.builder?.canvas?.nodes ?? {}),
          ...positions
        },
        actionLabels: {
          ...(definition.builder?.canvas?.actionLabels ?? {}),
          ...actionLabels
        }
      }
    }
  };
}

export function autoLayoutDefinition(definition: BuilderWorkflowDefinition): Record<string, CanvasPosition> {
  const layerByStepId = new Map<string, number>();
  const forwardTargetsBySource = getForwardLayoutTargetsBySource(definition);

  for (const step of definition.steps) {
    layerByStepId.set(step.id, definition.startStepIds.includes(step.id) ? 0 : 1);
  }

  let changed = true;
  let iterationCount = 0;
  while (changed && iterationCount < definition.steps.length * definition.steps.length) {
    iterationCount += 1;
    changed = false;
    for (const [sourceStepId, targetStepIds] of forwardTargetsBySource) {
      const sourceLayer = layerByStepId.get(sourceStepId) ?? 0;
      for (const targetStepId of targetStepIds) {
        const nextLayer = Math.max(layerByStepId.get(targetStepId) ?? 0, sourceLayer + 1);
        if (nextLayer !== layerByStepId.get(targetStepId)) {
          layerByStepId.set(targetStepId, nextLayer);
          changed = true;
        }
      }
    }
  }

  const rowByLayer = new Map<number, number>();
  const positions: Record<string, CanvasPosition> = {};
  const layerCounts = new Map<number, number>();

  for (const layer of layerByStepId.values()) {
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  }

  const maxLayerCount = Math.max(1, ...layerCounts.values());

  for (const step of definition.steps) {
    const layer = layerByStepId.get(step.id) ?? 0;
    const row = rowByLayer.get(layer) ?? 0;
    rowByLayer.set(layer, row + 1);
    const rowOffset = (maxLayerCount - (layerCounts.get(layer) ?? 1)) / 2;
    positions[step.id] = {
      x: 80 + layer * 340,
      y: 100 + Math.round((row + rowOffset) * 190)
    };
  }

  return positions;
}

export function autoLayoutActionLabels(
  definition: BuilderWorkflowDefinition,
  positions: Readonly<Record<string, CanvasPosition>> = autoLayoutDefinition(definition)
): Record<string, CanvasActionLabelLayout> {
  const layerByStepId = getLayerByPosition(positions);
  const transitionGroupsBySource = new Map<string, WorkflowTransition[]>();

  for (const transition of definition.transitions ?? []) {
    transitionGroupsBySource.set(transition.from, [...(transitionGroupsBySource.get(transition.from) ?? []), transition]);
  }

  const layouts: Record<string, CanvasActionLabelLayout> = {};

  for (const transition of definition.transitions ?? []) {
    const source = positions[transition.from];
    const target = positions[transition.to];

    if (!source || !target) {
      continue;
    }

    const event = transition.event ?? "COMPLETE_STEP";
    const key = getCanvasActionLabelKey({
      source: transition.from,
      target: transition.to,
      event
    });
    const sourceLayer = layerByStepId.get(transition.from) ?? 0;
    const targetLayer = layerByStepId.get(transition.to) ?? sourceLayer;
    const isLoop = targetLayer <= sourceLayer || target.x <= source.x;
    const sourceTransitions = transitionGroupsBySource.get(transition.from) ?? [];
    const siblingIndex = sourceTransitions.indexOf(transition);
    const siblingOffset = (siblingIndex - (sourceTransitions.length - 1) / 2) * 46;

    layouts[key] = {
      icon: getDefaultActionIcon({
        event,
        ...(transition.label ? { label: transition.label } : {})
      }),
      position: isLoop
        ? {
            x: Math.round((source.x + target.x) / 2),
            y: Math.round(Math.max(source.y, target.y) + 138 + siblingIndex * 28)
          }
        : {
            x: Math.round((source.x + target.x) / 2 + 8),
            y: Math.round((source.y + target.y) / 2 + siblingOffset)
          }
    };
  }

  return layouts;
}

export function applyCanvasDependencyEdge(
  definition: BuilderWorkflowDefinition,
  input: {
    readonly source: string;
    readonly target: string;
    readonly type?: WorkflowDependencyRule["type"];
    readonly count?: number;
  }
): BuilderMutationResult {
  if (input.source === input.target) {
    return { definition, changed: false, error: "A step cannot depend on itself." };
  }

  const targetStep = definition.steps.find((step) => step.id === input.target);
  if (!targetStep || !definition.steps.some((step) => step.id === input.source)) {
    return { definition, changed: false, error: "Dependency edge references an unknown step." };
  }

  if ((targetStep.dependencies ?? []).some((dependency) => dependency.stepIds.includes(input.source))) {
    return { definition, changed: false, error: "That dependency edge already exists." };
  }

  return {
    changed: true,
    definition: {
      ...definition,
      steps: definition.steps.map((step) =>
        step.id === input.target
          ? {
              ...step,
              dependencies: [
                ...(step.dependencies ?? []),
                createDependencyRule(input.type ?? "all", [input.source], input.count)
              ]
            }
          : step
      )
    }
  };
}

export function applyCanvasDependencyRule(
  definition: BuilderWorkflowDefinition,
  input: {
    readonly sourceStepIds: readonly string[];
    readonly target: string;
    readonly type?: WorkflowDependencyRule["type"];
    readonly count?: number;
  }
): BuilderMutationResult {
  const target = input.target.trim();
  const sourceStepIds = [...new Set(input.sourceStepIds.map((stepId) => stepId.trim()).filter(Boolean))];

  if (!target || sourceStepIds.length === 0) {
    return { definition, changed: false, error: "Choose at least one prerequisite step." };
  }

  if (sourceStepIds.includes(target)) {
    return { definition, changed: false, error: "A step cannot depend on itself." };
  }

  const stepIds = new Set(definition.steps.map((step) => step.id));
  if (!stepIds.has(target) || sourceStepIds.some((stepId) => !stepIds.has(stepId))) {
    return { definition, changed: false, error: "Dependency rule references an unknown step." };
  }

  const type = input.type ?? "all";
  const atLeastCount = input.count ?? 1;
  if (type === "atLeast") {
    if (!Number.isInteger(atLeastCount) || atLeastCount < 1 || atLeastCount > sourceStepIds.length) {
      return {
        definition,
        changed: false,
        error: "At-least dependency count must be between 1 and the number of prerequisite steps."
      };
    }
  }

  const targetStep = definition.steps.find((step) => step.id === target);
  const normalizedSourceKey = [...sourceStepIds].sort().join("\0");
  if (
    (targetStep?.dependencies ?? []).some((dependency) => {
      const dependencyKey = [...dependency.stepIds].sort().join("\0");
      return (
        dependencyKey === normalizedSourceKey &&
        dependency.type === type &&
        (dependency.type !== "atLeast" || dependency.count === atLeastCount)
      );
    })
  ) {
    return { definition, changed: false, error: "That dependency rule already exists." };
  }

  return {
    changed: true,
    definition: {
      ...definition,
      steps: definition.steps.map((step) =>
        step.id === target
          ? {
              ...step,
              dependencies: [
                ...(step.dependencies ?? []),
                createDependencyRule(type, sourceStepIds, atLeastCount)
              ]
            }
          : step
      )
    }
  };
}

export function applyCanvasTransitionEdge(
  definition: BuilderWorkflowDefinition,
  input: { readonly source: string; readonly target: string; readonly event: string; readonly label?: string }
): BuilderMutationResult {
  if (!definition.steps.some((step) => step.id === input.source) || !definition.steps.some((step) => step.id === input.target)) {
    return { definition, changed: false, error: "Transition edge references an unknown step." };
  }

  const event = input.event.trim() || "COMPLETE_STEP";
  const label = input.label?.trim();

  if (
    (definition.transitions ?? []).some(
      (transition) =>
        transition.from === input.source &&
        transition.to === input.target &&
        (transition.event ?? "COMPLETE_STEP") === event
    )
  ) {
    return { definition, changed: false, error: "That transition edge already exists." };
  }

  return {
    changed: true,
    definition: {
      ...definition,
      transitions: [
        ...(definition.transitions ?? []),
        {
          from: input.source,
          to: input.target,
          ...(event !== "COMPLETE_STEP" ? { event } : {}),
          ...(label ? { label } : {})
        }
      ]
    }
  };
}

export function deleteCanvasEdge(definition: BuilderWorkflowDefinition, edge: BuilderCanvasEdge): BuilderWorkflowDefinition {
  if (edge.kind === "dependency") {
    return {
      ...definition,
      steps: definition.steps.map((step) =>
        step.id === edge.target
          ? {
              ...step,
              dependencies: (step.dependencies ?? [])
                .map((dependency) => ({
                  ...dependency,
                  stepIds: dependency.stepIds.filter((stepId) => stepId !== edge.source)
                }))
                .filter((dependency) => dependency.stepIds.length > 0)
            }
          : step
      )
    };
  }

  return {
    ...definition,
    transitions: (definition.transitions ?? []).filter(
      (transition) =>
        !(
          transition.from === edge.source &&
          transition.to === edge.target &&
          (transition.event ?? "COMPLETE_STEP") === (edge.event ?? "COMPLETE_STEP")
        )
    )
  };
}

export function updateCanvasEdge(
  definition: BuilderWorkflowDefinition,
  originalEdge: BuilderCanvasEdge,
  input: CanvasEdgeUpdateInput
): BuilderMutationResult {
  const source = input.source.trim();
  const target = input.target.trim();

  if (!source || !target) {
    return { definition, changed: false, error: "Edge source and target are required." };
  }

  const withoutOriginalEdge = deleteCanvasEdge(definition, originalEdge);
  const result =
    input.kind === "dependency"
      ? applyCanvasDependencyEdge(withoutOriginalEdge, {
          source,
          target,
          ...(input.dependencyType ? { type: input.dependencyType } : {}),
          ...(input.dependencyCount !== undefined ? { count: input.dependencyCount } : {})
        })
      : applyCanvasTransitionEdge(withoutOriginalEdge, {
          source,
          target,
          event: input.event?.trim() || "COMPLETE_STEP",
          ...(input.label !== undefined ? { label: input.label } : {})
        });

  if (result.error) {
    return { definition, changed: false, error: result.error };
  }

  return { definition: result.definition, changed: true };
}

export function canEditBuilder(status: WorkflowDraftStatus): boolean {
  return status === "draft";
}

export function getDefaultActionIcon(edge?: Pick<BuilderCanvasEdge, "label" | "event">): CanvasActionIcon {
  const text = `${edge?.label ?? ""} ${edge?.event ?? ""}`.toLowerCase();

  if (text.includes("approve")) {
    return "check";
  }

  if (text.includes("reject") || text.includes("deny")) {
    return "x";
  }

  if (text.includes("resubmit") || text.includes("retry") || text.includes("fix")) {
    return "rotate";
  }

  if (text.includes("submit") || text.includes("send")) {
    return "send";
  }

  if (text.includes("alert") || text.includes("escalate")) {
    return "alert";
  }

  return "arrow";
}

function getForwardLayoutTargetsBySource(definition: BuilderWorkflowDefinition): Map<string, string[]> {
  const targetsBySource = new Map<string, string[]>();

  const addTarget = (sourceStepId: string, targetStepId: string) => {
    if (!sourceStepId || !targetStepId || sourceStepId === targetStepId) {
      return;
    }

    targetsBySource.set(sourceStepId, [...(targetsBySource.get(sourceStepId) ?? []), targetStepId]);
  };

  for (const step of definition.steps) {
    for (const dependency of step.dependencies ?? []) {
      for (const sourceStepId of dependency.stepIds) {
        addTarget(sourceStepId, step.id);
      }
    }
  }

  for (const transition of definition.transitions ?? []) {
    if (isFeedbackTransition(definition, transition)) {
      continue;
    }

    addTarget(transition.from, transition.to);
  }

  return targetsBySource;
}

function isFeedbackTransition(definition: BuilderWorkflowDefinition, transition: WorkflowTransition): boolean {
  const targetsBySource = new Map<string, string[]>();
  const addTarget = (sourceStepId: string, targetStepId: string) => {
    targetsBySource.set(sourceStepId, [...(targetsBySource.get(sourceStepId) ?? []), targetStepId]);
  };

  for (const step of definition.steps) {
    for (const dependency of step.dependencies ?? []) {
      for (const sourceStepId of dependency.stepIds) {
        addTarget(sourceStepId, step.id);
      }
    }
  }

  for (const candidate of definition.transitions ?? []) {
    if (candidate === transition) {
      continue;
    }

    addTarget(candidate.from, candidate.to);
  }

  const visited = new Set<string>();
  const stack = [transition.to];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    if (current === transition.from) {
      return true;
    }

    visited.add(current);
    stack.push(...(targetsBySource.get(current) ?? []));
  }

  return false;
}

function getLayerByPosition(positions: Readonly<Record<string, CanvasPosition>>): Map<string, number> {
  const sortedX = [...new Set(Object.values(positions).map((position) => position.x))].sort((left, right) => left - right);
  const layerByX = new Map(sortedX.map((x, index) => [x, index]));
  return new Map(Object.entries(positions).map(([stepId, position]) => [stepId, layerByX.get(position.x) ?? 0]));
}

function getUniqueStepId(definition: BuilderWorkflowDefinition, baseId: string): string {
  const normalizedBaseId = slugifyId(baseId || "new_step");
  const existingIds = new Set(definition.steps.map((step) => step.id));
  let index = 1;
  let candidate = normalizedBaseId;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${normalizedBaseId}_${index}`;
  }

  return candidate;
}

function getCanvasEdgeId(
  kind: BuilderCanvasEdgeKind,
  source: string,
  target: string,
  index: number,
  event?: string
): string {
  return `${kind}:${source}:${target}:${event ?? "COMPLETE_STEP"}:${index}`;
}

function setCanvasActionLabelLayout(
  definition: BuilderWorkflowDefinition,
  key: string,
  layout: CanvasActionLabelLayout
): BuilderWorkflowDefinition {
  return {
    ...definition,
    builder: {
      ...definition.builder,
      canvas: {
        ...definition.builder?.canvas,
        actionLabels: {
          ...(definition.builder?.canvas?.actionLabels ?? {}),
          [key]: layout
        }
      }
    }
  };
}

function getDependencyEdgeLabel(dependency: WorkflowDependencyRule): string {
  if (dependency.type === "atLeast") {
    return `requires ${dependency.count}`;
  }

  if (dependency.stepIds.length === 1) {
    return "requires";
  }

  return dependency.type === "all" ? "requires all" : "requires any";
}

function isLoopTransition(transition: WorkflowTransition, stepIds: ReadonlySet<string>): boolean {
  if (transition.from === transition.to) {
    return true;
  }

  const stepIdList = [...stepIds];
  const fromIndex = stepIdList.indexOf(transition.from);
  const toIndex = stepIdList.indexOf(transition.to);

  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

function createDependencyRule(
  type: WorkflowDependencyRule["type"],
  stepIds: readonly string[],
  count?: number
): WorkflowDependencyRule {
  if (type === "atLeast") {
    return { type, count: count ?? 1, stepIds };
  }

  return { type, stepIds };
}

function slugifyId(value: string): string {
  const slug = value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "new_step";
}

function humanizeId(value: string): string {
  const label = value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!label) {
    return "Workflow";
  }

  return label.replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeStepIdList(stepIds: readonly string[] | string, restStepIds: readonly string[]): string[] {
  const values = Array.isArray(stepIds) ? stepIds : [stepIds, ...restStepIds];
  return [...new Set(values.map((stepId) => stepId.trim()).filter(Boolean))];
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneData(value: WorkflowData): WorkflowData {
  return clonePlain(value);
}

function createRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function renameCanvasMetadataStep(
  metadata: BuilderMetadata | undefined,
  previousStepId: string,
  nextStepId: string
): BuilderMetadata | undefined {
  const nodePositions = metadata?.canvas?.nodes;
  const position = nodePositions?.[previousStepId];
  if (!metadata || !nodePositions || !position || previousStepId === nextStepId) {
    return metadata;
  }

  const rest = Object.fromEntries(
    Object.entries(nodePositions).filter(([stepId]) => stepId !== previousStepId)
  ) as Record<string, CanvasPosition>;

  return {
    ...metadata,
    canvas: {
      ...metadata.canvas,
      nodes: {
        ...rest,
        [nextStepId]: position
      }
    }
  };
}

function deleteCanvasMetadataStep(metadata: BuilderMetadata | undefined, stepId: string): BuilderMetadata | undefined {
  const nodePositions = metadata?.canvas?.nodes;
  if (!metadata || !nodePositions?.[stepId]) {
    return metadata;
  }

  const rest = Object.fromEntries(
    Object.entries(nodePositions).filter(([currentStepId]) => currentStepId !== stepId)
  ) as Record<string, CanvasPosition>;

  return {
    ...metadata,
    canvas: {
      ...metadata.canvas,
      nodes: rest
    }
  };
}
