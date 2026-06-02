## Session 2026-06-02 — Discord slash epic #143 shipped

Parallel fleet delivered 6 PRs (commands.json, register workflow, Worker bridge, handler workflow, deploy, runbook). 4 reviewer-lockout cycles (Garak blockers → Scotty fixes). Epic fully operational.

# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Project Learnings (Consolidated)

See archived history at `.squad/log/scotty-history-archive-2026-06-02T07-19-00Z.md` for full session history pre-2026-06-02.

### Key Patterns

- **Constitution v1.2.0 — npm test enforcement gate:** CI gate + pre-commit hook operationalize Principle IX.
- **Discord ops scripting:** Metadata endpoints split (`/users/@me` vs `/applications/@me`); avatar is data URI; image probing possible without deps.
- **Reviewer-lockout pattern:** Spawn Bashir + Garak SYNC before push to catch gaps in one cycle, not two.
- **Lockout-routed revisions:** Non-Scotty specialists (Bashir, Garak, Uhura) revisit locked-out PRs; Scotty owns follow-up commit.
- **Additive rebase conflicts:** For non-overlapping appends (docs sections, test imports), keep both sides + remove markers.
- **`npm ci` in worktrees:** After rebase, symlinked `node_modules` can be stale; always `npm ci` before first test in worktree (Rule 22).
- **Exclusion assertions in tests:** Workflow trigger pins must assert ABSENCE (e.g., `on.push === undefined`) not just presence. Non-negotiable pattern (Rule 3 per Kirk).
- **Docs redaction:** CLI output in docs must redact volatile fields (`generatedAt`, `stalenessDays`) with labeled placeholders + one-line notes.

## Learnings

### Rebase conflict patterns for additive changes

When two PRs touch the same file but in non-overlapping ways (e.g., appending distinct doc sections, adding separate test imports), conflicts are **purely additive** — keep both sides verbatim, remove the conflict markers, and stage the resolved file. Git cannot auto-merge when both sides append to the same region even if the content doesn't logically conflict.

Key steps for additive rebase conflicts:
1. Identify which side is HEAD (origin/main) and which is your incoming commit.
2. For docs: order the sections logically (e.g., register-commands before command-routing since registration is a prerequisite to routing).
3. For test index files: preserve all imports in order — HEAD imports first, then your new ones.
4. `git add <files>` then `GIT_EDITOR=true git rebase --continue` to avoid an editor prompt.

### force-with-lease after rebase

After any `git rebase` that rewrites history (produces new SHAs), use `git push --force-with-lease origin <branch>` — NOT `--force`. `--force-with-lease` verifies the remote hasn't been updated by someone else since your last fetch, preventing clobbering concurrent pushes. In single-maintainer repos this is mostly academic but is still the correct default.

### Rule 22: npm ci in fresh/reused worktrees

After a rebase into an existing worktree with a `node_modules` symlink, `tsx` (and other devDependencies) may be missing. Always run `npm ci` before the first `npm test` in a worktree to avoid misleading `ERR_MODULE_NOT_FOUND` failures that look like real test breaks.
- 2026-06-02 06:08 — Added 4 new promo codes (SFACPT2, SIMULATION, SIMULATION1, SIMULATION2) to promo-codes.txt via PR #170; test expectations updated (30→34).

## 2026-06-02T06:39Z — PR #169 Kirk reviewer-lockout revision (storage monitor pin-test gaps)

**Role:** Reviewer-lockout reviser (O'Brien locked out; Scotty owns revision)
**PR:** #169 (branch `squad/163-storage-monitor`)
**Commit:** `48e45e7`

Kirk's 3 NON-NEGOTIABLE Rule 3 gaps addressed in `tests/skills/storageSizeMonitor.test.ts`:

1. **Negative-trigger pin (Gap 1):** Added `has no push or pull_request trigger` test. Pattern: assert `on.push === undefined` and `on.pull_request === undefined`. This is the **exclusion-assertion pattern** — not just "these triggers exist" but "these triggers MUST NOT exist". Prevents silent drift if someone adds a push trigger.

2. **Dedup-state pin (Gap 2):** Added `--state open` assertion to the existing `deduplicates alert issues by title search` test. Pattern: pin the exact CLI flag that controls whether closed issues suppress new alerts. Without `--state open`, a closed prior incident could silently block a new alert.

3. **Threshold-in-body pin (Gap 3):** Added `issue body mentions threshold value` test. Finds the `Create alert issue` step by `name` field (no `id` on that step) and asserts `run` contains `100 MB`.

**Rule 16 fix:** Added `storage-size-monitor.yml` row to `docs/ARCHITECTURE.md` workflow table; updated count 14→15.

**Learnings:**
- **Exclusion assertions are as important as inclusion assertions.** When a workflow is intentionally trigger-restricted (schedule + dispatch only), the pin tests MUST assert the ABSENCE of unwanted triggers, not just the presence of desired ones. Kirk flags this as a NON-NEGOTIABLE gap.
- **Dedup state flags must be pinned.** `gh issue list --state open` is a behavioral correctness flag, not a cosmetic one. Pin it or a future refactor silently changes blast radius.
- **Steps without `id` are found by `name`.** When a workflow step lacks an `id`, use `steps?.find((s) => s?.name === '...')` in tests. Document the step name dependency so future authors know why the step name matters.

## 2026-06-02T07:17:00Z — #171 Retry-After cap (Kirk follow-up from #167)

- **Issue:** #171 — cap Retry-After at 60s to prevent hostile-server stalls
- **PR:** #172 — `fix(orchestrator): cap Retry-After at 60s to prevent hostile-server stalls` (in flight)
- **Branch:** `squad/171-retry-after-cap`
- **Changes:** `src/skills/runAll.ts` — added `MAX_RETRY_AFTER_MS = 60_000` constant, wrapped delay in `Math.min`; added TypeError comment in `isTransientRedeemError`
- **Test:** Added cap test in `tests/skills/runAll.test.ts` — mocks Retry-After: 86400 → asserts sleep ≤ 60_000ms
- **Suite:** 1098 pass, 0 fail

---

## 2026-06-02T07:19:00Z — Mid-session sweep (6 PRs shipped, 3 in flight)

**Session:** Scribe mid-flight consolidation post-6-PR merge batch
**Output:** Orchestration log, session log, decision inbox merged, Scotty history summarized (archive at `.squad/log/scotty-history-archive-2026-06-02T07-19-00Z.md`)

**PRs shipped this round:**
- #167 (orchestrator dead-code + retry, closed #166) — 228923e
- #170 (4 new promo codes added) — 0d56bb1
- #168 (game-state slash command + admin gate + option-regex, closed #159) — 429c9f9
- #169 (storage size monitor, closed #163) — fc4a3f5

**PRs in flight:**
- #160 (game-state persistence — Uhura + O'Brien, Scotty oversight)
- #161 (game-state data handlers — O'Brien + Scotty)
- #171 (Retry-After cap follow-up — in progress)
