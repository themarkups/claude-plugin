# Security Policy

[![Maintained by Cataam](https://img.shields.io/badge/Maintained%20by-Cataam-3b82f6?style=flat-square)](https://cataam.com)

## Supported versions

Security fixes are applied to the latest published version of `cataam-mcp-server` and the
plugin. Older pinned versions are not backported.

| Component | Supported |
|-----------|-----------|
| `cataam-mcp-server` (latest on npm) | ✅ |
| Plugin `main` (latest) | ✅ |
| Pinned/older versions | ❌ |

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via one of:

- **GitHub private disclosure** — the "Report a vulnerability" button on the
  [Security tab](../../security/advisories/new) of this repository.
- **Email** — [security@cataam.com](mailto:security@cataam.com). Encrypt with our PGP key
  if the details are sensitive (key available on request).

### What to include
- A clear description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The affected file(s) and version/commit
- Any suggested remediation, if you have one

### What to expect
| Timeline | Action |
|----------|--------|
| Within 48 hours | Acknowledgement of your report |
| Within 7 days | Initial assessment and severity rating |
| Within 30 days | Patch or mitigation for confirmed vulnerabilities |
| Post-fix | Public disclosure coordinated with the reporter |

We follow [responsible disclosure](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html).
Reporters who follow this policy are credited in the advisory unless they prefer anonymity.

---

## Scope

This repository is an **MCP connector** that talks to the Cataam API on a user's behalf.
In-scope reports include:

- **Credential handling** — leakage of `CATAAM_API_KEY` / `CATAAM_USERNAME` /
  `CATAAM_PASSWORD` / JWTs into logs, errors, or disk.
- **Auth bypass** — calling Cataam endpoints outside the intended `/api/audit/**` scope,
  or escaping the per-request `X-API-Key` isolation in HTTP transport mode.
- **Unconfirmed writes** — a state-changing tool (`rerun_compliance_test`,
  `update_test_due_date`, `link_test_to_jira`) executing without `confirm: true`.
- **Injection / unsafe handling** of tool inputs or API responses.

### Handling credentials safely
- Credentials are read from **environment variables only** and are never written to disk
  or committed. Do not paste real keys, passwords, or tokens into issues or PRs.
- Use a **Cataam API key** (`X-API-Key`) over username/password where available, and scope
  it to the least privilege needed.

### Out of scope
Vulnerabilities in the Cataam platform/API itself — report those through Cataam's product
security channel ([security@cataam.com](mailto:security@cataam.com)), not this repo.
