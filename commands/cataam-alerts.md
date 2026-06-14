---
description: Triage open Cataam compliance problems — latest failing-test alerts and continuous-control-monitoring (CCM) alerts.
allowed-tools: mcp__cataam__list_failing_alerts, mcp__cataam__get_compliance_overview
---

You are triaging open compliance problems in Cataam.

1. Call `mcp__cataam__list_failing_alerts`.
2. Present two sections:
   - **Failing tests** — name, framework/control, when it failed, and **auditProgressId**.
   - **CCM alerts** — the continuous-control-monitoring findings.
3. Prioritize: order by severity/framework impact where the data allows, and call out anything that blocks audit-readiness.
4. For each failing test, suggest the concrete next step: either remediate the underlying issue then `/cataam-fix <auditProgressId>` to re-verify, or `/cataam-fix` to link it to a Jira ticket / set a due date.
5. If there are zero alerts, say so plainly and (optionally) call `mcp__cataam__get_compliance_overview` to confirm overall readiness.

Report only what the tools return; do not fabricate alerts.
