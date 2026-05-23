# @guidegraph/mcp

MCP server tools for GuideGraph-aware AI agents.

Use this package when an AI agent or editor integration needs to validate, build, summarize, or simulate GuideGraph workflow definitions without importing the React UI, server runtime, or storage adapters.

## Why It Exists

GuideGraph workflows have domain-specific semantics:

- parallel start steps
- dependency rules: `all`, `any`, `atLeast`
- merge blocking
- branching transition events
- retry loops
- available actions
- history-producing events

Generic AI tools do not know those rules. `@guidegraph/mcp` exposes them as callable tools backed by the real `@guidegraph/core` and `@guidegraph/builder` packages.

## CLI

After building the package, run:

```sh
guidegraph-mcp
```

The stdio entrypoint speaks JSON-RPC-style MCP messages over newline-delimited stdio.

For local repo development:

```sh
pnpm --filter @guidegraph/mcp build
node packages/mcp/dist/stdio.js
```

## Tools

### `guidegraph_validate_workflow`

Validates a raw `WorkflowDefinition`.

Input:

```json
{
  "definition": {
    "id": "permit-application",
    "name": "Permit Application",
    "version": "1.0.0",
    "startStepIds": ["fillForm"],
    "steps": [{ "id": "fillForm", "name": "Fill Form" }]
  }
}
```

### `guidegraph_build_workflow`

Builds a `WorkflowDefinition` from a compact AI-friendly spec.

Input:

```json
{
  "id": "permit-application",
  "name": "Permit Application",
  "version": "1.0.0",
  "startStepIds": ["fillForm", "uploadDocuments", "payFee"],
  "steps": [
    { "id": "fillForm", "name": "Fill Form" },
    { "id": "uploadDocuments", "name": "Upload Documents" },
    { "id": "payFee", "name": "Pay Fee" },
    {
      "id": "submitApplication",
      "name": "Submit Application",
      "requiresAll": ["fillForm", "uploadDocuments", "payFee"]
    }
  ],
  "transitions": [
    { "from": "fillForm", "to": "submitApplication" },
    { "from": "uploadDocuments", "to": "submitApplication" },
    { "from": "payFee", "to": "submitApplication" }
  ]
}
```

### `guidegraph_simulate_workflow`

Creates an instance and applies events through `@guidegraph/core`.

This is useful for AI agents because they can prove that a generated workflow actually unlocks, branches, or loops as intended.

### `guidegraph_summarize_workflow`

Returns counts and high-level structure:

- step count
- start count
- dependency count
- transition count
- loop count
- validation result
- transition event types

## Programmatic API

```ts
import {
  callGuideGraphMcpTool,
  handleGuideGraphMcpRequest
} from "@guidegraph/mcp";
```

`handleGuideGraphMcpRequest()` supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

## Design Notes

This package intentionally does not depend on:

- React
- React Flow
- HTTP
- server runtime
- storage packages

It is an AI/tooling adapter around the stable GuideGraph definition model.
