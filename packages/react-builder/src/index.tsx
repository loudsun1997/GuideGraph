import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps
} from "@xyflow/react";
import {
  addCanvasStep,
  applyCanvasDependencyEdge,
  applyCanvasDependencyRule,
  applyCanvasTransitionEdge,
  autoLayoutCanvas,
  builderDefinitionToWorkflowDefinition,
  canEditBuilder,
  canvasActionIconOptions,
  createPreviewSimulation,
  createDefinitionSummary,
  definitionToCanvasModel,
  deleteCanvasEdge,
  deleteStep,
  flattenDependencies,
  getBuilderWarnings,
  getCanvasActionLabelKey,
  getCanvasActionLabelLayout,
  getDefaultActionIcon,
  normalizeBuilderDefinition,
  sendPreviewSimulationAction,
  setCanvasActionLabelIcon,
  setCanvasActionLabelPosition,
  setCanvasNodePosition,
  setStartStep,
  updateCanvasEdge,
  updateStep,
  validateBuilderDefinition,
  type BuilderCanvasEdge,
  type BuilderCanvasEdgeKind,
  type BuilderWorkflowDefinition,
  type CanvasActionIcon,
  type PreviewSimulation,
  type WorkflowDraftStatus
} from "@guidegraph/builder";
import type { WorkflowDefinition, WorkflowDependencyRule } from "@guidegraph/core";

export interface WorkflowBuilderProps {
  readonly initialDefinition: BuilderWorkflowDefinition;
  readonly status?: WorkflowDraftStatus;
  readonly height?: number | string;
  readonly readOnly?: boolean;
  readonly showJsonPreview?: boolean;
  readonly hasPublishedVersions?: boolean;
  readonly onChange?: (definition: BuilderWorkflowDefinition) => void;
  readonly onPublish?: (
    definition: WorkflowDefinition,
    builderDefinition: BuilderWorkflowDefinition
  ) => void | Promise<void>;
}

type EdgeMode = "dependency" | "transition";
type BuilderTab = "canvas" | "form" | "preview";

interface BuilderNodeData extends Record<string, unknown> {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isStart: boolean;
  readonly selected: boolean;
  readonly validationHints: readonly string[];
}

interface ActionLabelData extends Record<string, unknown> {
  readonly edge: BuilderCanvasEdge;
  readonly icon: CanvasActionIcon;
  readonly label: string;
}

interface RequirementGateData extends Record<string, unknown> {
  readonly edge: BuilderCanvasEdge;
  readonly label: string;
}

const nodeTypes = {
  actionLabel: ActionLabelNode,
  requirementGate: RequirementGateNode,
  workflowStep: BuilderStepNode
};

export function WorkflowBuilder(props: WorkflowBuilderProps): ReactNode {
  const [definition, setDefinitionState] = useState(() => normalizeBuilderDefinition(props.initialDefinition));
  const [selectedStepId, setSelectedStepId] = useState(definition.steps[0]?.id ?? "");
  const [selectedEdge, setSelectedEdge] = useState<BuilderCanvasEdge | undefined>();
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("dependency");
  const [activeTab, setActiveTab] = useState<BuilderTab>("canvas");
  const [localError, setLocalError] = useState<string | undefined>();
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "published">("idle");
  const status = props.status ?? "draft";
  const isEditable = !props.readOnly && canEditBuilder(status);
  const validation = useMemo(() => validateBuilderDefinition(definition), [definition]);
  const warnings = useMemo(
    () =>
      getBuilderWarnings({
        definition,
        ...(props.hasPublishedVersions !== undefined ? { hasPublishedVersions: props.hasPublishedVersions } : {})
      }),
    [definition, props.hasPublishedVersions]
  );
  const summary = useMemo(() => createDefinitionSummary({ definition, status }), [definition, status]);
  const graphNodes = useMemo(
    () => createReactFlowNodes(definition, selectedStepId, selectedEdge),
    [definition, selectedEdge, selectedStepId]
  );
  const graphEdges = useMemo(() => createReactFlowEdges(definition, selectedEdge), [definition, selectedEdge]);
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  const selectedStep = definition.steps.find((step) => step.id === selectedStepId);

  useEffect(() => {
    const nextDefinition = normalizeBuilderDefinition(props.initialDefinition);
    setDefinitionState(nextDefinition);
    setSelectedStepId((currentStepId) =>
      nextDefinition.steps.some((step) => step.id === currentStepId)
        ? currentStepId
        : nextDefinition.steps[0]?.id ?? ""
    );
    setSelectedEdge((currentEdge) =>
      currentEdge && definitionToCanvasModel(nextDefinition).edges.some((edge) => isSameCanvasEdge(edge, currentEdge))
        ? currentEdge
        : undefined
    );
  }, [props.initialDefinition]);

  useEffect(() => {
    setNodes(dockRequirementGates(graphNodes, definition));
  }, [definition, graphNodes]);

  const setDefinition = (nextDefinition: BuilderWorkflowDefinition) => {
    const normalized = normalizeBuilderDefinition(nextDefinition);
    setDefinitionState(normalized);
    props.onChange?.(normalized);
  };

  const onGraphNodesChange = (changes: NodeChange[]) => {
    setNodes((currentNodes) => dockRequirementGates(applyNodeChanges(changes, currentNodes), definition));
  };

  const onConnect = (connection: Connection) => {
    if (!isEditable || !connection.source || !connection.target) {
      return;
    }

    if (!isStepNodeId(definition, connection.source) || !isStepNodeId(definition, connection.target)) {
      setLocalError("Connect requirements and actions between workflow step cards.");
      return;
    }

    const result =
      edgeMode === "dependency"
        ? applyCanvasDependencyEdge(definition, {
            source: connection.source,
            target: connection.target
          })
        : applyCanvasTransitionEdge(definition, {
            source: connection.source,
            target: connection.target,
            event: "COMPLETE_STEP",
            label: ""
          });

    setLocalError(result.error);
    setDefinition(result.definition);
    if (!result.error) {
      setSelectedStepId("");
      setSelectedEdge(
        definitionToCanvasModel(result.definition).edges.find(
          (edge) => edge.kind === edgeMode && edge.source === connection.source && edge.target === connection.target
        )
      );
    }
  };

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (String(node.id).startsWith("action-label:")) {
      setSelectedEdge((node.data as ActionLabelData).edge);
      setSelectedStepId("");
      return;
    }

    if (String(node.id).startsWith("requirement-gate:")) {
      setSelectedEdge((node.data as RequirementGateData).edge);
      setSelectedStepId("");
      return;
    }

    setSelectedStepId(node.id);
    setSelectedEdge(undefined);
  };

  const addStepFromHeader = () => {
    const nextDefinition = addCanvasStep(definition);
    const previousStepIds = new Set(definition.steps.map((step) => step.id));
    const addedStep = nextDefinition.steps.find((step) => !previousStepIds.has(step.id));
    setDefinition(nextDefinition);
    setSelectedStepId(addedStep?.id ?? nextDefinition.steps.at(-1)?.id ?? "");
    setSelectedEdge(undefined);
  };

  const publish = async () => {
    setLocalError(undefined);
    if (!validation.valid) {
      setLocalError("Fix validation errors before publishing.");
      return;
    }

    setPublishState("publishing");
    try {
      await props.onPublish?.(builderDefinitionToWorkflowDefinition(definition), definition);
      setPublishState("published");
    } catch (error) {
      setPublishState("idle");
      setLocalError(error instanceof Error ? error.message : "Publishing failed.");
    }
  };

  return (
    <section className="ff-builder" data-status={status}>
      <header className="ff-builder-header">
        <div>
          <span className="ff-builder-kicker">Workflow Builder</span>
          <h2>{definition.name}</h2>
          <p>
            {definition.id} · version {definition.version} · {status}
          </p>
        </div>
        <div className="ff-builder-actions">
          <button
            disabled={!isEditable}
            data-variant="secondary"
            type="button"
            onClick={() => setDefinition(autoLayoutCanvas(definition))}
          >
            Auto-layout
          </button>
          <button disabled={!isEditable} data-variant="secondary" type="button" onClick={addStepFromHeader}>
            Add step
          </button>
          <button disabled={!isEditable || publishState === "publishing"} type="button" onClick={() => void publish()}>
            {publishState === "publishing" ? "Publishing..." : "Publish"}
          </button>
        </div>
      </header>

      <SummaryPanel summary={summary} />

      <section className="ff-builder-panel">
        <div className="ff-builder-tabs">
          {(["canvas", "form", "preview"] as const).map((tab) => (
            <button
              aria-pressed={activeTab === tab}
              data-variant={activeTab === tab ? "primary" : "secondary"}
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {formatLabel(tab)}
            </button>
          ))}
        </div>
        {localError ? <p className="ff-builder-error">{localError}</p> : null}
      </section>

      {activeTab === "canvas" ? (
        <section className="ff-builder-layout">
          <div className="ff-builder-canvas-card">
            <div className="ff-builder-toolbar">
              <div className="ff-builder-mode" aria-label="Edge creation mode">
                <button
                  aria-pressed={edgeMode === "dependency"}
                  disabled={!isEditable}
                  type="button"
                  onClick={() => setEdgeMode("dependency")}
                >
                  Requirement
                </button>
                <button
                  aria-pressed={edgeMode === "transition"}
                  disabled={!isEditable}
                  type="button"
                  onClick={() => setEdgeMode("transition")}
                >
                  Action / outcome
                </button>
              </div>
              <span className="ff-builder-kicker">{isEditable ? "Draft editable" : "Read only"}</span>
            </div>
            <div className="ff-builder-canvas" style={{ "--ff-builder-height": toCssSize(props.height ?? 680) } as CSSProperties}>
              <ReactFlow
                edges={graphEdges}
                fitView
                nodes={nodes}
                nodeTypes={nodeTypes}
                nodesConnectable={isEditable}
                nodesDraggable={isEditable}
                onConnect={onConnect}
                onEdgeClick={(_, edge) => {
                  setSelectedEdge((edge.data as { readonly edge?: BuilderCanvasEdge }).edge);
                  setSelectedStepId("");
                }}
                onNodeClick={onNodeClick}
                onNodeDragStop={(_, node) => {
                  if (!isEditable) {
                    return;
                  }

                  if (String(node.id).startsWith("action-label:")) {
                    const edge = (node.data as ActionLabelData).edge;
                    setDefinition(setCanvasActionLabelPosition(definition, edge, node.position));
                    return;
                  }

                  if (String(node.id).startsWith("requirement-gate:")) {
                    return;
                  }

                  setDefinition(setCanvasNodePosition(definition, node.id, node.position));
                }}
                onNodesChange={onGraphNodesChange}
              >
                <MiniMap pannable zoomable />
                <Controls />
                <Background />
              </ReactFlow>
            </div>
          </div>
          <BuilderInspector
            definition={definition}
            edge={selectedEdge}
            isEditable={isEditable}
            selectedStepId={selectedStep?.id}
            onDefinitionChange={setDefinition}
            onLocalError={setLocalError}
            onSelectedEdgeChange={setSelectedEdge}
            onSelectedStepChange={(stepId) => {
              setSelectedStepId(stepId);
              setSelectedEdge(undefined);
            }}
          />
        </section>
      ) : null}

      {activeTab === "form" ? (
        <FormEditor definition={definition} isEditable={isEditable} onDefinitionChange={setDefinition} onLocalError={setLocalError} />
      ) : null}

      {activeTab === "preview" ? (
        <PreviewPanel definition={definition} />
      ) : null}

      <ValidationPanel errors={validation.errors} warnings={warnings} />

      {props.showJsonPreview ?? true ? <JsonPreview definition={definition} /> : null}
    </section>
  );
}

function SummaryPanel(props: { readonly summary: ReturnType<typeof createDefinitionSummary> }): ReactNode {
  const cards = [
    ["Steps", props.summary.stepCount],
    ["Starts", props.summary.startStepCount],
    ["Dependencies", props.summary.dependencyCount],
    ["Transitions", props.summary.transitionCount],
    ["Loops", props.summary.loopTransitionCount],
    ["Valid", props.summary.valid ? "yes" : "no"]
  ] as const;

  return (
    <section className="ff-builder-summary" aria-label="Workflow definition summary">
      {cards.map(([label, value]) => (
        <article className="ff-builder-summary-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function BuilderInspector(props: {
  readonly definition: BuilderWorkflowDefinition;
  readonly edge: BuilderCanvasEdge | undefined;
  readonly isEditable: boolean;
  readonly selectedStepId: string | undefined;
  readonly onDefinitionChange: (definition: BuilderWorkflowDefinition) => void;
  readonly onLocalError: (error: string | undefined) => void;
  readonly onSelectedEdgeChange: (edge: BuilderCanvasEdge | undefined) => void;
  readonly onSelectedStepChange: (stepId: string) => void;
}): ReactNode {
  const selectedStep = props.definition.steps.find((step) => step.id === props.selectedStepId);

  return (
    <aside className="ff-builder-inspector" aria-label="Workflow builder inspector">
      <h3>Inspector</h3>
      <Field label="Selected step">
        <select
          value={selectedStep?.id ?? ""}
          onChange={(event) => {
            props.onSelectedStepChange(event.target.value);
            props.onSelectedEdgeChange(undefined);
          }}
        >
          <option value="">Choose a step</option>
          {props.definition.steps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name} ({step.id})
            </option>
          ))}
        </select>
      </Field>
      {selectedStep ? (
        <StepInspector
          definition={props.definition}
          isEditable={props.isEditable}
          stepId={selectedStep.id}
          onDefinitionChange={props.onDefinitionChange}
          onLocalError={props.onLocalError}
          onSelectedStepChange={props.onSelectedStepChange}
        />
      ) : null}
      {props.edge ? (
        <EdgeInspector
          definition={props.definition}
          edge={props.edge}
          isEditable={props.isEditable}
          onDefinitionChange={props.onDefinitionChange}
          onDelete={() => {
            props.onDefinitionChange(deleteCanvasEdge(props.definition, props.edge!));
            props.onSelectedEdgeChange(undefined);
          }}
          onLocalError={props.onLocalError}
          onSelectedEdgeChange={props.onSelectedEdgeChange}
        />
      ) : null}
      {!selectedStep && !props.edge ? <p>Select a step, requirement gate, action label, or edge.</p> : null}
    </aside>
  );
}

function StepInspector(props: {
  readonly definition: BuilderWorkflowDefinition;
  readonly isEditable: boolean;
  readonly stepId: string;
  readonly onDefinitionChange: (definition: BuilderWorkflowDefinition) => void;
  readonly onLocalError: (error: string | undefined) => void;
  readonly onSelectedStepChange: (stepId: string) => void;
}): ReactNode {
  const step = props.definition.steps.find((entry) => entry.id === props.stepId);
  const targetOptions = props.definition.steps.filter((entry) => entry.id !== props.stepId);
  const targetOptionsKey = targetOptions.map((option) => option.id).join("\0");
  const [requirementSourceIds, setRequirementSourceIds] = useState<string[]>(
    targetOptions[0]?.id ? [targetOptions[0].id] : []
  );
  const [requirementType, setRequirementType] = useState<WorkflowDependencyRule["type"]>("all");
  const [requirementCount, setRequirementCount] = useState(1);
  const [transitionTargetStepId, setTransitionTargetStepId] = useState(targetOptions[0]?.id ?? "");
  const [transitionEvent, setTransitionEvent] = useState("COMPLETE_STEP");
  const [transitionLabel, setTransitionLabel] = useState("");

  useEffect(() => {
    const validTargetIds = new Set(targetOptions.map((option) => option.id));
    setRequirementSourceIds((currentSourceIds) => {
      const stillValidSourceIds = currentSourceIds.filter((stepId) => validTargetIds.has(stepId));
      return stillValidSourceIds.length > 0 ? stillValidSourceIds : targetOptions[0]?.id ? [targetOptions[0].id] : [];
    });
    setTransitionTargetStepId((currentTargetStepId) =>
      validTargetIds.has(currentTargetStepId) ? currentTargetStepId : targetOptions[0]?.id ?? ""
    );
  }, [targetOptionsKey]);

  if (!step) {
    return null;
  }

  const renameStep = (nextId: string) => {
    const trimmedId = nextId.trim();
    if (!trimmedId) {
      props.onLocalError("Step id is required.");
      return;
    }
    if (trimmedId !== step.id && props.definition.steps.some((entry) => entry.id === trimmedId)) {
      props.onLocalError(`Step id "${trimmedId}" already exists.`);
      return;
    }
    props.onLocalError(undefined);
    props.onDefinitionChange(
      updateStep(props.definition, step.id, getStepUpdateInput(trimmedId, step.name, step.description))
    );
    props.onSelectedStepChange(trimmedId);
  };

  return (
    <section className="ff-builder-inspector-section">
      <h4>Step</h4>
      <Field label="Step id">
        <input disabled={!props.isEditable} value={step.id} onChange={(event) => renameStep(event.target.value)} />
      </Field>
      <Field label="Title">
        <input
          disabled={!props.isEditable}
          value={step.name}
          onChange={(event) =>
            props.onDefinitionChange(
              updateStep(props.definition, step.id, getStepUpdateInput(step.id, event.target.value, step.description))
            )
          }
        />
      </Field>
      <Field label="Description">
        <textarea
          disabled={!props.isEditable}
          value={step.description ?? ""}
          onChange={(event) =>
            props.onDefinitionChange(
              updateStep(props.definition, step.id, {
                id: step.id,
                name: step.name,
                description: event.target.value
              })
            )
          }
        />
      </Field>
      <label className="ff-builder-checkbox">
        <input
          checked={props.definition.startStepIds.includes(step.id)}
          disabled={!props.isEditable}
          type="checkbox"
          onChange={(event) => props.onDefinitionChange(setStartStep(props.definition, step.id, event.target.checked))}
        />
        Start step
      </label>
      <section className="ff-builder-inspector-section">
        <h4>Create requirement</h4>
        <Field label="Prerequisite steps">
          <select
            disabled={!props.isEditable || targetOptions.length === 0}
            multiple
            size={Math.min(6, Math.max(2, targetOptions.length))}
            value={requirementSourceIds}
            onChange={(event) =>
              setRequirementSourceIds(
                Array.from(event.currentTarget.selectedOptions, (option) => option.value)
              )
            }
          >
            {targetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.id})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requirement rule">
          <select
            disabled={!props.isEditable}
            value={requirementType}
            onChange={(event) => setRequirementType(event.target.value as WorkflowDependencyRule["type"])}
          >
            <option value="all">All selected steps</option>
            <option value="any">Any selected step</option>
            <option value="atLeast">At least a count</option>
          </select>
        </Field>
        {requirementType === "atLeast" ? (
          <Field label="Required count">
            <input
              disabled={!props.isEditable}
              min={1}
              max={Math.max(1, requirementSourceIds.length)}
              type="number"
              value={requirementCount}
              onChange={(event) => setRequirementCount(Number(event.target.value))}
            />
          </Field>
        ) : null}
        <div className="ff-builder-button-row">
          <button
            disabled={!props.isEditable || requirementSourceIds.length === 0}
            data-variant="secondary"
            type="button"
            onClick={() => {
              const result = applyCanvasDependencyRule(props.definition, {
                sourceStepIds: requirementSourceIds,
                target: step.id,
                type: requirementType,
                ...(requirementType === "atLeast" ? { count: requirementCount } : {})
              });
              props.onLocalError(result.error);
              props.onDefinitionChange(result.definition);
            }}
          >
            Add requirement rule
          </button>
        </div>
      </section>
      <section className="ff-builder-inspector-section">
        <h4>Create action / outcome</h4>
        <Field label="Action target">
          <select
            disabled={!props.isEditable || targetOptions.length === 0}
            value={transitionTargetStepId}
            onChange={(event) => setTransitionTargetStepId(event.target.value)}
          >
            {targetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.id})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Action event">
          <input disabled={!props.isEditable} value={transitionEvent} onChange={(event) => setTransitionEvent(event.target.value)} />
        </Field>
        <Field label="Action label">
          <input disabled={!props.isEditable} value={transitionLabel} onChange={(event) => setTransitionLabel(event.target.value)} />
        </Field>
        <button
          disabled={!props.isEditable || !transitionTargetStepId || transitionEvent.trim().length === 0}
          data-variant="secondary"
          type="button"
          onClick={() => {
            const result = applyCanvasTransitionEdge(props.definition, {
              source: step.id,
              target: transitionTargetStepId,
              event: transitionEvent,
              label: transitionLabel
            });
            props.onLocalError(result.error);
            props.onDefinitionChange(result.definition);
          }}
        >
          Add action / outcome
        </button>
      </section>
      <button
        disabled={!props.isEditable}
        data-variant="danger"
        type="button"
        onClick={() => {
          const result = deleteStep(props.definition, step.id);
          props.onLocalError(result.error);
          props.onDefinitionChange(result.definition);
        }}
      >
        Delete step
      </button>
    </section>
  );
}

function EdgeInspector(props: {
  readonly definition: BuilderWorkflowDefinition;
  readonly edge: BuilderCanvasEdge;
  readonly isEditable: boolean;
  readonly onDefinitionChange: (definition: BuilderWorkflowDefinition) => void;
  readonly onDelete: () => void;
  readonly onLocalError: (error: string | undefined) => void;
  readonly onSelectedEdgeChange: (edge: BuilderCanvasEdge | undefined) => void;
}): ReactNode {
  const [kind, setKind] = useState<BuilderCanvasEdgeKind>(props.edge.kind);
  const [source, setSource] = useState(props.edge.source);
  const [target, setTarget] = useState(props.edge.target);
  const [event, setEvent] = useState(props.edge.event ?? "COMPLETE_STEP");
  const [label, setLabel] = useState(props.edge.label ?? "");
  const [actionIcon, setActionIcon] = useState<CanvasActionIcon>(
    getCanvasActionLabelLayout(props.definition, props.edge)?.icon ?? getDefaultActionIcon(props.edge)
  );

  useEffect(() => {
    setKind(props.edge.kind);
    setSource(props.edge.source);
    setTarget(props.edge.target);
    setEvent(props.edge.event ?? "COMPLETE_STEP");
    setLabel(props.edge.label ?? "");
    setActionIcon(getCanvasActionLabelLayout(props.definition, props.edge)?.icon ?? getDefaultActionIcon(props.edge));
  }, [props.definition, props.edge]);

  const applyChanges = () => {
    const result = updateCanvasEdge(props.definition, props.edge, {
      kind,
      source,
      target,
      event,
      label
    });
    props.onLocalError(result.error);

    if (result.error) {
      return;
    }

    const updatedEdge = definitionToCanvasModel(result.definition).edges.find(
      (edge) =>
        edge.kind === kind &&
        edge.source === source &&
        edge.target === target &&
        (kind === "dependency" || edge.event === (event.trim() || "COMPLETE_STEP"))
    );
    const nextDefinition =
      kind === "transition" && updatedEdge
        ? setCanvasActionLabelIcon(result.definition, updatedEdge, actionIcon)
        : result.definition;

    props.onDefinitionChange(nextDefinition);
    props.onSelectedEdgeChange(updatedEdge);
  };

  const stepOptions = props.definition.steps;

  return (
    <section className="ff-builder-inspector-section">
      <h4>Edge</h4>
      <Field label="Type">
        <select disabled={!props.isEditable} value={kind} onChange={(changeEvent) => setKind(changeEvent.target.value as BuilderCanvasEdgeKind)}>
          <option value="dependency">Requirement</option>
          <option value="transition">Action / outcome</option>
        </select>
      </Field>
      <Field label="From">
        <select disabled={!props.isEditable} value={source} onChange={(changeEvent) => setSource(changeEvent.target.value)}>
          {stepOptions.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name} ({step.id})
            </option>
          ))}
        </select>
      </Field>
      <Field label="To">
        <select disabled={!props.isEditable} value={target} onChange={(changeEvent) => setTarget(changeEvent.target.value)}>
          {stepOptions.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name} ({step.id})
            </option>
          ))}
        </select>
      </Field>
      {kind === "transition" ? (
        <>
          <Field label="Action event">
            <input disabled={!props.isEditable} value={event} onChange={(changeEvent) => setEvent(changeEvent.target.value)} />
          </Field>
          <Field label="Action label">
            <input disabled={!props.isEditable} value={label} onChange={(changeEvent) => setLabel(changeEvent.target.value)} />
          </Field>
          <Field label="Action icon">
            <select disabled={!props.isEditable} value={actionIcon} onChange={(changeEvent) => setActionIcon(changeEvent.target.value as CanvasActionIcon)}>
              {canvasActionIconOptions.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <div className="ff-builder-button-row">
        <button disabled={!props.isEditable} data-variant="secondary" type="button" onClick={applyChanges}>
          Apply
        </button>
        <button disabled={!props.isEditable} data-variant="danger" type="button" onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </section>
  );
}

function FormEditor(props: {
  readonly definition: BuilderWorkflowDefinition;
  readonly isEditable: boolean;
  readonly onDefinitionChange: (definition: BuilderWorkflowDefinition) => void;
  readonly onLocalError: (error: string | undefined) => void;
}): ReactNode {
  const dependencies = flattenDependencies(props.definition);

  return (
    <section className="ff-builder-panel">
      <h3>Definition form</h3>
      <div className="ff-builder-button-row">
        <button disabled={!props.isEditable} data-variant="secondary" type="button" onClick={() => props.onDefinitionChange(addCanvasStep(props.definition))}>
          Add step
        </button>
      </div>
      <div className="ff-builder-inspector-section">
        <h4>Steps</h4>
        {props.definition.steps.map((step) => (
          <div className="ff-builder-inspector-section" key={step.id}>
            <strong>{step.name}</strong>
            <span>{step.id}</span>
            <button
              disabled={!props.isEditable}
              data-variant="danger"
              type="button"
              onClick={() => {
                const result = deleteStep(props.definition, step.id);
                props.onLocalError(result.error);
                props.onDefinitionChange(result.definition);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="ff-builder-inspector-section">
        <h4>Dependencies</h4>
        {dependencies.length === 0 ? <p>No dependencies yet.</p> : null}
        {dependencies.map((dependency, index) => (
          <p key={`${dependency.targetStepId}:${index}`}>
            {dependency.targetStepId} waits for {dependency.sourceStepIds.join(", ")} ({dependency.type})
          </p>
        ))}
      </div>
    </section>
  );
}

function PreviewPanel(props: { readonly definition: BuilderWorkflowDefinition }): ReactNode {
  const [simulation, setSimulation] = useState(() => createSafeSimulation(props.definition));

  useEffect(() => {
    setSimulation(createSafeSimulation(props.definition));
  }, [props.definition]);

  return (
    <section className="ff-builder-panel">
      <h3>Preview / simulation</h3>
      {simulation.error ? <p className="ff-builder-error">{simulation.error}</p> : null}
      {simulation.preview ? (
        <>
          <p>
            Revision {simulation.preview.instance.revision}; active steps:{" "}
            {simulation.preview.instance.activeStepIds.join(", ") || "none"}
          </p>
          <div className="ff-builder-button-row">
            {simulation.preview.availableActions.map((action) => (
              <button
                key={`${action.stepId}:${action.type}`}
                type="button"
                onClick={() =>
                  setSimulation({
                    preview: sendPreviewSimulationAction({
                      definition: props.definition,
                      simulation: simulation.preview!,
                      action
                    })
                  })
                }
              >
                {action.label}
              </button>
            ))}
          </div>
          <ol>
            {simulation.preview.history.map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

function ValidationPanel(props: { readonly errors: readonly string[]; readonly warnings: readonly { readonly code: string; readonly message: string }[] }): ReactNode {
  return (
    <section className="ff-builder-panel ff-builder-validation" data-valid={props.errors.length === 0 ? "true" : "false"}>
      <h3>Validation</h3>
      {props.errors.length === 0 ? <p>No validation errors.</p> : null}
      {props.errors.length > 0 ? (
        <ul>
          {props.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {props.warnings.length > 0 ? (
        <>
          <h4>Warnings</h4>
          <ul className="ff-builder-warning-list">
            {props.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function JsonPreview(props: { readonly definition: BuilderWorkflowDefinition }): ReactNode {
  return (
    <section className="ff-builder-json">
      <h3>Generated WorkflowDefinition</h3>
      <pre>{JSON.stringify(builderDefinitionToWorkflowDefinition(props.definition), null, 2)}</pre>
    </section>
  );
}

function BuilderStepNode(props: NodeProps<Node<BuilderNodeData>>): ReactNode {
  return (
    <div className="ff-builder-node" data-selected={props.data.selected ? "true" : "false"} data-start={props.data.isStart ? "true" : "false"}>
      <Handle position={Position.Left} type="target" />
      <strong>{props.data.label}</strong>
      <span>{props.data.id}</span>
      {props.data.validationHints.length > 0 ? <small>Validation hint</small> : null}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function ActionLabelNode(props: NodeProps<Node<ActionLabelData>>): ReactNode {
  const color = getIconColor(props.data.icon);

  return (
    <div className="ff-builder-action-label" style={{ borderColor: color, color }}>
      <Handle position={Position.Left} type="target" />
      {props.data.label}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function RequirementGateNode(props: NodeProps<Node<RequirementGateData>>): ReactNode {
  return (
    <div className="ff-builder-gate-node">
      <Handle position={Position.Left} type="target" />
      {props.data.label}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function Field(props: { readonly children: ReactNode; readonly label: string }): ReactNode {
  return (
    <label className="ff-builder-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function createReactFlowNodes(
  definition: BuilderWorkflowDefinition,
  selectedStepId: string,
  selectedEdge: BuilderCanvasEdge | undefined
): Node[] {
  const canvasModel = definitionToCanvasModel(definition);
  const stepNodes: Node<BuilderNodeData>[] = canvasModel.nodes.map((node) => ({
    id: node.id,
    type: "workflowStep",
    position: node.position,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      id: node.id,
      label: node.label,
      ...(node.description ? { description: node.description } : {}),
      isStart: node.isStart,
      selected: node.id === selectedStepId,
      validationHints: node.validationHints
    }
  }));
  const positionByStepId = new Map(canvasModel.nodes.map((node) => [node.id, node.position]));
  const gateNodes: Node<RequirementGateData>[] = definition.steps.flatMap((step) =>
    (step.dependencies ?? []).flatMap((dependency, dependencyIndex) => {
      const visibleSourceStepIds = getVisibleDependencySourceStepIds(definition, step.id, dependency);
      if (visibleSourceStepIds.length === 0) {
        return [];
      }

      const targetPosition = positionByStepId.get(step.id) ?? { x: 320, y: 80 };
      const edge: BuilderCanvasEdge = {
        id: `dependency:${visibleSourceStepIds[0] ?? ""}:${step.id}:${dependencyIndex}`,
        source: visibleSourceStepIds[0] ?? "",
        target: step.id,
        kind: "dependency",
        label: getRequirementRuleLabel(dependency.type, visibleSourceStepIds.length, dependency.type === "atLeast" ? dependency.count : undefined),
        dependencyIndex
      };

      return [{
        id: getRequirementGateId(step.id, dependencyIndex),
        type: "requirementGate",
        position: { x: targetPosition.x - 54, y: targetPosition.y + dependencyIndex * 56 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          edge,
          label: edge.label ?? "requires"
        },
        draggable: false
      }];
    })
  );
  const actionLabelNodes: Node<ActionLabelData>[] = canvasModel.edges
    .filter((edge) => edge.kind === "transition")
    .filter((edge) => !isDependencyBackedCompleteTransition(definition, edge))
    .map((edge) => {
      const layout = getCanvasActionLabelLayout(definition, edge);
      const icon = layout?.icon ?? getDefaultActionIcon(edge);

      return {
        id: getActionLabelNodeId(edge),
        type: "actionLabel",
        position: layout?.position ?? getDefaultActionLabelPosition(edge, positionByStepId),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          edge,
          icon,
          label: edge.label ?? edge.event ?? "Complete"
        },
        selected: selectedEdge?.id === edge.id
      };
    });

  return [...stepNodes, ...gateNodes, ...actionLabelNodes];
}

function createReactFlowEdges(
  definition: BuilderWorkflowDefinition,
  selectedEdge: BuilderCanvasEdge | undefined
): Edge[] {
  const canvasModel = definitionToCanvasModel(definition);

  return [
    ...definition.steps.flatMap((step) =>
      (step.dependencies ?? []).flatMap((dependency, dependencyIndex) => {
        const visibleSourceStepIds = getVisibleDependencySourceStepIds(definition, step.id, dependency);
        if (visibleSourceStepIds.length === 0) {
          return [];
        }

        const gateId = getRequirementGateId(step.id, dependencyIndex);
        return visibleSourceStepIds.map((sourceStepId, sourceIndex) => {
          const edge: BuilderCanvasEdge = {
            id: `dependency:${sourceStepId}:${step.id}:${dependencyIndex}`,
            source: sourceStepId,
            target: step.id,
            kind: "dependency",
            label: getRequirementRuleLabel(dependency.type, visibleSourceStepIds.length, dependency.type === "atLeast" ? dependency.count : undefined),
            dependencyIndex
          };

          return {
            id: `${edge.id}:gate-input:${sourceIndex}`,
            source: sourceStepId,
            target: gateId,
            type: "smoothstep",
            style: {
              stroke: selectedEdge?.id === edge.id ? "#1d4ed8" : "#5d83a8",
              strokeWidth: selectedEdge?.id === edge.id ? 3.5 : 2.5
            },
            data: { edge }
          };
        });
      })
    ),
    ...canvasModel.edges
      .filter((edge) => edge.kind === "transition")
      .filter((edge) => !isDependencyBackedCompleteTransition(definition, edge))
      .flatMap((edge) => {
        const icon = getCanvasActionLabelLayout(definition, edge)?.icon ?? getDefaultActionIcon(edge);
        const color = getIconColor(icon);
        const actionNodeId = getActionLabelNodeId(edge);
        const strokeWidth = selectedEdge?.id === edge.id ? 3.5 : 2.5;

        return [
          {
            id: `${edge.id}:action-input`,
            source: edge.source,
            target: actionNodeId,
            type: "smoothstep",
            animated: true,
            style: { stroke: color, strokeWidth },
            data: { edge }
          },
          {
            id: `${edge.id}:action-output`,
            source: actionNodeId,
            target: edge.target,
            type: "smoothstep",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color },
            style: { stroke: color, strokeWidth },
            data: { edge }
          }
        ] satisfies Edge[];
      })
  ];
}

function dockRequirementGates(nodes: Node[], definition: BuilderWorkflowDefinition): Node[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const gatePositions = new Map<string, { readonly x: number; readonly y: number }>();

  for (const step of definition.steps) {
    const stepNode = nodeById.get(step.id);
    if (!stepNode) {
      continue;
    }

    for (const [dependencyIndex] of (step.dependencies ?? []).entries()) {
      gatePositions.set(getRequirementGateId(step.id, dependencyIndex), {
        x: stepNode.position.x - 54,
        y: stepNode.position.y + dependencyIndex * 56
      });
    }
  }

  return nodes.map((node) => {
    const nextPosition = gatePositions.get(node.id);
    return nextPosition ? { ...node, position: nextPosition } : node;
  });
}

function createSafeSimulation(propsDefinition: BuilderWorkflowDefinition): {
  readonly error?: string;
  readonly preview?: PreviewSimulation;
} {
  try {
    return { preview: createPreviewSimulation(propsDefinition) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Preview simulation could not start."
    };
  }
}

function getStepUpdateInput(
  id: string,
  name: string,
  description: string | undefined
): { readonly id: string; readonly name: string; readonly description?: string } {
  return {
    id,
    name,
    ...(description !== undefined ? { description } : {})
  };
}

function isStepNodeId(definition: BuilderWorkflowDefinition, nodeId: string): boolean {
  return definition.steps.some((step) => step.id === nodeId);
}

function getRequirementGateId(targetStepId: string, dependencyIndex: number): string {
  return `requirement-gate:${targetStepId}:${dependencyIndex}`;
}

function isSameCanvasEdge(left: BuilderCanvasEdge, right: BuilderCanvasEdge): boolean {
  return (
    left.kind === right.kind &&
    left.source === right.source &&
    left.target === right.target &&
    (left.event ?? "COMPLETE_STEP") === (right.event ?? "COMPLETE_STEP") &&
    left.dependencyIndex === right.dependencyIndex
  );
}

function getActionLabelNodeId(edge: Pick<BuilderCanvasEdge, "source" | "target" | "event">): string {
  return `action-label:${getCanvasActionLabelKey(edge)}`;
}

function getDefaultActionLabelPosition(
  edge: Pick<BuilderCanvasEdge, "source" | "target">,
  positionByStepId: ReadonlyMap<string, { readonly x: number; readonly y: number }>
): { readonly x: number; readonly y: number } {
  const sourcePosition = positionByStepId.get(edge.source) ?? { x: 80, y: 80 };
  const targetPosition = positionByStepId.get(edge.target) ?? { x: sourcePosition.x + 300, y: sourcePosition.y };

  return {
    x: Math.round((sourcePosition.x + targetPosition.x) / 2 + 24),
    y: Math.round((sourcePosition.y + targetPosition.y) / 2 + 12)
  };
}

function isDependencyBackedCompleteTransition(
  definition: BuilderWorkflowDefinition,
  edge: Pick<BuilderCanvasEdge, "source" | "target" | "event" | "label">
): boolean {
  if ((edge.event ?? "COMPLETE_STEP") !== "COMPLETE_STEP") {
    return false;
  }

  if (edge.label?.trim() && edge.label.trim() !== "Complete") {
    return false;
  }

  const targetStep = definition.steps.find((step) => step.id === edge.target);
  return (targetStep?.dependencies ?? []).some(
    (dependency) => dependency.stepIds.length > 1 && dependency.stepIds.includes(edge.source)
  );
}

function getVisibleDependencySourceStepIds(
  definition: BuilderWorkflowDefinition,
  targetStepId: string,
  dependency: WorkflowDependencyRule
): readonly string[] {
  return dependency.stepIds.filter((sourceStepId) => !hasExplicitActionTransition(definition, sourceStepId, targetStepId));
}

function hasExplicitActionTransition(
  definition: BuilderWorkflowDefinition,
  sourceStepId: string,
  targetStepId: string
): boolean {
  return (definition.transitions ?? []).some(
    (transition) =>
      transition.from === sourceStepId &&
      transition.to === targetStepId &&
      ((transition.event ?? "COMPLETE_STEP") !== "COMPLETE_STEP" || Boolean(transition.label?.trim()))
  );
}

function getRequirementRuleLabel(type: "all" | "any" | "atLeast", sourceCount: number, count?: number): string {
  if (type === "atLeast") {
    return `requires ${count ?? 1}`;
  }

  if (type === "any") {
    return "requires any";
  }

  return sourceCount > 1 ? "requires all" : "requires";
}

function getIconColor(icon: CanvasActionIcon): string {
  const colors: Record<CanvasActionIcon, string> = {
    alert: "#ea580c",
    arrow: "#2563eb",
    check: "#16a34a",
    rotate: "#7c3aed",
    send: "#0f766e",
    x: "#dc2626"
  };

  return colors[icon];
}

function toCssSize(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
