#!/usr/bin/env node
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { handleGuideGraphMcpRequest, type JsonRpcRequest } from "./index.js";

const lines = createInterface({
  input: stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

lines.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  try {
    const request = JSON.parse(trimmed) as JsonRpcRequest;
    const response = await handleGuideGraphMcpRequest(request);
    if (response) {
      stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (cause) {
    stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: cause instanceof Error ? cause.message : "Invalid JSON-RPC request."
        }
      })}\n`
    );
  }
}
