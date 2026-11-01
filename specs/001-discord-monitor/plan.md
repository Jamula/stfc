# Implementation Plan: Discord Community Monitor for Codes & Tips

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-discord-monitor/spec.md`

## Summary

Add a scheduled, read-only Discord ingestion pipeline to the existing
`stfc-gift-redeemer` CLI. The new `discord-monitor` skill runs every 4 hours
(`cron: "15 */4 * * *"`) — an independent cadence from the redeemer's hourly
schedule (`cron: "0 * * * *"`), sharing only the `stfc-gift-redeemer`
concurrency group. It (a) reads new messages from
operator-curated Discord channels via a dedicated bot token, (b) extracts
candidate STFC promo codes with a precision-first regex, (c) classifies
the rest of the messages locally (no remote LLM) into tip/trick/hack
categories using a small ONNX zero-shot model, (d) hands new candidate
codes to the existing `redeem-codes` skill via a single in-process seam,
(e) auto-commits up to 10 successfully-redeemed codes per run to
`promo-codes.txt` on `main`, and (f) writes a single idempotent daily
digest at `data/digests/YYYY-MM-DD.md`. All Discord credential handling
follows Principle V; one new secret (`DISCORD_BOT_TOKEN`) and a set of
new committed durable inputs trigger a proposed constitution v1.3.0
amendment (see § Constitution Impact).

## Technical Context

**Language/Version**: TypeScript 5.7 on Node ≥ 24, executed via `tsx`
(matches `package.json` `engines.node` and existing skill convention).

**Primary Dependencies**:
- `@discordjs/rest` ^2.5.0 + `discord-api-types` ^0.38.x — Discord REST
  client (no Gateway). License: Apache-2.0. See [research § R1](./research.md#r1-discord-client-library-nodetypescript).
- `@xenova/transformers` ^2.17.x — local ONNX inference for the
  classifier, using `Xenova/nli-deberta-v3-xsmall` (~71 MB, MIT). See
  [research § R2](./research.md#r2-local-classifier-model).
- `onnxruntime-node` (transitive, brought in by `@xenova/transformers`).
- Existing: `zod` ^3.25, `tsx` ^4.19 — reused, no version bump.

**Storage**: Committed JSON / JSONL / Markdown files in the repo. No DB,
no external cache, no Actions cache for state (Actions cache is used
ONLY for the classifier model weights). See
[research § R6](./research.md#r6--state--config-files-introduced) for the
full file map.

**Testing**: Node built-in test runner via
`node --import tsx --test tests/index.test.ts` (matches existing
`npm test` script). New tests under `tests/discord/**` and
`tests/skills/discordMonitor.test.ts`. Live Discord access NOT required
for any unit/integration test — REST client is stubbed via fixtures
under `tests/fixtures/discord/`.

**Target Platform**: GitHub Actions `ubuntu-latest` runner (Node 24).
Identical platform to the existing `redeem.yml` workflow.

**Project Type**: cli (single TypeScript Node project; new code lives in
`src/discord/` + `src/skills/discordMonitor.ts`, both inside the
existing `tsconfig.json` include set).

**Performance Goals**:
- Per-run wall-clock budget: ≤ 5 min (matches `redeem.yml` `timeout-minutes`).
- Classifier throughput: ≥ 50 msg / second on a runner CPU after the
  heuristic pre-filter (which discards ≥ 70 % of volume).
- Discord ingestion: ≤ 50 REST requests / run (5 pages × ≤ 10 channels).

**Constraints**:
- No remote LLM, no third-party text-classification API (FR-016/017).
- No Discord write actions of any kind (FR-002 scopes are read-only).
- Discord token must traverse `src/lib/redact.ts` on every error path
  that could surface it (FR-029, Principle I).
- Auto-committed codes per run: hard cap **10** (R5).
- Failed-code re-suppression cool-down: **30 days** (FR-009 default
  confirmed).

**Scale/Scope**:
- v1 expects ≤ 10 channels in the allow-list (operator-curated).
- ≤ 5,000 messages scanned per run (channel-cap × page-cap × channel-count).
- Digest size: ≤ 50 KB per day (one file).
- New committed-state file growth: ~1 MB / year (candidates.jsonl is the
  dominant grower).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | User Safety & Trust First (NON-NEGOTIABLE) | **PASS** | Read-only Discord (FR-002 scopes are `READ_MESSAGE_HISTORY`+`VIEW_CHANNEL`). New `DISCORD_BOT_TOKEN` lives only in `.env` + GH secrets and traverses `src/lib/redact.ts` on error paths (FR-029). No new STFC-API surface (Principle II's seam routes through the existing `redeem-codes` skill). Auto-commit operates on a repo file, not on the player's STFC account. |
| II | Skill-Isolated CLI Architecture | **PASS** | New `discord-monitor` skill registered in `src/cli.ts`, exposed as `npm run skill:discord-monitor`, returns `{ result, exitCode }`, never calls `process.exit` from `src/`. Discord-specific logic lives in `src/discord/` (a sibling to `src/api/`); shared additions to `src/lib/promoCodes.ts` are additive (optional `extraCandidates` arg). |
| III | Resilient Upstream-API Automation | **PASS** | Discord client wraps `@discordjs/rest` and applies the same posture as `src/api/client.ts`: typed errors (`DiscordAuthError`, `DiscordRateLimitError`, `DiscordTransientError`, `DiscordApiError`, `SchemaMismatchError`), zod-validated responses, `AbortSignal` timeout, GET-only retry. STFC-API surface is unchanged. |
| IV | Type-Safe Headless TypeScript CLI | **PASS** | New code is `.ts` under `src/`, inside the existing `tsconfig.json` include glob; `npm run typecheck` runs against it. No UI framework, no React, no extension build. Native `onnxruntime-node` is a runtime dep only (Node addon, not a TS-build artifact). |
| V | Stateless Operation & Secret Custody | **CONDITIONAL PASS — amendment proposed** | Re-runs are safe (idempotent digest, append-only candidates with status updates, monotonic cursors). However: this feature adds a new third-party credential (`DISCORD_BOT_TOKEN`) AND seven new committed durable-input files (R6 table) AND new outbound network destinations (`discord.com`, `huggingface.co`). The literal text of v1.2.0 § V does not currently cover these. **Recommendation: open a constitution v1.3.0 amendment (see § Constitution Impact below).** Until the amendment lands, this plan documents the new secret and durable inputs explicitly so reviewers can evaluate them. |
| VI | Specification-First Governance | **PASS** | Speckit triggers cleanly met: new feature, multi-file, cross-skill, new external integration, new secret, new CI workflow. Spec → clarify → plan path followed. |
| VII | Artifact Hygiene | **PASS** | All artifacts in this PR are placeholder-only (no real Discord IDs, no real codes from monitored channels, no JWTs). Plan extends `scripts/check-artifact-hygiene.mjs` path list to include `data/digests/**/*.md` so the digest is scanned on every PR (including auto-commit PRs). |
| VIII | Wire-First Discovery | **PASS (with TODO in /tasks)** | `contracts/discord-bot.contract.md` cites the upstream Discord docs; captured request/response fixtures under `tests/fixtures/discord/` are scheduled in `/speckit.tasks` BEFORE the client implementation task per Principle IX ordering. |
| IX | Test-First Discipline (NON-NEGOTIABLE) | **PASS** | Every acceptance criterion in `spec.md` § "User Scenarios" maps to a test in the `/speckit.tasks` plan (extractor unit tests, classifier unit tests, dedup tests, digest idempotency test, end-to-end integration test with stubbed Discord REST). `npm test` will be required green pre-merge. |
| — | Artifact Hygiene CI gate | **PASS** | `.github/workflows/artifact-hygiene.yml` covers `specs/`, `docs/`, and `.github/` Markdown artifacts. |

**Re-evaluation after Phase 1 design:** All five contract documents and
the data model honor the same posture; no principle moved from PASS to
FAIL during Phase 1. The conditional-pass on Principle V is unchanged —
the amendment is the single open governance item, tracked in
§ Constitution Impact and surfaced as an explicit reviewer-gate item.

## Architecture Overview

```text
   ┌──────────────────────────── GitHub Actions runner ───────────────────────────┐
   │                                                                              │
   │   .github/workflows/discord-monitor.yml  (cron: 15 */4 * * *)                │
   │     ├─ npm ci                                                                │
   │     ├─ actions/cache  ← ~/.cache/huggingface (model weights, ~71 MB)         │
   │     ├─ npm run skill:discord-monitor                                         │
   │     │     │                                                                  │
   │     │     ▼                                                                  │
   │     │   src/cli.ts → src/skills/discordMonitor.ts                            │
   │     │     │                                                                  │
   │     │     ├──► src/discord/ingest.ts                                         │
   │     │     │      └─ @discordjs/rest ──► discord.com/api/v10                  │
   │     │     │                                                                  │
   │     │     ├──► src/discord/extractor.ts  (regex + stoplist + context bonus)  │
   │     │     │                                                                  │
   │     │     ├──► src/discord/classifier.ts                                     │
   │     │     │      ├─ tier 1: heuristic (in-repo)                              │
   │     │     │      └─ tier 2: @xenova/transformers + DeBERTa-v3-xsmall (ONNX)  │
   │     │     │                                                                  │
   │     │     ├──► src/discord/dedup.ts  (vs promo-codes.txt + candidates.jsonl  │
   │     │     │                            + suppression.json + cooldowns.json)  │
   │     │     │                                                                  │
   │     │     ├──► src/skills/redeemCodes.ts({ extraCandidates })                │
   │     │     │      └─ src/api/client.ts ──► STFC store API  (UNCHANGED)        │
   │     │     │                                                                  │
   │     │     ├──► src/digest/index.ts  (writes data/digests/YYYY-MM-DD.md)      │
   │     │     │                                                                  │
   │     │     └──► persists cursors.json, candidates.jsonl, tips-seen.jsonl,     │
   │     │         cooldowns.json                                                 │
   │     │                                                                        │
   │     └─ git add data/ promo-codes.txt && git commit && git push               │
   │           (workflow-attributed; same concurrency group as redeem.yml)        │
   │                                                                              │
   └──────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

### Documentation (this feature)

```text
specs/001-discord-monitor/
├── plan.md              # this file
├── spec.md              # already present (clarified)
├── research.md          # Phase 0 — choices + justifications
├── data-model.md        # Phase 1 — entity shapes
├── quickstart.md        # Phase 1 — operator onboarding
├── checklists/
│   └── requirements.md  # already present
└── contracts/
    ├── discord-bot.contract.md
    ├── classifier.contract.md
    ├── redeemer-integration.contract.md
    ├── digest-writer.contract.md
    └── state-files.contract.md
```

### Source code (repository root) — new and modified

```text
config/
├── discord-allowlist.json           NEW (initial: { "version": 1, "entries": [] })
└── classifier-model.json            NEW (pinned model id + revision + sha256)

data/
├── digests/                          NEW (directory; daily files at YYYY-MM-DD.md)
│   └── .gitkeep                     NEW
└── discord/                          NEW
    ├── cursors.json                 NEW (created on first run)
    ├── candidates.jsonl             NEW (append-only)
    ├── tips-seen.jsonl              NEW (append-only)
    ├── suppression.json             NEW (operator-curated rules)
    ├── cooldowns.json               NEW (skill-written cool-down telemetry)
    └── .gitkeep                     NEW

src/
├── cli.ts                            MODIFIED (register `discord-monitor` skill)
├── api/                              UNCHANGED
├── lib/
│   ├── promoCodes.ts                 MODIFIED (add optional `extraCandidates` arg)
│   └── (others)                      UNCHANGED
├── skills/
│   ├── discordMonitor.ts             NEW
│   ├── redeemCodes.ts                MODIFIED (accept `{ extraCandidates }`, pass through)
│   └── (others)                      UNCHANGED
├── digest/                           NEW (sibling to src/api/, src/discord/)
│   └── index.ts                      NEW (digest writer module)
└── discord/                          NEW (sibling to src/api/)
    ├── ingest.ts                     NEW
    ├── client.ts                     NEW (thin wrapper over @discordjs/rest)
    ├── extractor.ts                  NEW
    ├── stoplist.ts                   NEW
    ├── classifier.ts                 NEW
    ├── moderation.ts                 NEW
    ├── dedup.ts                      NEW
    ├── state.ts                      NEW (load/save cursors, cooldowns, etc.)
    └── schemas.ts                    NEW (zod schemas for all state files)

tests/
├── discord/                          NEW
│   ├── extractor.test.ts             NEW
│   ├── classifier.test.ts            NEW
│   ├── dedup.test.ts                 NEW
│   ├── moderation.test.ts            NEW
│   └── ingest.test.ts                NEW (with stubbed REST client)
├── digest/                           NEW
│   └── digest.test.ts                NEW
├── skills/
│   ├── discordMonitor.test.ts        NEW
│   ├── redeemCodes.test.ts           MODIFIED (extraCandidates path coverage)
│   └── (others)                      UNCHANGED
└── fixtures/discord/                 NEW
    ├── messages-codes.json           NEW (sanitized response fixtures)
    ├── messages-tips.json            NEW
    ├── messages-mixed.json           NEW
    └── rate-limit-429.json           NEW

scripts/
└── check-artifact-hygiene.mjs        MODIFIED (add data/digests/**/*.md to scan paths)

.github/workflows/
└── discord-monitor.yml               NEW (see § GitHub Actions below)

package.json                          MODIFIED (deps + new skill:* script)
.gitignore                            MODIFIED (add ~/.cache entries if needed; data/ stays tracked)
```

**Structure decision:** Single TypeScript CLI project, extended sideways
with a new `src/discord/` module sibling to the existing `src/api/`.
This keeps the redeemer's surface untouched (Principle II isolation) and
gives the Discord-specific code a single, well-bounded namespace that is
easy to audit and to remove if the feature is ever rolled back.

## Sequence (per scheduled run)

1. **Boot.** Load `config/discord-allowlist.json` and
   `config/classifier-model.json`. If the allow-list is empty, skip
   straight to step 7 (digest-only run) and exit 0 (FR-001 graceful empty).
2. **Token check.** `GET /users/@me`. On 401 → log redacted, mark
   `RunHealth.errors.auth_failed`, skip Discord half, continue with the
   redeemer half (FR-012).
3. **Ingest.** For each enabled allow-list entry, page
   `/channels/{id}/messages?after=<cursor>` until empty or 5-page cap.
   Persist new cursor (in-memory; flushed at step 8).
4. **Extract.** Run `extractor.ts` over every ingested message; emit
   `CandidateCode` for matches with confidence ≥ 0.6.
5. **Classify.** Run moderation pre-filter (FR-020). Then tier-1
   heuristic, then tier-2 zero-shot for survivors. Emit `Tip` for
   labels in {tip, trick, hack, event-info, patch-note} with
   confidence ≥ 0.55.
6. **Dedup + redeem.** Filter candidates against `promo-codes.txt`,
   `candidates.jsonl` history, `suppression.json` (operator rules), and
   `cooldowns.json` (FR-009 cool-down entries). Call
   `redeemCodes({ extraCandidates: fresh.map(c => c.value) })` once.
   Update each candidate's `perAccountOutcome` from the result.
   Update `cooldowns.json` for any new failures (skill-written, FR-009).
7. **Auto-commit promo codes.** Take up to 10 newly-`REDEEMED`
   candidates and append them to `promo-codes.txt` (one per line, no
   inline comment). The workflow's post-step does `git add … && git
   commit … && git push`.
8. **State write.** Persist `cursors.json`, append to `candidates.jsonl`
   and `tips-seen.jsonl`, write `cooldowns.json`.
9. **Digest.** Read existing `data/digests/YYYY-MM-DD.md` if present,
   union with this run's contributions, re-render, byte-compare,
   write only if changed (idempotent — see digest-writer contract).
10. **Job summary.** Emit the `RunHealth` block to the GitHub Actions
    Job Summary (FR-027).
11. **Exit.** Return `{ result, exitCode: 0 }` for any mix of expected
    outcomes; `exitCode: 1` only for infrastructure-class failures
    (allow-list malformed, classifier integrity failure, redeemer
    schema-mismatch propagation).

## GitHub Actions workflow changes

**New workflow:** `.github/workflows/discord-monitor.yml`.

Key configuration (full file written in `/speckit.implement`):

```yaml
name: Discord monitor
on:
  schedule:
    - cron: "15 */4 * * *"   # offset 15 min from redeem.yml's "0 * * * *"
  workflow_dispatch: {}
permissions:
  contents: write             # required for auto-commit to main
concurrency:
  group: stfc-gift-redeemer   # SAME group as redeem.yml + refresh-token.yml
  cancel-in-progress: false
jobs:
  monitor:
    runs-on: ubuntu-latest
    timeout-minutes: 10        # +5 over redeem.yml to absorb model load cold start
    steps:
      - uses: actions/checkout@<sha>  # v4 pinned per Security & Compliance
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .nvmrc, cache: npm }
      - uses: actions/cache@<sha>
        with:
          path: ~/.cache/huggingface
          key: hf-${{ hashFiles('config/classifier-model.json') }}
      - run: npm ci
      - run: npm run skill:discord-monitor
        env:
          DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}
          STFC_ACCOUNTS: ${{ secrets.STFC_ACCOUNTS }}
      - name: Commit state + digest + promo-codes (if changed)
        if: always()
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/discord data/digests promo-codes.txt
          git diff --cached --quiet || git commit -m "chore(discord-monitor): run ${{ github.run_id }}"
          git pull --rebase origin "$GITHUB_REF_NAME" || true
          git push
```

**Why a separate workflow** (and not folded into `redeem.yml`):
- Different timeout budget (model load cold start).
- Different secret needs (`DISCORD_BOT_TOKEN` is a Discord-monitor-only
  secret; keeping it out of `redeem.yml` reduces blast radius).
- Different cron offset (the 15-min stagger lets a redeem run finish before
  the monitor run starts under the shared concurrency group, so monitor
  runs see the freshest `promo-codes.txt`).
- Easier to disable independently if Discord access breaks.

**Why the same `concurrency.group` as `redeem.yml`** — this is the
critical safety bit:
- Both workflows write to the repo (`promo-codes.txt`, `data/`,
  `docs/redeem-history.md`). Without a shared group, two `git push`
  calls can collide and one will be rejected. The shared group
  serializes them.
- Honors documented Known Tension #3 (constitution v1.2.0:
  redeem/refresh concurrency lock un-principled).

## Secrets

| Name                   | Purpose                                      | Custodian / Writer       | New in this feature? |
|------------------------|----------------------------------------------|--------------------------|----------------------|
| `STFC_ACCOUNTS`        | STFC store JWTs (existing)                   | `capture-token.mjs` + `Refresh token` workflow (sanctioned per § V) | no |
| `STFC_EMAIL`           | Scopely login (existing, refresh pipeline)   | human (`gh secret set`)  | no |
| `STFC_PASSWORD`        | Scopely password (existing)                  | human (`gh secret set`)  | no |
| `STFC_REFRESH_PAT`     | GitHub PAT for `STFC_ACCOUNTS` writes (existing) | human (`gh secret set`) | no |
| `DISCORD_BOT_TOKEN`    | Discord REST auth                            | human (`gh secret set`); rotated by re-running secret set | **YES — NEW** |

`DISCORD_BOT_TOKEN` MUST NOT pass through `scripts/capture-token.mjs`,
MUST NOT be merged into `STFC_ACCOUNTS`, and MUST NOT be readable by
`redeem.yml` (it is only listed in `discord-monitor.yml`'s `env:` block).

## Per-run cap for auto-committed codes

**Cap: 10 codes per run.** Justified in [research § R5](./research.md#r5-auto-commit-safety):
~4× a generous spike estimate over the historical organic add-rate of
~3.5 codes/month; provides a finite blast radius from a runaway monitored
channel; gives the operator a chance to notice via the digest before a
flood lands.

Codes that would exceed the cap are recorded in `candidates.jsonl` with
status `deferred-cap` and re-considered on the next run.

## Cool-down window for FR-009

**Window: 30 days from `firstFailedAt`.** The default proposed in
spec § "Q-deferred" is **kept**: it is long enough to let a code's
issuance window definitely close (real STFC promos rarely have
windows > 2 weeks) and short enough that an honest re-circulation 60+
days later (e.g., the publisher re-uses a code for a new event) is
still picked up. Pruning of suppression entries beyond
`suppressedUntil + 7d` keeps the file bounded.

## Test strategy

| Layer | Files | What it asserts |
|-------|-------|-----------------|
| Unit — extractor | `tests/discord/extractor.test.ts` | Every code in `promo-codes.txt` is matched except the 3 short-code gap (TNG, GQ5, GQ7); documented stop-list rejects every entry; the "format is `XXXXX-YYYYY`" example is NOT extracted; spoiler-tag / zero-width / Markdown decoration are stripped. |
| Unit — classifier (heuristic only, model stubbed) | `tests/discord/classifier.test.ts` | Tier-1 chatter discard works; moderation filter excludes flagged content; `classify()` makes zero outbound `fetch` calls (privacy invariant). |
| Unit — dedup | `tests/discord/dedup.test.ts` | Filters against `promo-codes.txt`, prior `candidates.jsonl`, operator `suppression.json` rules, and `cooldowns.json` cool-down entries; `suppressed-cooldown` status transitions correctly. |
| Unit — moderation | `tests/discord/moderation.test.ts` | Personal attack / NSFW / doxxing patterns excluded (FR-020). |
| Unit — digest | `tests/digest/digest.test.ts` | Idempotent re-run produces byte-identical file; truncates excerpts > 600 chars; never emits forbidden tokens (Principle VII). |
| Unit — ingest (REST client stubbed) | `tests/discord/ingest.test.ts` | 401 path doesn't block redeemer (FR-012); 429 honors `Retry-After`; cursor advances monotonically; per-channel cap enforced. |
| Integration — skill | `tests/skills/discordMonitor.test.ts` | Full run on fixture data: empty allow-list = no-op; mixed-channel fixture produces correct digest + cursor + auto-commit list; per-run cap truncates correctly. |
| Regression | `tests/skills/redeemCodes.test.ts` | `extraCandidates` path is exercised; existing no-arg behavior unchanged (no regressions in current 5 skills). |

The acceptance-scenario coverage map (spec § User Stories) is enumerated in
`/speckit.tasks` for review.

## Constitution Impact (v1.3.0 amendment recommendation)

**Verdict: amendment NEEDED — recommend opening v1.3.0 PR before
`/speckit.implement` (or in lockstep with the first implementation PR).**

Required edits to `.specify/memory/constitution.md`:

1. **§ V "Stateless Operation & Secret Custody"** — broaden the
   definition of "secret" to include third-party API credentials the
   orchestrator carries:

   > A "secret" here means a Scopely password, an STFC store JWT, the
   > GitHub PAT used to write secrets, **or any third-party API
   > credential the orchestrator or its sibling skills carry (e.g.,
   > `DISCORD_BOT_TOKEN`)**.

2. **§ V durable-inputs enumeration** — append:

   > The `discord-monitor` skill (`src/skills/discordMonitor.ts` +
   > `src/discord/**` + `src/digest/`) additionally consumes
   > `config/discord-allowlist.json` and
   > `config/classifier-model.json`, and reads/writes the
   > workflow-committed runtime files
   > `data/discord/cursors.json`, `data/discord/candidates.jsonl`,
   > `data/discord/tips-seen.jsonl`,
   > `data/discord/cooldowns.json`, and the artifact tree
   > `data/digests/YYYY-MM-DD.md`. Operator-curated
   > `data/discord/suppression.json` is read by the skill but ONLY
   > written by human operators via reviewed PRs. The digest module
   > lives at `src/digest/` (not under `src/discord/`). These are the
   > only additional durable inputs/outputs introduced by v1.3.0.

   **Rationale for suppression/cooldowns split:** Constitution Principle V
   reserves `data/discord/suppression.json` as an operator-curated file
   (writer: human operator). FR-009's 30-day cool-down telemetry is
   auto-written by feature code and therefore belongs in a separate file
   (`data/discord/cooldowns.json`) to preserve the bright-line separation
   between policy (operator) and telemetry (skill).

3. **§ V Token Capture Custody** — append a single sentence:

   > `DISCORD_BOT_TOKEN` MUST NOT be merged into `STFC_ACCOUNTS`, MUST
   > NOT be handled by `scripts/capture-token.mjs`, and is provisioned
   > only via direct `gh secret set DISCORD_BOT_TOKEN` by the operator.

4. **§ Security & Compliance Constraints — outbound network scope** —
   append:

   > The `discord-monitor` skill additionally calls
   > `https://discord.com/api/v10/...` (REST only, read-only scopes)
   > and, on classifier-cache miss, `https://huggingface.co/...` (model
   > weights download, integrity-checked against the SHA-256 pinned in
   > `config/classifier-model.json`). Both destinations are
   > sanctioned for the `discord-monitor` skill only.

5. **§ Security & Compliance Constraints — third-party action pinning**
   — note that `discord-monitor.yml` is added to the SHA-pinning roster
   alongside `redeem.yml`, `refresh-token.yml`, `test.yml`, and
   `test-gate.yml`.

6. **Sync Impact Report** — bump 1.2.0 → 1.3.0, MINOR (new sanctioned
   surfaces, no removed obligations), credit reason "Discord monitor
   feature 001-discord-monitor", list templates affected (none — table
   structure unchanged).

The amendment PR is a standalone change. It should land **before** the
first PR that adds `DISCORD_BOT_TOKEN` handling code, OR be bundled with
that first PR with explicit reviewer sign-off on the bundling
choice. `/speckit.tasks` will track this as a P0 task.

## Review plan

Review the acceptance criteria and task coverage, verify implementation and
dependency claims against the repository, and check that tests pass and
committed artifacts contain no credentials.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Bot token leaks into a digest | FR-029 redaction on every error path; `data/digests/**/*.md` added to `check-artifact-hygiene.mjs` scan paths; digest writer's forbidden-content list (digest-writer contract). |
| Auto-commit floods `promo-codes.txt` from a hostile channel | Per-run cap of 10; suppression cool-down; allow-list is human-curated PR-only; per-account outcome filter (only `REDEEMED` codes are appended). |
| Classifier model goes stale or is removed from HuggingFace | SHA-256 pin in `config/classifier-model.json` + Actions cache; on cache miss with model gone, run fails loudly (not silently degrades). Fallback to heuristic-only is a planned v1.1 toggle but not v1. |
| Discord schema drift | zod validation per Principle III; `SchemaMismatchError` fails the monitor half but not the redeemer (FR-012). |
| Concurrency collision with `redeem.yml`'s git push | Shared `concurrency.group: stfc-gift-redeemer` serializes both. |
| Branch protection blocks `GITHUB_TOKEN` push to `main` | Documented operational dependency in quickstart § 8. If protection is enabled later, this plan must be revisited (PR-gated mode). |
| Privacy: author display names appear in cursors / state | Explicit data-model rule: only message IDs and channel IDs persisted; no author IDs, no usernames in any persisted file. |
| Discord ToS — "Message Content Intent" approval | For < 100 servers a bot can self-enable Message Content Intent without Discord review. v1 stays under that threshold (operator-curated allow-list). Documented in quickstart § 1. |

## Acknowledged assumptions

The following assumptions underpin this plan. Each was identified during
review and accepted as a plan-stage risk. Revisit each during implementation.

1. **Operator will configure the allow-list before the first meaningful run.** If they don't, the skill no-ops the Discord half indefinitely. The digest will say "0 channels configured" every run — but will anyone notice? There is no alerting surface in v1. The feature could ship, merge, run for months, and never actually monitor anything.
   — **Failure mode:** Silent feature deadweight.

2. **Concurrency group serializes `git push`, not just the workflow job.** This is true today — `cancel-in-progress: false` queues the second run. But if a future maintainer changes it to `true` (or adds a third workflow to the group), the pushed-but-not-pulled state files will silently regress cursors and duplicate candidates.
   — **Failure mode:** Cursor regression → duplicate ingestion → duplicate codes submitted to STFC API (idempotent, but noisy).

3. **GitHub-hosted runner has enough RAM and CPU budget for ONNX inference.** The plan estimates ~140 MB peak RAM and ~150 ms/inference. `ubuntu-latest` runners have 7 GB RAM — fine. But `timeout-minutes: 10` is the hard wall. If the model download takes 25 s (plan's claim) and inference is 150 ms × 5,000 messages = 750 s = 12.5 min, the run will timeout. The heuristic pre-filter ("≥ 70% discard") is load-bearing: if the filter passes more traffic than expected (new channel with different content profile), the run will silently fail on timeout.
   — **Failure mode:** Timeout → no digest, no codes, no state update.

4. **`promo-codes.txt` append is the only auto-commit path.** The workflow also commits `data/discord/*` and `data/digests/*`. If any of those files grows unexpectedly (e.g., `candidates.jsonl` under a flood), the commit size could trigger GitHub's push size limits or slow the checkout step for `redeem.yml`. The plan's "~1 MB/year" estimate for `candidates.jsonl` assumes ≤ 10 channels and low candidate volume; a misconfigured allow-list could change that.
   — **Failure mode:** Gradual repo bloat → slow CI for all workflows.

5. **`process.exit` is only in `src/cli.ts`.** The plan states the new skill MUST NOT call `process.exit`. This is true of the current code. But `@xenova/transformers` or `onnxruntime-node` could call `process.exit` on a fatal native error (segfault in the ONNX runtime). This would kill the entire workflow step with no cleanup.
   — **Failure mode:** State files not flushed → cursor not advanced → next run re-ingests same messages.

## Out of scope (v1)

- Posting any Discord message, reaction, DM, or webhook (per spec).
- OCR / image extraction of codes from screenshots.
- Translation of non-English tips.
- LLM-generated *summarization* of tips (FR-019: verbatim only).
- A backfill mode for cold-start cursors (manual override planned, not v1 cron).
- Signed git commits from the workflow (would require new bot GPG key).
- Compaction of `candidates.jsonl` and `tips-seen.jsonl`.
- A second-tier embedding-based dedup for tips (sticking with exact-hash
  in v1; FR-018's "near-duplicates MAY be collapsed" is deferred).
- Alerting on monitor health regressions (digest is the only surface in v1).
- Multi-tenant / multi-operator digest distribution.

## Complexity Tracking

> Filled ONLY for Constitution Check rows that are not PASS.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Principle V — adds a new third-party credential (`DISCORD_BOT_TOKEN`) and 7 new committed durable inputs not enumerated in the v1.2.0 list | The feature CANNOT exist without a Discord credential and a way to remember what it has already seen. The literal v1.2.0 enumeration was written before this feature was contemplated. | (a) No persistence at all — rejected because cold-start re-ingestion of every monitored channel from epoch is impractical and gives Discord a reason to rate-limit us. (b) Use Actions cache for state — rejected because eviction is silent and would cause cyclic re-ingestion. (c) Fold under the existing `STFC_ACCOUNTS` umbrella — rejected because mixing a Discord token into the STFC credential blob expands blast radius and conflates two unrelated trust domains. The constitution v1.3.0 amendment is the right venue to widen the rule, not a private exception. |

## CHANGEREQUESTS surfaced during planning

**None.** All 6 clarifications resolved by `/speckit.clarify` are honored
without revision. The 30-day cool-down default (the deferred Q) is
confirmed in this plan; no spec edit needed. The new ambiguity that
*could* surface — "should we run the monitor inline in `redeem.yml` or as
a separate workflow?" — was answered in this plan (separate workflow,
shared concurrency group) without changing any spec text.
