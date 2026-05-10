import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type {
  AvailableWorkflowAction,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowHistoryEntry,
  WorkflowInstance,
  WorkflowStepState
} from "@flowforge/core";
import type {
  CreateWorkflowInstanceInput,
  CreateWorkflowInstanceResult,
  SendWorkflowEventInput,
  SendWorkflowEventResult
} from "@flowforge/server";

export interface WorkflowClient {
  createInstance(input: CreateWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult>;
  getInstance(instanceId: string): Promise<WorkflowInstance>;
  sendEvent(input: SendWorkflowEventInput): Promise<SendWorkflowEventResult>;
  getHistory(instanceId: string): Promise<WorkflowHistoryEntry[]>;
  getAvailableActions(
    definition: WorkflowDefinition,
    instanceId: string
  ): Promise<AvailableWorkflowAction[]>;
}

export interface WorkflowProviderProps {
  readonly client: WorkflowClient;
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly children: ReactNode;
}

export interface SendWorkflowActionInput {
  readonly stepId: string;
  readonly type?: string;
  readonly idempotencyKey?: string;
}

export interface WorkflowReactState {
  readonly client: WorkflowClient;
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly instance?: WorkflowInstance;
  readonly history: readonly WorkflowHistoryEntry[];
  readonly availableActions: readonly AvailableWorkflowAction[];
  readonly isLoading: boolean;
  readonly error?: Error;
  readonly createInstance: () => Promise<WorkflowInstance>;
  readonly resetInstance: () => Promise<WorkflowInstance>;
  readonly refresh: () => Promise<void>;
  readonly sendAction: (input: SendWorkflowActionInput) => Promise<SendWorkflowEventResult>;
}

const WorkflowContext = createContext<WorkflowReactState | undefined>(undefined);

export function WorkflowProvider(props: WorkflowProviderProps): ReactNode {
  const [instance, setInstance] = useState<WorkflowInstance | undefined>();
  const [history, setHistory] = useState<WorkflowHistoryEntry[]>([]);
  const [availableActions, setAvailableActions] = useState<AvailableWorkflowAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const loadPersistedState = useCallback(
    async (nextInstance: WorkflowInstance): Promise<void> => {
      const [nextHistory, nextActions] = await Promise.all([
        props.client.getHistory(nextInstance.id),
        props.client.getAvailableActions(props.definition, nextInstance.id)
      ]);

      setInstance(nextInstance);
      setHistory([...nextHistory]);
      setAvailableActions([...nextActions]);
    },
    [props.client, props.definition]
  );

  const createOrResetInstance = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);

    try {
      const result = await props.client.createInstance({
        definition: props.definition,
        instanceId: props.instanceId,
        ...(props.actorId ? { actorId: props.actorId } : {})
      });
      await loadPersistedState(result.instance);
      return result.instance;
    } catch (cause) {
      const nextError = normalizeError(cause);
      setError(nextError);
      throw nextError;
    } finally {
      setIsLoading(false);
    }
  }, [loadPersistedState, props.actorId, props.client, props.definition, props.instanceId]);
  const createInstance = createOrResetInstance;
  const resetInstance = createOrResetInstance;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);

    try {
      const nextInstance = await props.client.getInstance(props.instanceId);
      await loadPersistedState(nextInstance);
    } catch (cause) {
      const nextError = normalizeError(cause);
      setError(nextError);
      throw nextError;
    } finally {
      setIsLoading(false);
    }
  }, [loadPersistedState, props.client, props.instanceId]);

  const sendAction = useCallback(
    async (input: SendWorkflowActionInput) => {
      if (!instance) {
        throw new Error("Create or load a workflow instance before sending actions.");
      }

      setIsLoading(true);
      setError(undefined);

      try {
        const event: WorkflowEvent = {
          id: createEventId(instance.revision, input.stepId, input.type ?? "COMPLETE_STEP"),
          instanceId: instance.id,
          type: input.type ?? "COMPLETE_STEP",
          stepId: input.stepId,
          ...(props.actorId ? { actorId: props.actorId } : {}),
          occurredAt: new Date().toISOString()
        };
        const result = await props.client.sendEvent({
          definition: props.definition,
          instanceId: instance.id,
          expectedRevision: instance.revision,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
          event
        });

        await loadPersistedState(result.instance);
        return result;
      } catch (cause) {
        const nextError = normalizeError(cause);
        setError(nextError);
        throw nextError;
      } finally {
        setIsLoading(false);
      }
    },
    [instance, loadPersistedState, props.actorId, props.client, props.definition]
  );

  const value = useMemo(
    () => ({
      client: props.client,
      definition: props.definition,
      instanceId: props.instanceId,
      ...(props.actorId ? { actorId: props.actorId } : {}),
      ...(instance ? { instance } : {}),
      history,
      availableActions,
      isLoading,
      ...(error ? { error } : {}),
      createInstance,
      resetInstance,
      refresh,
      sendAction
    }),
    [
      availableActions,
      createInstance,
      error,
      history,
      instance,
      isLoading,
      props.actorId,
      props.client,
      props.definition,
      props.instanceId,
      refresh,
      resetInstance,
      sendAction
    ]
  );

  return <WorkflowContext.Provider value={value}>{props.children}</WorkflowContext.Provider>;
}

export function useWorkflow(): WorkflowReactState {
  const context = useContext(WorkflowContext);

  if (!context) {
    throw new Error("useWorkflow must be used inside WorkflowProvider.");
  }

  return context;
}

export function useWorkflowActions(): {
  readonly availableActions: readonly AvailableWorkflowAction[];
  readonly sendAction: WorkflowReactState["sendAction"];
  readonly isLoading: boolean;
} {
  const workflow = useWorkflow();

  return {
    availableActions: workflow.availableActions,
    sendAction: workflow.sendAction,
    isLoading: workflow.isLoading
  };
}

export function useWorkflowHistory(): readonly WorkflowHistoryEntry[] {
  return useWorkflow().history;
}

export function CurrentStepCard(): ReactNode {
  const { definition, instance, availableActions, sendAction, isLoading } = useWorkflow();

  if (!instance) {
    return <section className="ff-panel">No workflow instance yet.</section>;
  }

  const stepById = new Map(definition.steps.map((step) => [step.id, step]));
  const activeSteps = instance.activeStepIds
    .map((stepId) => stepById.get(stepId))
    .filter((step) => step !== undefined);

  return (
    <section className="ff-panel">
      <h2>Active Steps</h2>
      <div className="ff-card-list">
        {activeSteps.map((step) => {
          const actions = availableActions.filter((action) => action.stepId === step.id);

          return (
            <article className="ff-step-card" key={step.id}>
              <div>
                <h3>{step.name}</h3>
                <p>{step.id}</p>
              </div>
              <div className="ff-action-row">
                {actions.map((action) => (
                  <button
                    disabled={isLoading}
                    key={`${action.stepId}:${action.type}`}
                    onClick={() =>
                      void sendAction({
                        stepId: action.stepId,
                        type: action.type
                      })
                    }
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function NextActions(): ReactNode {
  const { availableActions, sendAction, isLoading } = useWorkflowActions();

  return (
    <section className="ff-panel">
      <h2>Available Actions</h2>
      <div className="ff-action-list">
        {availableActions.map((action) => (
          <button
            disabled={isLoading}
            key={`${action.stepId}:${action.type}`}
            onClick={() =>
              void sendAction({
                stepId: action.stepId,
                type: action.type
              })
            }
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function BlockedSteps(): ReactNode {
  const { definition, instance } = useWorkflow();

  if (!instance) {
    return null;
  }

  const blockedSteps = definition.steps.filter(
    (step) => instance.stepStates[step.id]?.status === "blocked"
  );

  return (
    <section className="ff-panel">
      <h2>Blocked Steps</h2>
      <div className="ff-card-list">
        {blockedSteps.map((step) => (
          <article className="ff-blocked-step" key={step.id}>
            <strong>{step.name}</strong>
            <span>{instance.stepStates[step.id]?.blockedReason}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowTimeline(): ReactNode {
  const history = useWorkflowHistory();

  return (
    <section className="ff-panel">
      <h2>History</h2>
      <ol className="ff-timeline">
        {history.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.message}</strong>
            <span>{entry.occurredAt}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface DocumentChecklistProps {
  readonly stepIds?: readonly string[];
}

export function DocumentChecklist(props: DocumentChecklistProps): ReactNode {
  const { definition, instance } = useWorkflow();
  const stepIds = props.stepIds ?? ["fillForm", "uploadDocuments", "payFee"];

  if (!instance) {
    return null;
  }

  return (
    <section className="ff-panel">
      <h2>Checklist</h2>
      <ul className="ff-checklist">
        {stepIds.map((stepId) => {
          const step = definition.steps.find((candidate) => candidate.id === stepId);
          const status = instance.stepStates[stepId]?.status ?? "not_started";

          return (
            <li data-status={status} key={stepId}>
              <span>{step?.name ?? stepId}</span>
              <strong>{formatStatus(status)}</strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WorkflowStatusList(): ReactNode {
  const { definition, instance } = useWorkflow();

  if (!instance) {
    return null;
  }

  return (
    <section className="ff-panel">
      <h2>Status</h2>
      <div className="ff-status-list">
        {definition.steps.map((step) => {
          const state = instance.stepStates[step.id] ?? { status: "not_started" };

          return (
            <div className="ff-status-item" data-status={state.status} key={step.id}>
              <span>{step.name}</span>
              <strong>{formatStepState(state)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function createEventId(revision: number, stepId: string, type: string): string {
  return `${stepId}_${type.toLowerCase()}_${revision + 1}_${Date.now()}`;
}

function formatStepState(state: WorkflowStepState): string {
  if (state.status === "blocked" && state.blockedReason) {
    return `${formatStatus(state.status)}: ${state.blockedReason}`;
  }

  return formatStatus(state.status);
}

function formatStatus(status: string): string {
  return status.replace("_", " ");
}

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
