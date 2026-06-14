# Contributing to the Cataam Claude Plugin

Thanks for contributing! This repository is maintained by the [Cataam](https://cataam.com)
team. It packages an MCP connector plus slash-command workflows that bring your SOC 2 /
GDPR / ISO 27001 compliance program into Claude.

---

## Repository layout

```
.claude-plugin/      plugin.json + marketplace.json (plugin & marketplace manifests)
.mcp.json            MCP server registration (launches the server via npx)
commands/            slash-command skills (/cataam-status, /cataam-tests, …)
mcp-server/          the MCP connector — published to npm as `cataam-mcp-server`
  src/               config.ts · client.ts · tools.ts · index.ts
  test/smoke.mjs     end-to-end smoke test
assets/              logo and branding
```

## Local development

```bash
cd mcp-server
npm install
npm run build          # tsc → dist/
npm run dev            # run from source (stdio) via tsx

# load the plugin from source in Claude Code:
claude --plugin-dir /path/to/claude-plugin
```

Validate the manifests before opening a PR:

```bash
claude plugin validate .
```

## Adding or changing MCP tools

1. **Stay in scope.** Tools target Cataam's `/api/audit/**` surface so they work under
   both auth modes (API key and JWT). Don't reach into endpoints outside that scope.
2. **One tool per action**, with a precise `description` and a strict Zod `inputSchema`
   — the model reads these to decide when to call the tool.
3. **Write actions must be confirmation-gated.** Any tool that mutates state must require
   `confirm: true` and refuse without it (see `rerun_compliance_test` for the pattern).
4. **No hardcoded secrets.** Read credentials from env vars only (`config.ts`).
5. **Add coverage** in `test/smoke.mjs` for new read tools where practical.

## Testing

```bash
cd mcp-server && npm run build
CATAAM_BASE_URL=… CATAAM_USERNAME=… CATAAM_PASSWORD=… npm run smoke
```

The smoke test spawns the server over stdio and exercises a read tool end-to-end. Never
commit real credentials or compliance data.

## Branch naming

| Prefix | Use for | Example |
|--------|---------|---------|
| `feat/` | New tools, commands, or capabilities | `feat/list-policies-tool` |
| `fix/`  | Bug fixes | `fix/due-date-instant-format` |
| `docs/` | README / docs only | `docs/install-steps` |

Keep branch names lowercase and hyphen-separated.

## Submitting a PR

1. Fork and branch using the convention above.
2. Make your change; run `npm run build` and `claude plugin validate .`.
3. Open a PR describing the change, the Cataam endpoint(s) involved, and whether it adds a
   read or a (confirm-gated) write tool.

## Releasing (maintainers)

1. Bump the version in `mcp-server/package.json`.
2. `cd mcp-server && npm publish` (use a granular token scoped to `cataam-mcp-server`).
3. Update the pinned version in `.mcp.json` (`cataam-mcp-server@x.y.z`) and `plugin.json`.
4. Commit, then `claude plugin tag` to create a validated `cataam--vX.Y.Z` release tag.

By contributing, you agree your work is licensed under the [MIT License](LICENSE).
