# cataam-mcp-server

The MCP connector for Cataam. TypeScript, built on `@modelcontextprotocol/sdk`.
Exposes Cataam's `/api/audit/**` compliance surface as MCP tools.

## Layout

```
src/
  config.ts   — env-var config + auth-mode selection (apiKey | jwt)
  client.ts   — typed HTTP client for /api/audit (handles X-API-Key and JWT+refresh)
  tools.ts    — the 6 MCP tools (one-tool-per-action; write tools require confirm:true)
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

Cataam's `X-API-Key` filter only covers `/api/audit/**` (and a reserved `/api/iasm/**`).
All tools are intentionally scoped to `/api/audit/**` for **both** auth modes — even
though JWT could reach more — so migrating customers from JWT to API keys is seamless.

## Tools

See [`../README.md`](../README.md#mcp-tools). Read tools: `list_compliance_tests`,
`get_compliance_overview`, `list_failing_alerts`. Write tools (require `confirm:true`):
`rerun_compliance_test`, `update_test_due_date`, `link_test_to_jira`.
