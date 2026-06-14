---
description: List CATAAM compliance tests (controls) with pass/fail status. Filter by framework, category, status, or name.
argument-hint: "[framework] [status] [search terms]"
allowed-tools: mcp__cataam__list_compliance_tests
---

You are listing compliance tests from CATAAM.

1. Parse `$ARGUMENTS` for intent and map to `mcp__cataam__list_compliance_tests` parameters:
   - A framework name (SOC2 / GDPR / ISO27001) → `frameWork`
   - A status word (PASS / FAIL / IN_PROGRESS / COMPLETED) → `status`
   - A category like `CC1` → `category`
   - Free text → `testName`
   - Default to `size: 20`, `page: 0` unless the user asks for more.
2. Call the tool. If there are more pages (`totalPages > 1`), mention how many results matched and that more pages are available.
3. Present a compact table: test name, framework/category, status, and **auditProgressId** (users need this id to remediate). Group or sort failing tests first.
4. If the user seems to want to fix something, point them to `/cataam-fix <auditProgressId>`.

Report only what the tool returns.
