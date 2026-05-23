import { describe, expect, it } from "vitest";
import {
  applyWorkflowEvent,
  createWorkflowInstance,
  getAvailableActions,
  validateWorkflowDefinition,
  type WorkflowDefinition
} from "../src/index.ts";

describe("workflow extensibility model", () => {
  it("carries metadata, context, assignments, timers, inputs, artifacts, effects, compensation, audit, and migrations", () => {
    const definition = createExtensibleWorkflow();
    const validation = validateWorkflowDefinition(definition);
    const instance = createWorkflowInstance({
      definition,
      instanceId: "instance_1",
      actorId: "user_1",
      now: "2026-05-22T00:00:00.000Z",
      context: { permitId: "permit_1" },
      artifactIds: ["existing_doc"],
      metadata: { source: "test" }
    });
    const actions = getAvailableActions(definition, instance);
    const result = applyWorkflowEvent({
      definition,
      instance,
      event: {
        id: "event_1",
        instanceId: "instance_1",
        type: "COMPLETE_STEP",
        stepId: "uploadDocuments",
        actorId: "user_1",
        occurredAt: "2026-05-22T00:00:01.000Z",
        payload: {
          context: { uploaded: true },
          metadata: { reviewedByGuard: true }
        },
        metadata: {
          reason: "documents uploaded"
        },
        artifactIds: ["site_plan"]
      }
    });

    expect(validation.valid).toBe(true);
    expect(instance.context).toEqual({ permitId: "permit_1" });
    expect(instance.artifactIds).toEqual(["existing_doc"]);
    expect(instance.metadata).toEqual({ source: "test" });
    expect(instance.stepStates.uploadDocuments).toMatchObject({
      assignment: { role: "applicant" },
      timers: [{ kind: "deadline", after: "P3D" }],
      input: { required: ["sitePlan"] },
      artifacts: [{ id: "sitePlan", required: true }],
      metadata: { kind: "upload" }
    });
    expect(actions[0]).toMatchObject({
      stepId: "uploadDocuments",
      assignment: { role: "applicant" },
      input: { required: ["sitePlan"] },
      artifacts: [{ id: "sitePlan", required: true }],
      timers: [{ kind: "deadline", after: "P3D" }]
    });
    expect(result.instance.context).toEqual({ permitId: "permit_1", uploaded: true });
    expect(result.instance.metadata).toEqual({ source: "test", reviewedByGuard: true });
    expect(result.instance.artifactIds).toEqual(["existing_doc", "site_plan"]);
    expect(result.instance.history.at(-1)?.metadata).toEqual({
      reason: "documents uploaded",
      payload: {
        context: { uploaded: true },
        metadata: { reviewedByGuard: true }
      }
    });
    expect(definition.transitions?.[0]?.effects).toEqual([
      { type: "webhook", target: "https://example.test/webhook" }
    ]);
    expect(definition.steps[0]?.compensation).toEqual({
      effect: { type: "custom", target: "delete-uploaded-files" }
    });
    expect(definition.migrations).toEqual([
      { fromVersion: "1.0.0", toVersion: "1.1.0", description: "Add inspection step later" }
    ]);
  });

  it("validates invalid extension definitions", () => {
    const validation = validateWorkflowDefinition({
      ...createExtensibleWorkflow(),
      migrations: [{ fromVersion: "1.0.0", toVersion: "1.0.0" }],
      steps: [
        {
          id: "uploadDocuments",
          name: "Upload Documents",
          assignment: {},
          timers: [{ kind: "deadline" }],
          artifacts: [{ id: "" }],
          effects: [{ type: "" }]
        }
      ]
    });

    expect(validation.errors).toContain("Assignment for uploadDocuments must include an actorId or role.");
    expect(validation.errors).toContain("Timer on uploadDocuments must include after or at.");
    expect(validation.errors).toContain("Artifact on uploadDocuments must include an id.");
    expect(validation.errors).toContain("Effect on uploadDocuments must include a type.");
    expect(validation.errors).toContain("Workflow migration cannot target the same version: 1.0.0");
  });
});

function createExtensibleWorkflow(): WorkflowDefinition {
  return {
    id: "extensible_permit",
    name: "Extensible Permit",
    version: "1.0.0",
    metadata: { domain: "permit" },
    contextSchema: { required: ["permitId"] },
    startStepIds: ["uploadDocuments"],
    steps: [
      {
        id: "uploadDocuments",
        name: "Upload Documents",
        metadata: { kind: "upload" },
        assignment: { role: "applicant" },
        timers: [{ kind: "deadline", after: "P3D" }],
        input: { required: ["sitePlan"] },
        artifacts: [{ id: "sitePlan", kind: "document", required: true }],
        effects: [{ type: "notification", target: "applicant" }],
        compensation: { effect: { type: "custom", target: "delete-uploaded-files" } }
      },
      {
        id: "review",
        name: "Review",
        dependencies: [{ type: "all", stepIds: ["uploadDocuments"] }],
        assignment: { role: "reviewer", strategy: "pool" }
      }
    ],
    transitions: [
      {
        from: "uploadDocuments",
        to: "review",
        effects: [{ type: "webhook", target: "https://example.test/webhook" }]
      }
    ],
    effects: [{ type: "outbox", target: "workflow-events" }],
    migrations: [{ fromVersion: "1.0.0", toVersion: "1.1.0", description: "Add inspection step later" }]
  };
}
