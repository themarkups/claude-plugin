# cataam-mcp-server

The MCP connector for Cataam. TypeScript, built on `@modelcontextprotocol/sdk`.
Exposes Cataam's `/api/audit/**` compliance surface and the `/api/okf/**` OKF Context
Engine (open compliance-graph export) as MCP tools.

## Layout

```
src/
  config.ts   — env-var config + auth-mode selection (apiKey | jwt)
  client.ts   — typed HTTP client for /api/audit + /api/okf (X-API-Key and JWT+refresh)
  tools.ts    — the MCP tools (one-tool-per-action; write tools require confirm:true)
  index.ts    — entry point: stdio (default) or streamable-HTTP transport
test/
  smoke.mjs   — end-to-end test (spawns server over stdio, calls a read tool live)
```

## Develop

```bash
npm install
npm run build          # tsc → dist/
npm run dev            # run from source via tsx (stdio)
npm run smoke          # end-to-end smoke test (needs auth env vars + a built dist/)
```

## Configuration (env vars)

| Var | Purpose |
|---|---|
| `CATAAM_BASE_URL` | API base URL. Default `https://service.cataam.com`. |
| `CATAAM_API_KEY` | `X-API-Key` auth (preferred). |
| `CATAAM_USERNAME` / `CATAAM_PASSWORD` | JWT login auth (works today). |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `PORT` | HTTP port (default 3000) when `MCP_TRANSPORT=http`. |

If `CATAAM_API_KEY` is set it wins; otherwise username+password are used. Startup fails
fast with a clear message if neither is configured.

## Transports

- **stdio** — what the Claude plugin and `claude mcp add` use. Auth comes from env.
- **streamable-HTTP** — for remote/hosted SaaS deployment. Stateless: a fresh server is
  built per request, and an incoming `X-API-Key` request header overrides the env key,
  so one hosted process can serve many Cataam orgs. `GET`/`DELETE /mcp` return 405.

## Auth scoping note

Cataam's `X-API-Key` filter covers `/api/audit/**`, `/api/okf/**` (and a reserved
`/api/iasm/**`). All tools work under **both** auth modes; the OKF tools require a backend
that scopes the API-key filter to `/api/okf/**` (cataam-mcp-server ≥ 0.1.5 / platform with
that change) — under JWT they work regardless.

## Tools

See [`../README.md`](../README.md#mcp-tools).

**Compliance (`/api/audit`).** Read: `list_compliance_tests`, `get_compliance_overview`,
`list_failing_alerts`, `list_evidence_status`. Write (`confirm:true`):
`rerun_compliance_test`, `update_test_due_date`, `link_test_to_jira`, `publish_policies`,
`publish_documents`, `remediate_document_control`, `generate_network_diagram_from_iasm`,
`create_evidence_request`, `attach_evidence`.

**OKF Context Engine (`/api/okf`).** Read: `get_okf_status`, `list_okf_exports`,
`get_okf_artifact` (log.md / MANIFEST.json). Write (`confirm:true`): `generate_okf_export`,
`configure_okf`, `pin_okf_export`, `resync_okf_git`.
