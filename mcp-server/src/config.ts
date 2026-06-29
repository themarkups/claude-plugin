/**
 * Runtime configuration for the CATAAM MCP connector.
 *
 * Two auth modes are supported (see README "Authentication"):
 *   1. API key   — `X-API-Key` header. Preferred long-term integration path.
 *                  Set CATAAM_API_KEY. Provision/revoke keys in the Cataam app: Settings → API Keys.
 *   2. JWT login — username/password exchanged at POST /api/login for a short-lived
 *                  bearer token. Works today. Set CATAAM_USERNAME + CATAAM_PASSWORD.
 *
 * Secrets are NEVER hardcoded — they are read from env vars only.
 */

export interface CataamConfig {
  /** Base URL of the CATAAM API, no trailing slash. Default: https://service.cataam.com */
  baseUrl: string;
  /** X-API-Key value (api-key auth mode). */
  apiKey?: string;
  /** Username for JWT login (jwt auth mode). */
  username?: string;
  /** Password for JWT login (jwt auth mode). */
  password?: string;
}

export type AuthMode = "apiKey" | "jwt";

/**
 * Build config from env vars, with optional per-request overrides
 * (used by the HTTP transport to pass a per-request X-API-Key).
 */
export function loadConfig(overrides: Partial<CataamConfig> = {}): CataamConfig {
  const baseUrl = (
    overrides.baseUrl ??
    process.env.CATAAM_BASE_URL ??
    "https://service.cataam.com"
  ).replace(/\/+$/, "");

  const apiKey = overrides.apiKey ?? process.env.CATAAM_API_KEY ?? undefined;
  const username = overrides.username ?? process.env.CATAAM_USERNAME ?? undefined;
  const password = overrides.password ?? process.env.CATAAM_PASSWORD ?? undefined;

  if (!apiKey && !(username && password)) {
    throw new Error(
      "CATAAM auth not configured. Set CATAAM_API_KEY (recommended), " +
        "or CATAAM_USERNAME and CATAAM_PASSWORD for JWT login."
    );
  }

  return { baseUrl, apiKey, username, password };
}

export function authMode(cfg: CataamConfig): AuthMode {
  return cfg.apiKey ? "apiKey" : "jwt";
}
