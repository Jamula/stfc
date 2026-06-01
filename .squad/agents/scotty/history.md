# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — npm test Enforcement Gate (2026-05-08)

**Implementation completed:** Built `npm test` CI enforcement gate to operationalize Principle IX (tests are not optional; `npm test` MUST pass before any commit).

**Trigger and Scope:**
- Workflow: `.github/workflows/squad-test-enforcement.yml`
- Triggered on: All pull requests touching `src/`, `tests/`, package.json, or tsconfig.json
- Enforcement: PR cannot merge until all tests pass in CI

**Coordination with Bashir:** Bashir's reviewer gates (spec review, tasks review, implementation review) complement this CI gate. Tests must exist (Bashir's gates) AND pass (Scotty's CI gate).

**Design Pragmatism:** "Trigger Threshold" (speckit for >4-hour work, multi-file changes, architectural decisions) calibrated to maintenance-heavy project. Exemptions cover 70–80% of actual PR mix (bumps, single-file fixes, docs).

**Post-Ratification Commitment:** Pre-commit hook optional but recommended (Bashir to advise if simple-git-hooks or husky are preferred).

**Status:** Deployed and operational. npm test is gated at both code-review and CI layers.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

### 2026-05-18T02:29:30Z — Discord ops script (`set-discord-app-metadata.mjs`)

Built `scripts/discord-ops/set-discord-app-metadata.mjs` per the (a)-override
directive. Operator-only one-shot for bot avatar / username / application
description; not reachable from `src/` runtime (FR-009 preserved). Pushed on
branch `discord-ops-automation`, all 557 tests green including Bashir's 9
script tests + 5 constitution carve-out pinning tests.

## Learnings

* **Discord app metadata endpoint split.** Bot username + avatar live on
  `PATCH /users/@me`; application description lives on `PATCH /applications/@me`.
  These are two distinct resources — bot identity vs. application identity —
  and the same script needs to hit both when the operator wants to update
  multiple fields at once. Merging avatar + username into one /users/@me
  call is correct (Discord accepts partial bodies); merging anything across
  the resources is not.
* **Avatar payload is a data URI, not multipart.** The `avatar` field on
  `PATCH /users/@me` takes a base64 data URI string
  (`data:image/png;base64,…`). No multipart/form-data, no file upload —
  the whole image rides inline in the JSON body. 10 MB Discord hard cap
  on the encoded body. Magic-byte MIME detection is mandatory because
  Discord rejects mismatched declared MIME vs. content.
* **Image dimension probing without a library.** PNG: IHDR chunk starts at
  byte 8; width is BE u32 at byte 16, height at byte 20. GIF: Logical
  Screen Descriptor — width LE u16 @6, height LE u16 @8. JPEG: walk
  markers from byte 2, skip fill 0xFFs, stop on SOF (0xC0–0xCF except
  C4/C8/CC); height is BE u16 at marker+3, width at marker+5. Roughly
  ~40 lines of Node Buffer reads, no deps. Good enough for a soft floor
  warning; not a substitute for sharp/image-size in a real pipeline.
* **Redaction pattern from `src/lib/redact.ts`.** Inlined rather than
  imported to keep FR-009 clean. Two regexes + literal-token substitution:
  (1) `(authorization\s*"?\s*[:=]\s*"?)(Bot|Bearer)?<value>` for header
  forms, (2) `\b<64+chars>\.<8+>\.<8+>\b` JWT shape. The literal-token
  pass (with regex-escaped substitution) is the belt-and-suspenders that
  catches anything the structural passes miss — Bashir's sentinel-token
  test specifically verifies this.
* **Tiny arg parser pattern.** ~25 lines of switch/case over argv with
  `argv[++i]` for value-bearing flags. No yargs, no commander. Last-wins
  on repeated flags is the right default for workflow_dispatch wrappers
  that pass optional inputs as either populated or empty.
* **Testability via injection.** Exporting `runCli({ argv, env, fetchImpl,
  stdout, stderr })` plus an `import.meta.url === file://argv[1]` guard
  is the cleanest way to make an `.mjs` script both directly executable
  and unit-testable. Bashir's test, however, ended up preferring a
  process-level `spawnSync` + `--import` stub approach — both work, but
  the spawnSync style exercises the actual process boundary (env, exit
  codes, stderr) which is what an ops script's contract really is.
* **`.mjs` files outside `tsconfig.json` include globs.** `tsc --noEmit`
  ignored the new file automatically because the include list is scoped
  to `src/**/*.ts` and `tests/**/*.ts`. No tsconfig change needed.

## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---


**2026-05-18T04:00:10Z:** PR #73 merged; exit-code convention restored in discord-ops script — see decisions.md (PR #73 → bashir-exit-code-restoration decision)

## 2026-05-31 — Lesson learned from PR #78: spawn Bashir SYNC before pushing

**Context:** PR #78 cost a full revision cycle because Scotty shipped the data-layer PR without a SYNC gate spawn to Bashir before push. Garak + Bashir CHANGES_REQUESTED on test coverage gaps that could have been caught earlier if Bashir's review had happened in-flight (during the PR authoring phase) rather than after merge.

**Rule 5 note:** For future data-layer or test-heavy work, spawn reviewer-lockout-approved agent (Bashir for test coverage, Garak for contract enforcement) as a SYNC gate BEFORE pushing the PR. This allows findings to be incorporated in the initial review round rather than requiring a separate revision cycle. The pattern worked in PR #98: Uhura knew about the 5 findings before revising because she was looped in early, enabling a single-revision fix.

**Adopted practice:** On next data-layer work or comparable task, Scotty will coordinate with Coordinator to spawn Bashir + Garak SYNC before git push. This adds ~15 min to the initial authoring phase but saves a full revision cycle (1+ hour).

## 2026-05-31: PR #99/#100 review cycle — lockout-routed revisions

Both PRs required non-Scotty revisions (bootstrap path + validation + fixtures). Bashir pre-push gate caught test coverage; Garak caught correctness gaps. The bootstrap path was missed by pre-push gate but caught at PR review stage — future pre-push gates should include bootstrap assertions. Pattern: lockout-routed PR revisions work, but pre-push gates remain sensitive to new I/O boundary contracts.


## 2026-05-31 — PR #103 timestamp-redaction fix (lockout-routed from Uhura)

**Context:** Garak's hostile fact-check re-review of PR #103 caught that Uhura had pasted verbatim CLI output into `docs/CREW-OPTIMIZER.md`, including `generatedAt` ISO-8601 timestamps that are freshly emitted per run. Garak re-ran the CLI and saw a different timestamp — byte-match failed.

**Fix (Option A — docs-only):** Replaced the three literal `generatedAt` timestamp values (lines 38, 253, 300) and three `stalenessDays` values with `"<timestamp>"` and `<N>` placeholders. Added one-line blockquote notes above each example block explaining the substitution. No code changes required.

**Rebase:** Clean — no README conflict despite #102 having just merged. Branch was rebased onto `30fffcf`.

**Commit:** `24abf70` — pushed to `squad/83-operator-docs` (PR #103 unchanged, still OPEN).

**Tests:** 704/704 pass.

## Learnings

- **Verbatim-CLI-output-in-docs must redact volatile fields.** Any doc example that pastes raw CLI JSON must replace fields that change per invocation (`generatedAt`, `stalenessDays`, elapsed timers, process IDs, cache hashes) with labeled placeholders (e.g. `"<timestamp>"`, `<N>`). Add a one-line note above the block: *"Note: `<field>` is replaced with a placeholder; the actual CLI emits a fresh value per run."* This prevents hostile fact-check byte-match failures on fields that are structurally stable but value-volatile. The pattern is: placeholder + note = structurally-identical claim, not byte-identical claim.

**2026-05-31:** First lockout-routed assignment on PR #103 (reviser escalation from Uhura; doc timestamp redaction fix). Completed same-day; Garak approved. (3rd-agent escalation pattern — anti-fragility mechanism activated).

- **Wave 3 close-out pattern (auth + frontend split):** Keep cross-agent WIP in two commits by ownership boundaries (`#117` auth/lib+docs+CI gate first, `#119` web shell+bundle gate second). If `tests/ci` holds mixed ownership files, stage individual test files (and fixtures) intentionally before commit to avoid cross-issue bleed.
- **Worktree commit-message gotcha:** In git worktrees, `.git` is a file, not a directory. Write `git commit -F` message files in repo root (for example `.gitmsg*.txt`), not under `.git/`.
- **Web test portability in monorepo-ish layout:** If root CI runs `npm ci` only once, nested `web/` toolchains are absent. Web smoke tests should self-bootstrap (`npm ci` in `web/` when `node_modules/.bin/vite` is missing) so they pass both in local worktrees and clean CI runners.

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01 — Session wrap-up (crew v2 chain + Phase 1 Wave 3)

**Session:** crew-v2-chain-wrapup
**Role:** Workflow + dependency orchestration
**Outcome:** Crew v2 shipped cleanly; SWA deploy workflow + config shipped (PR #124)

Participated in:
- PR #129 (crew-v1-rewrite): dependency reconciliation
- PR #130 (crew-v2-data-layer): dependency additions (knowledge-rebuild, embedding support)
- PR #132 (crew-v2-optimization): workflow tuning (crew iteration concurrency)
- PR #124 (SWA Phase 1 Wave 3): deploy workflow, SHA-pinned actions, OIDC federation, DISABLE_WRITES env

**Follow-ups from Kirk's PR #124 review:**
- MEDIUM: api/ layout inconsistency (topbar `_lib` vs nested `src/_lib`). Route: Scotty (consolidation task, Wave 4 gate)
- LOW: bundle-budget unit ambiguity (80 KiB vs 80 KB). Fix: add comment

**Next:** Await Wave 4 scope definition (#121); api/ layout consolidation gate.
## 2026-06-01 — PR #129 shipped: crew[v2] read-only handlers (issue #92)

**Co-author:** Uhura-1 (phase-1 dispatcher scaffolding, phase-3+ handlers)
**Phase 2:** Scotty authored best, status, progression, rosterShow handlers (4 handlers using existing src/crew/** engine helpers)
**Cross-squad notes:** Uhura locked out by Garak CR (output determinism guarantee needed); Uhura issued fix; Garak re-verified and approved. All reviewers cleared: Kirk ✅+📝 (wrote skill), Bashir ✅, Picard ✅.
**Outcome:** PR merged 05:43Z. Handlers ready. Next dispatch: #93 (knowledge pipeline) unblocks when PR#129 users confirms (parallel user-action gate: #127 secrets, #85 screenshots).

