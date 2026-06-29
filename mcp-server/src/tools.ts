/**
 * MCP tool definitions for the CATAAM connector.
 *
 * Design: one-tool-per-action (the API surface is small — ~ a dozen
 * `/api/audit` endpoints — so search+execute would add overhead for no gain).
 * Tools follow a list → context → act shape.
 *
 * Write tools (rerun / due-date / jira-link) require an explicit `confirm: true`
 * argument; the server refuses the call without it and logs every executed write to
 * stderr. NOTE: `confirm` is a MODEL-supplied flag — it is NOT server-enforced human
 * approval. Real human-in-the-loop is provided by the slash-command workflows (which
 * confirm with the user before setting it); a server-enforced MCP elicitation/approval
 * is a roadmap item. Backend authorization (org-scoping, entitlement) is the real guard.
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

// Optional (default false) so the explicit "Refused" branch is reachable — not a schema
// error. NOTE: this is a model-supplied flag, not server-enforced human approval; the
// slash-command workflows are responsible for confirming with the user first.
const CONFIRM = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Must be set to true to execute this state-changing action. Defaults to false; the " +
      "server refuses the write without it. Confirm with the user before setting true."
  );

/** Append-only write log to stderr so every mutation is recorded by the host. */
function auditLog(action: string, args: Record<string, unknown>): void {
  console.error(`[cataam-mcp][write] ${new Date().toISOString()} ${action} ${JSON.stringify(args)}`);
}

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
        // Degrade gracefully — one failing sub-call shouldn't sink the whole overview.
        const [r, s, p] = await Promise.allSettled([
          client.getReadinessScore(),
          client.getComplianceSummary(),
          frameworkId ? client.getFrameworkProgress(frameworkId) : Promise.resolve(null),
        ]);
        const val = <T>(x: PromiseSettledResult<T>) => (x.status === "fulfilled" ? x.value : null);
        const readiness = val(r);
        const summary = val(s);
        const frameworkProgress = val(p);

        // Coverage caveat: the readiness score is computed over EXECUTED tests only, so a
        // single passing check can read "Audit Ready". Surface coverage so the model can't
        // over-claim audit-readiness (relays the backend's known scoring limitation).
        let coverage: { executedTests: number; totalTests: number; coveragePct: number } | null = null;
        let coverageCaveat: string | undefined;
        if (Array.isArray(summary)) {
          const rows = summary as Array<{ totalTests?: number; passedTests?: number; failedTests?: number }>;
          const totalTests = rows.reduce((a, f) => a + (f.totalTests ?? 0), 0);
          const executedTests = rows.reduce((a, f) => a + (f.passedTests ?? 0) + (f.failedTests ?? 0), 0);
          const coveragePct = totalTests ? Math.round((executedTests / totalTests) * 1000) / 10 : 0;
          coverage = { executedTests, totalTests, coveragePct };
          if (coveragePct < 60) {
            coverageCaveat =
              `⚠️ Readiness reflects EXECUTED tests only — ${executedTests}/${totalTests} ` +
              `(${coveragePct}%) executed. Do NOT report the org as audit-ready on this score alone; ` +
              `more tests must be run first.`;
          }
        }

        const partialErrors = [
          r.status === "rejected" ? `readinessScore: ${(r.reason as Error)?.message ?? r.reason}` : null,
          s.status === "rejected" ? `complianceSummary: ${(s.reason as Error)?.message ?? s.reason}` : null,
          p.status === "rejected" ? `frameworkProgress: ${(p.reason as Error)?.message ?? p.reason}` : null,
        ].filter(Boolean);

        return {
          readinessScore: readiness,
          complianceSummary: summary,
          frameworkProgress,
          coverage,
          ...(coverageCaveat ? { coverageCaveat } : {}),
          ...(partialErrors.length ? { partialErrors } : {}),
        };
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
      if (!confirm) return fail("Refused: rerun_compliance_test requires confirm=true. Confirm with the user first.");
      auditLog("rerun_compliance_test", { auditProgressId });
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
      if (!confirm) return fail("Refused: update_test_due_date requires confirm=true. Confirm with the user first.");
      auditLog("update_test_due_date", { auditProgressId, newDueDate });
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
      if (!confirm) return fail("Refused: link_test_to_jira requires confirm=true. Confirm with the user first.");
      auditLog("link_test_to_jira", { auditProgressId, jiraId });
      return guard(() => client.linkToJira(auditProgressId, jiraId));
    }
  );

  // ---- ACT: publish governance policies --------------------------------
  server.registerTool(
    "publish_policies",
    {
      title: "Publish adopted policies",
      description:
        "Publish every adopted-but-unpublished policy for the org in one step — the governance " +
        "remediation lever that lifts the readiness policy sub-score. This MUTATES state (formally " +
        "publishes the policies and raises human acknowledgement requests). Requires confirm=true. " +
        "Returns { published, alreadyPublished, total }.",
      inputSchema: {
        confirm: CONFIRM,
      },
    },
    async ({ confirm }) => {
      if (!confirm) return fail("Refused: publish_policies requires confirm=true. Confirm with the user first.");
      auditLog("publish_policies", {});
      return guard(() => client.publishPolicies());
    }
  );

  // ---- ACT: finalize governance documents ------------------------------
  server.registerTool(
    "publish_documents",
    {
      title: "Finalize adopted documents",
      description:
        "Put every not-yet-in-force document IN_FORCE for the org in one step — the documents " +
        "counterpart to publish_policies; lifts the readiness evidence sub-score. This MUTATES " +
        "state. Requires confirm=true. Returns { finalized, alreadyInForce, total }.",
      inputSchema: {
        confirm: CONFIRM,
      },
    },
    async ({ confirm }) => {
      if (!confirm) return fail("Refused: publish_documents requires confirm=true. Confirm with the user first.");
      auditLog("publish_documents", {});
      return guard(() => client.finalizeDocuments());
    }
  );

  // ---- ACT: remediate a failing document-presence control ---------------
  server.registerTool(
    "remediate_document_control",
    {
      title: "Remediate a document-presence control",
      description:
        "Fix a FAILING document-presence control (e.g. 'System Description (Section III)', " +
        "'Network diagram', 'Data inventory map', 'Risk Assessment') by AUTHORING the document " +
        "the control looks for and finalising it IN_FORCE, then re-running the control so the " +
        "verdict flips. Use this when the control's reason is 'No in-force document found for this " +
        "control' — publish_documents alone cannot fix it because there is no draft to finalise. " +
        "Pass the control's Tests id (the 'id' from list_compliance_tests). By default the document " +
        "is titled after the control and seeded with an honest scaffold that the org must complete; " +
        "pass title/content to provide your own. This MUTATES state and requires confirm=true. " +
        "Returns { documentId, title, testId, status, passed, authoredScaffold } with the REAL " +
        "post-run verdict — it never reports PASS unless the control actually passed.",
      inputSchema: {
        testId: z
          .number()
          .int()
          .positive()
          .describe("Tests id of the document-presence control (from list_compliance_tests)."),
        title: z
          .string()
          .min(1)
          .optional()
          .describe("Optional document title. Defaults to the control's test name (which satisfies the title match)."),
        content: z
          .string()
          .min(1)
          .optional()
          .describe("Optional document body. Defaults to an honest scaffold with [CONFIRM] items for the org to complete."),
        confirm: CONFIRM,
      },
    },
    async ({ testId, title, content, confirm }) => {
      if (!confirm) return fail("Refused: remediate_document_control requires confirm=true. Confirm with the user first.");
      auditLog("remediate_document_control", { testId, hasTitle: !!title, hasContent: !!content });
      return guard(() => client.remediateDocumentControl({ testId, title, content }));
    }
  );

  // ---- ACT: generate evidence document from the iASM Attack Graph --------
  server.registerTool(
    "generate_network_diagram_from_iasm",
    {
      title: "Generate network diagram / data inventory from iASM",
      description:
        "Generate a SOC 2 evidence document straight from the org's iASM Attack Graph (the " +
        "discovered asset topology) and finalise it IN_FORCE so the matching document-presence " +
        "control passes — 'your attack surface IS your network diagram'. Snapshots the live topology " +
        "(inventory by layer, a Mermaid diagram, provenance, and an embedded JSON snapshot for auditor " +
        "download) as a point-in-time artifact. Prefer this over remediate_document_control for the " +
        "'Network diagram' and 'Maintain data inventory map' controls — it produces a real, " +
        "evidence-backed artifact instead of a blank scaffold. kind='network-diagram' (default) targets " +
        "the Network diagram control; kind='data-inventory' targets the data inventory control. The " +
        "control's testId is resolved automatically unless you pass one. Requires a prior iASM connector " +
        "sync (errors if the graph is empty). MUTATES state; requires confirm=true. Returns " +
        "{ documentId, title, kind, assetCount, edgeCount, status, passed }. Leaves [CONFIRM] items " +
        "(management approval, non-discovered components) for the org to complete; never reports PASS " +
        "unless the control actually passed.",
      inputSchema: {
        kind: z
          .enum(["network-diagram", "data-inventory"])
          .default("network-diagram")
          .describe("Which evidence document to generate from the graph."),
        testId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional Tests id of the control to satisfy. Auto-resolved from kind if omitted."),
        confirm: CONFIRM,
      },
    },
    async ({ kind, testId, confirm }) => {
      if (!confirm) return fail("Refused: generate_network_diagram_from_iasm requires confirm=true. Confirm with the user first.");
      auditLog("generate_network_diagram_from_iasm", { kind, testId });
      return guard(() => client.generateIasmEvidenceDocument({ kind, testId }));
    }
  );

  // ---- EVIDENCE: drive manual-test execution ----------------------------
  // Manual controls (HR records, vendor reports, board minutes, …) can't be
  // auto-evaluated. The org admin executes them by opening an evidence request,
  // attaching evidence, and having a human reviewer accept it (acceptance latches
  // the control PASS). These tools cover the assemble+submit half; the reviewer
  // step stays human in the UI — there is intentionally no accept/reject tool.

  server.registerTool(
    "list_evidence_status",
    {
      title: "List evidence status",
      description:
        "Read the organization's manual-evidence state: org-wide counts " +
        "(requested / submitted / approved / rejected) and — when a testId is given — the " +
        "evidence requests already opened for that specific control. Use this to see which " +
        "manual tests still need evidence assembled or are awaiting review. The testId is the " +
        "Tests id (the 'id' field from list_compliance_tests), not the auditProgressId.",
      inputSchema: {
        testId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional Tests id to list that control's evidence requests."),
      },
    },
    async ({ testId }) =>
      guard(async () => {
        const [summary, requests] = await Promise.all([
          client.getEvidenceSummary(),
          testId ? client.listEvidenceForTest(testId) : Promise.resolve(null),
        ]);
        return { summary, requests };
      })
  );

  server.registerTool(
    "create_evidence_request",
    {
      title: "Open an evidence request for a manual control",
      description:
        "Open an evidence request against a manual compliance control so its execution can be " +
        "tracked and evidenced. This MUTATES state (creates a request record). Requires " +
        "confirm=true. testId is the Tests id from list_compliance_tests. Returns the created " +
        "request including its id — pass that id to attach_evidence.",
      inputSchema: {
        testId: z.number().int().positive().describe("Tests id (from list_compliance_tests)."),
        title: z.string().min(1).describe("Short title for the evidence request."),
        description: z.string().optional().describe("What evidence is being requested / context."),
        evidenceType: z
          .string()
          .optional()
          .describe("Evidence type hint, e.g. 'DOCUMENT', 'LINK', 'ANY' (default ANY)."),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date YYYY-MM-DD.")
          .optional()
          .describe("Optional due date, ISO YYYY-MM-DD."),
        confirm: CONFIRM,
      },
    },
    async ({ confirm, ...params }) => {
      if (!confirm)
        return fail("Refused: create_evidence_request requires confirm=true. Confirm with the user first.");
      auditLog("create_evidence_request", { testId: params.testId, title: params.title });
      return guard(() => client.createEvidenceRequest(params));
    }
  );

  server.registerTool(
    "attach_evidence",
    {
      title: "Attach evidence to a request",
      description:
        "Attach a note or an external link as evidence to an existing evidence request. This " +
        "MUTATES state. Requires confirm=true. Provide exactly one of `notes` (free text) or " +
        "`link` (a URL). Attaching evidence does NOT pass the control — a human reviewer must " +
        "accept it in the Cataam UI, which is what latches the control to PASS (separation of " +
        "duties). Find requestId via list_evidence_status or create_evidence_request.",
      inputSchema: {
        requestId: z.number().int().positive().describe("The evidence request id."),
        notes: z.string().optional().describe("Free-text evidence note. Mutually exclusive with link."),
        link: z.string().url().optional().describe("External evidence URL. Mutually exclusive with notes."),
        confirm: CONFIRM,
      },
    },
    async ({ requestId, notes, link, confirm }) => {
      if (!confirm)
        return fail("Refused: attach_evidence requires confirm=true. Confirm with the user first.");
      if ((notes && link) || (!notes && !link)) {
        return fail("Provide exactly one of `notes` or `link`.");
      }
      auditLog("attach_evidence", { requestId, kind: link ? "link" : "note" });
      return guard(() =>
        link
          ? client.attachEvidenceLink(requestId, link, notes)
          : client.attachEvidenceNote(requestId, notes as string)
      );
    }
  );

  // ---- OKF Context Engine ----------------------------------------------
  // Read + drive the Open Knowledge Format export of the org's compliance graph.

  server.registerTool(
    "get_okf_status",
    {
      title: "Get OKF Context Engine status",
      description:
        "Get the org's OKF (Open Knowledge Format) Context Engine status: whether it's enabled, the " +
        "delivery mode (MANAGED_EXPORT | GIT_SYNC | BOTH), last Git commit/push, last processed " +
        "sequence, and how many export bundles exist. Use to answer 'is OKF on?' or 'when did the " +
        "compliance bundle last sync?'.",
      inputSchema: {},
    },
    async () => guard(() => client.getOkfStatus())
  );

  server.registerTool(
    "list_okf_exports",
    {
      title: "List OKF export bundles",
      description:
        "List the org's point-in-time OKF export bundles (newest first): version, status, file count, " +
        "bundle SHA-256, pinned flag and timestamp — each a signed snapshot of the compliance graph " +
        "for auditor handoff. Returns the version id needed by get_okf_artifact / pin_okf_export.",
      inputSchema: {},
    },
    async () => guard(() => client.listOkfExports())
  );

  server.registerTool(
    "get_okf_artifact",
    {
      title: "Read an OKF bundle artifact (log.md or manifest)",
      description:
        "Fetch a TEXT artifact from a specific OKF export bundle. artifact='log' returns log.md — the " +
        "chronological audit/state-history timeline (best for 'what changed and when'); " +
        "artifact='manifest' returns MANIFEST.json — the per-file SHA-256 index. Pass the export " +
        "version from list_okf_exports. The binary .zip is downloaded from the Cataam UI, not here.",
      inputSchema: {
        version: z.string().min(1).describe("Export version id (from list_okf_exports)."),
        artifact: z.enum(["log", "manifest"]).default("log").describe("Which text artifact to fetch."),
      },
    },
    async ({ version, artifact }) =>
      guard(async () => ({ version, artifact, content: await client.getOkfArtifact(version, artifact) }))
  );

  server.registerTool(
    "generate_okf_export",
    {
      title: "Generate an OKF export bundle",
      description:
        "Compile a fresh signed point-in-time OKF bundle of the org's current compliance graph (for " +
        "auditor handoff or AI ingestion). MUTATES state (creates a new export). Requires confirm=true. " +
        "Returns the new export record (version, fileCount, bundleSha256, status).",
      inputSchema: { confirm: CONFIRM },
    },
    async ({ confirm }) => {
      if (!confirm) return fail("Refused: generate_okf_export requires confirm=true. Confirm with the user first.");
      auditLog("generate_okf_export", {});
      return guard(() => client.generateOkfExport());
    }
  );

  server.registerTool(
    "configure_okf",
    {
      title: "Configure the OKF Context Engine",
      description:
        "Update the org's OKF settings: enable/disable, delivery mode (MANAGED_EXPORT | GIT_SYNC | BOTH), " +
        "sync cron, signing, redaction profile, and — for Git modes — provider/repoUrl/branch. MUTATES " +
        "configuration. Requires confirm=true. Returns the saved config. (Git write credentials are " +
        "connected separately under Integrations, not here.)",
      inputSchema: {
        enabled: z.boolean().optional().describe("Turn the engine on/off for this org."),
        deliveryMode: z
          .enum(["MANAGED_EXPORT", "GIT_SYNC", "BOTH"])
          .optional()
          .describe("How the bundle is delivered."),
        scheduleCron: z.string().optional().describe("Spring cron for Git sync, e.g. '0 0 * * * *' (hourly)."),
        provider: z.enum(["GITHUB", "GITLAB", "BITBUCKET"]).optional().describe("Git provider (Git modes)."),
        repoUrl: z.string().optional().describe("Target repository URL (Git modes)."),
        branch: z.string().optional().describe("Target branch (Cataam-owned), default 'cataam-okf'."),
        signingEnabled: z.boolean().optional().describe("Ed25519-sign exports/commits for auditor verification."),
        redactionProfile: z.string().optional().describe("Redaction profile, e.g. 'pii'; omit/empty for none."),
        confirm: CONFIRM,
      },
    },
    async ({ confirm, ...body }) => {
      if (!confirm) return fail("Refused: configure_okf requires confirm=true. Confirm with the user first.");
      auditLog("configure_okf", body);
      return guard(() => client.configureOkf(body));
    }
  );

  server.registerTool(
    "pin_okf_export",
    {
      title: "Pin an OKF export",
      description:
        "Pin an OKF export so it is retained (exempt from retention garbage-collection) — use for an " +
        "audit-of-record snapshot. MUTATES state. Requires confirm=true. Pass the export version.",
      inputSchema: {
        version: z.string().min(1).describe("Export version id (from list_okf_exports)."),
        confirm: CONFIRM,
      },
    },
    async ({ version, confirm }) => {
      if (!confirm) return fail("Refused: pin_okf_export requires confirm=true. Confirm with the user first.");
      auditLog("pin_okf_export", { version });
      return guard(() => client.pinOkfExport(version));
    }
  );

  server.registerTool(
    "resync_okf_git",
    {
      title: "Sync the OKF bundle to Git now",
      description:
        "Trigger an immediate Git-sync delivery of the compliance bundle to the org's configured " +
        "repository (only meaningful when delivery mode includes GIT_SYNC). MUTATES the remote repo. " +
        "Requires confirm=true.",
      inputSchema: { confirm: CONFIRM },
    },
    async ({ confirm }) => {
      if (!confirm) return fail("Refused: resync_okf_git requires confirm=true. Confirm with the user first.");
      auditLog("resync_okf_git", {});
      return guard(() => client.resyncOkf());
    }
  );

  // ===== Trust Center authoring =====
  // NOTE: these hit /api/vendors and /api/trust-center/** which are NOT covered by the X-API-Key
  // scope (/api/audit, /api/okf). They require JWT auth — set CATAAM_USERNAME/CATAAM_PASSWORD
  // (an org admin with Manage Trust Center). With API-key-only config they return 401/403.

  // ---- LIST: connected vendors (the subprocessor source) ----------------
  server.registerTool(
    "list_vendors",
    {
      title: "List connected vendors",
      description:
        "List the org's vendors — the source for Trust Center subprocessors. Returns BOTH manually-" +
        "added GRC vendors (/api/vendors) AND connected integrations (/api/vendors/connections: AWS, " +
        "Azure, GitHub, Microsoft 365, Slack…). The connections set is what the Vendors UI shows and " +
        "what populate_subprocessors_from_vendors uses. Requires an API key (trust-center scope) or JWT auth.",
      inputSchema: {
        page: z.number().int().min(0).optional().default(0).describe("Page number for GRC vendors (default 0)."),
        size: z.number().int().min(1).max(200).optional().default(100).describe("Page size for GRC vendors (default 100)."),
      },
    },
    async ({ page, size }) =>
      guard(async () => {
        const [manualVendors, connectedIntegrations] = await Promise.all([
          client.listVendors(page, size).catch(() => []),
          client.listVendorConnections().catch(() => []),
        ]);
        return { manualVendors, connectedIntegrations };
      })
  );

  // ---- LIST: existing trust-center subprocessors (de-dupe) --------------
  server.registerTool(
    "list_subprocessors",
    {
      title: "List Trust Center subprocessors",
      description:
        "List the subprocessors already published on the org's Trust Center. Use before " +
        "add_subprocessor to avoid duplicates. Requires an API key (trust-center scope) or JWT auth.",
      inputSchema: {},
    },
    async () => guard(() => client.listSubprocessors())
  );

  // ---- ACT: add a subprocessor -----------------------------------------
  server.registerTool(
    "add_subprocessor",
    {
      title: "Add a Trust Center subprocessor",
      description:
        "Publish a subprocessor (a third party the org shares data with) on its public Trust Center " +
        "— typically created from a connected vendor (see list_vendors). MUTATES state; requires " +
        "confirm=true. Returns the created subprocessor. Requires an API key (trust-center scope) or JWT auth.",
      inputSchema: {
        name: z.string().min(1).describe("Subprocessor name, e.g. 'Amazon Web Services'."),
        category: z.string().optional().describe("e.g. 'Cloud infrastructure', 'Payments', 'Email'."),
        region: z.string().optional().describe("Hosting / processing region(s)."),
        purpose: z.string().optional().describe("What the subprocessor is used for."),
        dataCategories: z.string().optional().describe("Categories of data shared with them."),
        websiteUrl: z.string().optional().describe("Their privacy / trust / compliance URL."),
        sortOrder: z.number().int().optional().default(0).describe("Display order (lower first)."),
        showOnTrust: z.boolean().optional().default(true).describe("Show on the public trust page."),
        confirm: CONFIRM,
      },
    },
    async (p) => {
      if (!p.confirm) return fail("Refused: add_subprocessor requires confirm=true. Confirm with the user first.");
      auditLog("add_subprocessor", { name: p.name });
      const { confirm, ...body } = p;
      return guard(() => client.addSubprocessor(body));
    }
  );

  // ---- ACT: upload a trust document ------------------------------------
  server.registerTool(
    "upload_trust_document",
    {
      title: "Upload a Trust Center document",
      description:
        "Upload a document (SOC 2 report, policy, pen-test letter) to the org's Trust Center from a " +
        "local file path. Gated documents require a visitor access request; public ones are directly " +
        "downloadable. MUTATES state; requires confirm=true. Returns { id, title, fileSize }. " +
        "Requires an API key (trust-center scope) or JWT auth.",
      inputSchema: {
        filePath: z.string().min(1).describe("Absolute path to the local file to upload."),
        title: z.string().min(1).describe("Document title, e.g. 'SOC 2 Type II Report'."),
        category: z.string().optional().describe("e.g. 'Compliance', 'Policy', 'Security'."),
        gated: z.boolean().optional().default(true).describe("Require an access request (default true)."),
        showOnTrust: z.boolean().optional().default(true).describe("Show on the public trust page."),
        sortOrder: z.number().int().optional().default(0).describe("Display order (lower first)."),
        confirm: CONFIRM,
      },
    },
    async (p) => {
      if (!p.confirm) return fail("Refused: upload_trust_document requires confirm=true. Confirm with the user first.");
      auditLog("upload_trust_document", { title: p.title, filePath: p.filePath });
      return guard(() =>
        client.uploadTrustDocument({
          filePath: p.filePath,
          title: p.title,
          category: p.category,
          gated: p.gated,
          showOnTrust: p.showOnTrust,
          sortOrder: p.sortOrder,
        })
      );
    }
  );

  // ---- ACT: bulk-populate subprocessors from connected vendors ----------
  server.registerTool(
    "populate_subprocessors_from_vendors",
    {
      title: "Bulk-populate subprocessors from connected vendors",
      description:
        "One-shot: read the org's connected vendors and publish each as a Trust Center subprocessor, " +
        "skipping any that already exist (by name). Enriches known vendors (AWS, GCP, Jira, GitHub, …) " +
        "with a category + website. MUTATES state; requires confirm=true. Pass dryRun=true to PREVIEW " +
        "what would be created without writing (no confirm needed). Returns " +
        "{ vendorsFound, created, skipped, errors }. Requires an API key (trust-center scope) or JWT auth.",
      inputSchema: {
        showOnTrust: z.boolean().optional().default(true).describe("Show the created subprocessors on the public trust page."),
        dryRun: z.boolean().optional().default(false).describe("Preview only — list what would be created without writing."),
        confirm: CONFIRM,
      },
    },
    async (p) => {
      if (!p.dryRun && !p.confirm) {
        return fail("Refused: populate_subprocessors_from_vendors requires confirm=true (or dryRun=true to preview). Confirm with the user first.");
      }
      auditLog("populate_subprocessors_from_vendors", { dryRun: p.dryRun, showOnTrust: p.showOnTrust });
      return guard(() => client.populateSubprocessorsFromVendors({ showOnTrust: p.showOnTrust, dryRun: p.dryRun }));
    }
  );
}
