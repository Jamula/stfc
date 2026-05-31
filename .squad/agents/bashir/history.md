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
