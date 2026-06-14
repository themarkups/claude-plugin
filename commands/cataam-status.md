---
description: Show CATAAM compliance posture — overall readiness score and per-framework pass rates. Optionally drill into one framework.
argument-hint: "[frameworkId]"
allowed-tools: mcp__cataam__get_compliance_overview
---

You are reporting the organization's compliance posture from CATAAM.

1. Call `mcp__cataam__get_compliance_overview`. If the user provided a framework id in `$ARGUMENTS`, pass it as `frameworkId` to include that framework's detailed progress.
2. Summarize for a human, clearly and concisely:
   - **Overall readiness**: the score, its label/trend, and the test / policy / evidence sub-scores.
   - **Per framework** (SOC2, GDPR, ISO27001, …): total tests, passed, failed, and pass rate. Use a compact table.
   - If a specific framework's progress was returned, call out its standout gaps.
3. End with a one-line verdict on audit-readiness and, if anything is failing, suggest running `/cataam-alerts` to triage.

Do not invent numbers — report only what the tool returns. If the call errors, surface the error and check that auth env vars are set.
