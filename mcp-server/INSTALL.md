# Connect the Cataam MCP to Claude

Bring your Cataam compliance, OKF, and Trust Center data into Claude. No repository, build, or
developer setup — Claude runs the connector for you via `npx`.

## What you need
1. **Claude Desktop** or **Claude Code**.
2. A **Cataam account** for your organization (an admin who can manage the Trust Center).
3. A **Cataam API key** — Settings → API keys in the Cataam app (or ask your Cataam contact).
   The key is scoped to *your* organization; everything the connector does is limited to your org.

> **Don't have an API key yet?** You can use your Cataam login instead — set `CATAAM_USERNAME` /
> `CATAAM_PASSWORD` rather than `CATAAM_API_KEY` (see "Alternative auth" below). An API key is
> recommended so you never put a password in a config file.

---

## Option A — Claude Desktop
1. Open **Settings → Developer → Edit Config** (this opens `claude_desktop_config.json`).
2. Add the `cataam` server:
   ```json
   {
     "mcpServers": {
       "cataam": {
         "command": "npx",
         "args": ["-y", "cataam-mcp-server"],
         "env": {
           "CATAAM_API_KEY": "ck_live_your_key_here"
         }
       }
     }
   }
   ```
3. **Restart Claude Desktop.** You'll see the Cataam tools available in a new chat.

## Option B — Claude Code
```bash
claude mcp add cataam \
  -e CATAAM_API_KEY=ck_live_your_key_here \
  -- npx -y cataam-mcp-server
```
Then `claude mcp list` should show `cataam`. (You don't need a base URL — it defaults to
`https://service.cataam.com`.)

---

## Try it
In a Claude chat with the connector enabled:
- *"How audit-ready are we for SOC 2?"*
- *"List our failing compliance tests."*
- *"What's our OKF Context Engine status? Generate an export."*
- **Trust Center:** *"List our connected vendors, then populate our Trust Center subprocessors from them — do a dry run first."*
- *"Upload `~/Documents/soc2-type2.pdf` to our Trust Center as a gated document titled 'SOC 2 Type II Report'."*

Anything that **changes data** (re-run a test, add a subprocessor, upload a document) is confirmed
with you before it runs.

## What it can do
- **Compliance** — readiness score, framework summaries, failing tests, re-run tests, due dates, Jira links.
- **Governance** — publish policies, finalize documents, remediate document-presence controls.
- **OKF Context Engine** — status, configure, generate / read / pin export bundles, Git-sync.
- **Trust Center** — list vendors, add subprocessors (incl. bulk from vendors), upload documents, review access requests.

## Alternative auth (login instead of API key)
If you don't have an API key, use your Cataam login. Replace the `env` block with:
```json
"env": {
  "CATAAM_USERNAME": "you@yourcompany.com",
  "CATAAM_PASSWORD": "your-password"
}
```
(Both auth modes are org-scoped; an API key is preferred so no password sits in your config.)

## Security
- The connector talks only to `https://service.cataam.com` over HTTPS.
- Your key/login is org-scoped — the connector can only see and change **your** organization's data.
- Revoke an API key any time in the Cataam app; it stops the connector immediately.
- Updates ship automatically — `npx -y` always fetches the latest published version.

## Troubleshooting
- **Tools don't appear:** fully quit and reopen Claude Desktop; confirm Node.js 18+ is installed (`node -v`).
- **401 / Unauthorized:** the key/login is wrong or revoked, or (for Trust Center tools) your key
  predates trust-center support — re-issue a current key.
- **`npx` can't find the package:** check your internet connection; `npm view cataam-mcp-server version`
  should print a version.
