---
description: Remediate a Cataam compliance test — re-run it to verify a fix, set a due date, or link it to a Jira issue. Always confirms before changing anything.
argument-hint: "<auditProgressId> [rerun|due-date <YYYY-MM-DD>|jira <KEY>]"
allowed-tools: mcp__cataam__list_compliance_tests, mcp__cataam__rerun_compliance_test, mcp__cataam__update_test_due_date, mcp__cataam__link_test_to_jira
---

You are remediating a compliance test in Cataam. These actions MUTATE compliance state, so you MUST confirm with the user before executing.

1. Identify the target test from `$ARGUMENTS`:
   - The first token should be an `auditProgressId`. If it's missing, ask the user for it (they can find it via `/cataam-tests` or `/cataam-alerts`).
   - Determine the intended action:
     - `rerun` (default) → `mcp__cataam__rerun_compliance_test`
     - `due-date <YYYY-MM-DD>` → `mcp__cataam__update_test_due_date`
     - `jira <KEY>` → `mcp__cataam__link_test_to_jira`

2. **Confirm before acting.** State exactly what will happen, e.g. "Re-run compliance test #142 — this executes the underlying check and updates its PASS/FAIL status. Proceed?" Wait for an explicit yes. Do NOT pass `confirm: true` until the user agrees.

3. Execute the chosen tool with `confirm: true` and the required arguments.

4. Report the result:
   - For a rerun: the returned `status` and whether it `passed`. If it still fails, say the remediation didn't take and suggest reviewing the underlying control.
   - For due-date / jira: confirm the updated value.

Never perform more than the user asked for. One confirmed action per request unless they explicitly ask to chain.
