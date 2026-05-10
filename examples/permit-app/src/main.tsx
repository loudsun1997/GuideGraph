import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  BlockedSteps,
  CurrentStepCard,
  DocumentChecklist,
  NextActions,
  WorkflowProvider,
  WorkflowStatusList,
  WorkflowTimeline,
  useWorkflow
} from "@flowforge/react";
import type { WorkflowStepStatus } from "@flowforge/core";
import { permitWorkflow } from "./permitWorkflow.js";
import { createHttpDemoWorkflowClient, createLocalWorkflowClient } from "./workflowClient.js";
import "./styles.css";

function App() {
  const transport = getTransportMode();
  const client = useMemo(
    () => (transport === "http" ? createHttpDemoWorkflowClient() : createLocalWorkflowClient()),
    [transport]
  );

  return (
    <WorkflowProvider
      actorId="demo_user"
      client={client}
      definition={permitWorkflow}
      instanceId="permit_demo"
    >
      <PermitWorkflow />
    </WorkflowProvider>
  );
}

function PermitWorkflow() {
  const { createInstance, error, instance, isLoading, resetInstance } = useWorkflow();

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p>FlowForge example</p>
          <h1>Permit Application</h1>
          <p className="storage-note">
            {getStorageNote()}
          </p>
        </div>
        <button
          disabled={isLoading}
          onClick={() => void (instance ? resetInstance() : createInstance())}
          type="button"
        >
          {instance ? "Reset Instance" : "Create Instance"}
        </button>
      </header>

      {error ? <p className="error-message">{error.message}</p> : null}

      {instance ? (
        <>
          <DebugPanel />
          <CapabilityMap />
          <section className="workflow-grid">
            <div className="workflow-main">
              <CurrentStepCard />
              <WorkflowStatusList />
              <WorkflowTimeline />
            </div>
            <aside className="workflow-side">
              <NextActions />
              <DocumentChecklist />
              <BlockedSteps />
              <ScenarioGuide />
            </aside>
          </section>
        </>
      ) : (
        <section className="empty-state">
          <h2>Create a workflow instance to start</h2>
          <p>The first state should activate fillForm, uploadDocuments, and payFee in parallel.</p>
        </section>
      )}
    </main>
  );
}

function getTransportMode(): "local" | "http" {
  return new URLSearchParams(window.location.search).get("transport") === "http" ? "http" : "local";
}

function getStorageNote(): string {
  if (getTransportMode() === "http") {
    return "HTTP demo mode: React calls createHttpWorkflowClient, which talks to a local FlowForge HTTP handler backed by memory storage.";
  }

  return "Local demo mode: React calls the FlowForge server object directly with memory storage. Add ?transport=http to test the HTTP client path.";
}

function CapabilityMap() {
  const { availableActions, instance } = useWorkflow();

  if (!instance) {
    return null;
  }

  const statuses = instance.stepStates;
  const reviewActions = availableActions
    .filter((action) => action.stepId === "cityReview")
    .map((action) => action.label);
  const missingMergeSteps = statuses.submitApplication?.missingStepIds ?? [];

  return (
    <section className="capability-map">
      <CapabilityCard
        label="Concurrent"
        note="fillForm, uploadDocuments, and payFee can move independently."
        status={getGroupStatus(statuses, ["fillForm", "uploadDocuments", "payFee"])}
        title="Parallel intake"
      />
      <CapabilityCard
        label="Merge"
        note={
          missingMergeSteps.length > 0
            ? `Waiting for ${missingMergeSteps.join(", ")}.`
            : "Submit Application is unlocked."
        }
        status={statuses.submitApplication?.status ?? "not_started"}
        title="All prerequisites"
      />
      <CapabilityCard
        label="Diverge"
        note={
          reviewActions.length > 0
            ? `Available: ${reviewActions.join(" or ")}.`
            : "City Review exposes approve/reject when active."
        }
        status={statuses.cityReview?.status ?? "not_started"}
        title="Review branch"
      />
      <CapabilityCard
        label="Loop"
        note="Reject activates Fix Issues, then returns to Submit Application."
        status={statuses.fixIssues?.status ?? "not_started"}
        title="Retry path"
      />
      <CapabilityCard
        label="Undo"
        note="Not implemented yet. History and revision make it the next runtime feature."
        status="not_started"
        title="Future runtime"
      />
    </section>
  );
}

interface CapabilityCardProps {
  readonly label: string;
  readonly title: string;
  readonly note: string;
  readonly status: WorkflowStepStatus;
}

function CapabilityCard({ label, note, status, title }: CapabilityCardProps) {
  return (
    <article className="capability-card" data-status={status}>
      <span>{label}</span>
      <strong>{title}</strong>
      <p>{note}</p>
    </article>
  );
}

function ScenarioGuide() {
  return (
    <section className="ff-panel scenario-guide">
      <h2>Scenario Paths</h2>
      <div className="scenario-columns">
        <article>
          <h3>Approval</h3>
          <ol>
            <li>Complete the three intake steps.</li>
            <li>Submit the application.</li>
            <li>Approve city review.</li>
          </ol>
        </article>
        <article>
          <h3>Retry</h3>
          <ol>
            <li>Submit the application.</li>
            <li>Reject city review.</li>
            <li>Complete Fix Issues and resubmit.</li>
          </ol>
        </article>
      </div>
    </section>
  );
}

function DebugPanel() {
  const { instance } = useWorkflow();

  if (!instance) {
    return null;
  }

  return (
    <section className="debug-panel" data-status={instance.status}>
      <span>Status: {instance.status}</span>
      <span>Revision: {instance.revision}</span>
      <span>Active: {instance.activeStepIds.join(", ") || "none"}</span>
      {instance.status === "completed" ? <strong>Workflow complete</strong> : null}
    </section>
  );
}

function getGroupStatus(
  stepStates: NonNullable<ReturnType<typeof useWorkflow>["instance"]>["stepStates"],
  stepIds: readonly string[]
): WorkflowStepStatus {
  const statuses = stepIds.map((stepId) => stepStates[stepId]?.status ?? "not_started");

  if (statuses.every((status) => status === "completed")) {
    return "completed";
  }

  if (statuses.some((status) => status === "active")) {
    return "active";
  }

  if (statuses.some((status) => status === "blocked")) {
    return "blocked";
  }

  return "not_started";
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
