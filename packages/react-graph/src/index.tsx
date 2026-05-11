import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import ElkConstructor from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import {
  buildWorkflowGraph,
  type FlowForgeGraph,
  type FlowForgeGraphEdge,
  type FlowForgeGraphNode
} from "@flowforge/graph";
import { useOptionalWorkflow } from "@flowforge/react";
import type {
  AvailableWorkflowAction,
  WorkflowDefinition,
  WorkflowHistoryEntry,
  WorkflowInstance,
  WorkflowStepDefinition
} from "@flowforge/core";

export interface WorkflowGraphProps {
  readonly definition?: WorkflowDefinition;
  readonly instance?: WorkflowInstance;
  readonly history?: readonly WorkflowHistoryEntry[];
  readonly availableActions?: readonly AvailableWorkflowAction[];
  readonly direction?: "RIGHT" | "DOWN";
  readonly height?: number | string;
  readonly interactive?: boolean;
  readonly initialSelectedStepId?: string;
  readonly showActions?: boolean;
  readonly onStepClick?: (stepId: string) => void;
  readonly getStepDescription?: (step: WorkflowStepDefinition) => string | undefined;
}

export interface FlowGraphLayoutResult {
  readonly nodes: readonly Node<WorkflowGraphNodeData>[];
  readonly edges: readonly Edge[];
}

export interface WorkflowGraphNodeData extends Record<string, unknown> {
  readonly graphNode: FlowForgeGraphNode;
  readonly label: string;
  readonly status: FlowForgeGraphNode["status"];
  readonly selected: boolean;
  readonly blockedReason?: string;
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 76;
const elk = new (ElkConstructor as unknown as { new(): ELK })();
const nodeTypes = {
  flowforgeStep: memo(FlowForgeStepNode)
};

export function WorkflowGraph(props: WorkflowGraphProps): ReactNode {
  const workflow = useOptionalWorkflow();
  const definition = props.definition ?? workflow?.definition;
  const instance = props.instance ?? workflow?.instance;
  const history = props.history ?? workflow?.history ?? instance?.history ?? [];
  const availableActions = props.availableActions ?? workflow?.availableActions ?? [];
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(props.initialSelectedStepId);
  const graph = useMemo(
    () =>
      definition
        ? buildWorkflowGraph({
            definition,
            history,
            ...(instance ? { instance } : {})
          })
        : { nodes: [], edges: [] },
    [definition, history, instance]
  );
  const resolvedSelectedStepId = useMemo(
    () => getSelectedStepId(graph, selectedStepId, instance),
    [graph, instance, selectedStepId]
  );
  const [layout, setLayout] = useState<FlowGraphLayoutResult>(() =>
    createFallbackLayout(graph, props.direction ?? "RIGHT", resolvedSelectedStepId)
  );

  useEffect(() => {
    if (!resolvedSelectedStepId) {
      return;
    }

    setSelectedStepId(resolvedSelectedStepId);
  }, [resolvedSelectedStepId]);

  useEffect(() => {
    let cancelled = false;

    void layoutWorkflowGraph(graph, {
      direction: props.direction ?? "RIGHT",
      selectedStepId: resolvedSelectedStepId
    }).then((nextLayout) => {
      if (!cancelled) {
        setLayout(nextLayout);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [graph, props.direction, resolvedSelectedStepId]);

  if (!definition) {
    return (
      <section className="ff-panel ff-workflow-graph">
        <h2>Workflow Graph</h2>
        <p className="ff-empty-message">Pass a workflow definition or render inside WorkflowProvider.</p>
      </section>
    );
  }

  const selectedNode = graph.nodes.find((node) => node.id === resolvedSelectedStepId) ?? graph.nodes[0];
  const selectedStep = selectedNode
    ? definition.steps.find((step) => step.id === selectedNode.stepId)
    : undefined;
  const selectedActions = selectedNode
    ? availableActions.filter((action) => action.stepId === selectedNode.stepId)
    : [];
  const outgoingEdges = selectedNode
    ? graph.edges.filter((edge) => edge.source === selectedNode.stepId && edge.kind === "transition")
    : [];
  const selectedHistory = selectedNode
    ? history.filter((entry) => entry.stepId === selectedNode.stepId)
    : [];
  const canSendActions = props.showActions !== false && workflow?.sendAction;

  return (
    <section className="ff-panel ff-workflow-graph ff-workflow-graph-enhanced">
      <header className="ff-graph-header">
        <div>
          <span>Workflow Graph</span>
          <h2>{definition.name}</h2>
        </div>
        <div className="ff-graph-summary" aria-label="Workflow graph summary">
          <strong>{instance?.status ?? "definition"}</strong>
          <span>{instance ? `revision ${instance.revision}` : `${definition.steps.length} steps`}</span>
        </div>
      </header>

      <div className="ff-graph-layout">
        <div className="ff-react-flow-shell" style={{ height: props.height ?? 520 }}>
          <ReactFlow
            colorMode="light"
            edges={[...layout.edges]}
            fitView
            maxZoom={1.4}
            minZoom={0.35}
            nodes={[...layout.nodes]}
            nodeTypes={nodeTypes}
            nodesDraggable={props.interactive ?? false}
            nodesConnectable={false}
            onNodeClick={(_, node) => {
              setSelectedStepId(node.id);
              props.onStepClick?.(node.id);
            }}
            proOptions={{ hideAttribution: true }}
            zoomOnDoubleClick={false}
          >
            <Background gap={18} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="ff-graph-inspector" aria-label="Selected workflow step details">
          {selectedNode && selectedStep ? (
            <>
              <StepInspectorHeader
                description={props.getStepDescription?.(selectedStep)}
                node={selectedNode}
                step={selectedStep}
              />
              <AvailableActionsPanel
                actions={selectedActions}
                canSendActions={Boolean(canSendActions)}
                isLoading={workflow?.isLoading ?? false}
                onSendAction={(action) =>
                  workflow?.sendAction({
                    stepId: action.stepId,
                    type: action.type
                  })
                }
              />
              <BlockedReasonPanel definition={definition} instance={instance} node={selectedNode} step={selectedStep} />
              <OutcomePanel definition={definition} edges={outgoingEdges} />
              <HistoryPanel history={history} selectedHistory={selectedHistory} selectedStepId={selectedNode.stepId} />
            </>
          ) : (
            <p className="ff-empty-message">Select a step to inspect status, blockers, outcomes, and history.</p>
          )}
        </aside>
      </div>

      <GraphLegend />
    </section>
  );
}

export async function layoutWorkflowGraph(
  graph: FlowForgeGraph,
  options: { readonly direction?: "RIGHT" | "DOWN"; readonly selectedStepId?: string | undefined } = {}
): Promise<FlowGraphLayoutResult> {
  const direction = options.direction ?? "RIGHT";
  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.edgeRouting": "ORTHOGONAL"
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    })),
    edges: graph.edges.map((edge): ElkExtendedEdge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  };
  const layoutedGraph = await elk.layout(elkGraph);
  const positionById = new Map<string, { readonly x: number; readonly y: number }>(
    (layoutedGraph.children ?? []).map((node: ElkNode) => [
      node.id,
      {
        x: node.x ?? 0,
        y: node.y ?? 0
      }
    ])
  );

  return {
    nodes: graph.nodes.map((node) => {
      const position = positionById.get(node.id) ?? { x: 0, y: 0 };
      const selected = node.id === options.selectedStepId;

      return {
        id: node.id,
        type: "flowforgeStep",
        position,
        data: {
          graphNode: node,
          label: node.label,
          status: node.status,
          selected,
          ...(node.blockedReason ? { blockedReason: node.blockedReason } : {})
        },
        className: selected ? "ff-flow-node ff-flow-node-selected" : "ff-flow-node",
        style: getNodeStyle(node, selected),
        sourcePosition: direction === "RIGHT" ? Position.Right : Position.Bottom,
        targetPosition: direction === "RIGHT" ? Position.Left : Position.Top
      };
    }),
    edges: graph.edges.map((edge) => toReactFlowEdge(edge, options.selectedStepId))
  };
}

function createFallbackLayout(
  graph: FlowForgeGraph,
  direction: "RIGHT" | "DOWN",
  selectedStepId?: string
): FlowGraphLayoutResult {
  return {
    nodes: graph.nodes.map((node, index) => {
      const selected = node.id === selectedStepId;

      return {
        id: node.id,
        type: "flowforgeStep",
        position: direction === "RIGHT" ? { x: index * 240, y: 0 } : { x: 0, y: index * 120 },
        data: {
          graphNode: node,
          label: node.label,
          status: node.status,
          selected,
          ...(node.blockedReason ? { blockedReason: node.blockedReason } : {})
        },
        className: selected ? "ff-flow-node ff-flow-node-selected" : "ff-flow-node",
        style: getNodeStyle(node, selected)
      };
    }),
    edges: graph.edges.map((edge) => toReactFlowEdge(edge, selectedStepId))
  };
}

function StepInspectorHeader(props: {
  readonly description: string | undefined;
  readonly node: FlowForgeGraphNode;
  readonly step: WorkflowStepDefinition;
}): ReactNode {
  return (
    <section className="ff-graph-inspector-section ff-graph-step-detail">
      <span className="ff-graph-kicker">Selected step</span>
      <h3>{props.step.name}</h3>
      <div className="ff-graph-status-row">
        <StatusPill status={props.node.status} />
        {props.node.terminal ? <span className="ff-graph-pill">terminal</span> : null}
        {props.node.visited ? <span className="ff-graph-pill">visited</span> : null}
      </div>
      <p>{props.description ?? `Step id: ${props.step.id}`}</p>
    </section>
  );
}

function AvailableActionsPanel(props: {
  readonly actions: readonly AvailableWorkflowAction[];
  readonly canSendActions: boolean;
  readonly isLoading: boolean;
  readonly onSendAction: (action: AvailableWorkflowAction) => Promise<unknown> | undefined;
}): ReactNode {
  return (
    <section className="ff-graph-inspector-section">
      <h3>Available Actions</h3>
      {props.actions.length === 0 ? (
        <p className="ff-empty-message">No action is currently enabled for this step.</p>
      ) : (
        <div className="ff-graph-action-strip">
          {props.actions.map((action) => (
            <button
              disabled={!props.canSendActions || props.isLoading}
              key={`${action.stepId}:${action.type}`}
              onClick={() => void props.onSendAction(action)}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function BlockedReasonPanel(props: {
  readonly definition: WorkflowDefinition;
  readonly instance: WorkflowInstance | undefined;
  readonly node: FlowForgeGraphNode;
  readonly step: WorkflowStepDefinition;
}): ReactNode {
  const dependencyProgress = getDependencyProgress(props.definition, props.instance, props.step);
  const missingStepIds = props.node.missingStepIds ?? [];

  if (props.node.status !== "blocked" && dependencyProgress.length === 0) {
    return null;
  }

  return (
    <section className="ff-graph-inspector-section ff-graph-blocked-panel">
      <h3>{props.node.status === "blocked" ? "Why this step is blocked" : "Prerequisites"}</h3>
      {props.node.blockedReason ? <p>{props.node.blockedReason}</p> : null}
      {dependencyProgress.map((progress) => (
        <div className="ff-graph-progress" key={progress.id}>
          <div>
            <strong>{progress.label}</strong>
            <span>
              {progress.completedCount}/{progress.totalCount} complete
            </span>
          </div>
          <meter max={progress.totalCount} min={0} value={progress.completedCount} />
        </div>
      ))}
      {missingStepIds.length > 0 ? (
        <ul className="ff-graph-missing-list">
          {missingStepIds.map((stepId) => (
            <li key={stepId}>{getStepName(props.definition, stepId)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function OutcomePanel(props: {
  readonly definition: WorkflowDefinition;
  readonly edges: readonly FlowForgeGraphEdge[];
}): ReactNode {
  return (
    <section className="ff-graph-inspector-section">
      <h3>Possible Outcomes</h3>
      {props.edges.length === 0 ? (
        <p className="ff-empty-message">No outgoing transition from this step.</p>
      ) : (
        <div className="ff-graph-outcomes">
          {props.edges.map((edge) => (
            <article data-loop={edge.loop ? "true" : "false"} key={edge.id}>
              <span>{edge.label ?? formatEventType(edge.eventType ?? "COMPLETE_STEP")}</span>
              <strong>{getStepName(props.definition, edge.target)}</strong>
              {edge.loop ? <small>retry loop</small> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryPanel(props: {
  readonly history: readonly WorkflowHistoryEntry[];
  readonly selectedHistory: readonly WorkflowHistoryEntry[];
  readonly selectedStepId: string;
}): ReactNode {
  const latestHistory = [...props.history].slice(-5).reverse();

  return (
    <section className="ff-graph-inspector-section">
      <h3>History</h3>
      {props.selectedHistory.length > 0 ? (
        <p className="ff-graph-history-note">
          {props.selectedHistory.length} event{props.selectedHistory.length === 1 ? "" : "s"} recorded for{" "}
          {props.selectedStepId}.
        </p>
      ) : null}
      {latestHistory.length === 0 ? (
        <p className="ff-empty-message">No workflow history yet.</p>
      ) : (
        <ol className="ff-graph-history">
          {latestHistory.map((entry) => (
            <li data-selected={entry.stepId === props.selectedStepId ? "true" : "false"} key={entry.id}>
              <strong>{entry.message}</strong>
              <span>{entry.occurredAt}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GraphLegend(): ReactNode {
  return (
    <div className="ff-graph-legend" aria-label="Workflow graph legend">
      {["active", "completed", "blocked", "waiting", "not_started", "visited"].map((status) => (
        <span data-status={status} key={status}>
          {formatStatus(status)}
        </span>
      ))}
      <span data-edge="dependency">dependency edge</span>
      <span data-edge="transition">transition edge</span>
      <span data-edge="loop">loop edge</span>
    </div>
  );
}

function StatusPill(props: { readonly status: FlowForgeGraphNode["status"] }): ReactNode {
  return (
    <span className="ff-graph-status-pill" data-status={props.status}>
      {formatStatus(props.status)}
    </span>
  );
}

function toReactFlowEdge(edge: FlowForgeGraphEdge, selectedStepId?: string): Edge {
  const style: CSSProperties = {
    stroke: getEdgeColor(edge, selectedStepId),
    strokeWidth: isSelectedEdge(edge, selectedStepId) || edge.status === "available" || edge.status === "completed" ? 2.5 : 1.5
  };

  if (edge.kind === "dependency") {
    style.strokeDasharray = "5 5";
  }

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.loop ? "smoothstep" : "smoothstep",
    label: edge.label,
    animated: edge.status === "available" || edge.loop,
    markerEnd: {
      type: MarkerType.ArrowClosed
    },
    className: [
      "ff-flow-edge",
      `ff-flow-edge-${edge.kind}`,
      `ff-flow-edge-${edge.status}`,
      edge.loop ? "ff-flow-edge-loop" : "",
      isSelectedEdge(edge, selectedStepId) ? "ff-flow-edge-selected" : ""
    ]
      .filter(Boolean)
      .join(" "),
    style
  };
}

function FlowForgeStepNode(props: NodeProps<Node<WorkflowGraphNodeData>>): ReactNode {
  const graphNode = props.data.graphNode;

  return (
    <div className="ff-flow-step-node" data-selected={props.data.selected ? "true" : "false"} data-status={graphNode.status}>
      <Handle position={Position.Left} type="target" />
      <strong>{graphNode.label}</strong>
      <span>{formatStatus(graphNode.status)}</span>
      {graphNode.blockedReason ? <small>{graphNode.blockedReason}</small> : null}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function getNodeStyle(node: FlowForgeGraphNode, selected: boolean): CSSProperties {
  const colors = getNodeColors(node.status);

  return {
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
    border: `2px solid ${selected ? "#24384d" : colors.border}`,
    borderRadius: 8,
    background: colors.background,
    color: "#1d2530",
    fontWeight: 800,
    padding: "10px 12px",
    boxShadow: selected
      ? "0 0 0 4px rgba(36, 56, 77, 0.12), 0 12px 26px rgba(31, 45, 61, 0.16)"
      : node.active
        ? "0 8px 22px rgba(35, 105, 91, 0.16)"
        : "none"
  };
}

function getNodeColors(status: FlowForgeGraphNode["status"]): { readonly background: string; readonly border: string } {
  if (status === "active") {
    return { background: "#eef8f5", border: "#2d7c6f" };
  }

  if (status === "completed") {
    return { background: "#f2f7ec", border: "#5e7f42" };
  }

  if (status === "blocked") {
    return { background: "#fff8e7", border: "#c8a64b" };
  }

  if (status === "failed") {
    return { background: "#fff0ef", border: "#b94b43" };
  }

  if (status === "waiting") {
    return { background: "#f4f7fa", border: "#93a3af" };
  }

  return { background: "#fff", border: "#cad7dd" };
}

function getEdgeColor(edge: FlowForgeGraphEdge, selectedStepId?: string): string {
  if (isSelectedEdge(edge, selectedStepId)) {
    return "#24384d";
  }

  if (edge.status === "available") {
    return "#2d7c6f";
  }

  if (edge.status === "completed" || edge.status === "visited") {
    return "#5e7f42";
  }

  if (edge.status === "blocked") {
    return "#c8a64b";
  }

  return "#aebbc5";
}

function getSelectedStepId(
  graph: FlowForgeGraph,
  selectedStepId: string | undefined,
  instance: WorkflowInstance | undefined
): string | undefined {
  if (selectedStepId && graph.nodes.some((node) => node.id === selectedStepId)) {
    return selectedStepId;
  }

  const firstActiveStepId = instance?.activeStepIds.find((stepId) => graph.nodes.some((node) => node.id === stepId));

  return firstActiveStepId ?? graph.nodes[0]?.id;
}

function getDependencyProgress(
  definition: WorkflowDefinition,
  instance: WorkflowInstance | undefined,
  step: WorkflowStepDefinition
): Array<{
  readonly id: string;
  readonly label: string;
  readonly completedCount: number;
  readonly totalCount: number;
}> {
  return (step.dependencies ?? []).map((dependency, index) => {
    const completedCount = dependency.stepIds.filter((stepId) => instance?.stepStates[stepId]?.status === "completed").length;
    const requiredCount = dependency.type === "atLeast" ? dependency.count : dependency.type === "any" ? 1 : dependency.stepIds.length;

    return {
      id: `${step.id}:${dependency.type}:${index}`,
      label: `${formatDependencyType(dependency.type)} ${dependency.stepIds.map((stepId) => getStepName(definition, stepId)).join(", ")}`,
      completedCount,
      totalCount: requiredCount
    };
  });
}

function getStepName(definition: WorkflowDefinition, stepId: string): string {
  return definition.steps.find((step) => step.id === stepId)?.name ?? stepId;
}

function isSelectedEdge(edge: FlowForgeGraphEdge, selectedStepId?: string): boolean {
  return Boolean(selectedStepId && (edge.source === selectedStepId || edge.target === selectedStepId));
}

function formatDependencyType(type: string): string {
  if (type === "atLeast") {
    return "At least";
  }

  return type === "any" ? "Any of" : "All of";
}

function formatEventType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(status: string): string {
  return status.replace("_", " ");
}
