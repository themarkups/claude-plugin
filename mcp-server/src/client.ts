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
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
