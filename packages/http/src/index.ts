import type {
  AvailableWorkflowAction,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowHistoryEntry,
  WorkflowInstance
} from "@guidegraph/core";
import {
  WorkflowServerError,
  type CreateWorkflowInstanceResult,
  type SendWorkflowEventResult,
  type WorkflowServer,
  type WorkflowServerErrorCode
} from "@guidegraph/server";

export type GuideGraphHttpErrorCode =
  | WorkflowServerErrorCode
  | "UNKNOWN_WORKFLOW_DEFINITION"
  | "DEFINITION_VERSION_MISMATCH"
  | "INVALID_REQUEST"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "SCHEMA_NOT_INSTALLED"
  | "STORAGE_COMMIT_FAILED"
  | "INTERNAL_ERROR";

export interface GuideGraphHttpErrorBody {
  readonly error: {
    readonly code: GuideGraphHttpErrorCode;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export class GuideGraphHttpError extends Error {
  readonly code: GuideGraphHttpErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    readonly code: GuideGraphHttpErrorCode;
    readonly message: string;
    readonly status: number;
    readonly details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "GuideGraphHttpError";
    this.code = input.code;
    this.status = input.status;
    if (input.details) {
      this.details = input.details;
    }
  }
}

export interface CreateHttpWorkflowClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly getHeaders?: () => Promise<HeadersInit> | HeadersInit;
}

export interface CreateWorkflowInstanceInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly now?: string;
}

export interface SendWorkflowEventInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly event: WorkflowEvent;
  readonly expectedRevision?: number;
  readonly idempotencyKey?: string;
}

export interface ResetWorkflowInstanceInput {
  readonly definition: WorkflowDefinition;
  readonly instanceId: string;
  readonly actorId?: string;
  readonly now?: string;
}

export interface HttpWorkflowClient {
  createInstance(input: CreateWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult>;
  getInstance(instanceId: string): Promise<WorkflowInstance>;
  sendEvent(input: SendWorkflowEventInput): Promise<SendWorkflowEventResult>;
  getHistory(instanceId: string): Promise<WorkflowHistoryEntry[]>;
  getAvailableActions(
    definition: WorkflowDefinition,
    instanceId: string
  ): Promise<AvailableWorkflowAction[]>;
  resetInstance?(input: ResetWorkflowInstanceInput): Promise<CreateWorkflowInstanceResult>;
}

export interface CreateGuideGraphHttpHandlerOptions {
  readonly workflowServer: WorkflowServer;
  readonly definitions?: readonly WorkflowDefinition[];
  readonly resolveDefinition?: (input: ResolveWorkflowDefinitionInput) => WorkflowDefinition | Promise<WorkflowDefinition>;
  readonly getActorId?: (request: Request) => string | undefined | Promise<string | undefined>;
  readonly basePath?: string;
}

export interface ResolveWorkflowDefinitionInput {
  readonly workflowId: string;
  readonly workflowVersion?: string;
  readonly request: Request;
}

export interface GuideGraphHttpHandler {
  handle(request: Request): Promise<Response>;
  (request: Request): Promise<Response>;
}

export function createHttpWorkflowClient(options: CreateHttpWorkflowClientOptions): HttpWorkflowClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("createHttpWorkflowClient requires fetch support.");
  }

  return {
    async createInstance(input) {
      return requestJson<CreateWorkflowInstanceResult>(options, fetchImpl, "/instances", {
        method: "POST",
        body: {
          workflowId: input.definition.id,
          workflowVersion: input.definition.version,
          instanceId: input.instanceId,
          ...(input.now ? { now: input.now } : {})
        }
      });
    },

    async getInstance(instanceId) {
      return requestJson<WorkflowInstance>(options, fetchImpl, `/instances/${encodeURIComponent(instanceId)}`, {
        method: "GET"
      });
    },

    async sendEvent(input) {
      return requestJson<SendWorkflowEventResult>(
        options,
        fetchImpl,
        `/instances/${encodeURIComponent(input.instanceId)}/events`,
        {
          method: "POST",
          body: {
            workflowId: input.definition.id,
            workflowVersion: input.definition.version,
            ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
            ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
            event: {
              id: input.event.id,
              type: input.event.type,
              ...(input.event.stepId ? { stepId: input.event.stepId } : {}),
              occurredAt: input.event.occurredAt
            }
          }
        }
      );
    },

    async getHistory(instanceId) {
      return requestJson<WorkflowHistoryEntry[]>(
        options,
        fetchImpl,
        `/instances/${encodeURIComponent(instanceId)}/history`,
        { method: "GET" }
      );
    },

    async getAvailableActions(definition, instanceId) {
      const search = new URLSearchParams({
        workflowId: definition.id,
        workflowVersion: definition.version
      });

      return requestJson<AvailableWorkflowAction[]>(
        options,
        fetchImpl,
        `/instances/${encodeURIComponent(instanceId)}/actions?${search.toString()}`,
        { method: "GET" }
      );
    },

    async resetInstance(input) {
      return requestJson<CreateWorkflowInstanceResult>(
        options,
        fetchImpl,
        `/instances/${encodeURIComponent(input.instanceId)}/reset`,
        {
          method: "POST",
          body: {
            workflowId: input.definition.id,
            workflowVersion: input.definition.version,
            ...(input.now ? { now: input.now } : {})
          }
        }
      );
    }
  };
}

export function createGuideGraphHttpHandler(options: CreateGuideGraphHttpHandlerOptions): GuideGraphHttpHandler {
  const definitionByKey = new Map(
    (options.definitions ?? []).map((definition) => [getDefinitionKey(definition.id, definition.version), definition])
  );

  const handle = async (request: Request): Promise<Response> => {
    try {
      const route = getRoute(request, options.basePath);

      if (route.kind === "not_found") {
        return errorResponse(
          new GuideGraphHttpError({
            code: "NOT_FOUND",
            message: `Unknown GuideGraph route: ${route.path}`,
            status: 404
          })
        );
      }

      if (!route.methodAllowed) {
        return errorResponse(
          new GuideGraphHttpError({
            code: "METHOD_NOT_ALLOWED",
            message: `Unsupported method ${request.method} for ${route.path}.`,
            status: 405
          })
        );
      }

      if (route.kind === "create_instance") {
        const body = await readJson<CreateInstanceBody>(request);
        const definition = await resolveDefinition(options, definitionByKey, request, body);
        const actorId = await options.getActorId?.(request);

        return jsonResponse(
          await options.workflowServer.createInstance({
            definition,
            instanceId: requireString(body.instanceId, "instanceId"),
            ...(actorId ? { actorId } : {}),
            ...(body.now ? { now: body.now } : {})
          })
        );
      }

      if (route.kind === "get_instance") {
        return jsonResponse(await options.workflowServer.getInstance(route.instanceId));
      }

      if (route.kind === "send_event") {
        const body = await readJson<SendEventBody>(request);
        const definition = await resolveDefinition(options, definitionByKey, request, body);
        const actorId = await options.getActorId?.(request);
        const eventBody = requireRecord(body.event, "event");
        const event: WorkflowEvent = {
          id: requireString(eventBody.id, "event.id"),
          instanceId: route.instanceId,
          type: requireString(eventBody.type, "event.type"),
          ...(typeof eventBody.stepId === "string" ? { stepId: eventBody.stepId } : {}),
          ...(actorId ? { actorId } : {}),
          occurredAt: requireString(eventBody.occurredAt, "event.occurredAt")
        };

        return jsonResponse(
          await options.workflowServer.sendEvent({
            definition,
            instanceId: route.instanceId,
            event,
            ...(typeof body.expectedRevision === "number"
              ? { expectedRevision: body.expectedRevision }
              : {}),
            ...(typeof body.idempotencyKey === "string"
              ? { idempotencyKey: body.idempotencyKey }
              : {})
          })
        );
      }

      if (route.kind === "get_history") {
        return jsonResponse(await options.workflowServer.getHistory(route.instanceId));
      }

      if (route.kind === "get_actions") {
        const url = new URL(request.url);
        const workflowId = url.searchParams.get("workflowId") ?? undefined;
        const workflowVersion = url.searchParams.get("workflowVersion") ?? undefined;
        const definitionReference: Partial<DefinitionReference> = {
          ...(workflowId ? { workflowId } : {}),
          ...(workflowVersion ? { workflowVersion } : {})
        };
        const definition = await resolveDefinition(options, definitionByKey, request, {
          ...definitionReference
        });

        return jsonResponse(
          await options.workflowServer.getAvailableActions(definition, route.instanceId)
        );
      }

      if (route.kind === "reset_instance") {
        const body = await readJson<CreateInstanceBody>(request);
        const definition = await resolveDefinition(options, definitionByKey, request, body);
        const actorId = await options.getActorId?.(request);

        return jsonResponse(
          await options.workflowServer.createInstance({
            definition,
            instanceId: route.instanceId,
            ...(actorId ? { actorId } : {}),
            ...(body.now ? { now: body.now } : {})
          })
        );
      }

      return errorResponse(
        new GuideGraphHttpError({
          code: "NOT_FOUND",
          message: "Unknown GuideGraph route.",
          status: 404
        })
      );
    } catch (error) {
      return errorResponse(error);
    }
  };

  return Object.assign(handle, { handle });
}

async function requestJson<T>(
  options: CreateHttpWorkflowClientOptions,
  fetchImpl: typeof fetch,
  path: string,
  input: { readonly method: string; readonly body?: unknown }
): Promise<T> {
  const headers = new Headers(await options.getHeaders?.());

  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(joinUrl(options.baseUrl, path), {
    method: input.method,
    headers,
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {})
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const errorBody = body as Partial<GuideGraphHttpErrorBody>;
    const error = errorBody.error;

    throw new GuideGraphHttpError({
      code: error?.code ?? "INTERNAL_ERROR",
      message: error?.message ?? `GuideGraph HTTP request failed with status ${response.status}.`,
      status: response.status,
      ...(error?.details ? { details: error.details } : {})
    });
  }

  return body as T;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      return {
        error: {
          code: "INTERNAL_ERROR",
          message: text
        }
      };
    }

    throw new Error("GuideGraph HTTP response was not valid JSON.");
  }
}

function getRoute(request: Request, basePath = ""): HttpRoute {
  const url = new URL(request.url);
  const path = stripBasePath(url.pathname, basePath);

  if (!path) {
    return { kind: "not_found", path: url.pathname, methodAllowed: false };
  }

  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (segments.length === 1 && segments[0] === "instances") {
    return {
      kind: "create_instance",
      path,
      methodAllowed: request.method === "POST"
    };
  }

  if (segments.length >= 2 && segments[0] === "instances") {
    const instanceId = segments[1];

    if (!instanceId) {
      return { kind: "not_found", path, methodAllowed: false };
    }

    if (segments.length === 2) {
      return {
        kind: "get_instance",
        path,
        instanceId,
        methodAllowed: request.method === "GET"
      };
    }

    if (segments.length === 3 && segments[2] === "events") {
      return {
        kind: "send_event",
        path,
        instanceId,
        methodAllowed: request.method === "POST"
      };
    }

    if (segments.length === 3 && segments[2] === "history") {
      return {
        kind: "get_history",
        path,
        instanceId,
        methodAllowed: request.method === "GET"
      };
    }

    if (segments.length === 3 && segments[2] === "actions") {
      return {
        kind: "get_actions",
        path,
        instanceId,
        methodAllowed: request.method === "GET"
      };
    }

    if (segments.length === 3 && segments[2] === "reset") {
      return {
        kind: "reset_instance",
        path,
        instanceId,
        methodAllowed: request.method === "POST"
      };
    }
  }

  return { kind: "not_found", path, methodAllowed: false };
}

function stripBasePath(pathname: string, basePath: string): string | undefined {
  const normalizedBasePath = normalizePath(basePath);

  if (!normalizedBasePath) {
    return pathname;
  }

  if (pathname === normalizedBasePath) {
    return "/";
  }

  if (pathname.startsWith(`${normalizedBasePath}/`)) {
    return pathname.slice(normalizedBasePath.length);
  }

  return undefined;
}

function normalizePath(path: string): string {
  if (!path || path === "/") {
    return "";
  }

  return `/${path.split("/").filter(Boolean).join("/")}`;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    return requireRecord(body, "body") as T;
  } catch (error) {
    if (error instanceof GuideGraphHttpError) {
      throw error;
    }

    throw new GuideGraphHttpError({
      code: "INVALID_REQUEST",
      message: "Request body must be valid JSON.",
      status: 400
    });
  }
}

async function resolveDefinition(
  options: CreateGuideGraphHttpHandlerOptions,
  definitionByKey: ReadonlyMap<string, WorkflowDefinition>,
  request: Request,
  input: Partial<DefinitionReference>
): Promise<WorkflowDefinition> {
  const workflowId = requireString(input.workflowId, "workflowId");
  const workflowVersion = typeof input.workflowVersion === "string" ? input.workflowVersion : undefined;

  if (options.resolveDefinition) {
    return options.resolveDefinition({ workflowId, ...(workflowVersion ? { workflowVersion } : {}), request });
  }

  if (!workflowVersion) {
    throw new GuideGraphHttpError({
      code: "INVALID_REQUEST",
      message: "workflowVersion is required.",
      status: 400
    });
  }

  const definition = definitionByKey.get(getDefinitionKey(workflowId, workflowVersion));

  if (!definition) {
    const hasWorkflow = [...definitionByKey.values()].some((candidate) => candidate.id === workflowId);

    throw new GuideGraphHttpError({
      code: hasWorkflow ? "DEFINITION_VERSION_MISMATCH" : "UNKNOWN_WORKFLOW_DEFINITION",
      message: hasWorkflow
        ? `Unknown workflow definition version: ${workflowId}@${workflowVersion}.`
        : `Unknown workflow definition: ${workflowId}.`,
      status: hasWorkflow ? 409 : 404,
      details: {
        workflowId,
        workflowVersion
      }
    });
  }

  return definition;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function errorResponse(cause: unknown): Response {
  const error = normalizeHttpError(cause);
  const body: GuideGraphHttpErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  };

  return jsonResponse(body, error.status);
}

function normalizeHttpError(cause: unknown): GuideGraphHttpError {
  if (cause instanceof GuideGraphHttpError) {
    return cause;
  }

  if (cause instanceof WorkflowServerError) {
    return new GuideGraphHttpError({
      code: cause.code,
      message: cause.message,
      status: getWorkflowServerErrorStatus(cause.code)
    });
  }

  return new GuideGraphHttpError({
    code: "INTERNAL_ERROR",
    message: "GuideGraph HTTP handler failed.",
    status: 500
  });
}

function getWorkflowServerErrorStatus(code: WorkflowServerErrorCode): number {
  if (code === "INSTANCE_NOT_FOUND") {
    return 404;
  }

  if (code === "REVISION_CONFLICT" || code === "IDEMPOTENCY_CONFLICT") {
    return 409;
  }

  if (code === "GUARD_REJECTED") {
    return 403;
  }

  if (code === "INVALID_EVENT") {
    return 400;
  }

  return 500;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuideGraphHttpError({
      code: "INVALID_REQUEST",
      message: `${fieldName} must be an object.`,
      status: 400
    });
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GuideGraphHttpError({
      code: "INVALID_REQUEST",
      message: `${fieldName} is required.`,
      status: 400
    });
  }

  return value;
}

function getDefinitionKey(workflowId: string, workflowVersion: string): string {
  return `${workflowId}@${workflowVersion}`;
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${trimmedBase}${normalizedPath}`;
}

interface DefinitionReference {
  readonly workflowId: string;
  readonly workflowVersion?: string;
}

interface CreateInstanceBody extends DefinitionReference {
  readonly instanceId?: string;
  readonly now?: string;
}

interface SendEventBody extends DefinitionReference {
  readonly event?: unknown;
  readonly expectedRevision?: number;
  readonly idempotencyKey?: string;
}

type HttpRoute =
  | {
      readonly kind: "create_instance";
      readonly path: string;
      readonly methodAllowed: boolean;
    }
  | {
      readonly kind: "get_instance" | "send_event" | "get_history" | "get_actions" | "reset_instance";
      readonly path: string;
      readonly instanceId: string;
      readonly methodAllowed: boolean;
    }
  | {
      readonly kind: "not_found";
      readonly path: string;
      readonly methodAllowed: boolean;
    };
