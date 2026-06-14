# CATAAM Claude Plugin

Connect Claude to **CATAAM** — the GRC / compliance-automation platform (SOC2, GDPR,
ISO27001). This plugin bundles two things:

1. **An MCP server** (`mcp-server/`) — the connector. Exposes CATAAM's `/api/audit`
   compliance surface as a small set of precise MCP tools.
2. **Slash-command skills** (`commands/`) — packaged workflows that drive those tools.

It ships as **both** a standalone MCP server *and* an installable Claude plugin.

---

## What you can do

| Command | What it does | Tool(s) |
|---|---|---|
| `/cataam-status [frameworkId]` | Readiness score + per-framework pass rates | `get_compliance_overview` |
| `/cataam-tests [framework] [status] [search]` | List compliance tests/controls with status | `list_compliance_tests` |
| `/cataam-alerts` | Triage failing tests + CCM alerts | `list_failing_alerts` |
| `/cataam-fix <id> [rerun\|due-date <date>\|jira <KEY>]` | Re-verify / schedule / link a test (confirms first) | `rerun_compliance_test`, `update_test_due_date`, `link_test_to_jira` |

### MCP tools

- **`list_compliance_tests`** — paginated tests + stats, filterable by framework / category / status / name.
- **`get_compliance_overview`** — readiness score, per-framework summary, optional framework drill-down.
- **`list_failing_alerts`** — latest failing-test alerts + continuous-control-monitoring alerts.
- **`rerun_compliance_test`** ⚠️ *write* — re-execute one test to verify a remediation.
- **`update_test_due_date`** ⚠️ *write* — set a test's remediation due date.
- **`link_test_to_jira`** ⚠️ *write* — link a test to a Jira issue key.

The three write tools require an explicit `confirm: true` argument; the server refuses
otherwise, and the `/cataam-fix` workflow always confirms with you before acting.

---

## Authentication

The API is served from **`https://service.cataam.com`**. Two modes are supported — set
env vars, never hardcode secrets:

- **API key (recommended)** — `CATAAM_API_KEY` (an `X-API-Key`, looks like `cataam_…`).
  This is the long-term integration path. *Note: in-UI key generation is being rolled out;
  until then use JWT below.*
- **JWT login (works today)** — `CATAAM_USERNAME` + `CATAAM_PASSWORD`. The server logs in
  at `POST /api/login`, caches the short-lived token, and re-authenticates automatically.

Optional: `CATAAM_BASE_URL` (default `https://service.cataam.com`) to target staging/local.

---

## Install

### As a Claude plugin (recommended)

The bundled MCP server is published to npm and launched on demand via `npx`, so there's
nothing to build — just add the marketplace and install:

```bash
# In a Claude Code session:
/plugin marketplace add themarkups/claude-plugin
/plugin install cataam@cataam-marketplace

# …or from the terminal:
claude plugin marketplace add themarkups/claude-plugin
claude plugin install cataam@cataam-marketplace
```

Then provide credentials in your shell (picked up via `${ENV}` expansion in `.mcp.json`):

```bash
export CATAAM_USERNAME="you@example.com"
export CATAAM_PASSWORD="••••••"        # or: export CATAAM_API_KEY="cataam_…"
```

### As a standalone MCP server (any MCP client / `claude mcp add`)

```bash
claude mcp add cataam \
  --env CATAAM_BASE_URL=https://service.cataam.com \
  --env CATAAM_API_KEY=cataam_xxx \
  -- npx -y cataam-mcp-server
```

### Local development

```bash
cd mcp-server && npm install && npm run build
claude --plugin-dir /path/to/claude-plugin   # loads the plugin from source
```

Remote (streamable-HTTP) deployment:

```bash
MCP_TRANSPORT=http PORT=3000 node dist/index.js
# clients POST to http://host:3000/mcp ; per-request X-API-Key header is honored
```

---

## Verify

```bash
claude mcp list           # confirm "cataam" registers and connects
cd mcp-server && npm run smoke   # end-to-end: lists tools + calls a read tool live
```

See [`mcp-server/README.md`](mcp-server/README.md) for server internals and development.

## Example invocations

- "What's our SOC2 readiness?" → `/cataam-status`
- "Show failing ISO27001 controls" → `/cataam-tests ISO27001 FAIL`
- "What needs attention?" → `/cataam-alerts`
- "I fixed the S3 logging issue, re-check control 142" → `/cataam-fix 142 rerun`
