import { describe, expect, it } from "vitest";
import type { FlowForgeGraph } from "@flowforge/graph";
import { layoutWorkflowGraph } from "../src/index.tsx";

describe("layoutWorkflowGraph", () => {
  it("marks selected node and selected edges in React Flow data", async () => {
    const result = await layoutWorkflowGraph(graphFixture, {
      selectedStepId: "review"
    });
    const selectedNode = result.nodes.find((node) => node.id === "review");
    const selectedEdge = result.edges.find((edge) => edge.id === "transition:review:approved:APPROVE");

    expect(selectedNode?.data.selected).toBe(true);
    expect(selectedNode?.className).toContain("ff-flow-node-selected");
    expect(selectedEdge?.label).toBe("Approve");
    expect(selectedEdge?.className).toContain("ff-flow-edge-selected");
  });

  it("preserves dependency and loop edge classes", async () => {
    const result = await layoutWorkflowGraph(graphFixture, {
      selectedStepId: "fix"
    });

    expect(result.edges.find((edge) => edge.id === "dependency:draft:review:all")?.className).toContain(
      "ff-flow-edge-dependency"
    );
    expect(result.edges.find((edge) => edge.id === "transition:fix:review:COMPLETE_STEP")?.className).toContain(
      "ff-flow-edge-loop"
    );
  });
});

const graphFixture: FlowForgeGraph = {
  nodes: [
    {
      id: "draft",
      stepId: "draft",
      label: "Draft",
      kind: "step",
      status: "completed",
      terminal: false,
      active: false,
      completed: true,
      visited: true
    },
    {
      id: "review",
      stepId: "review",
      label: "Review",
      kind: "step",
      status: "active",
      terminal: false,
      active: true,
      completed: false,
      visited: true
    },
    {
      id: "approved",
      stepId: "approved",
      label: "Approved",
      kind: "step",
      status: "not_started",
      terminal: true,
      active: false,
      completed: false,
      visited: false
    },
    {
      id: "fix",
      stepId: "fix",
      label: "Fix",
      kind: "step",
      status: "blocked",
      terminal: false,
      active: false,
      completed: false,
      visited: false,
      blockedReason: "Waiting for review.",
      missingStepIds: ["review"]
    }
  ],
  edges: [
    {
      id: "dependency:draft:review:all",
      source: "draft",
      target: "review",
      kind: "dependency",
      status: "completed",
      label: "all",
      loop: false,
      visited: true
    },
    {
      id: "transition:review:approved:APPROVE",
      source: "review",
      target: "approved",
      kind: "transition",
      status: "available",
      label: "Approve",
      eventType: "APPROVE",
      loop: false,
      visited: false
    },
    {
      id: "transition:fix:review:COMPLETE_STEP",
      source: "fix",
      target: "review",
      kind: "transition",
      status: "inactive",
      eventType: "COMPLETE_STEP",
      loop: true,
      visited: false
    }
  ]
};
