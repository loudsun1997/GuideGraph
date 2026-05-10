import { describe, expect, it } from "vitest";
import { validateWorkflowDefinition, type WorkflowDefinition } from "../src/index.ts";
import { permitWorkflow } from "./fixtures/permitWorkflow.ts";

describe("validateWorkflowDefinition", () => {
  it("accepts a valid workflow definition", () => {
    const result = validateWorkflowDefinition(permitWorkflow);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing workflow id", () => {
    const { id: _id, ...definition } = permitWorkflow;
    const result = validateWorkflowDefinition(definition as WorkflowDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow id is required.");
  });

  it("rejects a missing workflow version", () => {
    const { version: _version, ...definition } = permitWorkflow;
    const result = validateWorkflowDefinition(definition as WorkflowDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow version is required.");
  });

  it("rejects missing startStepIds", () => {
    const { startStepIds: _startStepIds, ...definition } = permitWorkflow;
    const result = validateWorkflowDefinition(definition as WorkflowDefinition);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow startStepIds must include at least one step id.");
  });

  it("rejects an empty workflow", () => {
    const result = validateWorkflowDefinition({
      id: "empty_workflow",
      name: "Empty Workflow",
      version: "1.0.0",
      startStepIds: [],
      steps: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow startStepIds must include at least one step id.");
    expect(result.errors).toContain("Workflow steps must include at least one step.");
  });

  it("rejects startStepIds that reference unknown steps", () => {
    const result = validateWorkflowDefinition({
      ...permitWorkflow,
      startStepIds: ["missingStep"]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("startStepIds references unknown step: missingStep");
  });

  it("rejects transitions with unknown from steps", () => {
    const result = validateWorkflowDefinition({
      ...permitWorkflow,
      transitions: [
        ...(permitWorkflow.transitions ?? []),
        {
          from: "missingFrom",
          to: "approved"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Transition references unknown from step: missingFrom");
  });

  it("rejects transitions with unknown to steps", () => {
    const result = validateWorkflowDefinition({
      ...permitWorkflow,
      transitions: [
        ...(permitWorkflow.transitions ?? []),
        {
          from: "approved",
          to: "missingTo"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Transition references unknown to step: missingTo");
  });

  it("rejects dependencies that reference unknown steps", () => {
    const result = validateWorkflowDefinition({
      ...permitWorkflow,
      steps: permitWorkflow.steps.map((step) =>
        step.id === "submitApplication"
          ? {
              ...step,
              dependencies: [
                {
                  type: "all",
                  stepIds: ["missingDependency"]
                } as const
              ]
            }
          : step
      )
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Dependency references unknown step: missingDependency");
  });

  it("rejects circular dependencies", () => {
    const result = validateWorkflowDefinition({
      id: "circular_workflow",
      name: "Circular Workflow",
      version: "1.0.0",
      startStepIds: ["alpha"],
      steps: [
        {
          id: "alpha",
          name: "Alpha",
          dependencies: [
            {
              type: "all",
              stepIds: ["beta"]
            }
          ]
        },
        {
          id: "beta",
          name: "Beta",
          dependencies: [
            {
              type: "all",
              stepIds: ["alpha"]
            }
          ]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Circular dependency detected: alpha -> beta -> alpha");
  });

  it("rejects duplicate and invalid step ids", () => {
    const result = validateWorkflowDefinition({
      ...permitWorkflow,
      steps: [
        ...permitWorkflow.steps,
        {
          id: "fillForm",
          name: "Duplicate Fill Form"
        },
        {
          id: "123 invalid",
          name: "Invalid Step"
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate step id: fillForm");
    expect(result.errors).toContain("Invalid step id: 123 invalid");
  });
});
