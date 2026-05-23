import { useMemo, useState, type ReactNode } from "react";

type UseCaseId = "concurrent" | "blocked" | "branch" | "history";
type ShowcaseNodeStatus = "active" | "completed" | "blocked" | "waiting" | "attention";

interface UseCaseConfig {
  readonly id: UseCaseId;
  readonly label: string;
  readonly title: string;
  readonly note: string;
}

const useCases: readonly UseCaseConfig[] = [
  {
    id: "concurrent",
    label: "Concurrent",
    title: "Parallel intake",
    note: "Several active steps can move independently before the workflow reaches a merge."
  },
  {
    id: "blocked",
    label: "Merge",
    title: "Blocked merge",
    note: "Submit Application stays blocked until every prerequisite is complete."
  },
  {
    id: "branch",
    label: "Diverge",
    title: "Review outcomes",
    note: "City Review exposes approve and reject paths from the same active step."
  },
  {
    id: "history",
    label: "Loop",
    title: "History and retry",
    note: "Rejected applications can move through Fix Issues and return to review with history preserved."
  }
];
const defaultUseCase: UseCaseConfig = useCases[0] ?? {
  id: "blocked",
  label: "Merge",
  title: "Blocked merge",
  note: "Submit Application stays blocked until every prerequisite is complete."
};

export function WorkflowUseCaseShowcase(): ReactNode {
  const [activeUseCaseId, setActiveUseCaseId] = useState<UseCaseId>("blocked");
  const activeUseCase = useMemo(
    () => useCases.find((useCase) => useCase.id === activeUseCaseId) ?? defaultUseCase,
    [activeUseCaseId]
  );

  return (
    <section className="use-case-showcase" aria-labelledby="use-case-showcase-title">
      <header className="use-case-showcase-header">
        <div>
          <span>Graph use cases</span>
          <h2 id="use-case-showcase-title">{activeUseCase.title}</h2>
          <p>{activeUseCase.note}</p>
        </div>
        <div className="use-case-tabs" role="tablist" aria-label="Workflow graph use cases">
          {useCases.map((useCase) => (
            <button
              aria-selected={useCase.id === activeUseCaseId}
              className="use-case-tab"
              key={useCase.id}
              onClick={() => setActiveUseCaseId(useCase.id)}
              role="tab"
              type="button"
            >
              {useCase.label}
            </button>
          ))}
        </div>
      </header>
      <UseCasePanel id={activeUseCase.id} />
    </section>
  );
}

function UseCasePanel(props: { readonly id: UseCaseId }): ReactNode {
  if (props.id === "concurrent") {
    return <ConcurrentPanel />;
  }

  if (props.id === "branch") {
    return <BranchPanel />;
  }

  if (props.id === "history") {
    return <HistoryPanel />;
  }

  return <BlockedMergePanel />;
}

function ConcurrentPanel(): ReactNode {
  return (
    <ShowcaseFrame
      bottom={
        <>
          <ActionStrip
            actions={[
              { label: "Complete Fill Form", tone: "primary" },
              { label: "Upload Documents", tone: "secondary" },
              { label: "Pay Fee", tone: "secondary" }
            ]}
            title="Available Actions"
          />
          <Legend items={["Active", "Blocked", "Dependency edge", "Merge waits"]} />
        </>
      }
      side={
        <SidePanel title="Concurrent active steps">
          <p>GuideGraph instances can keep more than one step active at the same time.</p>
          <div className="side-list">
            <SideItem label="Fill Form" meta="Active" status="active" />
            <SideItem label="Upload Documents" meta="Active" status="active" />
            <SideItem label="Pay Fee" meta="Active" status="active" />
          </div>
        </SidePanel>
      }
    >
      <div className="showcase-canvas showcase-concurrent">
        <CanvasToolbar label="Concurrent mode" />
        <div className="node-stack">
          <ShowcaseNode status="active" subtitle="Applicant can edit form" title="Fill Form" />
          <ShowcaseNode status="active" subtitle="Files can upload in parallel" title="Upload Documents" />
          <ShowcaseNode status="active" subtitle="Payment can complete separately" title="Pay Fee" />
        </div>
        <div className="merge-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <ShowcaseNode className="merge-target" status="blocked" subtitle="Waiting for all intake steps" title="Submit Application" />
      </div>
    </ShowcaseFrame>
  );
}

function BlockedMergePanel(): ReactNode {
  return (
    <ShowcaseFrame
      bottom={
        <>
          <ActionStrip
            actions={[
              { label: "Complete Pay Fee", tone: "primary" },
              { label: "Open Upload Documents", tone: "secondary" }
            ]}
            title="Available Actions"
          />
          <Legend items={["Active", "Completed", "Blocked", "Not Started"]} />
        </>
      }
      side={
        <SidePanel title="Why this step is blocked">
          <AlertCard title="Submit Application is blocked">
            This step is waiting for every prerequisite to be completed.
          </AlertCard>
          <h3>Waiting on</h3>
          <SideItem label="Pay Fee" meta="Payment not completed" status="active" />
          <p>All prerequisites must be completed before the application can be submitted.</p>
        </SidePanel>
      }
    >
      <div className="showcase-canvas showcase-blocked">
        <CanvasToolbar label="Blocked merge view" />
        <div className="blocked-column">
          <ShowcaseNode status="completed" subtitle="Form completed" title="Fill Form" />
          <ShowcaseNode status="completed" subtitle="Documents uploaded" title="Upload Documents" />
          <ShowcaseNode status="active" subtitle="Payment not completed" title="Pay Fee" />
        </div>
        <div className="merge-dot" aria-hidden="true" />
        <ShowcaseNode className="submit-node" progress="2/3 complete" status="blocked" subtitle="Cannot submit yet" title="Submit Application" />
        <ShowcaseConnector className="to-review" />
        <ShowcaseNode className="review-node" status="waiting" subtitle="Not started" title="City Review" />
      </div>
    </ShowcaseFrame>
  );
}

function BranchPanel(): ReactNode {
  return (
    <ShowcaseFrame
      bottom={
        <>
          <ActionStrip
            actions={[
              { label: "Approve Review", tone: "success" },
              { label: "Reject Review", tone: "danger" }
            ]}
            title="Next actions"
          />
          <Legend items={["Active", "Completed", "Needs Attention", "Returns / Loops"]} />
        </>
      }
      side={
        <SidePanel title="Possible outcomes">
          <OutcomeCard label="If approved" status="completed" title="Permit Approved">
            The application is approved and the permit is issued.
          </OutcomeCard>
          <OutcomeCard label="If rejected" status="attention" title="Fix Issues -> Resubmit -> City Review">
            The applicant fixes issues and the workflow returns for another evaluation.
          </OutcomeCard>
        </SidePanel>
      }
    >
      <div className="showcase-canvas showcase-branch">
        <CanvasToolbar label="Outcome view" />
        <div className="faded-stack">
          <ShowcaseNode status="completed" subtitle="Form completed" title="Fill Form" />
          <ShowcaseNode status="completed" subtitle="Documents uploaded" title="Upload Documents" />
          <ShowcaseNode status="completed" subtitle="Payment completed" title="Pay Fee" />
          <ShowcaseNode status="completed" subtitle="Application submitted" title="Submit Application" />
        </div>
        <ShowcaseNode className="city-node" status="active" subtitle="In progress" title="City Review" />
        <LabelChip className="approved-label" label="approved" tone="success" />
        <ShowcaseNode className="approved-node" status="completed" subtitle="Process complete" title="Permit Approved" />
        <LabelChip className="rejected-label" label="rejected" tone="danger" />
        <ShowcaseNode className="fix-node" status="attention" subtitle="Address required items" title="Fix Issues" />
        <ShowcaseNode className="resubmit-node" status="attention" subtitle="Resubmit application" title="Resubmit" />
        <LabelChip className="loop-label" label="Loop / Retry" tone="info" />
      </div>
    </ShowcaseFrame>
  );
}

function HistoryPanel(): ReactNode {
  return (
    <ShowcaseFrame
      bottom={
        <>
          <ActionStrip
            actions={[
              { label: "History View", tone: "primary" },
              { label: "Reset View", tone: "secondary" }
            ]}
            title="View Controls"
          />
          <Legend items={["Completed", "Visited", "Not Visited", "Blocked"]} />
        </>
      }
      side={
        <SidePanel title="Workflow history">
          <HistoryItem label="Submitted" meta="Application submitted by Casey Smith" status="completed" />
          <HistoryItem label="Rejected" meta="Application rejected by City Reviewer" status="attention" />
          <HistoryItem label="Issues Fixed" meta="Applicant updated required information" status="attention" />
          <HistoryItem label="Resubmitted" meta="Application resubmitted by Casey Smith" status="completed" />
          <HistoryItem label="Approved" meta="Application approved by City Reviewer" status="active" />
        </SidePanel>
      }
    >
      <div className="showcase-canvas showcase-history">
        <CanvasToolbar label="History View" note="Showing visited path" />
        <div className="history-line">
          <ShowcaseNode status="completed" subtitle="May 12, 9:02 AM" title="Fill Form" />
          <ShowcaseNode status="completed" subtitle="May 12, 9:05 AM" title="Upload Documents" />
          <ShowcaseNode status="completed" subtitle="May 12, 9:07 AM" title="Pay Fee" />
          <ShowcaseNode status="completed" subtitle="May 12, 9:08 AM" title="Submit Application" />
          <ShowcaseNode status="active" subtitle="Reviewed May 12, 9:15 AM" title="City Review" />
          <ShowcaseNode status="active" subtitle="Completed May 12, 10:26 AM" title="Approved" />
        </div>
        <ShowcaseNode className="history-fix" status="attention" subtitle="Issues identified" title="Fix Issues" />
        <ShowcaseNode className="history-resubmit" status="completed" subtitle="Resubmitted" title="Resubmit" />
        <LabelChip className="history-loop" label="Loop / Retry" tone="info" />
      </div>
    </ShowcaseFrame>
  );
}

function ShowcaseFrame(props: {
  readonly bottom: ReactNode;
  readonly children: ReactNode;
  readonly side: ReactNode;
}): ReactNode {
  return (
    <div className="showcase-frame">
      <div className="showcase-main">{props.children}</div>
      <aside className="showcase-side">{props.side}</aside>
      <div className="showcase-bottom">{props.bottom}</div>
    </div>
  );
}

function ShowcaseNode(props: {
  readonly className?: string;
  readonly progress?: string;
  readonly status: ShowcaseNodeStatus;
  readonly subtitle: string;
  readonly title: string;
}): ReactNode {
  return (
    <article className={["showcase-node", props.className ?? ""].filter(Boolean).join(" ")} data-status={props.status}>
      <span className="showcase-node-icon" aria-hidden="true" />
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
        {props.progress ? <em>{props.progress}</em> : null}
      </div>
      <span className="showcase-node-state" aria-hidden="true" />
    </article>
  );
}

function ShowcaseConnector(props: { readonly className?: string }): ReactNode {
  return <span className={["showcase-connector", props.className ?? ""].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function LabelChip(props: {
  readonly className?: string;
  readonly label: string;
  readonly tone: "danger" | "info" | "success";
}): ReactNode {
  return (
    <span className={["showcase-label-chip", props.className ?? ""].filter(Boolean).join(" ")} data-tone={props.tone}>
      {props.label}
    </span>
  );
}

function CanvasToolbar(props: { readonly label: string; readonly note?: string }): ReactNode {
  return (
    <div className="canvas-toolbar">
      <span>{props.label}</span>
      {props.note ? <strong>{props.note}</strong> : null}
    </div>
  );
}

function SidePanel(props: { readonly children: ReactNode; readonly title: string }): ReactNode {
  return (
    <div className="showcase-side-panel">
      <header>
        <h3>{props.title}</h3>
        <span aria-hidden="true">x</span>
      </header>
      <div className="showcase-side-body">{props.children}</div>
    </div>
  );
}

function AlertCard(props: { readonly children: ReactNode; readonly title: string }): ReactNode {
  return (
    <article className="showcase-alert-card">
      <span className="showcase-alert-icon" aria-hidden="true" />
      <div>
        <strong>{props.title}</strong>
        <p>{props.children}</p>
      </div>
    </article>
  );
}

function SideItem(props: {
  readonly label: string;
  readonly meta: string;
  readonly status: ShowcaseNodeStatus;
}): ReactNode {
  return (
    <article className="side-item" data-status={props.status}>
      <span aria-hidden="true" />
      <div>
        <strong>{props.label}</strong>
        <small>{props.meta}</small>
      </div>
    </article>
  );
}

function OutcomeCard(props: {
  readonly children: ReactNode;
  readonly label: string;
  readonly status: ShowcaseNodeStatus;
  readonly title: string;
}): ReactNode {
  return (
    <article className="outcome-card" data-status={props.status}>
      <span>{props.label}</span>
      <strong>{props.title}</strong>
      <p>{props.children}</p>
    </article>
  );
}

function HistoryItem(props: {
  readonly label: string;
  readonly meta: string;
  readonly status: ShowcaseNodeStatus;
}): ReactNode {
  return (
    <article className="history-item" data-status={props.status}>
      <span aria-hidden="true" />
      <div>
        <strong>{props.label}</strong>
        <small>May 12</small>
        <p>{props.meta}</p>
      </div>
    </article>
  );
}

function ActionStrip(props: {
  readonly actions: ReadonlyArray<{ readonly label: string; readonly tone: "danger" | "primary" | "secondary" | "success" }>;
  readonly title: string;
}): ReactNode {
  return (
    <section className="showcase-bottom-card action-strip">
      <h3>{props.title}</h3>
      <div>
        {props.actions.map((action) => (
          <button data-tone={action.tone} key={action.label} type="button">
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Legend(props: { readonly items: readonly string[] }): ReactNode {
  return (
    <section className="showcase-bottom-card showcase-legend-card">
      <h3>Legend</h3>
      <div>
        {props.items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}
