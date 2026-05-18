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

### Phase 3 Test Completion — Commit 39ad92f (2026-05-17T20:42:03Z)

US3 token validation tests integrated. 3 new test files added (ingest.test.ts, tokenDecoder.test.ts, tokenValidator.test.ts). All Phase 3 assertions passing.


2026-05-17T21:39Z: Feature 003-discord-oauth shipped (Phase 5–6); all 457 tests green; T028 smoke test deferred.
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

---

### 2026-05-18T02:29:30Z — Discord-ops pinning tests (PR feature: discord-ops-automation)

**Three test files shipped** (committed in 87a8ef6 alongside Tuvok's constitution amendment due to a concurrent-staging race; commit body acknowledges the test additions):

- `tests/scripts/discord-ops/set-discord-app-metadata.test.ts` — behavioral tests for Scotty's script via `node:child_process.spawnSync` + a `--import`'d fetch-stub fixture. 8 assertions covering `--help`, missing-token exit, dry-run, 401 redaction, 200 OK, missing-icon, oversize-icon.
- `tests/constitution/discord-ops-carveout.test.ts` — Rule 1 pinning for Tuvok's Principle V carve-out; structural assertions over `scripts/discord-ops/`, write-verb, `discord.com/api/v10`, and version-bump above v1.4.0.
- `tests/workflows/discord-ops-workflow.test.ts` — Rule 3 pinning for O'Brien's `.github/workflows/discord-ops.yml`; workflow_dispatch-only, declared inputs, secrets→env mapping, minimal permissions block, node invocation, SHA-pinned actions.

**Result:** `npm test` 557/557 pass after both Scotty's script + Tuvok's constitution + O'Brien's workflow + my tests are all in the tree.

### Patterns to remember

**Sentinel-token leak assertion pattern** — set `DISCORD_BOT_TOKEN` to a unique, greppable, never-reused string (here: `BOT_TOKEN_SENTINEL_DO_NOT_LEAK_a8f3c91e`) and assert `!output.includes(SENTINEL)` on every failure path (--dry-run, 401, missing file, oversize file). The sentinel is registered in `.squad/decisions/inbox/bashir-discord-ops-tests.md` — future devs MUST NOT reuse it for any other purpose, or the leak guard becomes a false-positive.

**Fetch-stub-must-redact-too pattern** — when a stub records calls to stderr for test inspection, the stub itself must redact `Authorization` headers in its own output. Otherwise the test false-positives by detecting the sentinel in the stub's debug log (not the script's error path). The stub is part of the test harness, not the system under test, but it shares the same output channel.

**Workflow-pinning YAML grep pattern** — mirrors `tests/skills/discordMonitor.test.ts:465+`: `fs.readFileSync` the YAML as text, then `assert.match(yaml, /pattern/)` over the raw body. To isolate sub-blocks like `on:` or `permissions:`, slice from the block header to the next top-level key (regex `\n[a-zA-Z_][\w-]*:\s*\n`). Cheaper and more reliable than adding a YAML parser dependency.

**Constitution-pinning version-bump check** — parse the version footer (`**Version**: 1.4.0 | ...`) AND the SIR header (`Version change: 1.3.0 → 1.4.0`) and compare with a `cmpVersion` helper. Take the highest version that appears. Restrict regex search to footer + SIR lines to avoid matching unrelated semver strings elsewhere in the document.

**Subprocess test discipline for `.mjs` scripts** — when a script doesn't expose a programmatic entry point, spawn it via `node:child_process.spawnSync` with:
- A scrubbed env (PATH + HOME only; never inherit the developer's `DISCORD_BOT_TOKEN`).
- `--import ./tests/fixtures/.../stub.mjs` for global `fetch` injection. Env vars on the child control the stub's behavior (status, body) so each test case is one line.
- A bounded `timeout` (10s here) so a hung HTTP call doesn't hang CI.

**Skip-gracefully when upstream artifacts missing** — guard each `describe` / `it` with `{ skip: !fileExists }` so the suite stays green during Phase 1 fan-out (before all sibling agents have landed their files). Once the upstream commits, the skips automatically become real assertions. Avoids the "tests block tests" deadlock that comes from strict `fs.readFileSync` at the top of a test file.

**Concurrent-process commit hazard** — multiple squad agents working on the same workspace can collide on `.git/index`. Observed symptoms: (a) `git commit` lands a different set of files than was staged; (b) `git status` and `git status --porcelain` disagree; (c) `index.lock` appears mid-command. Mitigation: stage explicitly, immediately verify with `git status --short`, and `git diff --cached` before committing. If the index gets clobbered, `git reset HEAD^` and retry. Don't trust the staged state across multiple shell commands.

## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---


---

### 2026-05-18T04:00:10Z — Exit-code restoration (issue #72, b01ffdf regression)

**Trigger:** User pushed `b01ffdf` which collapsed exit codes onto a single non-zero value, contradicting runAll.ts convention. User chose `fix_exit_codes` option; accepted the other b01ffdf simplifications (drop `--proto '=https'`, drop USAGE prose block, drop workflow-pin concurrency/timeout tests).

**What changed:**
- `scripts/discord-ops/set-discord-app-metadata.mjs`: Added `DiscordApiError extends Error` with `{ status, code }` opts; `discordPatch` now throws `DiscordApiError` on non-2xx (was plain `Error`). `runCli`: parseArgs/no-flag/validation/icon-load → `return 1` (was 2 for three of those). PATCH loop: replaced `return 1` short-circuit with `worstExit` fold; `DiscordApiError` folds to `max(worstExit, 2)`, transport throws fold to `max(worstExit, 1)`. Added 3-line exit-code comment above `runCli`.
- `tests/scripts/discord-ops/set-discord-app-metadata.test.ts`: 401-from-Discord test tightened from `notEqual(r.status, 0)` to `equal(r.status, 2)`. Three new pinning tests: unknown-flag→1, no-flag→1 (with "At least one of" message check), invalid-username→1.
- `tests/index.test.ts`: Re-added `partial-success.test.ts` and `endpoint-narrowing.test.ts` imports (dropped by b01ffdf, files still existed).

**Accepted simplifications (user direction, do NOT restore):** full USAGE exit-code prose block, `--proto '=https'` curl hardening, workflow concurrency.group/timeout-minutes literal pins.

**Result:** 566/566 tests pass (up from 557 in PR #73 head, 9 new tests from the three new files now registered + 3 new pinning assertions). Typecheck: one pre-existing huggingface error unchanged.

**Commit:** f93947a

## Learnings

**Exit-code restoration pattern:** When a refactor collapses a multi-value exit-code taxonomy into a single non-zero code, the minimum restoration surface is: (a) an error-type discriminator class, (b) a `worstExit` fold in the loop, (c) three new pinning tests. Do NOT restore prose docs the user explicitly accepted as removed.

**Re-registering dropped test imports:** When a refactor drops import lines from `tests/index.test.ts` but leaves the test files on disk, re-add the imports. The files pin behaviour that matches the restored convention — letting them be orphaned means the pinning is silent.

**runAll.ts convention reinforcement:** 0=success, 1=operator/infra (bad args, missing env, validation, file-not-found, transport), 2=remote service rejected a well-formed request (4xx/5xx). Every script in this repo must follow this split. The discriminator pattern (custom error class thrown on remote rejection, plain Error on transport) is the canonical implementation.
