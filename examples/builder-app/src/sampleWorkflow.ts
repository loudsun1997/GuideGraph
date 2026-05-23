import type { BuilderWorkflowDefinition } from "@guidegraph/builder";

export const permitBuilderWorkflow = {
  id: "permit-application",
  name: "Permit Application",
  version: "1.0.0",
  description: "A workflow definition for building permits with prerequisites, city review, rejection, and retry.",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    {
      id: "fillForm",
      name: "Fill Form",
      description: "Applicant completes the permit application form."
    },
    {
      id: "uploadDocuments",
      name: "Upload Documents",
      description: "Applicant uploads required plans and supporting documents."
    },
    {
      id: "payFee",
      name: "Pay Fee",
      description: "Applicant pays the processing fee."
    },
    {
      id: "submitApplication",
      name: "Submit Application",
      description: "Application can be submitted after all prerequisites are complete.",
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
      description: "City reviewer approves or rejects the submitted application.",
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
      description: "Permit is approved and the workflow is complete.",
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
      description: "Applicant addresses reviewer comments before resubmitting.",
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
      to: "cityReview",
      label: "Submit"
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
      label: "Resubmit"
    }
  ],
  builder: {
    canvas: {
      nodes: {
        fillForm: { x: 80, y: 100 },
        uploadDocuments: { x: 80, y: 290 },
        payFee: { x: 80, y: 480 },
        submitApplication: { x: 420, y: 290 },
        cityReview: { x: 760, y: 290 },
        approved: { x: 1100, y: 195 },
        fixIssues: { x: 1100, y: 385 }
      },
      actionLabels: {
        "cityReview:approved:REVIEW_APPROVED": {
          icon: "check",
          position: { x: 938, y: 220 }
        },
        "cityReview:fixIssues:REVIEW_REJECTED": {
          icon: "x",
          position: { x: 938, y: 361 }
        },
        "fixIssues:submitApplication:COMPLETE_STEP": {
          icon: "rotate",
          position: { x: 760, y: 523 }
        },
        "submitApplication:cityReview:COMPLETE_STEP": {
          icon: "send",
          position: { x: 598, y: 302 }
        }
      }
    }
  }
} satisfies BuilderWorkflowDefinition;
