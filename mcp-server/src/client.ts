/**
 * Thin typed HTTP client for the CATAAM `/api/audit/**` compliance surface.
 *
 * Handles both auth modes:
 *   - apiKey: sends `X-API-Key` on every request.
 *   - jwt:    logs in at POST /api/login, caches the token, and transparently
 *             re-authenticates once on a 401 (short-lived tokens expire).
 */

import { CataamConfig, authMode } from "./config.js";

export class CataamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "CataamError";
  }
}

type Query = Record<string, string | number | undefined>;

export class CataamClient {
  private token?: string;

  constructor(private readonly cfg: CataamConfig) {}

  // ---- auth -------------------------------------------------------------

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.cfg.apiKey) return { "X-API-Key": this.cfg.apiKey };
    if (!this.token) await this.login();
    return { Authorization: `Bearer ${this.token}` };
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.cfg.baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: this.cfg.username,
        password: this.cfg.password,
      }),
    });
    if (!res.ok) {
      throw new CataamError(
        `Login failed for user "${this.cfg.username}"`,
        res.status,
        await safeText(res)
      );
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new CataamError("Login response missing token", res.status);
    }
    this.token = data.token;
  }

  // ---- core request -----------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; retryOn401?: boolean } = {}
  ): Promise<T> {
    const url = new URL(this.cfg.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = { ...(await this.authHeaders()) };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { method, headers, body });

    // JWT expired mid-session — re-login once and retry.
    if (
      res.status === 401 &&
      authMode(this.cfg) === "jwt" &&
      opts.retryOn401 !== false
    ) {
      this.token = undefined;
      await this.login();
      return this.request<T>(method, path, { ...opts, retryOn401: false });
    }

    if (!res.ok) {
      throw new CataamError(
        `${method} ${path} → ${res.status}`,
        res.status,
        await safeText(res)
      );
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ---- read endpoints ---------------------------------------------------

  /** GET /api/audit/tests — paginated compliance tests + aggregate stats. */
  listComplianceTests(params: {
    page?: number;
    size?: number;
    testName?: string;
    frameWork?: string;
    category?: string;
    status?: string;
    auditId?: string;
  }): Promise<unknown> {
    return this.request("GET", "/api/audit/tests", { query: { ...params } });
  }

  /** GET /api/audit/{frameworkId}/audit-progress — per-framework progress stats. */
  getFrameworkProgress(frameworkId: number): Promise<unknown> {
    return this.request("GET", `/api/audit/${frameworkId}/audit-progress`);
  }

  /** GET /api/audit/compliance-summary — per-framework totals & pass rate. */
  getComplianceSummary(): Promise<unknown> {
    return this.request("GET", "/api/audit/compliance-summary");
  }

  /** GET /api/audit/readiness-score — overall readiness score breakdown. */
  getReadinessScore(): Promise<unknown> {
    return this.request("GET", "/api/audit/readiness-score");
  }

  /** GET /api/audit/latest-failed-tests-alert — most recent failing-test alerts. */
  getFailedTestAlerts(): Promise<unknown> {
    return this.request("GET", "/api/audit/latest-failed-tests-alert");
  }

  /** GET /api/audit/ccm-alerts — continuous control monitoring alerts. */
  getCcmAlerts(): Promise<unknown> {
    return this.request("GET", "/api/audit/ccm-alerts");
  }

  // ---- write endpoints (callers must confirm first) ---------------------

  /** POST /api/audit/tests/{auditProgressId}/rerun — re-execute one compliance test. */
  rerunTest(auditProgressId: number): Promise<unknown> {
    return this.request("POST", `/api/audit/tests/${auditProgressId}/rerun`);
  }

  /**
   * PUT /api/audit/tests/{auditProgressId}/update-due-date?newDueDate=...
   * The backend parses the value with Instant.parse(), so it requires a full
   * ISO-8601 instant. A bare YYYY-MM-DD is expanded to UTC midnight.
   */
  updateDueDate(auditProgressId: number, newDueDate: string): Promise<unknown> {
    const instant = /^\d{4}-\d{2}-\d{2}$/.test(newDueDate)
      ? `${newDueDate}T00:00:00Z`
      : newDueDate;
    return this.request(
      "PUT",
      `/api/audit/tests/${auditProgressId}/update-due-date`,
      { query: { newDueDate: instant } }
    );
  }

  /** PATCH /api/audit/tests/{auditProgressId}/jira-link — body { jiraId }. */
  linkToJira(auditProgressId: number, jiraId: string): Promise<unknown> {
    return this.request(
      "PATCH",
      `/api/audit/tests/${auditProgressId}/jira-link`,
      { body: { jiraId } }
    );
  }

  /**
   * POST /api/audit/governance/publish-policies — publish every adopted-but-unpublished policy
   * for the org. A genuine governance action that lifts the readiness policy sub-score.
   */
  publishPolicies(): Promise<unknown> {
    return this.request("POST", "/api/audit/governance/publish-policies");
  }

  /**
   * POST /api/audit/governance/finalize-documents — put every not-yet-in-force document IN_FORCE
   * for the org. Genuine governance action that lifts the readiness evidence sub-score.
   */
  finalizeDocuments(): Promise<unknown> {
    return this.request("POST", "/api/audit/governance/finalize-documents");
  }

  /**
   * POST /api/audit/documents/remediate — author + finalise the document a
   * document-presence control looks for, then re-run the control. The authoring
   * half that finalizeDocuments() (finalise-only) cannot do. Returns the new
   * document id and the genuine post-run verdict.
   */
  remediateDocumentControl(params: {
    testId: number;
    title?: string;
    content?: string;
  }): Promise<unknown> {
    return this.request("POST", "/api/audit/documents/remediate", { body: params });
  }

  /**
   * POST /api/audit/documents/network-diagram-from-iasm — generate a SOC 2 evidence
   * document straight from the iASM Attack Graph (discovered topology), finalise it
   * IN_FORCE, and re-run the matching document-presence control. Supports
   * kind="network-diagram" (Network diagram control) and kind="data-inventory"
   * (Maintain data inventory map control). Returns the new document id, asset/edge
   * counts, and the genuine post-run verdict.
   */
  generateIasmEvidenceDocument(params: {
    kind?: "network-diagram" | "data-inventory";
    testId?: number;
  }): Promise<unknown> {
    return this.request("POST", "/api/audit/documents/network-diagram-from-iasm", { body: params });
  }

  // ---- evidence workflow (manual-test execution) -----------------------

  /** POST /api/audit/evidence/requests/by-test — open an evidence request for a control. */
  createEvidenceRequest(params: {
    testId: number;
    title: string;
    description?: string;
    evidenceType?: string;
    dueDate?: string;
  }): Promise<unknown> {
    return this.request("POST", "/api/audit/evidence/requests/by-test", { body: params });
  }

  /** POST /api/audit/evidence/requests/{id}/items/note — attach a free-text note. */
  attachEvidenceNote(requestId: number, notes: string): Promise<unknown> {
    return this.request("POST", `/api/audit/evidence/requests/${requestId}/items/note`, {
      body: { notes },
    });
  }

  /** POST /api/audit/evidence/requests/{id}/items/link — attach an external link. */
  attachEvidenceLink(requestId: number, externalLink: string, notes?: string): Promise<unknown> {
    return this.request("POST", `/api/audit/evidence/requests/${requestId}/items/link`, {
      body: { externalLink, notes },
    });
  }

  /** GET /api/audit/evidence/requests/test/{testId} — requests already opened for a control. */
  listEvidenceForTest(testId: number): Promise<unknown> {
    return this.request("GET", `/api/audit/evidence/requests/test/${testId}`);
  }

  /** GET /api/audit/evidence/summary — org-wide evidence counts. */
  getEvidenceSummary(): Promise<unknown> {
    return this.request("GET", "/api/audit/evidence/summary");
  }

  // ---- OKF Context Engine (/api/okf) -----------------------------------

  /** GET /api/okf/status — engine status: enabled, delivery mode, last sync, export count. */
  getOkfStatus(): Promise<unknown> {
    return this.request("GET", "/api/okf/status");
  }

  /** GET /api/okf/exports — list of point-in-time export bundles (newest first). */
  listOkfExports(): Promise<unknown> {
    return this.request("GET", "/api/okf/exports");
  }

  /** POST /api/okf/export — generate a new signed point-in-time export. */
  generateOkfExport(): Promise<unknown> {
    return this.request("POST", "/api/okf/export");
  }

  /** POST /api/okf/resync — trigger a Git-sync delivery now (Git delivery modes only). */
  resyncOkf(): Promise<unknown> {
    return this.request("POST", "/api/okf/resync");
  }

  /** POST /api/okf/exports/{version}/pin — pin an export (exempt from retention GC). */
  pinOkfExport(version: string): Promise<unknown> {
    return this.request("POST", `/api/okf/exports/${encodeURIComponent(version)}/pin`);
  }

  /** PUT /api/okf/config — update engine settings; returns the saved config. */
  configureOkf(body: {
    enabled?: boolean;
    deliveryMode?: "GIT_SYNC" | "MANAGED_EXPORT" | "BOTH";
    scheduleCron?: string;
    provider?: string;
    repoUrl?: string;
    branch?: string;
    signingEnabled?: boolean;
    redactionProfile?: string | null;
  }): Promise<unknown> {
    return this.request("PUT", "/api/okf/config", { body });
  }

  /**
   * GET /api/okf/exports/{version}/download?artifact=log|manifest — fetch a TEXT
   * artifact from a bundle. log.md is markdown; manifest is JSON text. The binary
   * "bundle" zip is intentionally not exposed over MCP — the UI signed-URL download
   * is the right channel for that.
   */
  getOkfArtifact(version: string, artifact: "log" | "manifest"): Promise<string> {
    return this.requestText(
      `/api/okf/exports/${encodeURIComponent(version)}/download`,
      { artifact }
    );
  }

  /** Like request() but returns raw response text (no JSON.parse) — for log.md / manifest. */
  private async requestText(path: string, query?: Query): Promise<string> {
    const url = new URL(this.cfg.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const doFetch = async () => fetch(url, { method: "GET", headers: { ...(await this.authHeaders()) } });
    let res = await doFetch();
    if (res.status === 401 && authMode(this.cfg) === "jwt") {
      this.token = undefined;
      await this.login();
      res = await doFetch();
    }
    if (!res.ok) throw new CataamError(`GET ${path} → ${res.status}`, res.status, await safeText(res));
    return res.text();
  }

  // ---- Trust Center + vendors (org-scoped; JWT auth only — NOT in the X-API-Key scope) ----

  /** GET /api/vendors — the org's connected vendors (the natural subprocessor source). */
  listVendors(page = 0, size = 100): Promise<unknown> {
    return this.request("GET", "/api/vendors", { query: { page, size } });
  }

  /** GET /api/trust-center/subprocessors — subprocessors already on the org's trust page. */
  listSubprocessors(): Promise<unknown> {
    return this.request("GET", "/api/trust-center/subprocessors");
  }

  /** POST /api/trust-center/subprocessors — publish a subprocessor on the public trust page. */
  addSubprocessor(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/api/trust-center/subprocessors", { body });
  }

  /** POST /api/trust-center/documents — multipart upload of a trust document from a local file. */
  async uploadTrustDocument(args: {
    filePath: string;
    title: string;
    category?: string;
    gated?: boolean;
    showOnTrust?: boolean;
    sortOrder?: number;
  }): Promise<unknown> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const bytes = await fs.readFile(args.filePath);
    const fname = path.basename(args.filePath);
    const build = (): FormData => {
      const fd = new FormData();
      fd.append("file", new Blob([bytes]), fname);
      fd.append("title", args.title);
      if (args.category) fd.append("category", args.category);
      fd.append("gated", String(args.gated ?? true));
      fd.append("showOnTrust", String(args.showOnTrust ?? true));
      fd.append("sortOrder", String(args.sortOrder ?? 0));
      return fd;
    };
    // Don't set Content-Type — fetch derives the multipart boundary from the FormData body.
    const send = async () =>
      fetch(`${this.cfg.baseUrl}/api/trust-center/documents`, {
        method: "POST",
        headers: { ...(await this.authHeaders()) },
        body: build(),
      });
    let res = await send();
    if (res.status === 401 && authMode(this.cfg) === "jwt") {
      this.token = undefined;
      res = await send();
    }
    if (!res.ok) {
      throw new CataamError(
        `POST /api/trust-center/documents → ${res.status}`,
        res.status,
        await safeText(res)
      );
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  /**
   * Bulk: map every connected vendor to a Trust Center subprocessor, skipping any that already
   * exist (by name). Enriches known vendors with a category/website. dryRun previews without writing.
   */
  async populateSubprocessorsFromVendors(
    opts: { showOnTrust?: boolean; dryRun?: boolean } = {}
  ): Promise<unknown> {
    const ENRICH: Record<string, { category: string; region?: string; websiteUrl?: string }> = {
      aws: { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://aws.amazon.com/compliance/" },
      "amazon web services": { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://aws.amazon.com/compliance/" },
      gcp: { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://cloud.google.com/security/compliance" },
      "google cloud": { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://cloud.google.com/security/compliance" },
      "google cloud platform": { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://cloud.google.com/security/compliance" },
      azure: { category: "Cloud infrastructure", region: "Multi-region", websiteUrl: "https://learn.microsoft.com/azure/compliance/" },
      jira: { category: "Issue tracking", websiteUrl: "https://www.atlassian.com/trust" },
      atlassian: { category: "Issue tracking", websiteUrl: "https://www.atlassian.com/trust" },
      github: { category: "Source control", websiteUrl: "https://github.com/security" },
      stripe: { category: "Payments", websiteUrl: "https://stripe.com/privacy" },
      twilio: { category: "Communications", websiteUrl: "https://www.twilio.com/legal/privacy" },
    };

    const raw = (await this.listVendors(0, 200)) as any;
    const vendors: any[] = Array.isArray(raw) ? raw : (raw?.content ?? []);
    const existing = ((await this.listSubprocessors()) as any[]) ?? [];
    const seen = new Set(existing.map((s) => String(s?.name ?? "").trim().toLowerCase()));

    const created: string[] = [];
    const skipped: string[] = [];
    const errors: { name: string; error: string }[] = [];
    let order = existing.length;

    for (const v of vendors) {
      const vn = v?.vendorName;
      const name = (typeof vn === "string" ? vn : vn?.displayName ?? vn?.name ?? "").toString().trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) {
        skipped.push(name);
        continue;
      }
      seen.add(key);
      const e = ENRICH[key] ?? { category: "Third-party service" };
      const body: Record<string, unknown> = {
        name,
        category: e.category,
        region: e.region,
        websiteUrl: e.websiteUrl,
        purpose: `Connected ${e.category.toLowerCase()} integrated with the platform.`,
        sortOrder: order++,
        showOnTrust: opts.showOnTrust ?? true,
      };
      if (opts.dryRun) {
        created.push(name);
        continue;
      }
      try {
        await this.addSubprocessor(body);
        created.push(name);
      } catch (err) {
        errors.push({ name, error: (err as Error).message });
      }
    }
    return { vendorsFound: vendors.length, created, skipped, errors, dryRun: !!opts.dryRun };
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
