import type {
  WorkflowDefinition,
  WorkflowHistoryEntry,
  WorkflowInstance,
  WorkflowStepDefinition,
  WorkflowStepState
} from "@guidegraph/core";

export type GuideGraphGraphNodeKind = "step";
export type GuideGraphGraphEdgeKind = "transition" | "dependency";

export type GuideGraphGraphNodeStatus =
  | "active"
  | "completed"
  | "blocked"
  | "waiting"
  | "skipped"
  | "failed"
  | "not_started";

export type GuideGraphGraphEdgeStatus =
  | "available"
  | "completed"
  | "blocked"
  | "visited"
  | "waiting"
  | "inactive";

export interface GuideGraphGraphNode {
  readonly id: string;
  readonly stepId: string;
  readonly label: string;
  readonly kind: GuideGraphGraphNodeKind;
  readonly status: GuideGraphGraphNodeStatus;
  readonly terminal: boolean;
  readonly active: boolean;
  readonly completed: boolean;
  readonly visited: boolean;
  readonly blockedReason?: string;
  readonly missingStepIds?: readonly string[];
}

export interface GuideGraphGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: GuideGraphGraphEdgeKind;
  readonly status: GuideGraphGraphEdgeStatus;
  readonly label?: string;
  readonly eventType?: string;
  readonly loop: boolean;
  readonly visited: boolean;
}

export interface GuideGraphGraph {
  readonly nodes: readonly GuideGraphGraphNode[];
  readonly edges: readonly GuideGraphGraphEdge[];
}

export interface BuildWorkflowGraphOptions {
  readonly includeDependencies?: boolean;
  readonly includeTransitions?: boolean;
  readonly includeHistory?: boolean;
}

export interface BuildWorkflowGraphInput {
  readonly definition: WorkflowDefinition;
  readonly instance?: WorkflowInstance;
  readonly history?: readonly WorkflowHistoryEntry[];
  readonly options?: BuildWorkflowGraphOptions;
}

export function buildWorkflowGraph(input: BuildWorkflowGraphInput): GuideGraphGraph {
  const options = {
    includeDependencies: true,
    includeTransitions: true,
    includeHistory: true,
    ...input.options
  };
  const history = input.history ?? input.instance?.history ?? [];
  const visitedStepIds = options.includeHistory ? getVisitedStepIds(history) : new Set<string>();
  const nodes = input.definition.steps.map((step) =>
    buildGraphNode(input.definition, step, input.instance, visitedStepIds)
  );
  const dependencyPairs = getDependencyEdgePairs(input.definition);
  const edges: GuideGraphGraphEdge[] = [];

  if (options.includeTransitions) {
    edges.push(...buildTransitionEdges(input.definition, input.instance, visitedStepIds, dependencyPairs));
  }

  if (options.includeDependencies) {
    edges.push(...buildDependencyEdges(input.definition, input.instance, visitedStepIds));
  }

  return { nodes, edges };
}

function buildGraphNode(
  definition: WorkflowDefinition,
  step: WorkflowStepDefinition,
  instance: WorkflowInstance | undefined,
  visitedStepIds: ReadonlySet<string>
): GuideGraphGraphNode {
  const state = instance?.stepStates[step.id];
  const status = getGraphNodeStatus(step, state, instance);

  return {
    id: step.id,
    stepId: step.id,
    label: step.name,
    kind: "step",
    status,
    terminal: isTerminalStep(definition, step.id),
    active: status === "active",
    completed: status === "completed",
    visited: visitedStepIds.has(step.id) || status === "completed" || status === "active",
    ...(state?.blockedReason ? { blockedReason: state.blockedReason } : {}),
    ...(state?.missingStepIds ? { missingStepIds: [...state.missingStepIds] } : {})
  };
}

function buildTransitionEdges(
  definition: WorkflowDefinition,
  instance: WorkflowInstance | undefined,
  visitedStepIds: ReadonlySet<string>,
  dependencyPairs: ReadonlySet<string>
): GuideGraphGraphEdge[] {
  return (definition.transitions ?? []).flatMap((transition) => {
    const eventType = transition.event ?? "COMPLETE_STEP";

    if (eventType === "COMPLETE_STEP" && dependencyPairs.has(edgePairKey(transition.from, transition.to))) {
      return [];
    }

    const visited = visitedStepIds.has(transition.from) && visitedStepIds.has(transition.to);

    return [{
      id: `transition:${transition.from}:${transition.to}:${eventType}`,
      source: transition.from,
      target: transition.to,
      kind: "transition",
      status: getTransitionEdgeStatus(transition.from, transition.to, instance, visited),
      ...(transition.label || transition.event ? { label: transition.label ?? transition.event } : {}),
      ...(transition.event ? { eventType: transition.event } : {}),
      loop: createsBackEdge(definition, transition.from, transition.to),
      visited
    }];
  });
}

function buildDependencyEdges(
  definition: WorkflowDefinition,
  instance: WorkflowInstance | undefined,
  visitedStepIds: ReadonlySet<string>
): GuideGraphGraphEdge[] {
  const edges: GuideGraphGraphEdge[] = [];

  for (const step of definition.steps) {
    for (const dependency of step.dependencies ?? []) {
      for (const dependencyStepId of dependency.stepIds) {
        const visited = visitedStepIds.has(dependencyStepId) && visitedStepIds.has(step.id);

        edges.push({
          id: `dependency:${dependencyStepId}:${step.id}:${dependency.type}`,
          source: dependencyStepId,
          target: step.id,
          kind: "dependency",
          status: getDependencyEdgeStatus(dependencyStepId, step.id, instance, visited),
          label: dependency.type === "atLeast" ? `at least ${dependency.count}` : dependency.type,
          loop: false,
          visited
        });
      }
    }
  }

  return edges;
}

function getGraphNodeStatus(
  step: WorkflowStepDefinition,
  state: WorkflowStepState | undefined,
  instance: WorkflowInstance | undefined
): GuideGraphGraphNodeStatus {
  if (instance?.status === "failed" && state?.status !== "completed") {
    return "failed";
  }

  if (!state) {
    return "not_started";
  }

  if (state.status === "not_started" && (step.dependencies?.length ?? 0) > 0) {
    return "waiting";
  }

  return state.status;
}

function getTransitionEdgeStatus(
  fromStepId: string,
  toStepId: string,
  instance: WorkflowInstance | undefined,
  visited: boolean
): GuideGraphGraphEdgeStatus {
  const fromStatus = instance?.stepStates[fromStepId]?.status;
  const toStatus = instance?.stepStates[toStepId]?.status;

  if (fromStatus === "completed" && toStatus === "completed") {
    return "completed";
  }

  if (fromStatus === "completed" && toStatus === "active") {
    return "available";
  }

  if (toStatus === "blocked") {
    return "blocked";
  }

  if (visited) {
    return "visited";
  }

  if (fromStatus === "completed") {
    return "waiting";
  }

  return "inactive";
}

function getDependencyEdgeStatus(
  fromStepId: string,
  toStepId: string,
  instance: WorkflowInstance | undefined,
  visited: boolean
): GuideGraphGraphEdgeStatus {
  const fromStatus = instance?.stepStates[fromStepId]?.status;
  const toState = instance?.stepStates[toStepId];

  if (fromStatus === "completed" && toState?.status === "completed") {
    return "completed";
  }

  if (fromStatus === "completed" && toState?.status === "active") {
    return "available";
  }

  if (toState?.status === "blocked" && toState.missingStepIds?.includes(fromStepId)) {
    return "blocked";
  }

  if (visited) {
    return "visited";
  }

  if (fromStatus === "completed") {
    return "waiting";
  }

  return "inactive";
}

function getVisitedStepIds(history: readonly WorkflowHistoryEntry[]): Set<string> {
  return new Set(history.map((entry) => entry.stepId).filter((stepId): stepId is string => Boolean(stepId)));
}

function getDependencyEdgePairs(definition: WorkflowDefinition): Set<string> {
  const pairs = new Set<string>();

  for (const step of definition.steps) {
    for (const dependency of step.dependencies ?? []) {
      for (const dependencyStepId of dependency.stepIds) {
        pairs.add(edgePairKey(dependencyStepId, step.id));
      }
    }
  }

  return pairs;
}

function edgePairKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function isTerminalStep(definition: WorkflowDefinition, stepId: string): boolean {
  return !(definition.transitions ?? []).some((transition) => transition.from === stepId);
}

function createsBackEdge(definition: WorkflowDefinition, fromStepId: string, toStepId: string): boolean {
  const visited = new Set<string>();
  const stack = [toStepId];

  while (stack.length > 0) {
    const stepId = stack.pop();

    if (!stepId || visited.has(stepId)) {
      continue;
    }

    if (stepId === fromStepId) {
      return true;
    }

    visited.add(stepId);

    for (const transition of definition.transitions ?? []) {
      if (transition.from === stepId) {
        stack.push(transition.to);
      }
    }
  }

  return false;
}
