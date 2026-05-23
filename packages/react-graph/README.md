# @guidegraph/react-graph

Optional React graph renderer for GuideGraph.

This package provides `<WorkflowGraph />`, powered by React Flow for the interactive canvas and ELK.js for automatic layered layout.

```tsx
import { WorkflowGraph } from "@guidegraph/react-graph";

export function PermitScreen() {
  return <WorkflowGraph />;
}
```

`<WorkflowGraph />` can read `definition`, `instance`, `history`, and `availableActions` from `WorkflowProvider`, or you can pass them directly:

```tsx
<WorkflowGraph definition={definition} instance={instance} />
```

The renderer visualizes:

- active steps
- completed steps
- blocked steps
- waiting and not-started steps
- failed and skipped states
- dependency edges
- transition edges
- branch labels
- retry loops
- blocked reasons
- selected step details
- available actions for the selected step
- dependency progress for blocked steps
- possible outgoing outcomes
- workflow history
- selected/related edge highlighting
- status and edge legend

Useful props include:

```tsx
<WorkflowGraph
  definition={definition}
  instance={instance}
  history={history}
  availableActions={availableActions}
  direction="RIGHT"
  initialSelectedStepId="submitApplication"
  getStepDescription={(step) => step.id}
/>
```

This package is intentionally separate from `@guidegraph/react` so teams that do not need a built-in graph do not install React Flow or ELK.
