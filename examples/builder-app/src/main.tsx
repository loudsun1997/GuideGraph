import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  builderDefinitionToWorkflowDefinition,
  createBuilderDefinition,
  createDefinitionSummary,
  type BuilderWorkflowDefinition,
  type WorkflowDraftStatus
} from "@guidegraph/builder";
import { WorkflowBuilder } from "@guidegraph/react-builder";
import type { WorkflowDefinition } from "@guidegraph/core";
import { permitBuilderWorkflow } from "./sampleWorkflow.js";
import "./styles.css";

function App() {
  const [definition, setDefinition] = useState<BuilderWorkflowDefinition>(permitBuilderWorkflow);
  const [status, setStatus] = useState<WorkflowDraftStatus>("draft");
  const [publishedDefinition, setPublishedDefinition] = useState<WorkflowDefinition | undefined>();
  const summary = useMemo(() => createDefinitionSummary({ definition, status }), [definition, status]);
  const runtimeDefinition = useMemo(() => builderDefinitionToWorkflowDefinition(definition), [definition]);

  return (
    <main className="builder-app">
      <header className="builder-app-header">
        <div>
          <span>GuideGraph Builder Example</span>
          <h1>Reusable workflow builder</h1>
          <p>
            This app exercises the optional builder packages: draft editing, React Flow canvas editing,
            validation, preview simulation, and publish output.
          </p>
        </div>
        <div className="builder-app-header-actions">
          <button
            type="button"
            onClick={() => {
              setDefinition(permitBuilderWorkflow);
              setStatus("draft");
              setPublishedDefinition(undefined);
            }}
          >
            Load permit template
          </button>
          <button
            type="button"
            onClick={() => {
              setDefinition(
                createBuilderDefinition({
                  id: "new-workflow",
                  name: "New Workflow",
                  version: "0.1.0",
                  description: "A blank workflow builder draft."
                })
              );
              setStatus("draft");
              setPublishedDefinition(undefined);
            }}
          >
            New blank draft
          </button>
          <button type="button" onClick={() => setStatus(status === "draft" ? "published" : "draft")}>
            {status === "draft" ? "Preview published lock" : "Return to draft"}
          </button>
        </div>
      </header>

      <section className="builder-app-grid">
        <WorkflowBuilder
          hasPublishedVersions={Boolean(publishedDefinition)}
          height={720}
          initialDefinition={definition}
          showJsonPreview={false}
          status={status}
          onChange={(nextDefinition) => {
            setDefinition(nextDefinition);
            if (status !== "draft") {
              setStatus("draft");
            }
          }}
          onPublish={(runtime, builderDefinition) => {
            setPublishedDefinition(runtime);
            setDefinition(builderDefinition);
            setStatus("published");
          }}
        />

        <aside className="builder-app-sidecar" aria-label="Builder developer output">
          <section>
            <span>Draft state</span>
            <h2>{status}</h2>
            <dl>
              <div>
                <dt>Steps</dt>
                <dd>{summary.stepCount}</dd>
              </div>
              <div>
                <dt>Starts</dt>
                <dd>{summary.startStepCount}</dd>
              </div>
              <div>
                <dt>Dependencies</dt>
                <dd>{summary.dependencyCount}</dd>
              </div>
              <div>
                <dt>Transitions</dt>
                <dd>{summary.transitionCount}</dd>
              </div>
              <div>
                <dt>Loops</dt>
                <dd>{summary.loopTransitionCount}</dd>
              </div>
            </dl>
          </section>

          <section>
            <span>Generated runtime definition</span>
            <pre>{JSON.stringify(runtimeDefinition, null, 2)}</pre>
          </section>

          <section>
            <span>Last published definition</span>
            {publishedDefinition ? <pre>{JSON.stringify(publishedDefinition, null, 2)}</pre> : <p>No publish yet.</p>}
          </section>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
