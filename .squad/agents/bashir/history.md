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
