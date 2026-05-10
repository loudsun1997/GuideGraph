import type { WorkflowDefinition, WorkflowEvent, WorkflowInstance } from "../../src/index.ts";

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
    },
    {
      id: "cityReview",
      name: "City Review",
      dependencies: [
        {
          type: "all",
          stepIds: ["submitApplication"]
        }
      ]
    },
    {
      id: "approved",
      name: "Approved",
      dependencies: [
        {
          type: "all",
          stepIds: ["cityReview"]
        }
      ]
    },
    {
      id: "fixIssues",
      name: "Fix Issues",
      dependencies: [
        {
          type: "all",
          stepIds: ["cityReview"]
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
    },
    {
      from: "submitApplication",
      to: "cityReview"
    },
    {
      from: "cityReview",
      to: "approved",
      event: "REVIEW_APPROVED",
      label: "Approve"
    },
    {
      from: "cityReview",
      to: "fixIssues",
      event: "REVIEW_REJECTED",
      label: "Reject"
    },
    {
      from: "fixIssues",
      to: "submitApplication",
      label: "Resubmit Application"
    }
  ]
};

export function workflowEvent(
  instance: WorkflowInstance,
  stepId: string,
  overrides: Partial<WorkflowEvent> = {}
): WorkflowEvent {
  const eventNumber = instance.revision + 1;

  return {
    id: `event_${eventNumber}`,
    instanceId: instance.id,
    type: "COMPLETE_STEP",
    stepId,
    actorId: "user_1",
    occurredAt: `2026-01-01T00:00:0${eventNumber}.000Z`,
    ...overrides
  };
}
