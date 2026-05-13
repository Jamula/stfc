# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — Test-First Proof Workflow (2026-05-08)

**Implementation completed:** Built test-first proof workflow to enforce Principle IX and close the honor-system gap around optional test tasks.

**Three reviewer gates established:**
1. **Specification review gate:** Scope, acceptance criteria, and risk boundaries verified before planning begins.
2. **Tasks review gate:** All acceptance criteria have corresponding test tasks (no optional tests; no untested flows).
3. **Implementation review gate:** All acceptance criteria have passing test artifacts (unit + integration tests required before merge).

**Test quality checklist:** Template created for test-first discipline, ensuring:
- No untested code paths
- Tests are written and passing before implementation
- Acceptance criteria have clear, verifiable test coverage

**Coordination:** Parallel work with Scotty (npm test enforcement) ensures tests are gated both at CI (npm test must pass) and at code review (tests must exist).

**Status:** Integrated into Constitution Principle IX with reviewer-gate enforcement. Closes the gap between "tests are mandatory" policy and "tests are optional in templates" footgun.

---

## Learnings

### 001-discord-monitor — tasks.md generation (2026-05-13)

**tasks-template.md shape:** Template enforces Format `[ID] [P?] [Story] Description`;
`[P]` means different files, no intra-phase dependencies; `[Story]` traces to a spec user
story. Group by user story (US1/US2/US3). Replace ALL sample tasks — keep zero template
placeholder rows. Include exact file paths in every task. Dependency table and parallel
opportunities section are required at the bottom.

**Phase 0 governance pattern:** When a constitution amendment is a prerequisite (Picard
APPROVE WITH CONDITIONS → OPTION 1), Tasks MUST open with a standalone Phase 0 whose
sole deliverable is the amendment PR. Phase 0 BLOCKS all implementation phases. Its
acceptance criteria are taken verbatim from the amendment-audit memo (Tuvok's P0 findings
in this case). No implementation source file may appear in the amendment PR.

**Verified-facts encoding rule:** Every numeric or literal claim from plan.md that is
load-bearing for correctness MUST become a concrete assertion in a test task — not just
prose. Examples applied here:
- `promo-codes.txt` has **30** non-comment entries; **27** match `^[A-Z][A-Z0-9]{3,19}$`
  (3 known short-code gaps: `TNG`, `GQ5`, `GQ7`) → encoded as named expected-failure
  assertions in extractor test task T013.
- Concurrency group string `stfc-gift-redeemer` must match `.github/workflows/redeem.yml:31`
  bit-for-bit → encoded as a string assertion in integration test task T017.
- Cron literals `15 */4 * * *` (monitor) and `0 * * * *` (redeemer) → asserted by value
  in T017.
- Redeemer seam exports are `readPromoCodes(path)` + `parsePromoCodes(content)`, NOT
  `loadPromoCodes` → encoded as an import-name assertion in seam test task T015.
- 7 new committed durable inputs (NOT 6) → stated in Phase 0 acceptance criteria (T000
  P0-1 checklist) and in Notes section.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
