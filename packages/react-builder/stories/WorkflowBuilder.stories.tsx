import { useMemo, useState } from "react";
import type { StoryDefault } from "@ladle/react";
import {
  builderDefinitionToWorkflowDefinition,
  createBuilderDefinition,
  createDefinitionSummary,
  type BuilderWorkflowDefinition,
  type WorkflowDraftStatus
} from "@guidegraph/builder";
import { WorkflowBuilder } from "../src";

export default {
  title: "Workflow Builder"
} satisfies StoryDefault;

export function PermitWorkflow() {
  return <BuilderWorkbench initialDefinition={permitBuilderWorkflow} />;
}

export function BlankDraft() {
  return (
    <BuilderWorkbench
      initialDefinition={createBuilderDefinition({
        id: "blank-workflow",
        name: "Blank Workflow",
        version: "0.1.0",
        description: "Start from a single step and build from there."
      })}
    />
  );
}

export function PublishedReadOnly() {
  return <BuilderWorkbench initialDefinition={permitBuilderWorkflow} initialStatus="published" />;
}

export function InvalidDraft() {
  return <BuilderWorkbench initialDefinition={{ ...permitBuilderWorkflow, startStepIds: [] }} />;
}

function BuilderWorkbench(props: {
  readonly initialDefinition: BuilderWorkflowDefinition;
  readonly initialStatus?: WorkflowDraftStatus;
}) {
  const [definition, setDefinition] = useState(props.initialDefinition);
  const [status, setStatus] = useState<WorkflowDraftStatus>(props.initialStatus ?? "draft");
  const [publishedAt, setPublishedAt] = useState<string | undefined>();
  const summary = useMemo(() => createDefinitionSummary({ definition, status }), [definition, status]);
  const runtimeDefinition = useMemo(() => builderDefinitionToWorkflowDefinition(definition), [definition]);

  return (
    <div style={{ display: "grid", gap: 12, padding: 16 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 12,
          justifyContent: "space-between"
        }}
      >
        <div>
          <strong>{definition.name}</strong>
          <div style={{ color: "#647381", fontSize: 13 }}>
            {summary.stepCount} steps · {summary.dependencyCount} requirements · {summary.transitionCount} actions ·{" "}
            {status}
          </div>
        </div>
        <button type="button" onClick={() => setStatus(status === "draft" ? "published" : "draft")}>
          {status === "draft" ? "Show published lock" : "Return to draft"}
        </button>
      </div>

      <WorkflowBuilder
        hasPublishedVersions={Boolean(publishedAt)}
        height={620}
        initialDefinition={definition}
        showJsonPreview={false}
        status={status}
        onChange={(nextDefinition) => {
          setDefinition(nextDefinition);
          if (status !== "draft") {
            setStatus("draft");
          }
        }}
        onPublish={(_, builderDefinition) => {
          setDefinition(builderDefinition);
          setStatus("published");
          setPublishedAt(new Date().toISOString());
        }}
      />

      <details>
        <summary>Generated WorkflowDefinition</summary>
        <pre
          style={{
            background: "#0f172a",
            borderRadius: 8,
            color: "#e2e8f0",
            maxHeight: 360,
            overflow: "auto",
            padding: 14
          }}
        >
          {JSON.stringify(runtimeDefinition, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const permitBuilderWorkflow = {
  id: "permit-application",
  name: "Permit Application",
  version: "1.0.0",
  description: "A permit workflow with parallel prerequisites, a review branch, and a retry loop.",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    {
      id: "fillForm",
      name: "Fill Form",
      description: "Applicant completes the form."
    },
    {
      id: "uploadDocuments",
      name: "Upload Documents",
      description: "Applicant uploads supporting documents."
    },
    {
      id: "payFee",
      name: "Pay Fee",
      description: "Applicant pays the required fee."
    },
    {
      id: "submitApplication",
      name: "Submit Application",
      description: "Merge step unlocked once prerequisites are done.",
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
      description: "Reviewer chooses approval or rejection.",
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
      description: "Terminal approval step.",
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
      description: "Retry step for rejected applications.",
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
        fillForm: { x: 80, y: 80 },
        uploadDocuments: { x: 80, y: 260 },
        payFee: { x: 80, y: 440 },
        submitApplication: { x: 430, y: 260 },
        cityReview: { x: 790, y: 260 },
        approved: { x: 1140, y: 110 },
        fixIssues: { x: 790, y: 450 }
      },
      actionLabels: {
        "cityReview:approved:REVIEW_APPROVED": {
          icon: "check",
          position: { x: 980, y: 170 }
        },
        "cityReview:fixIssues:REVIEW_REJECTED": {
          icon: "x",
          position: { x: 875, y: 360 }
        },
        "fixIssues:submitApplication:COMPLETE_STEP": {
          icon: "rotate",
          position: { x: 650, y: 395 }
        }
      }
    }
  }
} satisfies BuilderWorkflowDefinition;
