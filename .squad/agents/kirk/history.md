# Kirk — History

> Append-only log of substantive technical decisions, architectural calls, and lessons learned. Scribe-owned commits.

## 2026-05-16 — Joined squad as Lead (role swap from Picard)

Picard moved to M2 / Engineering Manager (boss role). I took over the technical
Lead responsibilities he previously held: architecture, technical direction,
and code review on correctness. Picard retains scope, priorities, issue
triage, and blocker removal.

Decision recorded in `.squad/decisions/inbox/picard-kirk-role-swap-2026-05-16.md`
(pending Scribe merge).

Files inherited from Picard's Lead-era work that I now own going forward:
- Architecture of `src/discord/`, `src/digest/`, `src/skills/`
- Reviewer gates on technical correctness across the codebase
- Speckit chain technical sign-off (constitution stays under Picard for scope)

## 2026-05-17 — PR #20 review: refresh-token.yml Saturday 00 UTC cron (Issue #14)

**Verdict:** APPROVE → squash-merged (commit `e053b9c`). Issue #14 auto-closed via `Closes #14`.

**What I checked (review pattern for single-file workflow-cron PRs):**

1. **Cron semantics** — decoded `0 0 * * 6` against GitHub Actions' `MIN HOUR DOM MONTH DOW` format. DOW=6=Saturday (0=Sunday), confirmed = Saturday 00:00 UTC.
2. **Pinning-test rule (repo Rule 3)** — ran `grep -rn 'refresh-token' tests/` and `grep -rn '"0 0 \* \* 6"\|0 4 \* \* 0' tests/` in the worktree. Both empty. No same-commit test update required. PR author had already documented this check in the body, which is the right precedent — future workflow-cron PRs should include the grep result inline.
3. **Permissions/concurrency** — `permissions: contents: read` (minimal). Concurrency group `stfc-gift-redeemer` shared with redeem.yml + incoming discord-monitor.yml is correct: anything touching `STFC_ACCOUNTS` must serialize. `cancel-in-progress: false` is the safe choice (queue rather than drop work).
4. **Scope** — single-file diff `.github/workflows/refresh-token.yml`, +7/-1. The +6 are a block comment pinning rationale (Issue #13 alarm pairing, 30-day expiry headroom, concurrency interaction). Comment-as-architecture-doc — good practice for workflow files where readers won't see the PR description.

**Gotchas observed:**

- `gh pr review --approve` is blocked when the local `gh` is authed as the PR author (cyrusjamula). Worked around by posting the same body as `--comment` and proceeding to merge. Squad sign-off recorded textually, not as a GitHub formal "Approved" status.
- `gh pr merge --delete-branch` fails the local-branch cleanup step when another worktree has the target branch checked out (`fatal: 'main' is already used by worktree at '/workspaces/stfc'`). **Remote branch deletion still succeeds before that error** — verified via `git ls-remote`. Non-blocking for the merge itself, but worth knowing: in worktree mode, local branch cleanup is your problem, not gh's.

**Architectural note:** The Saturday-midnight cadence is the right call. Pairs cleanly with Issue #13's all-accounts-expired alarm — weekly refresh keeps tokens >20 days clear of the 30-day expiry wall, so the alarm only fires on real breakage rather than scheduler lag.

## 2026-05-17T17:53:01.345+00:00 — Batch PR review: #35, #36, #37

### PR #35 — `fix(squad): add Rule 8 — .squad/ artifact sweep` (Picard)

**Verdict:** APPROVE. Clean governance-only change. `rsync --ignore-existing` sweep
before `git worktree remove` is idempotent and non-breaking. All four cleanup locations
updated consistently (ship-it ritual, manual cleanup, Ralph heartbeat, issue lifecycle).
Template mirrors live doc. 284 tests pass.

### PR #36 — `fix(deps): @xenova/transformers → @huggingface/transformers` (Uhura)

**Verdict:** APPROVE. Resolves 8 security advisories (1 critical, 4 high, 3 moderate)
via clean package swap. Dynamic import updated. `pipeline()` API compatible. Tier-2
still gated behind placeholder SHA — no runtime behavior change. 283 pass / 0 fail / 3
todo. Minor: `quickstart.md` line 84 still references `@xenova/transformers` — non-blocking.

### PR #37 — `feat(001-discord-monitor): Phases 5–6` (Scotty)

**Verdict:** CHANGES_REQUESTED. Found a variable shadowing bug:

- `let classifiedTips: Tip[] = []` at function scope (line ~183; line number may vary)
- `const classifiedTips: Tip[] = []` inside `if (token !== null)` (line ~231; line number may vary)

The inner `const` shadows the outer `let`. After the if-block exits, tip-seen
persistence and the finalize() call both reference the outer (empty) array. Classified
tips are silently discarded — `tips-seen.jsonl` never gets entries, digest always has
`tips: []`. Tests pass because they only check RunHealth counters (wired via `health`),
not the data output.

**Fix:** Remove inner `const` declaration, push into outer `let`. Add a test asserting
`result.tips.length > 0` when classifier produces non-chatter.

## Learnings

- **Variable shadowing in block scopes is a silent killer.** TypeScript's `--noEmit`
  typecheck doesn't flag `const` shadowing an outer `let` in a nested block. This is
  legal JS/TS but produces wrong runtime behavior. Consider adding a lint rule
  (`no-shadow`) to catch this class of bug at CI time.
- **Test coverage gap pattern:** When a module has both counter-based health metrics
  and data-output paths, tests that only check counters can pass even when the data
  pipeline is completely broken. Need at least one end-to-end assertion per output path.
- **Self-review blocked by GitHub.** `gh pr review --approve` fails when the `gh` token
  belongs to the PR author. Workaround: post as `gh pr comment` with the verdict header.
  This is the same pattern discovered during the PR #20 review cycle.

2026-05-17T21:39Z: Feature 003-discord-oauth shipped; code review approved and merged via PR #59.
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

## 2026-05-18T02:46Z — PR #71 review: discord-ops-automation (Scotty + O'Brien)

**Verdict:** APPROVE ✅ (architecture review). Comment: https://github.com/Jamula/stfc/pull/71#issuecomment-4473820298

**Scope:** `scripts/discord-ops/set-discord-app-metadata.mjs` (546 LOC, zero new deps) +
`.github/workflows/discord-ops.yml` (operator-only workflow_dispatch wrapper) +
Bashir's 10 pinning/behavior tests. Garak ran parallel hostile fact-check on the
constitution v1.5.0 amendment; Picard is the final governance gate.

**What I checked (review pattern for "script + workflow + tests" PRs):**

1. **Fetch-injection seam.** `discordPatch({ fetchImpl })` with call-time fallback to
   `fetchImpl ?? fetch` lets Bashir stub via `--import` without module-level state.
   Same pattern as `src/discord/client.ts` and `src/api/client.ts`. Uniform.
2. **Inlined redact vs import.** Scotty inlined `redactString` to keep FR-009's
   "scripts/ unreachable from src/" boundary. ~10 LOC duplication. Sentinel-token
   leak test catches future drift. Defensible.
3. **Shell-injection hardening (O'Brien).** Every operator input routed through env
   var → quoted use site → built into argv via bash array. Matches GitHub Security
   Hardening guidance verbatim. First reference implementation of this pattern in
   the repo.
4. **Concurrency group uniqueness.** `grep -h 'concurrency:' .github/workflows/*.yml`
   confirmed `stfc-discord-ops` is unique — distinct from the shared
   `stfc-gift-redeemer` group used by redeem/refresh-token/monitor. Correct because
   the write target is Discord API, not repo `git push`.
5. **Idempotency design.** Script always PATCHes (no GET-diff short-circuit).
   Correct for a one-shot operator script but undocumented — flagged LOW.
6. **Exit-code consistency.** Comment-stated taxonomy: 0=success, 1=infra, 2=operator
   error. Token-missing returns 1 — inconsistency with the stated intent. LOW.

**LOW findings (none gating):**

- Idempotency comment missing near `plannedCalls.push`.
- `DISCORD_BOT_TOKEN not set` should be exit 2, not 1.
- `curl --proto '=https' --proto-redir '=https'` would harden SSRF (belt-and-suspenders).
- Partial-success path (icon OK, description fail) untested.

**Reviewer-rejection lockout:** routed follow-ups to Bashir (script tweaks + test)
and Uhura (curl hardening) — NOT back to Scotty or O'Brien.

**Skill candidate endorsed:** `.copilot/skills/operator-workflows/` for the four
reusable invariants (workflow_dispatch-only · minimal perms + step-scoped secret env ·
unique concurrency group · env-routed quoted inputs). First workflow of its shape in
the repo (operator-only, manual-only, third-party-mutating) — the pattern is reusable
for any future `scripts/<vendor>-ops/` wrapper.

## Learnings

- **Env-routed input hardening is the canonical GHA shell-injection pattern** and
  this PR is now the reference implementation in this repo. Future workflow PRs
  touching `inputs.*` in `run:` blocks should be diffed against `discord-ops.yml`.
- **First-of-its-kind workflow shape** (operator-only + third-party-mutating) needs
  its own concurrency group, distinct from `stfc-gift-redeemer`. Blast-radius
  isolation matters even when both groups serialize "writes" — the writes are to
  different systems.
- **Script-as-CLI-with-injection-seams** is the pattern: export `runCli`,
  `discordPatch`, parsers/validators; isMain guard at the bottom; `process.exit`
  only at the entrypoint. Keeps tests fast (no spawn needed for unit tests) and
  the workflow integration via spawnSync is still possible for end-to-end pin tests.

**2026-05-18T04:00:10Z:** PR #73 merged; exit-code convention restored — see decisions.md (PR #73 → bashir-exit-code-restoration decision)

## 2026-05-31 — PR #75 review: docs/stfc-knowledge ingestion (Picard, closes #74)

**Verdict:** APPROVE ✅ — Comment: https://github.com/Jamula/stfc/pull/75#issuecomment-4587873547

**Scope:** `docs/stfc-knowledge/README.md` (lineage convention), 11 per-tab mirrors under
`docs/stfc-knowledge/community-reference-sheet/`, `scripts/fetch-community-sheet.mjs`,
cross-link updates to `README.md` and `docs/stfc-game-knowledge.md`. Docs + scripts only —
zero `src/` or `.squad/` touches.

**What I checked:**

1. **Fetcher script (`scripts/fetch-community-sheet.mjs`)** — gviz endpoint correctly
   constructed as `?tqx=out:csv&gid=${tab.gid}` per tab. `TABS` array hardcodes 11 gids
   with instructions for adding new ones from `/htmlview`. `writeFile` overwrites on every
   run — correct refresh semantics. Error handling throws on `!res.ok`. No secrets
   (sheet is public). Uses only `node:fs/promises` and `node:path` (ESM, Node built-ins —
   no new deps). RFC 4180 CSV parser is inlined — handles quoted fields and escaped quotes.

2. **Lineage convention** — 6 fields present and clear. Convention doc explicitly enumerates
   "Discord channel snapshots" as a future use case alongside sheet tabs and forum excerpts.
   Generalises cleanly to #76 (Discord ingestion). Sub-directory naming rule (source name,
   not topic) is the right call for long-term discoverability.

3. **Per-tab files** — Spot-checked 4/11 (01-intro, 02-sf-academy-building, 04-athena,
   11-critical-damage-mitigation). All carry 6-field lineage block, tab-specific gid
   deep-links, full attribution list, and RFC 4180 fenced CSV block. Header generated
   from constants in the script — attribution cannot accidentally be dropped on refresh.

4. **Cross-links** — README.md tree diagram accurate. `docs/stfc-game-knowledge.md` section 14
   correctly frames the distinction: Scopely-canonical terminology in the main doc vs
   community-derived progression/crewing numbers in the mirror. No broken refs.

5. **CI** — 5/5 required checks green: CodeQL ✅, secret scan ✅, npm test ✅ (×3 runners).

**LOW finding (non-blocking, logged in comment):**

- `fetch-community-sheet.mjs` does not check `Content-Type` after the `!res.ok` guard.
  A rate-limited gviz response (HTML redirect or 429 with HTML body) would silently write
  HTML into the CSV block. Fix: `if (!res.headers.get('content-type')?.startsWith('text/csv')) throw`.

## Learnings

- **gviz CSV endpoint pattern** (`/gviz/tq?tqx=out:csv&gid=`) is the canonical way to
  fetch public Google Sheet tabs without OAuth. gids come from the `/htmlview` URL source.
  This is the reference implementation for any future sheet ingestion in this repo.
- **Content-Type guard on fetch responses** should be standard in any ingest script that
  hits a public API endpoint. `!res.ok` alone doesn't catch redirected HTML error pages
  (e.g., 429 with a body, login redirects). Pattern: check both status AND content-type.
- **Lineage-from-constants pattern** (generate the 6-field block from TABS constants in
  the script, not hand-written per-file) is the right design: attribution cannot be
  silently dropped on a refresh. Future ingest scripts should follow this.
- **For #76 Discord ingestion:** the `docs/stfc-knowledge/` structure and lineage convention
  are ready. The sub-directory will be `officer-tool-discord-codes-channel/` or similar
  (source-named, not topic-named). The lineage convention already names Discord snapshots
  explicitly — no convention update needed. The fetcher will differ (Discord API or
  manual snapshot rather than gviz) but the output format (6-field lineage + fenced block)
  is the same.

## 2026-05-31 — Spec + Constitution v1.6.0 + Data Layer Review

Reviewed PR #97 (v1.6.0 constitution amendment) and PR #98 (data layer) on the same cycle. Kirk's role: technical + governance ack on the constitution (vs Picard self-approval), plus standard code review on data layer.

**PR #97:** Approved. Architecture, contracts, test strategy, and SemVer all correct. Plan template re-sync verified. Deferred merge pending Garak's hostile fact-check per Rule 7 — both reviewer approvals required on constitution amendments.

**PR #98 (round 1):** Approved on architecture. Module split coherent; loaders isolated from compute; TypeScript strict mode clean. Garak + Bashir found 5 test/contract gaps; did not block Kirk's APPROVE because findings were non-architectural.

**PR #98 (round 2):** Both re-reviews approved. Uhura addressed all 5 findings in single revision (277f7023, +53 tests). Merged as eb2fd9d.

**Lesson:** Strict-mode TypeScript + contract clarity enables reviewers to work in parallel across different concern axes (Kirk: architecture + test strategy; Garak: contract enforcement; Bashir: coverage gaps). All findings ground-truthable against contracts → single-revision fix.
- Phase 0 shipped (PR #111, aeef1b5)
