---
name: Bug report
about: Report a problem with the Cataam Claude plugin or MCP server
title: "[bug] "
labels: bug
assignees: ''
---

**Describe the bug**
A clear and concise description of what went wrong.

**Which part?**
- [ ] A slash command (`/cataam-status`, `/cataam-tests`, `/cataam-alerts`, `/cataam-fix`)
- [ ] An MCP tool (`list_compliance_tests`, `get_compliance_overview`, `list_failing_alerts`, `rerun_compliance_test`, `update_test_due_date`, `link_test_to_jira`)
- [ ] Install / connection (`/plugin install`, `claude mcp list`, `npx cataam-mcp-server`)
- [ ] Other

**To reproduce**
Steps to reproduce:
1. Command or tool call made (with arguments, redact secrets)…
2. What you expected…
3. What actually happened…

**MCP server output / logs**
Paste relevant output. Run `claude mcp list` to check connection status, or run the
server directly to see logs:
```
CATAAM_BASE_URL=… CATAAM_USERNAME=… npx -y cataam-mcp-server
```
⚠️ Redact API keys, passwords, tokens, and any org/compliance data.

**Environment**
- Plugin / `cataam-mcp-server` version: [e.g. 0.1.0 — `npm view cataam-mcp-server version`]
- Claude Code version: [`claude --version`]
- Node.js version: [`node --version`] (must be ≥ 18)
- OS: [e.g. macOS 15, Ubuntu 24.04]
- Auth mode: [ ] API key (`X-API-Key`)  [ ] username/password (JWT)
- `CATAAM_BASE_URL`: [e.g. https://service.cataam.com — do **not** include credentials]

**Additional context**
Anything else that helps — was this a read tool or a write (`confirm`-gated) tool?
