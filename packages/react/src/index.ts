import { useCallback, useState } from "react";
import type { RunnableWorkflowStep, WorkflowId, WorkflowRunResult } from "@flowforge/core";
import { runWorkflow } from "@flowforge/core";

export interface RunnableWorkflowDefinition<TInput = unknown> {
  readonly id: WorkflowId;
  readonly steps: readonly RunnableWorkflowStep<TInput>[];
}

export interface UseWorkflowRunState {
  readonly isRunning: boolean;
  readonly result?: WorkflowRunResult;
  readonly error?: Error;
}

export interface UseWorkflowRunResult<TInput> extends UseWorkflowRunState {
  readonly run: (input: TInput) => Promise<WorkflowRunResult>;
  readonly reset: () => void;
}

export function useWorkflowRun<TInput = unknown>(
  workflow: RunnableWorkflowDefinition<TInput>
): UseWorkflowRunResult<TInput> {
  const [state, setState] = useState<UseWorkflowRunState>({ isRunning: false });

  const run = useCallback(
    async (input: TInput) => {
      setState({ isRunning: true });
      const result = await runWorkflow(workflow, input);
      setState(
        result.error
          ? { isRunning: false, result, error: result.error }
          : { isRunning: false, result }
      );
      return result;
    },
    [workflow]
  );

  const reset = useCallback(() => {
    setState({ isRunning: false });
  }, []);

  return {
    ...state,
    run,
    reset
  };
}
