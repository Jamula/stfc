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

---

### Phase 4 — US2 Tips Digest Test Fixes (2026-05-16)

**Session:** cyrusj requested fix of 3 failing tests in Phase 4 WIP (T028–T034).

**Root cause 1 — Digest idempotency (digest.test.ts lines 117 & 238):**
`merge()` in `src/digest/index.ts` summed additive health counters (e.g. `channelsRead`) on every re-run, even when the same `runId` was re-submitted. This meant re-rendering with identical input produced different state-block JSON, so the downstream byte-compare never short-circuited.
**Fix:** Added an idempotency fast-path at the top of `merge()`: if all `next.runIds` are already present in `prior.runIds`, return `prior` unchanged. The byte-compare then sees identical bytes and returns `bytesWritten: 0`.
**Pattern to remember:** Digest merge fast-path must gate on runId coverage BEFORE summing counters. Otherwise any re-submit doubles the stats.

**Root cause 2 — Empty-allowlist digest not written (discordMonitor.test.ts line 154):**
`finalize()` called `writeDigest(digest, { digestsDir: args.digestsDir })` but the `WriteDigestOptions` interface uses `outputDir`, not `digestsDir`. The unknown key was silently ignored; `writeDigest` fell back to `DEFAULT_DIGESTS_DIR` (`data/digests/`). Two TypeScript errors confirmed this:
- `Type 'DigestWriteResult' is not assignable to type 'string'`
- `'digestsDir' does not exist in type 'WriteDigestOptions'`
**Fix:** Corrected to `{ outputDir: args.digestsDir }` and extracted `.filePath` from the `DigestWriteResult`.
**Side effect:** All prior test runs were writing to `data/digests/2026-05-16.md` (real dir) instead of the temp dir. That stray file was removed; `data/digests/*.md` added to `.gitignore`.

**Temp-dir discipline:** The test suite correctly used `os.tmpdir()` + `mkdtempSync` for all paths — the real issue was purely in the production code passing the wrong option key.

**Commit:** `9475937 feat(001-discord-monitor): Phase 4 — US2 tips digest (T028–T034)`
**Test result:** 286 tests, 283 pass, 0 fail (3 pre-existing extractor.test.ts KNOWN GAP warnings unchanged).

---

### Issue #18 — Fix extractor short-code gaps (2026-05-17T17:53:01.345+00:00)

**Decision:** Option B — relax regex floor + expand stoplist.

**What changed:**
- `CORE_CODE_REGEX` in `src/discord/extractor.ts` changed from `{3,19}` to `{2,19}` (min total length 4→3).
- `src/discord/schemas.ts` Zod regex synced to `{2,19}`.
- `src/discord/stoplist.ts` gained 38 common 3-char English words (FOR, ARE, BUT, NOT, HIS, HER, ALL, CAN, etc.) to maintain precision at the lower floor.
- `tests/discord/extractor.test.ts` — removed `KNOWN_GAPS` set and `t.todo()` wrappers; all 30 promo-codes.txt entries now pass as real assertions (287 pass, 0 todo).
- `specs/001-discord-monitor/contracts/state-files.contract.md` regex comment updated.

**Key files:** `src/discord/extractor.ts`, `src/discord/stoplist.ts`, `src/discord/schemas.ts`, `tests/discord/extractor.test.ts`.

**Pattern:** When lowering a regex precision floor, always expand the stoplist in the same commit. The stoplist is the precision guardrail — the regex is just the recall gate.

**PR:** #38 on branch `squad/18-fix-extractor-short-codes`.
