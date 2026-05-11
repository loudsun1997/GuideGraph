# @flowforge/graph

Renderer-agnostic graph utilities for FlowForge workflow definitions and instances.

Use this package when you want workflow graph data without adopting a specific UI library.

```ts
import { buildWorkflowGraph } from "@flowforge/graph";

const graph = buildWorkflowGraph({
  definition: permitWorkflow,
  instance,
  history
});
```

The returned graph contains:

- step nodes
- dependency edges
- transition edges
- active, completed, blocked, waiting, skipped, failed, and not-started statuses
- blocked reasons and missing prerequisite ids
- terminal step markers
- loop edge markers
- visited node and edge hints when history is available

`buildWorkflowGraph()` also suppresses duplicate dependency-backed `COMPLETE_STEP` transition edges. This keeps merge diagrams readable when a step has both a dependency edge and a completion transition to the same target.

This package does not import React, React Flow, ELK, server, HTTP, or storage code. Developers can render its output with React Flow, Cytoscape, Mermaid, D3, SVG, canvas, or their own UI.
