import { describe, expect, it } from "vitest";
import { callGuideGraphMcpTool, handleGuideGraphMcpRequest } from "../src/index.ts";

const permitWorkflow = {
  id: "permit-application",
  name: "Permit Application",
  version: "1.0.0",
  startStepIds: ["fillForm", "uploadDocuments", "payFee"],
  steps: [
    { id: "fillForm", name: "Fill Form" },
    { id: "uploadDocuments", name: "Upload Documents" },
    { id: "payFee", name: "Pay Fee" },
    {
      id: "submitApplication",
      name: "Submit Application",
      dependencies: [{ type: "all" as const, stepIds: ["fillForm", "uploadDocuments", "payFee"] }]
    },
    { id: "cityReview", name: "City Review", dependencies: [{ type: "all" as const, stepIds: ["submitApplication"] }] },
    { id: "approved", name: "Approved", dependencies: [{ type: "all" as const, stepIds: ["cityReview"] }] },
    { id: "fixIssues", name: "Fix Issues", dependencies: [{ type: "all" as const, stepIds: ["cityReview"] }] }
  ],
  transitions: [
    { from: "fillForm", to: "submitApplication" },
    { from: "uploadDocuments", to: "submitApplication" },
    { from: "payFee", to: "submitApplication" },
    { from: "submitApplication", to: "cityReview", label: "Submit" },
    { from: "cityReview", to: "approved", event: "REVIEW_APPROVED", label: "Approve" },
    { from: "cityReview", to: "fixIssues", event: "REVIEW_REJECTED", label: "Reject" },
    { from: "fixIssues", to: "submitApplication", label: "Resubmit" }
  ]
};

describe("@guidegraph/mcp", () => {
  it("responds to initialize and lists GuideGraph tools", async () => {
    const initialized = await handleGuideGraphMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    });
    const tools = await handleGuideGraphMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });

    expect(initialized?.result).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: "guidegraph-mcp" }
    });
    expect(JSON.stringify(tools?.result)).toContain("guidegraph_validate_workflow");
    expect(JSON.stringify(tools?.result)).toContain("guidegraph_simulate_workflow");
  });

  it("validates workflow definitions through a tool call", async () => {
    const result = await callGuideGraphMcpTool("guidegraph_validate_workflow", {
      definition: { ...permitWorkflow, startStepIds: ["missing"] }
    });
    const validation = JSON.parse(result.content[0].text) as { readonly valid: boolean; readonly errors: string[] };

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("startStepIds references unknown step: missing");
  });

  it("builds a merge, branch, and retry-loop workflow from compact AI-friendly input", async () => {
    const result = await callGuideGraphMcpTool("guidegraph_build_workflow", {
      id: "permit-application",
      name: "Permit Application",
      version: "1.0.0",
      startStepIds: ["fillForm", "uploadDocuments", "payFee"],
      steps: [
        { id: "fillForm", name: "Fill Form" },
        { id: "uploadDocuments", name: "Upload Documents" },
        { id: "payFee", name: "Pay Fee" },
        {
          id: "submitApplication",
          name: "Submit Application",
          requiresAll: ["fillForm", "uploadDocuments", "payFee"]
        },
        { id: "cityReview", name: "City Review", requiresAll: ["submitApplication"] },
        { id: "approved", name: "Approved", requiresAll: ["cityReview"] },
        { id: "fixIssues", name: "Fix Issues", requiresAll: ["cityReview"] }
      ],
      transitions: permitWorkflow.transitions
    });
    const output = JSON.parse(result.content[0].text) as {
      readonly definition: typeof permitWorkflow;
      readonly validation: { readonly valid: boolean };
    };

    expect(output.validation.valid).toBe(true);
    expect(output.definition.steps.find((step) => step.id === "submitApplication")?.dependencies).toEqual([
      { type: "all", stepIds: ["fillForm", "uploadDocuments", "payFee"] }
    ]);
    expect(output.definition.transitions).toContainEqual({
      from: "cityReview",
      to: "fixIssues",
      event: "REVIEW_REJECTED",
      label: "Reject"
    });
  });

  it("simulates workflow events through the core engine", async () => {
    const result = await callGuideGraphMcpTool("guidegraph_simulate_workflow", {
      definition: permitWorkflow,
      instanceId: "permit_1",
      actorId: "agent_1",
      now: "2026-05-22T00:00:00.000Z",
      events: [
        { type: "COMPLETE_STEP", stepId: "fillForm", occurredAt: "2026-05-22T00:00:01.000Z" },
        { type: "COMPLETE_STEP", stepId: "uploadDocuments", occurredAt: "2026-05-22T00:00:02.000Z" },
        { type: "COMPLETE_STEP", stepId: "payFee", occurredAt: "2026-05-22T00:00:03.000Z" }
      ]
    });
    const output = JSON.parse(result.content[0].text) as {
      readonly instance: { readonly activeStepIds: readonly string[]; readonly revision: number };
      readonly availableActions: readonly { readonly stepId: string }[];
    };

    expect(output.instance.revision).toBe(3);
    expect(output.instance.activeStepIds).toEqual(["submitApplication"]);
    expect(output.availableActions).toContainEqual(expect.objectContaining({ stepId: "submitApplication" }));
  });

  it("returns structured JSON-RPC errors for unknown tools", async () => {
    const response = await handleGuideGraphMcpRequest({
      jsonrpc: "2.0",
      id: "call_1",
      method: "tools/call",
      params: {
        name: "missing_tool",
        arguments: {}
      }
    });

    expect(response?.error).toMatchObject({
      code: -32603,
      message: "Unknown GuideGraph MCP tool: missing_tool"
    });
  });
});
