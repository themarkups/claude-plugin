/**
 * MCP tool definitions for the CATAAM connector.
 *
 * Design: one-tool-per-action (the API surface is small — ~ a dozen
 * `/api/audit` endpoints — so search+execute would add overhead for no gain).
 * Tools follow a list → context → act shape.
 *
 * Write tools (rerun / due-date / jira-link) require an explicit `confirm: true`
 * argument. The server refuses the call without it, so a model cannot mutate
 * compliance state without a deliberate, logged decision. The slash-command
 * skills instruct the model to confirm with the human before passing it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CataamClient, CataamError } from "./client.js";

/** Wrap a handler so CataamErrors become readable MCP error results. */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function guard(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof CataamError) {
      return fail(`CATAAM API error (${e.status}): ${e.message}\n${e.body ?? ""}`.trim());
    }
    return fail(`Unexpected error: ${(e as Error).message}`);
  }
}

const CONFIRM = z
  .boolean()
  .describe(
    "Must be true to execute this state-changing action. Confirm intent with the user before setting."
  );

export function registerTools(server: McpServer, client: CataamClient): void {
  // ---- LIST -------------------------------------------------------------
  server.registerTool(
    "list_compliance_tests",
    {
      title: "List compliance tests",
      description:
        "List CATAAM compliance tests (controls) with their pass/fail status and aggregate " +
        "stats, paginated. Use this to see which automated and manual checks exist for a " +
        "framework (SOC2, GDPR, ISO27001) and which are passing or failing. Returns the " +
        "auditProgressId for each test — needed by the write tools.",
      inputSchema: {
        page: z.number().int().min(0).default(0).describe("0-based page index."),
        size: z.number().int().min(1).max(500).default(20).describe("Page size (max 500)."),
        testName: z.string().optional().describe("Filter by test name substring."),
        frameWork: z
          .string()
          .optional()
          .describe("Filter by framework, e.g. 'SOC2', 'GDPR', 'ISO27001'."),
        category: z.string().optional().describe("Filter by requirement category, e.g. 'CC1'."),
        status: z
          .enum(["PASS", "FAIL", "IN_PROGRESS", "COMPLETED"])
          .optional()
          .describe("Filter by last audit status."),
        auditId: z.string().optional().describe("Filter by a specific audit id."),
      },
    },
    async (args) => guard(() => client.listComplianceTests(args))
  );

  // ---- CONTEXT / OVERVIEW ----------------------------------------------
  server.registerTool(
    "get_compliance_overview",
    {
      title: "Get compliance overview",
      description:
        "Get a high-level compliance posture for the organization: overall readiness score " +
        "(with test/policy/evidence breakdown), per-framework pass-rate summary, and — when a " +
        "frameworkId is given — that framework's detailed audit-progress stats. Use this to " +
        "answer 'how compliant are we?' or 'are we audit-ready for SOC2?'.",
      inputSchema: {
        frameworkId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional framework id to include detailed per-framework progress."),
      },
    },
    async ({ frameworkId }) =>
      guard(async () => {
        const [readiness, summary, progress] = await Promise.all([
          client.getReadinessScore(),
          client.getComplianceSummary(),
          frameworkId ? client.getFrameworkProgress(frameworkId) : Promise.resolve(null),
        ]);
        return { readinessScore: readiness, complianceSummary: summary, frameworkProgress: progress };
      })
  );

  // ---- ALERTS -----------------------------------------------------------
  server.registerTool(
    "list_failing_alerts",
    {
      title: "List failing / monitoring alerts",
      description:
        "List the organization's open compliance problems: the latest failing-test alerts plus " +
        "continuous-control-monitoring (CCM) alerts. Use this to triage what needs remediation. " +
        "Each failing test includes its auditProgressId for use with rerun_compliance_test.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const [failedTests, ccmAlerts] = await Promise.all([
          client.getFailedTestAlerts(),
          client.getCcmAlerts(),
        ]);
        return { failedTests, ccmAlerts };
      })
  );

  // ---- ACT: rerun (the "fix/verify" action) -----------------------------
  server.registerTool(
    "rerun_compliance_test",
    {
      title: "Re-run a compliance test",
      description:
        "Re-execute a single compliance test to verify a remediation. This MUTATES compliance " +
        "state: it runs the underlying automated check and updates the test's pass/fail status. " +
        "Requires confirm=true. Returns { id, status, passed }. Find auditProgressId via " +
        "list_compliance_tests or list_failing_alerts.",
      inputSchema: {
        auditProgressId: z.number().int().positive().describe("The test's auditProgressId."),
        confirm: CONFIRM,
      },
    },
    async ({ auditProgressId, confirm }) => {
      if (!confirm) return fail("Refused: rerun_compliance_test requires confirm=true.");
      return guard(() => client.rerunTest(auditProgressId));
    }
  );

  // ---- ACT: update due date --------------------------------------------
  server.registerTool(
    "update_test_due_date",
    {
      title: "Update a compliance test's due date",
      description:
        "Set the remediation due date for a compliance test. This MUTATES the record. " +
        "Requires confirm=true.",
      inputSchema: {
        auditProgressId: z.number().int().positive().describe("The test's auditProgressId."),
        newDueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date YYYY-MM-DD.")
          .describe("New due date, ISO format YYYY-MM-DD."),
        confirm: CONFIRM,
      },
    },
    async ({ auditProgressId, newDueDate, confirm }) => {
      if (!confirm) return fail("Refused: update_test_due_date requires confirm=true.");
      return guard(() => client.updateDueDate(auditProgressId, newDueDate));
    }
  );

  // ---- ACT: link to Jira ------------------------------------------------
  server.registerTool(
    "link_test_to_jira",
    {
      title: "Link a compliance test to a Jira issue",
      description:
        "Associate a compliance test with a Jira issue key (e.g. 'SEC-123') for remediation " +
        "tracking. This MUTATES the record. Requires confirm=true.",
      inputSchema: {
        auditProgressId: z.number().int().positive().describe("The test's auditProgressId."),
        jiraId: z.string().min(1).describe("Jira issue key, e.g. 'SEC-123'."),
        confirm: CONFIRM,
      },
    },
    async ({ auditProgressId, jiraId, confirm }) => {
      if (!confirm) return fail("Refused: link_test_to_jira requires confirm=true.");
      return guard(() => client.linkToJira(auditProgressId, jiraId));
    }
  );
}
