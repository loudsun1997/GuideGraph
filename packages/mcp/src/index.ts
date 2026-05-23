import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowEventType,
  type WorkflowInstance,
  type WorkflowTransition
} from "@guidegraph/core";
import {
  createDefinitionSummary,
  workflow,
  workflowDefinitionToBuilderDefinition,
  type WorkflowStepBuilder
} from "@guidegraph/builder";

export interface JsonRpcRequest {
  readonly jsonrpc?: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly isError?: boolean;
}

export interface BuildWorkflowToolInput {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly startStepIds?: readonly string[];
  readonly steps?: readonly BuildWorkflowStepInput[];
  readonly transitions?: readonly WorkflowTransition[];
}

export interface BuildWorkflowStepInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly start?: boolean;
  readonly requiresAll?: readonly string[];
  readonly requiresAny?: readonly string[];
  readonly requiresAtLeast?: {
    readonly count: number;
    readonly stepIds: readonly string[];
  };
}

export interface SimulateWorkflowToolInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId?: string;
  readonly actorId?: string;
  readonly now?: string;
  readonly events?: readonly SimulatedEventInput[];
}

export interface SimulatedEventInput {
  readonly id?: string;
  readonly type: WorkflowEventType;
  readonly stepId?: string;
  readonly actorId?: string;
  readonly occurredAt?: string;
}

export const guideGraphMcpTools: readonly McpTool[] = [
  {
    name: "guidegraph_validate_workflow",
    description: "Validate a GuideGraph WorkflowDefinition and return validation errors.",
    inputSchema: {
      type: "object",
      required: ["definition"],
      properties: {
        definition: workflowDefinitionSchema()
      }
    }
  },
  {
    name: "guidegraph_build_workflow",
    description: "Build and validate a WorkflowDefinition from a compact authoring spec.",
    inputSchema: {
      type: "object",
      required: ["id", "steps"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        version: { type: "string" },
        startStepIds: { type: "array", items: { type: "string" } },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              start: { type: "boolean" },
              requiresAll: { type: "array", items: { type: "string" } },
              requiresAny: { type: "array", items: { type: "string" } },
              requiresAtLeast: {
                type: "object",
                required: ["count", "stepIds"],
                properties: {
                  count: { type: "number" },
                  stepIds: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        },
        transitions: {
          type: "array",
          items: {
            type: "object",
            required: ["from", "to"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              event: { type: "string" },
              label: { type: "string" }
            }
          }
        }
      }
    }
  },
  {
    name: "guidegraph_simulate_workflow",
    description: "Create a workflow instance, apply events through @guidegraph/core, and return the resulting state.",
    inputSchema: {
      type: "object",
      required: ["definition"],
      properties: {
        definition: workflowDefinitionSchema(),
        instanceId: { type: "string" },
        actorId: { type: "string" },
        now: { type: "string" },
        events: {
          type: "array",
          items: {
            type: "object",
            required: ["type"],
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              stepId: { type: "string" },
              actorId: { type: "string" },
              occurredAt: { type: "string" }
            }
          }
        }
      }
    }
  },
  {
    name: "guidegraph_summarize_workflow",
    description: "Return a high-level summary of steps, starts, dependencies, transitions, loops, and available actions.",
    inputSchema: {
      type: "object",
      required: ["definition"],
      properties: {
        definition: workflowDefinitionSchema()
      }
    }
  }
];

export async function handleGuideGraphMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  if (request.method.startsWith("notifications/")) {
    return undefined;
  }

  try {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: await handleMcpMethod(request.method, request.params)
    };
  } catch (cause) {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: toJsonRpcError(cause)
    };
  }
}

export async function callGuideGraphMcpTool(name: string, input: unknown): Promise<ToolCallResult> {
  switch (name) {
    case "guidegraph_validate_workflow":
      return toolText(validateWorkflowDefinition(readDefinition(input)));
    case "guidegraph_build_workflow":
      return toolText(buildWorkflowFromSpec(readBuildWorkflowInput(input)));
    case "guidegraph_simulate_workflow":
      return toolText(simulateWorkflow(readSimulateWorkflowInput(input)));
    case "guidegraph_summarize_workflow":
      return toolText(summarizeWorkflow(readDefinition(input)));
    default:
      throw new Error(`Unknown GuideGraph MCP tool: ${name}`);
  }
}

function handleMcpMethod(method: string, params: unknown): unknown | Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "guidegraph-mcp",
          version: "0.1.0"
        }
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: guideGraphMcpTools };
    case "tools/call": {
      const call = readToolCall(params);
      return callGuideGraphMcpTool(call.name, call.arguments ?? {});
    }
    default:
      throw new McpProtocolError(-32601, `Unsupported MCP method: ${method}`);
  }
}

function buildWorkflowFromSpec(input: BuildWorkflowToolInput): {
  readonly definition: WorkflowDefinition;
  readonly validation: ReturnType<typeof validateWorkflowDefinition>;
} {
  const builder = workflow({
    id: input.id,
    ...(input.name ? { name: input.name } : {}),
    ...(input.version ? { version: input.version } : {})
  });

  for (const step of input.steps ?? []) {
    builder.step(
      step.id,
      {
        ...(step.name ? { name: step.name } : {}),
        ...(step.description ? { description: step.description } : {}),
        ...(step.start !== undefined ? { start: step.start } : {})
      },
      (stepBuilder: WorkflowStepBuilder) => {
      if (step.requiresAll?.length) {
        stepBuilder.requiresAll(step.requiresAll);
      }

      if (step.requiresAny?.length) {
        stepBuilder.requiresAny(step.requiresAny);
      }

      if (step.requiresAtLeast) {
        stepBuilder.requiresAtLeast(step.requiresAtLeast.count, step.requiresAtLeast.stepIds);
      }
      }
    );
  }

  if (input.startStepIds?.length) {
    builder.start(input.startStepIds);
  }

  for (const transition of input.transitions ?? []) {
    builder.transition(transition.from, transition.to, {
      ...(transition.event ? { event: transition.event } : {}),
      ...(transition.label ? { label: transition.label } : {})
    });
  }

  const definition = builder.build();
  return {
    definition,
    validation: validateWorkflowDefinition(definition)
  };
}

function simulateWorkflow(input: SimulateWorkflowToolInput): {
  readonly instance: WorkflowInstance;
  readonly availableActions: ReturnType<typeof getAvailableActions>;
  readonly validation: ReturnType<typeof validateWorkflowDefinition>;
} {
  const validation = validateWorkflowDefinition(input.definition);
  if (!validation.valid) {
    return {
      instance: createInvalidSimulationInstance(input.definition, input.instanceId ?? "invalid_simulation"),
      availableActions: [],
      validation
    };
  }

  let instance = createWorkflowInstance({
    definition: input.definition,
    instanceId: input.instanceId ?? "guidegraph_simulation",
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.now ? { now: input.now } : {})
  });

  for (const [index, event] of (input.events ?? []).entries()) {
    const occurredAt = event.occurredAt ?? new Date(Date.parse(instance.updatedAt) + index + 1).toISOString();
    const workflowEvent: WorkflowEvent = {
      id: event.id ?? `sim_event_${index + 1}`,
      instanceId: instance.id,
      type: event.type,
      occurredAt,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      ...(event.actorId ?? input.actorId ? { actorId: event.actorId ?? input.actorId } : {})
    };
    instance = applyWorkflowEvent({
      definition: input.definition,
      instance,
      event: workflowEvent
    }).instance;
  }

  return {
    instance,
    availableActions: getAvailableActions(input.definition, instance),
    validation
  };
}

function summarizeWorkflow(definition: WorkflowDefinition): {
  readonly validation: ReturnType<typeof validateWorkflowDefinition>;
  readonly summary: ReturnType<typeof createDefinitionSummary>;
  readonly startStepIds: readonly string[];
  readonly transitionEvents: readonly string[];
} {
  const builderDefinition = workflowDefinitionToBuilderDefinition(definition);
  return {
    validation: validateWorkflowDefinition(definition),
    summary: createDefinitionSummary({ definition: builderDefinition }),
    startStepIds: definition.startStepIds,
    transitionEvents: [...new Set((definition.transitions ?? []).map((transition) => transition.event ?? "COMPLETE_STEP"))]
  };
}

function readDefinition(input: unknown): WorkflowDefinition {
  const object = readObject(input, "tool input");
  const definition = object.definition;
  if (!definition || typeof definition !== "object") {
    throw new Error("Tool input must include a workflow definition.");
  }

  return definition as WorkflowDefinition;
}

function readBuildWorkflowInput(input: unknown): BuildWorkflowToolInput {
  const object = readObject(input, "build workflow input");
  if (typeof object.id !== "string") {
    throw new Error("Build workflow input must include id.");
  }

  return object as unknown as BuildWorkflowToolInput;
}

function readSimulateWorkflowInput(input: unknown): SimulateWorkflowToolInput {
  const object = readObject(input, "simulate workflow input");
  if (!object.definition || typeof object.definition !== "object") {
    throw new Error("Simulate workflow input must include definition.");
  }

  return object as unknown as SimulateWorkflowToolInput;
}

function readToolCall(input: unknown): { readonly name: string; readonly arguments?: unknown } {
  const object = readObject(input, "tools/call params");
  if (typeof object.name !== "string") {
    throw new McpProtocolError(-32602, "tools/call params must include a tool name.");
  }

  return {
    name: object.name,
    arguments: object.arguments
  };
}

function readObject(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }

  return input as Record<string, unknown>;
}

function toolText(value: unknown): ToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function workflowDefinitionSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["id", "name", "version", "startStepIds", "steps"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      version: { type: "string" },
      startStepIds: { type: "array", items: { type: "string" } },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            dependencies: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "stepIds"],
                properties: {
                  type: { type: "string", enum: ["all", "any", "atLeast"] },
                  count: { type: "number" },
                  stepIds: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      },
      transitions: {
        type: "array",
        items: {
          type: "object",
          required: ["from", "to"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            event: { type: "string" },
            label: { type: "string" }
          }
        }
      }
    }
  };
}

function createInvalidSimulationInstance(definition: WorkflowDefinition, instanceId: string): WorkflowInstance {
  const now = new Date().toISOString();
  return {
    id: instanceId,
    workflowId: definition.id,
    workflowVersion: definition.version,
    status: "failed",
    revision: 0,
    activeStepIds: [],
    stepStates: {},
    history: [],
    context: {},
    artifactIds: [],
    metadata: {},
    createdAt: now,
    updatedAt: now
  };
}

class McpProtocolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "McpProtocolError";
  }
}

function toJsonRpcError(cause: unknown): JsonRpcError {
  if (cause instanceof McpProtocolError) {
    return {
      code: cause.code,
      message: cause.message,
      ...(cause.data ? { data: cause.data } : {})
    };
  }

  return {
    code: -32603,
    message: cause instanceof Error ? cause.message : "Internal GuideGraph MCP error."
  };
}
