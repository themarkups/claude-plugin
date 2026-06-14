#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Spawns the built MCP server over stdio (exactly as the Claude plugin does),
 * lists its tools, and calls one READ tool (`get_compliance_overview`) against
 * the live CATAAM API. No writes are performed.
 *
 * Requires auth env vars (CATAAM_API_KEY, or CATAAM_USERNAME + CATAAM_PASSWORD)
 * and optionally CATAAM_BASE_URL. Run after `npm run build`:
 *
 *     CATAAM_BASE_URL=... CATAAM_API_KEY=... npm run smoke
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(__dirname, "../dist/index.js");

const EXPECTED_TOOLS = [
  "list_compliance_tests",
  "get_compliance_overview",
  "list_failing_alerts",
  "rerun_compliance_test",
  "update_test_due_date",
  "link_test_to_jira",
];

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env },
});
const client = new Client({ name: "cataam-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  console.log("→ connected to cataam MCP server over stdio");

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log("→ tools:", names.join(", "));
  for (const t of EXPECTED_TOOLS) {
    assert(names.includes(t), `tool registered: ${t}`);
  }

  console.log("→ calling read tool: get_compliance_overview");
  const res = await client.callTool({ name: "get_compliance_overview", arguments: {} });
  assert(!res.isError, "get_compliance_overview returned without error");
  const text = res.content?.[0]?.text ?? "";
  console.log("→ response (truncated):\n" + text.slice(0, 800));
  assert(text.length > 0, "got a non-empty response payload");

  console.log("\n✅ smoke test passed");
} catch (err) {
  console.error("\n✗ smoke test failed:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
