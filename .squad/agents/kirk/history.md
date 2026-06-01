# Kirk — Technical Architecture Lead & Reviewer

> Entries prior to 2026-06-01 archived to `history-archive.md` (348 lines, 37KB).

## 2026-06-01 — Multi-PR technical review + triage: PRs #129, #130, #132; Issue #92

**PR #129 (crew[v2] read-only handlers):** Engine reuse verified (no logic duplicated across 8 verbs); type safety enforced (HandlerDeps shape, no any); pure functions confirmed (no disk writes except via injected load* helpers); output length cap verified; dispatcher switch exhaustive with TS never check. ✅ APPROVE (no rework). Wrote `.squad/skills/embedding-pipeline-review/SKILL.md` post-PR.

**PR #130 (crew[v2] knowledge embedding + handler):** Embedder interface sound (pluggable default=hashed-bow-v1); MiniLM plumbing complete but opt-in (STFC_KNOWLEDGE_MODEL env gated, dead-code in default); staleness evaluation correct; deterministic output. ✅ APPROVE (no rework).

**PR #132 (knowledge-rebuild workflow + Rule 3 pinning tests):** O'Brien's pin test suite verified. ✅ APPROVE (no rework).

**Issue #92 triage:** 8-handler inventory, parallel-safe Scotty/Uhura split, test-coverage strategy, reviewer-lane matrix, internal phase-boundary commits per Rule 5. Triage memo exported to decisions inbox for Batch 2 #93 dispatch prep.

1. **Scope isolation** — the critical invariant: promo-code extraction must not see command-channel messages. Verified by checking that `codeChannelIds` is built from `allowlist.entries` (original promo channels only), not from the merged `ingestAllowlist`. `codeMessages` then filters `ingestedMessages` against this set. Command messages pass through `processCrewCommands` separately. Fully isolated.
2. **Rate limiter rolling-window semantics** — `pruneWindow` rebuilds the value array on every call (filter + set), keeping per-key arrays bounded. Rejected commands return before `push`, so they don't count against limits. Both channel (10) and user (5) windows independent.
3. **Parser edge cases** — `isCrewCommandPrefix` checks `startsWith(PREFIX) && (next === undefined || /\s/.test(next))`. Handles: bare `!crew`, `!crew ` (trailing space), `!crewbest` (no boundary → false), `!Crew` (case sensitive → false). `tokenizeArgs` handles quoted strings and backslash escape. `parseArgs` treats `--` (exactly 2 dashes) as positional (end-of-flags convention).
4. **Backward compatibility** — `guild_id: optional()` on `DiscordMessageSchema` is additive. `discordMessages` field on `IngestOutput` is additive (existing callers ignore it). `loadCommandChannelAllowlist` returns `[]` on missing file.
5. **Constitution durable-inputs** — `data/discord/command-channels.json` is operator-local, not committed (only `.example` shipped). No constitution amendment needed. Deferred to #95 (confirmed OPEN).

**LOW findings (all non-blocking):**

- `CrewCommandRateLimiter` Map keys accumulate over process lifetime (values are bounded per key, but the key itself stays even after the array empties). Non-issue for restart-per-run (GHA). Tag for #92 if daemon model adopted.
- `withCommandChannels` hardcodes `version: 1` — safe for current schema but would need fixing at schema v2.
- PR body uses `## Verification` not `## Tests` (Rule 15 compliance gap — heading-only, substance was correct).
- `stats.ignored` inflated by non-crew messages from promo channels; surfaced only when `seen > 0 || rateLimited > 0`, so harmless.

**Handler seam assessment for #92:** `processCrewCommands` / `handleCrewCommand` are clean. `CrewCommand { subcommand, args, raw, message }` is a sufficient interface. Positional args available as `_0`, `_1`, `_`; flags drop `--` prefix. No rework needed for Phase 20 handler wires.

## 2026-06-01 — PR #133 review: crew v2 operator docs (Tuvok, closes #95)

**Verdict:** APPROVE ✅ WITH NOTES — Comment: https://github.com/Jamula/stfc/pull/133#issuecomment-4589964586

**Author:** Tuvok. **Branch:** `squad/95-crew-v2-operator-docs`.

**Scope:** `docs/CREW-OPTIMIZER.md` docs-only expansion (+254 lines). No `src/` or test changes.

**What I checked (docs accuracy review pattern):**

1. **`!crew best`** (`best.ts`) — `--account` required, `--top` 1–3 default 1 via `parseTop`, 1900-char inline `truncateForDiscord` footer. All accurate.
2. **`!crew knowledge`** (`handlers/knowledge.ts`) — `--top` 1–5 default 3 via `DEFAULT_TOP`/`MAX_TOP`, citation template `` `**${source}:L${startLine}-L${endLine}**` `` matches doc's `**source:LX-LY**`, retrieval-only confirmed. All accurate.
3. **`!crew synergy`** (`synergy.ts:8`) — regex `/^[a-z0-9]+(?:_[a-z0-9]+)*$/i` with case-insensitive flag + `.toLowerCase()` normalize. Doc claim accurate.
4. **Knowledge workflow** (`knowledge-rebuild.yml`) — push paths, `workflow_dispatch`, concurrency group, commit message all match exactly. Rebase-before-push step present in workflow but omitted in doc (operator-irrelevant detail).
5. **Rule 12** — `Closes #95` on its own line at L28 of PR body.

**LOW findings (non-blocking):**

- **`STFC_KNOWLEDGE_MODEL=hashed` implied but not recognized** (`knowledge.ts:535`): code only checks `=== "minilm"`; any other value including unset falls through to hashed embedder. Doc says "Unset or `hashed`" — implies `hashed` is a named sentinel. Fix: doc should say "Unset (default); only `minilm` is a recognized value."
- **Two distinct truncation footer formats not differentiated** (`shared.ts:86` vs inline `truncateForDiscord`): `officers` uses `truncateLines` → `… (N more — use --owned or --faction X to filter)` (count-aware); all other handlers use `_…output truncated to 1900 chars; narrow the query for full details._`. Doc only shows generic description. Low operator-confusion risk but a gap from the task spec.

## Learnings

- **Docs accuracy review pattern for handler docs:** Cross-check (a) every flag's range + default in the source's `parseX()` function, (b) every template literal that produces user-visible output (especially citation formats), (c) every env var for both its conditional check AND what values actually trigger distinct behavior. Don't trust the doc's enum list — check `===` comparisons in the source.
- **`truncateLines` vs `truncateForDiscord`:** These two patterns coexist in this repo as of v2. `truncateLines` (shared.ts, used by `officers`) is count-aware and line-granular; the inline `truncateForDiscord` (best, knowledge, progression, rosterShow, status) is char-granular with a generic footer. When documenting command output, distinguish which handler uses which — operators will see different footers.
- **Env-var recognized-values vs fallthrough:** Code that does `if (env === "foo")` makes `foo` the ONLY recognized value; everything else is a silent default. Doc should not list the default path as a named value unless the code explicitly checks for it. Pattern to catch in future env-var PRs.

## Learnings

- **Parser PR review pattern:** The key invariant for any monitor-integration parser PR is scope isolation — verify the original channel set is used for existing pipelines, and only the merged/enriched set is used for new pipelines. In this repo, check `codeChannelIds` vs `ingestAllowlist`.
- **Rate-limiter sanity checks:** (1) Are values bounded? (values array pruned per call ✅) (2) Are rejected commands NOT registered? (early return before push ✅) (3) Are keys bounded? (NO — potential long-running concern; flag if daemon). (4) Is the window truly rolling, not fixed? (pruneWindow filters `ts > nowMs - WINDOW_MS` ✅ — note `>` not `>=`, so timestamps exactly at the boundary are excluded, which is the correct strict-window semantics).
- **Optional operator files** (not committed, only `.example` shipped) don't need constitution amendments. The constitution's committed durable-inputs list is for committed files only. `.example` is the discoverable convention.
- **`withCommandChannels` version field**: when building a new `DiscordAllowlist` from an existing one, carry `allowlist.version` forward rather than hardcoding. Catch this pattern in future allowlist manipulation PRs.

## 2026-06-01T01:25:00Z — Wave 3 close-out + Wave 4 fanout audit (Picard triage)
PR #124 (auth.ts + shell) open on `squad/005-phase1-dashboard`. Picard triage identifies Wave 4 #118 + #121 parallel-safe, queued for dispatch post-Kirk review gate.
**Smooth cycle:** Three PRs merged 05:43–05:46Z with zero technical rework.

---

## Archived Learnings

**See `history-archive.md` for:**
- PR #123 review (crew parser, Phase 19)
- Architecture-doc decision (canonical system map)
- Data-layer schema review (PR #98)
- Test-first discipline notes
- Engine-reuse patterns
- Parser edge-case verification
- And 320+ more lines of technical decisions (2026-05-18 through 2026-05-31)

Status: COMPLETE
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

## 2026-06-01 — PR #124 review: 005-web-control-panel Phase 1 Wave 3 (multi-issue bundle)

**Verdict:** APPROVE ✅ — Comment: https://github.com/Jamula/stfc/pull/124#issuecomment-4589200978

**Scope:** 57 files (+10,893 / −338, ~5,111 in package-lock.json) bundling 8 P1 issues (#113 SWA deploy, #114 unignore digests, #115 SWA bootstrap, #116 SWA config + roles, #117 auth-lib + grep gate, #119 frontend shell, #120 bundle budget, #122 shared TS contracts). Parallel hostile fact-check by Garak (per `feat(*) touching src/` hard-gate). Full reasoning at `.squad/decisions/inbox/kirk-pr124-phase1-wave3.md`.

**Local verification:** typecheck clean; npm test 906 pass / 0 fail. CI: deploy ❌ (Azure OIDC secrets missing — O'Brien parallel work, not a code regression), all other checks green.

**Architecture validated:**
- SWA principal auth (`x-ms-client-principal` base64 JSON decode + shape validation + allowlist re-check) is correct defence-in-depth on top of the SWA route-level `stfc_operator` gate.
- `requireRole` deliberately NOT accepted by the grep gate — forces username allowlist or owner re-check.
- SWA config is deny-by-default; `/.auth/*` correctly precedes `/*` (first-match-wins); CSP forbids `script-src 'unsafe-inline'`; 403 page is CSP-safe.
- Deploy workflow: SHA-pinned actions, OIDC federation (no long-lived token), `DISABLE_WRITES: "1"` literal in deploy env, teardown on PR close.
- Contract generator handles flat + discriminated-oneOf schemas; `@stfc/contracts/*` path alias in both root + api tsconfigs.
- Frontend: Lit 3 + Vite 6, all stfc-* prefixed, `cssCodeSplit: false` + separate lit vendor chunk for CSP compatibility.

**4 follow-up findings (none blocking, with rejection-lockout routing):**

1. **MEDIUM** — grep gate enforces *presence* not *first statement* despite the docstring's claim ("first non-trivial statement"). Either tighten via AST or soften the docstring. Route → Uhura (#117 owner).
2. **MEDIUM** — inconsistent `api/` layout: `api/_lib/github-raw.ts` (top-level) vs `api/src/_lib/auth.ts` (nested). `api/tsconfig.json` rootDir mismatch means each file is typechecked via a different path. Pick canonical layout before Wave 4 #121. Route → Scotty (author of divergence; consolidation is a fresh task).
3. **LOW** — `EXCLUDE_SEGMENTS` skips every `_lib` recursively, not just top-level. Footgun if a handler lands inside a nested `_lib`. Route → Uhura.
4. **LOW** — `DISABLE_WRITES` is dead code (no API handler reads it yet). Ship a tiny kill-switch helper or TODO note this wave. Route → O'Brien.

Plus LOW: bundle-budget unit ambiguity (81920 = 80 KiB vs spec "80 KB" = 80000). Add a comment. Route → Scotty.

## Learnings

- **Grep-gate-as-contract: the script's docstring IS the contract.** Any drift between docstring promise and behaviour is itself a reviewable finding. Always read both the rules statement at the top and the check body — they can disagree silently.
- **TS path-alias + multi-tsconfig parity is fragile.** When a repo has a root tsconfig AND sub-project tsconfigs, BOTH include arrays need to cover every shared library directory, or you get "works because tests reach it" coverage that breaks the moment a non-test consumer is added. Always grep both `include` blocks against every new directory.
- **First-statement enforcement is harder than presence enforcement.** A grep gate is fundamentally a presence check; a "first statement" check requires AST parsing. Choose the contract that matches the tool, or upgrade the tool — don't promise AST-grade ordering in a regex script.
- **Lit + CSP: `style-src 'unsafe-inline'` is the standard Lit-with-shadow-DOM concession** (older Safari adoptedStyleSheets fallback path). Don't try to drop it for `style-src` until Safari coverage is verified. `script-src 'self'` (no unsafe-inline) is achievable and is what shipped here. ✓
- **The largest bundle this repo has shipped (8 issues, 57 files, +10.9k LOC) held together** because every concern group brought its own test file. The pattern scales as long as test-file boundaries match concern-group boundaries. For Wave 4, either pre-split by issue OR pre-assign per-group reviewers in the PR body (Garak/Bashir/Kirk each own a section) rather than re-discovering boundaries during review.
- **Rule 12 (`Closes #N` one-per-line) at scale**: PR #124's 8-issue close block is exactly the right form. Ship-it ritual will close all 8 cleanly with no manual sweep needed.
- **Multi-issue PR review tactics that worked here**: (1) group files by concern in `gh pr view --json files`, (2) read one test file per concern as the spec, (3) run typecheck + npm test once at the end, (4) cross-check rule disclosures (#15 Tests, #16 Docs, #3 pinning) before verdict. ~45 minutes elapsed for this scope.

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01 — Session wrap-up (crew v2 chain + final reviewer batch)

**Session:** crew-v2-chain-wrapup
**Role:** Code review + scope validation
**Outcome:** Crew v2 shipped cleanly; operator docs (#133) parked for accuracy fixes (#136)

Code reviews completed this session:
- PR #129 (crew-v1-rewrite): APPROVE ✅
- PR #130 (crew-v2-data-layer): APPROVE ✅ + embedding-pipeline-review skill (uncommitted post-merge)
- PR #132 (crew-v2-optimization): APPROVE ✅
- PR #123 (crew command parser): APPROVE ✅ — scope isolation verified, rate-limiter semantics sound, parser edge cases clean
- PR #133 (operator-docs): APPROVE ✅ + 📝 doc-accuracy findings → included in #136 scope

**Stacked PR pattern learning:** After PR #129 squash-merge to main, PR #130 rebased via `git rebase --onto origin/main <PR-#129-base> HEAD` to clean the diff. Same technique applied post-#130 for #132. Clean diffs enabled faster review cycles.

**Kirk history summarized:** Entries prior to 2026-06-01 archived to history-archive.md (9,134 bytes). Current history reset to recent work only.

**Next phase:** Awaiting #136 fix + PR #135 (devcontainer) follow-up.

