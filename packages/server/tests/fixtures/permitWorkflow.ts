import type { WorkflowDefinition, WorkflowEvent, WorkflowInstance } from "@flowforge/core";

export const permitWorkflow: WorkflowDefinition = {
  id: "permit_application",
  name: "Permit Application",
  version: "1.0.0",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    {
      id: "fillForm",
      name: "Fill Form"
    },
    {
      id: "uploadDocuments",
      name: "Upload Documents"
    },
    {
      id: "payFee",
      name: "Pay Fee"
    },
    {
      id: "submitApplication",
      name: "Submit Application",
      dependencies: [
        {
          type: "all",
          stepIds: ["fillForm", "uploadDocuments", "payFee"]
        }
      ]
    }
  ],
  transitions: [
    {
      from: "fillForm",
      to: "submitApplication"
    },
    {
      from: "uploadDocuments",
      to: "submitApplication"
    },
    {
      from: "payFee",
      to: "submitApplication"
    }
  ]
};

export function workflowEvent(
  instance: WorkflowInstance,
  stepId: string,
  overrides: Partial<WorkflowEvent> = {}
): WorkflowEvent {
  return {
    id: `event_${instance.revision + 1}`,
    instanceId: instance.id,
    type: "COMPLETE_STEP",
    stepId,
    actorId: "user_1",
    occurredAt: `2026-01-01T00:00:0${instance.revision + 1}.000Z`,
    ...overrides
  };
}
