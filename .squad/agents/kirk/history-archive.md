# Kirk — History

> Append-only log of substantive technical decisions, architectural calls, and lessons learned. Scribe-owned commits.

## 2026-06-01 — PR #123 review: !crew command parser, Phase 19 (closes #91)

**Verdict:** APPROVE ✅ — Comment: https://github.com/Jamula/stfc/pull/123#issuecomment-4588860690

**Author:** Uhura. **Branch:** `squad/91-v2-parser`.

**Scope:** New `src/discord/crewCommandParser.ts` (229 LOC) + `tests/discord/crewCommandParser.test.ts` (150 LOC) + `data/discord/command-channels.json.example`. Edits to `schemas.ts`, `state.ts`, `ingest.ts`, `client.ts`, `discordMonitor.ts`, `tests/index.test.ts`. +556/-30.

**What I checked (pattern for parser + rate-limiter + monitor-integration PRs):**

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

## Learnings

- **Parser PR review pattern:** The key invariant for any monitor-integration parser PR is scope isolation — verify the original channel set is used for existing pipelines, and only the merged/enriched set is used for new pipelines. In this repo, check `codeChannelIds` vs `ingestAllowlist`.
- **Rate-limiter sanity checks:** (1) Are values bounded? (values array pruned per call ✅) (2) Are rejected commands NOT registered? (early return before push ✅) (3) Are keys bounded? (NO — potential long-running concern; flag if daemon). (4) Is the window truly rolling, not fixed? (pruneWindow filters `ts > nowMs - WINDOW_MS` ✅ — note `>` not `>=`, so timestamps exactly at the boundary are excluded, which is the correct strict-window semantics).
- **Optional operator files** (not committed, only `.example` shipped) don't need constitution amendments. The constitution's committed durable-inputs list is for committed files only. `.example` is the discoverable convention.
- **`withCommandChannels` version field**: when building a new `DiscordAllowlist` from an existing one, carry `allowlist.version` forward rather than hardcoding. Catch this pattern in future allowlist manipulation PRs.

## 2026-06-01T01:25:00Z — Wave 3 close-out + Wave 4 fanout audit (Picard triage)
PR #124 (auth.ts + shell) open on `squad/005-phase1-dashboard`. Picard triage identifies Wave 4 #118 + #121 parallel-safe, queued for dispatch post-Kirk review gate.

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE

## 2026-06-01T04:05Z — Triage: Issue #92 (crew v2 read-only command handlers)

**Mode:** read-only triage. Memo dropped at `.squad/decisions/inbox/kirk-issue-92-triage.md`.

**Verdict shape:** 8 verbs, every one a thin `(load → existing helper → format)` shell over `src/crew/{optimizer,progression,roster,staleness,tasks,database}.ts`. Zero novel domain logic. Recommended single PR on `squad/92-crew-v2-handlers` with four phase-boundary commits; split work by handler boundary (Scotty: best/status/progression/rosterShow; Uhura: explain/synergy/tasks/officers + dispatch wire-up). Sole shared-file conflict surface is the `handleCrewCommand` switch in `src/discord/crewCommandParser.ts:98`, owned end-to-end by Uhura. Open questions Q1–Q7 mostly default-able; only Q1 (embed vs string) and Q6 (id vs name lookup) worth surfacing to user before dispatch.

## Learnings — triage-memo pattern (NEW)

- **"Handler implementation issue" triage rubric** — for any issue of the form "implement N verbs over an existing engine", check:
  1. **Helper coverage** — does the engine already expose every primitive needed, or does at least one verb need new engine code? If new engine code, escalate to "needs spec clarification" (or split issue) before dispatch.
  2. **Shared-file conflict count** — list every file BOTH parallel owners must edit. If >1 (excluding append-only barrels and test-index files), recommend serializing the agents or splitting the file boundary.
  3. **Output-format ambiguity** — Discord/CLI/markdown handlers usually have an unstated "rich vs plain" choice. Default to the cheapest (plain string) and call it out; never silently introduce a new responder API surface.
  4. **Length-cap reality check** — Discord 2000-char limit, CLI terminal width, etc. If any verb's natural output exceeds the limit at realistic data scale (30–50 officers, 4–20 tasks), pin a truncation strategy in the triage.
  5. **Account/selector resolution gap** — most CLI-derived Discord commands inherit a `--account` flag whose default is undefined. Pin the default behaviour (error vs loop-all vs first-alphabetical) before dispatch; don't let the implementer guess.

- **Single-PR-vs-split heuristic for handler bundles** — if the dispatcher already advertises all N verbs ("coming soon" in help text) AND total diff < 1.5 kLOC AND all verbs share a common deps shape, ship as ONE PR. Splitting mid-bundle leaves the dispatcher half-rewritten on `main` and forces a second PR to re-test the dispatch path.

- **Reviewer-lane assignment for handler PRs** — Garak (does output match engine output, or does formatting drift?) > Kirk (engine reuse + exhaustive switch) > Bashir (per-verb golden + integration) > Picard (no governance amendment needed; just scope + Rule 6a per-line `Closes`). No Tuvok unless docs change in the same PR.

- **Dispatcher seam ownership** — when a parser PR (#91) and a handler PR (#92) are split across agents, the parser PR's author should own the dispatcher edit in the handler PR too. Prevents two agents trampling the same switch statement.
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

## 2026-06-01 — Authored docs/ARCHITECTURE.md (system architecture map)

**Request:** Cyrus Jamula via Copilot: *"document the system architecture / I want to understand the details on how the system works."*

**Deliverable:** Single canonical `docs/ARCHITECTURE.md` — 754 lines / 33 KB, 4 Mermaid diagrams, 8-section template. Direct commit to `main` (docs-only, low risk).

**Approach.** Followed the 8-section template specified in the prompt verbatim — verified it generalises well across all 6 subsystems. Cross-referenced existing per-subsystem docs (`SWA-SETUP.md`, `SWA-INVITATION-RUNBOOK.md`, `CREW-OPTIMIZER.md`, `DISCORD-BOT-SETUP.md`, `SETUP.md`, `squad.md`) rather than duplicating them — architecture doc is the MAP, not the encyclopedia.

**Diagrams shipped.** (1) `flowchart LR` topology with three swimlanes (Triggers, Subsystems, State). (2) Sequence diagram for scheduled gift redemption. (3) Sequence diagram for `!crew` Discord command dispatch. (4) Sequence diagram for SWA authenticated read with two-gate auth model.

## Learnings

- **8-section "system architecture" template that scales for multi-subsystem repos.** For any future *"document the system"* request, reuse: §1 Topology at a glance (Mermaid + subsystem table) → §2 Repository layout (annotated tree, only meaningful dirs) → §3 Subsystem deep-dives (one §3.N per subsystem with consistent sub-headings: entrypoint, contract, modules, scheduling) → §4 Data flows (Mermaid sequenceDiagrams for the 2-3 most cross-cutting flows) → §5 Cross-cutting concerns (secrets, ops constraints, testing) → §6 Reference index (lookup table) → §7 Known gaps (with TODO links) → §8 How to change safely (cite repo rules by number). The shape lets a reader land in §3.N for their subsystem and a maintainer audit §7 for what's deferred.
- **Architecture-doc-as-map, not encyclopedia.** Always cross-reference per-subsystem docs (`docs/SWA-SETUP.md`, `docs/CREW-OPTIMIZER.md`, etc.) rather than duplicating their content. Drift cost of duplication is enormous; a 1-line pointer ages gracefully.
- **Cite file:line for any specific behaviour claim.** The doc claims things like "exit codes per `runAll.ts:399-407`" — every behavioural assertion is grounded against a path. If I'm not 100% sure, mark "TODO: verify" with the file someone should read. Future maintainers can ground-truth the doc against the code without rebuilding the mental model.
- **Mermaid `flowchart LR` + 2-3 `sequenceDiagram`s are sufficient for almost any architecture doc** at this repo's scale. More diagrams = more drift risk. Pick the 2-3 most cross-cutting flows (here: redemption, !crew, web-auth) and leave the rest to per-subsystem docs.
- **Section §7 "Known gaps" with explicit TODO markers** is the most valuable section for a returning maintainer — it tells them what NOT to trust and where to start verifying. Always include even if everything seems clean today.

## 2026-06-01T05:16Z — PR #130 review: crew v2 knowledge embedding pipeline (closes #93)

**Verdict:** APPROVE ✅ WITH NOTES — Comment: https://github.com/Jamula/stfc/pull/130#issuecomment-4589762939

**Author:** Scotty. **Branch:** `squad/93-crew-v2-knowledge` @ `5a75942`. +30999/-3 (most of which is the committed 396KB embeddings artifact, 76 chunks).

**Scope:** New `src/crew/knowledge.ts` (562 LOC — chunker, hashed-BoW + MiniLM embedders, cache I/O, retriever, CLI), `src/crew/handlers/knowledge.ts` (Discord handler), `data/crew/knowledge-embeddings.json` (committed artifact), tests for both modules. Dispatcher wired in `crewCommandParser.ts:216-217`. `@huggingface/transformers ^4.2.0` added as a regular dep (lazy-imported).

**Pattern for embedding-pipeline reviews — what I checked:**

1. **Chunker overlap math (oversized section path)** — Walked a 600-char section by hand. `cursor=0, sliceEnd=500` → push slice [0,500]. `cursor=500-100=400, sliceEnd=min(900,600)=600` → push slice [400,600]. `sliceEnd>=len` → break. Forward progress guaranteed because `TARGET-OVERLAP = 400 > 0`. Line anchors via `offsetToLine` (binary search over `lineOffsets`) are exact. The `trimmed.length <= TARGET*1.5` early-return path handles the common "just slightly over" case in a single chunk.
2. **Cache invalidation completeness** — Three drift sources: source content, model id, chunker version. `hashSources` mixes all three (model, CHUNKER_VERSION, sorted `source:path\ncontent\n`). `cacheNeedsRebuild` also short-circuits on `chunkerVersion` separately — redundant with the hash but defensible as belt-and-suspenders. No CRLF normalisation (CI is LF-only so harmless).
3. **Determinism** — Tie-break by `(chunk.source, chunk.startLine)`. Both are intrinsic to the chunk, never array index. Reproducible across runs AND across cache rebuilds. This is the critical property for a retriever in a test suite.
4. **No LLM generation** — Handler returns `chunk.text` verbatim via `previewText` (320-char truncate) in fenced code blocks with `**source:Lstart-Lend**` citation header. No template substitution anywhere in the render path. Every byte traceable to a committed source file.
5. **Embedder abstraction** — Pluggable `type Embedder = (text) => Promise<number[]>`. MiniLM lazy-imported so the unit-test suite doesn't drag in `@huggingface/transformers`. Cache records `model:` so `defaultEmbedderForCache` picks the right embedder at query time — keeps cosine self-consistent. Committed artifact is built with the hashed fallback so the cache is reproducible without network access; operators flip to MiniLM via `STFC_KNOWLEDGE_MODEL=minilm` env.

**Convention parity with #129 (the 8-handler PR):**

- Plain markdown output (no embeds) ✅
- `MAX_DISCORD_CHARS=1900`, `TRUNCATION_FOOTER` text matches `best.ts` byte-for-byte ✅
- `--top N` parser mirrors `best.parseTop` shape (rejects `"true"`, requires integer, range check) — knowledge allows 1-5 vs best's 1-3, which is reasonable for a retriever
- Dispatcher case in `crewCommandParser.ts` follows the 8-verb switch pattern verbatim
- Error envelope: throws `Error`, dispatcher renders. Same as `best.ts`

**LOW findings (all non-blocking):**

- **`findOfficerEndLine` brace-counting doesn't skip string literals.** A `captain_maneuver.text` like `"...{alpha} fire rate"` would inflate `depth` and over-extend `endLine`. Bounded by `+60` cap so worst case is a slightly stretched citation, no crash. Defer to v2.
- **`readCache` runs on every query.** 396 KB JSON parse per `!crew knowledge`. Rate limiter caps load (10/channel/5min) so harmless today, but an `mtime`-keyed in-memory cache in the handler would be nearly free.
- **`cosineSimilarity` recomputes norms each call.** Both stored embeddings (hashed BoW) and MiniLM outputs are already L2-normalised; denominator is always ~1.0. Could fast-path as plain dot product.
- **No `STFC_KNOWLEDGE_EMBEDDINGS_PATH` env override.** Other handlers use `STFC_OFFICERS_PATH`/etc; `KnowledgeHandlerDeps.cachePath` covers tests but operators can't relocate the artifact without code change. Minor consistency gap.

## Learnings

- **Embedding-pipeline review pattern** (reusable for any future retrieval PR):
  1. **Chunker overlap math** — walk an oversized-section edge case by hand. Verify `cursor` strictly increases (i.e., `TARGET > OVERLAP`) and that termination uses `sliceEnd >= len` not `cursor >= len` (which would loop one short).
  2. **Cache key completeness** — list the drift sources (content, model, chunker version, path identifiers). Confirm each is in the hash AND that each triggers rebuild via `cacheNeedsRebuild`. Sorted iteration on directory inputs (so file-order shuffles don't invalidate the hash) is required.
  3. **Tie-break determinism** — sort comparator must use intrinsic chunk properties (source, line, id), never array index or insertion order. Otherwise the retriever flaps under cache rebuilds.
  4. **Non-generative invariant** — grep the handler for `${`, `replace(`, template substitutions on the chunk text. Confirm the output is `chunk.text` verbatim (optionally truncated, but never rewritten).
  5. **Embedder/cache self-consistency** — the cache must record which embedder built it (`cache.model`), and the query path must select the matching embedder. Otherwise cosine across mismatched spaces is noise.
- **Lazy import for heavy optional deps** is the right pattern when the dep is opt-in: `async function createMiniLMEmbedder() { const transformers = await import("@huggingface/transformers"); ... }`. Keeps unit-test cold start fast and avoids forcing the dep on test runners. But the dep still has to be in `package.json` (not `optionalDependencies`) so `npm install` resolves it for operators who DO opt in.
- **Committed reproducible artifact** — using the deterministic hashed-BoW fallback to BUILD the committed cache (rather than MiniLM weights, which require network) means CI / new contributors can regenerate the exact same bytes. Smart trade-off: ship retrieval quality of the hashed fallback by default, let operators upgrade locally.
- **String-literal-aware brace matching** is a recurring trap in line-anchor heuristics over JSON/YAML. If a future PR adds depth-based parsing, recommend using `JSON.parse` + position maps rather than raw character counting.


## 2026-06-01 — PR #132 review: knowledge-rebuild workflow + Rule 3 pinning tests (closes #94)

**Verdict:** APPROVE ✅ WITH NOTES — Comment: https://github.com/Jamula/stfc/pull/132#issuecomment-4589795749

**Author:** O'Brien. **Branch:** `squad/94-knowledge-rebuild`. **Stacked on:** PR #130 (`squad/93-crew-v2-knowledge`).

**Scope:** `.github/workflows/knowledge-rebuild.yml` (+64), `tests/skills/knowledgeRebuild.test.ts` (+189), `tests/index.test.ts` (+1). +254 / -0. Stacked PR — diff scoped to O'Brien's 3 files only.

**What I checked (workflow YAML + pinning test review pattern):**

1. **Trigger scoping** — push paths exactly `docs/stfc-game-knowledge.md`, `data/crew/officers.json`, `data/crew/tasks/**` + `workflow_dispatch`. No cron. Correct for a pure-compute regenerator.
2. **Concurrency uniqueness** — `stfc-knowledge-rebuild` is distinct from all 5 other groups in the repo (stfc-gift-redeemer ×3, stfc-crew-optimizer, stfc-discord-ops). Grep-verified against `.github/workflows/*.yml`.
3. **Action SHA pinning** — both `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` and `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` match sibling workflows exactly.
4. **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`** — present at `env:` level. ✅
5. **Rebase-before-push pattern** — structurally identical to `optimize-crew.yml` (`set -euo pipefail`, `git status --porcelain` guard, `git add -- <file>`, `git commit`, `git pull --rebase || true`, `git push origin HEAD:$GITHUB_REF_NAME`). No divergence.
6. **Idempotency confirmed** — `rebuildCommand()` returns `{status: "up-to-date"}` without writing the file when `sourcesHash` matches the cache. Workflow `git status --porcelain` guard catches no-op runs. Output file (`knowledge-embeddings.json`) is NOT in the trigger paths — no self-loop.
7. **`|| true` risk (LOW)** — rebase failure is silently swallowed; the push acts as the real safety net. Acceptable because concurrency group serializes runs. Pre-existing pattern from `optimize-crew.yml`.
8. **`if: always()` on commit step (LOW)** — runs even on rebuild failure. Common failure mode leaves the file untouched; `git status` guard handles it correctly. Partial-write edge case is extremely rare on GHA runners. Pre-existing from sibling.

**Pinning test structure:**
- 17 tests in one `describe` block — organized by concern: trigger shape → path list → no-cron → concurrency (+ 2 `notStrictEqual` distinctness) → permissions → npm command → commit message → staging target → rebase pattern → uses existence → dynamic SHA regex loop → 2 explicit SHA equality checks.
- YAML-parsed (not substring): `parse as parseYaml` + typed tree walk. Comments can't accidentally satisfy assertions.
- Dynamic `for (const step of usesSteps)` loop auto-generates SHA regex tests; explicit SHA equality tests catch exact version drift. Dependabot bump → intentional test break. Rule 3 semantics correct.

**LOW findings (both pre-existing inherited patterns, not blocking):**
- `|| true` on `git pull --rebase` — push failure is the real guard; acceptable for serialized single-artifact workflows.
- `if: always()` on commit step — `git status --porcelain` guards the no-op path; partial-write risk negligible.

## Learnings — workflow YAML + pinning test review (NEW)

- **Stacked PR sanity check**: run `git diff <base-branch>...HEAD --name-only` to confirm only the PR author's files are in the diff. Never trust the PR files count alone — verify the base branch is correct too.
- **Concurrency uniqueness check**: always `grep -A2 'concurrency:' .github/workflows/*.yml` and compare group names. Collision risk is not just aesthetic — it means two unrelated workflows serialize on the same lock, causing unexpected delays. Unique group per _write target_ is the invariant (same write target = shared lock is intentional).
- **`|| true` + `set -euo pipefail` pattern**: the `|| true` is only safe when the following step provides a compensating failure signal (here: `git push` rejection). Flag it LOW in review but don't block if the compensation signal is present.
- **`if: always()` on commit-back steps**: the guard is `git status --porcelain`. Safe if the build step never produces a partial/corrupt output on failure (atomic write pattern). Flag if a build step could leave partial output — then the pattern needs a `if: success()` instead.
- **Pinning test count calibration**: 17 tests for a single-job workflow with 2 `uses:` steps is appropriate. Rule of thumb: at least 1 test per pinnable value (SHA, cron, concurrency group, permissions, key command, commit message). Dynamic loops add tests proportional to the number of `uses:` steps — they grow the suite automatically as actions are added.
- **Forward-looking concurrency comments** (e.g., "distinct from stfc-knowledge-monitor" where that workflow doesn't exist yet) are fine as documentation intent, not a correctness issue. The enforcement is the actual group string value, not the comment.

## 2026-06-01 — Multi-PR technical review + triage: PRs #129, #130, #132; Issue #92

**PR #129 (crew[v2] read-only handlers):** Engine reuse verified (no logic duplicated across 8 verbs); type safety enforced (HandlerDeps shape, no any); pure functions confirmed (no disk writes except via injected load* helpers); output length cap verified; dispatcher switch exhaustive with TS never check. ✅ APPROVE (no rework). Wrote `.squad/skills/embedding-pipeline-review/SKILL.md` post-PR.

**PR #130 (crew[v2] knowledge embedding + handler):** Embedder interface sound (pluggable default=hashed-bow-v1); MiniLM plumbing complete but opt-in (STFC_KNOWLEDGE_MODEL env gated, dead-code in default); staleness evaluation correct; deterministic output. ✅ APPROVE (no rework).

**PR #132 (knowledge-rebuild workflow + Rule 3 pinning tests):** O'Brien's pin test suite verified. ✅ APPROVE (no rework).

**Issue #92 triage:** 8-handler inventory, parallel-safe Scotty/Uhura split, test-coverage strategy, reviewer-lane matrix, internal phase-boundary commits per Rule 5. Triage memo exported to decisions inbox for Batch 2 #93 dispatch prep.

**Smooth cycle:** Three PRs merged 05:43–05:46Z with zero technical rework.

