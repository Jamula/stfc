# Bashir — Test & QA Reviewer

> Archived entries (prior to 2026-05-31) are in `history-archive.md`.

## 2026-05-31 — Data Layer Test Coverage Review

Reviewed PR #98 test coverage against the data-layer task specification (T100–T304 test matrix in `.squad/decisions.md`).

**Round 1 findings (2 items):**
1. **Task YAML loader-path test (High):** Missing end-to-end test of malformed YAML through `loadTask()`. Existing coverage only exercises `TaskDefinitionSchema.safeParse` in memory.
2. **Schema invariants one-assertion-per-invariant (Medium):** `schemas.test.ts` had 14 assertions but grouped multiple invariants; missing coverage for officer id format, enum failures, roster bounds, task `synergy_bonus >= 0`.

Recommended reassignment to Uhura under reviewer-lockout (Scotty barred from revision after initial implementation).

**Evidence collected:** `npm test` 597/597 pass; `tiny-officers.json` covers captain/officer/either roles.

**Round 2 (after Uhura revision 277f7023):**
- Finding 4: Resolved. 2 new tests in `tasks.test.ts` exercising malformed YAML via `loadTask()`.
- Finding 5: Resolved. `schemas.test.ts` expanded to 35 assertions (+21), each invariant independently covered.

Approved. Merged as eb2fd9d.

**Lesson:** Test coverage gaps in initial PR are easier to fix with reviewer-lockout reassignment (Uhura) than to ask author (Scotty) to re-work twice. Uhura's single revision addressed both Garak's contract violations AND Bashir's coverage gaps—faster than a two-round cycle.

## 2026-06-02 — Re-Review: squad/81-optimize-cli (Issue #81) — APPROVE

**Round 2 (post-revision):** Reviewed gap-fill test additions in `/workspaces/stfc-81` against 9 previously-requested coverage items.

**Gap resolution status:**
1. **Progression hash gating** — ✅ Covered by `progression.test.ts:253` "writes docs only when the computed input hash changes" (same-input idempotency + changed-input re-write). Also mirrored in `optimizeCrew.test.ts:355`.
2. **Progression GITHUB_STEP_SUMMARY** — ✅ Covered by `progression.test.ts:221` "appends workflow summary output when GITHUB_STEP_SUMMARY is set"; asserts summary file contains `=== progression ===` and `Account: alpha`.
3. **Env cleanup** — ✅ Both test files have `afterEach(() => { delete process.env.GITHUB_STEP_SUMMARY; ... })` (lines 119–121 and 139–141). Standard node:test teardown pattern; correct.
4. **Mixed status exit 0** — ✅ `optimizeCrew.test.ts:279` "returns 0 for mixed account health under --all"; `progression.test.ts:322` also exercises same pattern.
5. **Selector conflict** — ✅ `optimizeCrew.test.ts:198` "returns 2 on selector conflict"; `progression.test.ts:161` mirrors it. Both assert `exitCode === 2` and `/Use either --account X or --all/`.
6. **No-accounts** — ✅ `optimizeCrew.test.ts:329` "returns 2 when no eligible roster files exist"; `progression.test.ts:335` same.
7. **Invalid top** — ✅ `optimizeCrew.test.ts:213` "returns 2 for invalid --top values" iterates `["0","abc"]`.
8. **Per-account failure isolation** — ✅ `optimizeCrew.test.ts:305` writes `broken.yaml` alongside healthy `alpha`, expects exit 0 and alpha output. `progression.test.ts:308` covers same with malformed YAML.
9. **Legacy doc header rewrite** — ✅ `optimizeCrew.test.ts:398` "rewrites legacy docs without an input-hash header"; pre-seeds `alpha.md` with `"# legacy\n"`, re-runs, asserts hash header present. Covers the shared `writeCrewDocIfChanged` helper (used by both skills).

**Test suite result:** 703 pass / 0 fail in 8.96s.

**Lesson:** Shared helper (`writeCrewDocIfChanged`, `parseSelector`, `resolveRosterFiles`) tested through one skill (optimizeCrew) is sufficient when the other skill (progression) already exercises the same code paths via its own integration tests. No gap in coverage despite Gap 9 not having a symmetric test in progression.test.ts.
- Phase 0 shipped (PR #111)

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE

---

**[2026-06-01T03:39Z] Garak P1 Surgical Fixes — Wave-Boundary Clarity Pattern**

**Task:** Fix 2 remaining Garak P1 findings on PR #124 (Tuvok reviewer-locked per Rule 2).

**Findings Fixed:**
- P1#7: PR body test count stale (914 → 918 per Kirk's counter-tests added in interim)
- P1#8a: Quickstart.md overclaimed `/api/data/*` endpoints shipping in Wave 3; they ship in Wave 4 PR #126 (already merged)

**Implementation:**
1. Updated PR #124 body via `gh pr edit --body-file` (sed: 914 → 918)
2. Restructured `specs/005-web-control-panel/quickstart.md` Phase 1 section:
   - Added Wave 3 subsection (this PR: auth lib, frontend shell, SWA contract)
   - Added Wave 4 subsection (separate PRs already merged: data-read endpoints PR #126, invitation runbook PR #125)
   - Moved `/api/data/*` reference to Wave 4 subsection with PR #126 attribution

**Editorial Pattern — Wave-Boundary Clarity:**
When multiple PRs ship in sequence (same epic, same phase) but land separately (different commits, different reviews), cross-references in quickstart/README must:
1. Use subsection headers per wave (e.g., "### Wave 3 — Foundation", "### Wave 4 — Capabilities")
2. Cite PR numbers + merge state alongside features (e.g., "PR #126, merged")
3. Avoid future-tense claims for features in later waves (e.g., never "will ship" — say "ships" only for current wave)

This prevents re-verification friction: reviewers re-opening PRs weeks later will see feature attribution clearly divorced by wave/PR/commit.

**Commit:** `41b04a1` — docs(005-web-control-panel): clarify Wave 3 vs Wave 4 boundary
**Status:** COMPLETE — PR #124 CI green, quickstart + PR body now aligned

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)
