---
description: "Task list for 001-discord-monitor feature implementation"
---

# Tasks: Discord Community Monitor for Codes & Tips

**Input**: Design documents from `/specs/001-discord-monitor/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

> **Regeneration note (2026-05-16)** — This file was regenerated against the
> post-BLOCKER-fix artifacts described in
> `specs/001-discord-monitor/analysis-report.md` § Resolution Note (2026-05-16).
> Two BLOCKERs from the prior `/speckit.analyze` were resolved upstream:
>
> 1. **Suppression split** — `data/discord/suppression.json` is now operator-only
>    (deny/allow rules, human-curated PR). A new `data/discord/cooldowns.json`
>    holds skill-written FR-009 cool-down telemetry. Constitution v1.3.0
>    enumeration was refined to list both files (no version bump).
> 2. **Digest writer location** — moved from `src/discord/digest.ts` to
>    `src/digest/index.ts` (matches Constitution Principle V wording verbatim).
>
> The Phase 0 governance gate (T000–T002) is preserved verbatim from the prior
> run and remains a hard blocker for Phase 1+ merging to `main`. T000 P0-1's
> 7-path enumeration matches the constitution's post-refinement durable-inputs
> list (`config/discord-allowlist.json`, `config/classifier-model.json`,
> `data/discord/cursors.json`, `data/discord/candidates.jsonl`,
> `data/discord/tips-seen.jsonl`, `data/discord/suppression.json`,
> `data/discord/cooldowns.json`) — exactly 7, with the `data/digests/**`
> artifact tree enumerated separately per `.specify/memory/constitution.md:33–42`.

**Tests**: Per Constitution Principle IX (Test-First Discipline, NON-NEGOTIABLE),
every user story whose spec defines acceptance criteria MUST include at least
one test task that exercises those criteria, and the test task MUST be ordered
BEFORE its corresponding implementation tasks (test-first). Tests are NOT
optional.

**Organization**: Tasks are grouped by phase and user story. Phase 0 is a
governance gate that BLOCKS all implementation. Phases 3–5 map to user stories
US1–US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies within same phase)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Source: `src/discord/`, `src/digest/`, `src/skills/`, `src/lib/`, `src/cli.ts`
- Tests: `tests/discord/`, `tests/digest/`, `tests/skills/`, `tests/fixtures/discord/`
- Config: `config/discord-allowlist.json`, `config/classifier-model.json`
- State: `data/discord/`, `data/digests/`
- Workflow: `.github/workflows/discord-monitor.yml`
- Constitution: `.specify/memory/constitution.md`
- Templates: `.specify/templates/plan-template.md`

---

## Phase 0: Pre-Implementation Governance (Standalone Amendment PR)

**Purpose**: Land the constitution v1.3.0 amendment as a STANDALONE PR before
any implementation code that references or handles `DISCORD_BOT_TOKEN`. Per
the review conditions, this amendment must be reviewable and revertable
independently of implementation code (Principle VI).

**⚠️ BLOCKER**: No Phase 1+ task may merge to `main` until T000 acceptance
criteria are satisfied and the amendment PR has landed.

### Governance check for Phase 0

- [X] T000 Verify the v1.3.0 amendment PR satisfies all three P0 findings before
  merging. Acceptance criteria (checklist — all three must be ✅ before merge):
  - **[P0-1]** `.specify/templates/plan-template.md` Principle V guidance text is
    updated: the stale line stating "durable inputs limited to STFC_ACCOUNTS /
    promo-codes.txt (+ refresh-pipeline secrets)" is corrected to reflect the
    7 new durable inputs introduced by v1.3.0
    (`config/discord-allowlist.json`, `config/classifier-model.json`,
    `data/discord/cursors.json`, `data/discord/candidates.jsonl`,
    `data/discord/tips-seen.jsonl`, `data/discord/suppression.json`,
    `data/discord/cooldowns.json`) plus the `data/digests/**` artifact tree
    enumerated separately — exactly 7 file paths, matching
    `.specify/memory/constitution.md:33–42`.
  - **[P0-2]** The v1.3.0 Sync Impact Report block in
    `.specify/memory/constitution.md` contains a per-principle change summary
    field enumerating REVISED / KEPT / EXTENDED status for every section
    (Principles I–IX, Security & Compliance Constraints, Development Workflow,
    Governance, Speckit Reviewer Gates) — matching the shape of the v1.2.0
    report at `.specify/memory/constitution.md:1–119`.
  - **[P0-3]** The v1.3.0 Sync Impact Report states explicit disposition for
    all three Known Tensions previously committed to v1.3.0 resolution
    (Principle III auth/me overclaim, Principle VII `.github/` scan-path
    overclaim, redeem/refresh concurrency lock un-principled). Each tension
    MUST either be fully resolved in this amendment or explicitly re-targeted
    to v1.4.0 with written rationale; no tension may remain silently
    unaddressed.

### Implementation for Phase 0

- [X] T001 Draft v1.3.0 amendment to `.specify/memory/constitution.md` applying
  all six edits enumerated in `plan.md` § Constitution Impact:
  (1) broaden § V "secret" definition to include third-party API credentials;
  (2) append the 7-path durable-input enumeration listed in T000 P0-1, with
  `data/discord/suppression.json` flagged as operator-only and
  `data/discord/cooldowns.json` flagged as skill-written;
  (3) append Token Capture Custody sentence: `DISCORD_BOT_TOKEN` MUST NOT be
  merged into `STFC_ACCOUNTS`, MUST NOT be handled by
  `scripts/capture-token.mjs`, and is provisioned only via direct
  `gh secret set DISCORD_BOT_TOKEN`;
  (4) append outbound network scope for `discord.com/api/v10/...` (read-only)
  and `huggingface.co/...` (model weights, integrity-checked) under Security
  & Compliance Constraints;
  (5) add `discord-monitor.yml` to the SHA-pinning roster in Security &
  Compliance Constraints alongside `redeem.yml`, `refresh-token.yml`,
  `test.yml`, `test-gate.yml`;
  (6) write the full v1.3.0 Sync Impact Report satisfying P0-1, P0-2, P0-3
  above, including the 2026-05-16 refinement note splitting suppression into
  operator-rules + skill-cooldowns.
  Also update `.specify/templates/plan-template.md` for P0-1. Bump version
  string in constitution: `1.2.0 → 1.3.0, MINOR`.

- [X] T002 Open standalone PR for the v1.3.0 amendment
  (`.specify/memory/constitution.md` + `.specify/templates/plan-template.md`).
  Complete review before merging to `main`. This PR contains NO implementation
  source files.

**Checkpoint**: Constitution v1.3.0 landed on `main`. Implementation phases
may begin.

---

## Phase 1: Setup & Scaffolding

**Purpose**: Scaffold all new directories, empty config files, placeholder
files, and `package.json` changes. No runtime logic yet. Run `npm test` —
new test stubs must fail.

- [X] T003 [P] Create directory tree and committed placeholder files:
  `config/discord-allowlist.json` (initial value:
  `{ "version": 1, "entries": [] }`), `config/classifier-model.json` (stub
  object with fields `id`, `revision`, `weightSha256`, `task`, `labels`,
  `confidenceFloor` — placeholder values), `data/discord/.gitkeep`,
  `data/digests/.gitkeep`. Do NOT create `data/discord/suppression.json` or
  `data/discord/cooldowns.json` here — they are created by the runtime on
  first use (suppression on first operator edit; cooldowns on first failure
  via T022). Verify tree matches `plan.md` § Project Structure exactly.

- [X] T004 [P] Add npm runtime dependencies to `package.json`:
  `@discordjs/rest` ^2.5.0, `discord-api-types` ^0.38.x, `@xenova/transformers`
  ^2.17.x. Add `"skill:discord-monitor": "tsx src/cli.ts discord-monitor"` to
  `scripts`. Run `npm install` to update `package-lock.json`. Verify
  `discord-api-types` actual license via `npm view discord-api-types license`
  (plan claimed Apache-2.0; the review requires verification — MIT is
  also license-compatible per Security & Compliance Constraints).

- [X] T005 [P] Create empty stub source files (export stubs only — no logic):
  `src/discord/client.ts`, `src/discord/ingest.ts`, `src/discord/extractor.ts`,
  `src/discord/stoplist.ts`, `src/discord/classifier.ts`,
  `src/discord/moderation.ts`, `src/discord/dedup.ts`,
  `src/discord/cooldown.ts`, `src/discord/state.ts`,
  `src/discord/schemas.ts`, `src/digest/index.ts`,
  `src/skills/discordMonitor.ts`. (Note: digest writer lives at
  `src/digest/index.ts` per constitution v1.3.0 — NOT under `src/discord/`.)
  Confirm `npm run typecheck` passes with stubs in place.

- [X] T006 [P] Create empty test files with mandatory failing assertions
  (red phase — Principle IX): `tests/discord/extractor.test.ts`,
  `tests/discord/classifier.test.ts`, `tests/discord/dedup.test.ts`,
  `tests/discord/cooldown.test.ts`, `tests/digest/digest.test.ts`,
  `tests/discord/moderation.test.ts`, `tests/discord/ingest.test.ts`,
  `tests/skills/discordMonitor.test.ts`. Each file MUST contain at least one
  `assert.fail("not implemented")` test. Run `npm test` and confirm all new
  test files fail (proves tests are live in the runner before any
  implementation).

- [X] T007 Register `discord-monitor` skill in `src/cli.ts` as a stub entry
  that returns `{ result: "not-implemented", exitCode: 1 }`. Confirm
  `npm run typecheck` passes. (Unblocks workflow YAML task T027 later without
  requiring full implementation.)

**Checkpoint**: Directory tree present, deps installed and locked, stubs
compile, new test stubs run and fail. Foundation is visible before a line of
logic is written.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure MUST be complete before any user story can
be implemented. Includes: Discord REST fixtures (Principle VIII wire-first),
zod schemas, state I/O, secret loader, artifact hygiene extension.

**⚠️ CRITICAL**: No user story implementation may start until this phase is
complete.

- [X] T008 [P] Write Discord REST fixtures in `tests/fixtures/discord/`
  (Principle VIII wire-first, before any client implementation):
  `messages-codes.json` (sanitized 200 OK array with ≥ 3 code-bearing
  messages), `messages-tips.json` (~20 tip/trick/hack messages, varied
  categories), `messages-mixed.json` (~50 messages: codes + tips + chatter +
  memes, matching the spec § "Independent Test" for US1 and US2),
  `rate-limit-429.json` (429 response body with `retry_after` field per
  Discord API). Fixtures MUST be sanitized: no real tokens, no real account
  credentials. Discord snowflake IDs in fixtures are placeholder values; the
  operator-seed pair (guild `509679626763632640` / channel
  `509685530108362773`) is reserved for smoke-test fixtures and MUST NOT be
  committed to production state files. Runtime allow-list MUST default to
  empty per FR-001 / Q3 clarification.

- [X] T009 [P] Implement zod schemas in `src/discord/schemas.ts` for all
  entities in `contracts/state-files.contract.md` and `data-model.md`:
  - `DiscordAllowlist` (version 1 literal, entries array) — entity #7.
  - `IngestionCursorMap` (Record<channelId, cursor>) — entity #6.
  - `CandidateCode` (candidates.jsonl line shape with all 9 status literals)
    — entity #2.
  - `Tip` / tips-seen.jsonl line (contentHash + firstSeenAt + category) —
    entity #4.
  - `OperatorSuppressionMap` (Record<code, { action: "deny"|"allow", reason,
    addedAt, addedBy }>) — entity #8 / `data/discord/suppression.json`.
  - `CooldownMap` (Record<code, { firstFailedAt, lastFailedAt,
    suppressedUntil, failureOutcomes[≤5] }>) — entity #9 /
    `data/discord/cooldowns.json`.
  - `ClassifierModel` (id, revision, weightSha256, task, labels,
    confidenceFloor).
  - `RunHealth` (entity #10) and `IngestedMessage` (entity #1) and
    `RedemptionResult` (entity #3) and `DailyDigest` (entity #5) TS interfaces.
  Include schema tests (inline or `tests/discord/schemas.test.ts`) covering
  happy path and missing-required-field rejection for each schema. Run
  `npm test`.

- [X] T010 [P] Implement `src/discord/state.ts` — load/save for all state
  files:
  - `config/discord-allowlist.json` (read-only; zod-validate on load, fail
    on malformed).
  - `data/discord/cursors.json` (read → `IngestionCursorMap`; write →
    pretty-printed 2-space indent, keys sorted alphabetically — all JSON
    state files follow this convention; missing file → `{}`).
  - `data/discord/candidates.jsonl` (append-only write; read uses
    latest-line-wins per value as tombstone semantics).
  - `data/discord/tips-seen.jsonl` (append-only write).
  - `data/discord/suppression.json` (READ-ONLY from feature code per
    state-files.contract.md cross-file invariant #4; missing file → `{}`
    treated as "no operator rules"; zod-validate on load).
  - `data/discord/cooldowns.json` (read AND write; eviction of entries
    where `suppressedUntil < now - 7d` runs at end of every write per
    state-files.contract.md § cooldowns).
  All writes validated against T009 schemas. Write unit tests covering
  round-trip, missing-file behavior for both suppression and cooldowns, and
  cooldowns eviction.

- [X] T011 Implement `DISCORD_BOT_TOKEN` secret loader in
  `src/discord/client.ts`: read from `process.env.DISCORD_BOT_TOKEN`;
  require non-empty (fail-fast on missing); on any error path the token
  MUST transit `src/lib/redact.ts` (`redactForLog`) before appearing in any
  log output — same pattern as `src/api/client.ts` for STFC credentials
  (FR-029, Principle I). Token MUST NOT appear in any committed file.
  Depends on T009, T010.

- [X] T012 [P] Extend `scripts/check-artifact-hygiene.mjs` to scan
  `data/digests/**/*.md` AND `data/discord/**/*.json{,l}` for forbidden
  tokens: JWT-shaped strings, the literal `DISCORD_BOT_TOKEN`, raw upstream
  API response bodies (per digest-writer contract § Forbidden contents and
  plan § Risks). Verify by injecting a synthetic forbidden token into a
  test Markdown file and confirming the scanner catches it.

**Checkpoint**: Schemas pass, state I/O tested with round-trip coverage
(including suppression read-only + cooldowns eviction), secret loader
redacts on error, hygiene scanner covers digest + state files. User story
phases may now begin.

---

## Phase 3: User Story 1 — Auto-Harvest & Redeem New Promo Codes (Priority: P1) 🎯 MVP

**Goal**: Discord-sourced promo codes are extracted, deduplicated against
`promo-codes.txt`, prior-run history (`candidates.jsonl`), operator
allow/deny rules (`suppression.json`), and FR-009 cool-downs
(`cooldowns.json`); submitted to the existing redeemer via a single
in-process seam; and outcomes are recorded for the daily digest.

**Independent Test**: Replay `tests/fixtures/discord/messages-mixed.json`
through the full pipeline (ingest → extract → dedup → redeem-stub →
cooldown-write → digest). Confirm the correct codes are extracted,
duplicates suppressed, outcomes recorded, and any failures result in
`cooldowns.json` entries with `suppressedUntil = firstFailedAt + 30d`.

### Tests for User Story 1 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US1 Acceptance Scenarios MUST map to a test.**

- [X] T013 [P] [US1] Write extractor unit tests in
  `tests/discord/extractor.test.ts` **before** implementing
  `src/discord/extractor.ts`. Test suite MUST assert:
  - All 30 non-comment entries in `promo-codes.txt` are exercised against
    the extractor. The 27 that match the core regex `^[A-Z][A-Z0-9]{3,19}$`
    are extracted. The 3 known short-code gaps (`TNG`, `GQ5`, `GQ7`) MUST
    be reported as KNOWN GAPS in the test output (labeled, expected
    failures — not regressions; these are accepted precision trade-offs).
  - The example string in "the code format is `XXXXX-YYYYY`" is NOT
    extracted (hyphenated format must be rejected).
  - Spoiler-tag decoration `||CODE||`, zero-width Unicode characters, and
    Markdown bold/italic wrapping are stripped before the regex is applied.
  - Extraction confidence ≥ 0.6 threshold is applied.
  - Stoplist entries from `src/discord/stoplist.ts` are rejected.
  - Messages inside triple-backtick code fences are not extracted
    (documentation pattern edge case from spec § Edge Cases).

- [X] T014 [P] [US1] Write dedup unit tests in `tests/discord/dedup.test.ts`
  **before** implementing `src/discord/dedup.ts`. Test suite MUST assert
  (maps to spec § US1 Acceptance Scenarios 1–3):
  - Code present in `promo-codes.txt` → status `already-known`, NOT queued
    for redemption (Scenario 2).
  - Code present in `candidates.jsonl` from a prior run → status
    `duplicate`.
  - Code present in `data/discord/suppression.json` with `action: "deny"`
    → status `suppressed-operator-deny`; never queued.
  - Code present in `data/discord/suppression.json` with `action: "allow"`
    → cool-down entries in `cooldowns.json` for that code are OVERRIDDEN
    and the code is queued (allow = override a cooldown).
  - Code present in `data/discord/cooldowns.json` with `suppressedUntil >
    now` (and no operator allow) → status `suppressed-cooldown` (Scenario
    3). Default cool-down window: **30 days** from `firstFailedAt` (FR-009
    confirmed in plan).
  - `cooldowns.json` `suppressedUntil` expiry correctly transitions the
    code back to evaluable.
  - Code absent from all four sources → status `pending`, added to fresh
    list (Scenario 1).

- [X] T015 [P] [US1] Write cooldown unit tests in
  `tests/discord/cooldown.test.ts` **before** implementing
  `src/discord/cooldown.ts`. Assert (FR-009 30-day window math + write
  semantics, maps to state-files.contract.md § cooldowns):
  - `recordFailure(code, outcome, now)` on a code not yet in
    `cooldowns.json` writes a new entry where `firstFailedAt === now`,
    `lastFailedAt === now`, `suppressedUntil === now + 30d` (the **30-day
    default per FR-009**, expressed as a constant), and
    `failureOutcomes === [outcome]`.
  - `recordFailure` on an existing code updates `lastFailedAt` and appends
    to `failureOutcomes` (cap last 5), but does NOT reset `firstFailedAt`
    or extend `suppressedUntil` (idempotent re-failure within window).
  - `evictExpired(map, now)` removes entries where `suppressedUntil <
    now - 7d` per state-files.contract.md eviction rule; entries still
    within the 7-day grace window are retained.
  - The module emits writes that satisfy state-files.contract.md
    cross-file invariant #3 (every cooldown `value` must also appear in
    `candidates.jsonl` with a non-success outcome); covered via a
    fixture-driven assertion.
  - Cooldown writes NEVER touch `data/discord/suppression.json` (operator
    file invariant #4) — verify by spying on `state.ts` writers.

- [X] T016 [P] [US1] Write redeemer-seam unit tests in
  `tests/skills/redeemCodes.test.ts` (modify existing file) **before**
  implementing seam changes. Assert:
  - `redeemCodes({ extraCandidates: ["CODE1", "CODE2"] })` merges
    candidates after `promo-codes.txt` codes, deduplicated, and passes the
    unified list to the STFC API client.
  - `redeemCodes()` called with no args continues to work unchanged —
    existing behavior is not regressed.
  - The new `readCodesForRun(opts?)` function in `src/lib/promoCodes.ts`
    wraps the existing seam exports `readPromoCodes(path)` +
    `parsePromoCodes(content)`. These two function names MUST remain
    unchanged. The name `loadPromoCodes` MUST NOT appear (it does not
    exist; verify the import at `src/skills/redeemCodes.ts:9`).

- [X] T017 [P] [US1] Write ingest unit tests in
  `tests/discord/ingest.test.ts` **before** implementing
  `src/discord/ingest.ts`. Use fixture files from T008 as the stubbed REST
  client responses. Assert:
  - 401 response from `GET /users/@me` → `DiscordAuthError` raised;
    redeemer half continues to run on `promo-codes.txt` (FR-012; maps to
    US3 Scenario 2).
  - 429 response with `Retry-After: 5` header →
    `DiscordRateLimitError`; bounded retry ≤ 3× per channel; partial
    completion is recorded in health counters.
  - Per-channel 5-page cap enforced: messages beyond page 5 are deferred
    (cursor not advanced past page 5 boundary).
  - Cursor advances monotonically per channel after each successful page
    fetch.
  - `GET /api/v10/users/@me` is called exactly once per run (token
    validation).
  - 403 / 404 → channel marked errored in `RunHealth`, remaining channels
    continue.

- [X] T018 [US1] Write integration test in
  `tests/skills/discordMonitor.test.ts` **before** implementing
  `src/skills/discordMonitor.ts`. Assert (full-run with fixture data; no
  live Discord or STFC connections):
  - Empty `config/discord-allowlist.json` → skill returns
    `{ exitCode: 0 }`; zero Discord REST calls made; digest produced with
    "0 channels configured" health note (FR-001).
  - Mixed-channel fixture → correct codes extracted; dedup filters prior
    codes + operator denies + cool-downs; `redeemCodes` called exactly
    once with `{ extraCandidates: [...] }`; zero spy calls if
    `fresh.length === 0`; per-account outcomes recorded in candidates.
  - **Per-run auto-commit cap of 10**: `appendToPromoCodesTxt` called with
    at most 10 codes (truncated from the redeemed list), NOT truncating
    the redeem call itself. Cap value MUST be defined as a named
    constant `AUTO_COMMIT_PER_RUN_CAP = 10` in
    `src/skills/discordMonitor.ts` (or shared lib) and asserted by name in
    the test.
  - Failed redemption outcomes trigger `cooldown.ts` writes to
    `data/discord/cooldowns.json` (assert via spied state writer); no
    writes to `data/discord/suppression.json` (operator-only invariant).
  - Concurrency group string in `.github/workflows/discord-monitor.yml`
    (once created at T027) matches `.github/workflows/redeem.yml:31`
    exactly: `stfc-gift-redeemer` (bit-for-bit; verified as a string
    assertion in test).
  - Cron expression in `discord-monitor.yml` is literally `15 */4 * * *`;
    cron expression in `redeem.yml` is literally `0 * * * *` — assert
    both literal values.

### Implementation for User Story 1

- [X] T019 [P] [US1] Implement `src/discord/stoplist.ts` — curated reject
  list for false-positive code-shaped strings (format-example patterns,
  common abbreviations, high-frequency non-code ALL-CAPS words). Export
  `isOnStoplist(candidate: string): boolean`. Populate with at least the
  patterns used in the extractor tests (T013).

- [X] T020 [P] [US1] Implement `src/discord/extractor.ts` —
  precision-first regex extractor. Core pattern:
  `^[A-Z][A-Z0-9]{3,19}$`. Strip Markdown decoration, spoiler tags
  `||…||`, zero-width Unicode characters, and triple-backtick code fences
  before applying the regex. Context-bonus scoring for messages in
  channels labeled with "code" or "promo". Emit `CandidateCode[]` with
  `extractionConfidence` ≥ 0.6 threshold. Integrate `stoplist.ts`.
  Depends on T013 (must fail first), T019.

- [X] T021 [P] [US1] Implement `src/discord/cooldown.ts` — pure-function
  module owning FR-009 cool-down telemetry math. Export:
  - `const COOLDOWN_DEFAULT_DAYS = 30;` (FR-009 default constant).
  - `recordFailure(map: CooldownMap, code: string, outcome: string, now:
    Date): CooldownMap` — adds new entry or appends to existing; never
    extends `suppressedUntil` on re-failure within window; caps
    `failureOutcomes` at last 5.
  - `isInCooldown(map: CooldownMap, code: string, now: Date): boolean` —
    true iff `map[code]?.suppressedUntil > now`.
  - `evictExpired(map: CooldownMap, now: Date): CooldownMap` —
    state-files.contract.md eviction (drop entries with
    `suppressedUntil < now - 7d`).
  This module performs NO I/O; it is wired into `src/discord/state.ts`
  for `data/discord/cooldowns.json` writes from the orchestration layer.
  Depends on T015, T009.

- [X] T022 [US1] Implement `src/discord/dedup.ts` — filter
  `CandidateCode[]` against (in priority order):
  (a) `promo-codes.txt` via `readPromoCodes(path)` +
  `parsePromoCodes(content)` (existing exports, unchanged) →
  `already-known`;
  (b) `candidates.jsonl` history via latest-line-wins read from T010 →
  `duplicate`;
  (c) `data/discord/suppression.json` operator deny rules → marks
  `suppressed-operator-deny`; operator allow rules force-override (d);
  (d) `data/discord/cooldowns.json` via `cooldown.isInCooldown()` from
  T021 → `suppressed-cooldown`.
  Emit fresh list and status-annotated full list. Depends on T014, T021,
  T010.

- [X] T023 [US1] Implement redeemer seam changes:
  - Add `export async function readCodesForRun(opts?: { extraCandidates?:
    string[] }): Promise<string[]>` to `src/lib/promoCodes.ts`. It wraps
    the existing `readPromoCodes(path)` + `parsePromoCodes(content)`
    pipeline; existing callers invoking these functions directly continue
    to work unchanged.
  - Modify `src/skills/redeemCodes.ts` to accept an optional
    `{ extraCandidates?: string[] }` arg in its options and pass it
    through to `readCodesForRun(opts)`. The return shape, exit code
    semantics, and per-account error handling are UNCHANGED.
  - Confirm the `readPromoCodes` import at `src/skills/redeemCodes.ts:9`
    is correct (update name if any rename is needed; `loadPromoCodes`
    MUST NOT be used).
  Depends on T016.

- [X] T024 [US1] Implement Discord REST client in `src/discord/client.ts`
  — thin wrapper over `@discordjs/rest`. Typed error classes:
  `DiscordAuthError` (401), `DiscordRateLimitError` (429),
  `DiscordTransientError` (5xx), `DiscordChannelAccessError` (403),
  `DiscordChannelNotFoundError` (404), `SchemaMismatchError`. GET-only.
  zod schema validation on every response (rejects payloads missing
  `id`, `channel_id`, `content`, `timestamp`). `AbortSignal` timeout.
  Retry: ≤ 3× per channel on 429 (honor `Retry-After`), 1× with jitter
  on 5xx. 401 → non-retrying; token MUST pass through `src/lib/redact.ts`
  before any log line. `DISCORD_BOT_TOKEN` MUST NOT appear in any log
  output or error message. User-Agent header:
  `STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)`.
  Depends on T011, T017.

- [X] T025 [US1] Implement `src/discord/ingest.ts` — per-channel message
  pager. Reads `config/discord-allowlist.json` (validated by T009 schema);
  for each enabled entry calls `src/discord/client.ts` to page
  `GET /api/v10/channels/{id}/messages?after=<cursor>&limit=100` up to 5
  pages per channel. Advances cursor in memory (flushed at step 8 of
  plan sequence). Returns `IngestedMessage[]`. On 401 auth failure:
  marks `RunHealth.errors.auth_failed`, skips Discord half, does NOT
  block the redeemer (FR-012). Depends on T024, T010, T017.

- [X] T026 [US1] Implement main skill orchestration in
  `src/skills/discordMonitor.ts` following the 11-step sequence in
  `plan.md` § Sequence:
  (1) boot + allow-list load; (2) token check; (3) ingest; (4) extract;
  (5) classify (deferred to T033); (6) dedup + redeem via
  `redeemCodes({ extraCandidates })`; (7) auto-commit up to
  `AUTO_COMMIT_PER_RUN_CAP = 10` newly-redeemed codes to `promo-codes.txt`
  (constant from T018, **per-run cap of 10 codes**); (8) state write —
  flush `cursors.json`, `candidates.jsonl`, `tips-seen.jsonl`, AND call
  `cooldown.recordFailure()` + `evictExpired()` then write
  `cooldowns.json` for any failed redemptions (NEVER write
  `suppression.json`); (9) digest at `src/digest/index.ts` (deferred to
  T034); (10) job summary (deferred to T038); (11) exit. Returns
  `{ result, exitCode }`. MUST NOT call `process.exit`. Register as the
  real implementation in `src/cli.ts` (replacing T007 stub). Depends on
  T018, T020, T021, T022, T023, T024, T025.

- [X] T027 [US1] Create `.github/workflows/discord-monitor.yml`. Key
  values (must match assertions in T018 bit-for-bit):
  - `cron: "15 */4 * * *"` (4-hourly, 15-min offset from redeemer's
    `0 * * * *`).
  - `concurrency.group: stfc-gift-redeemer` (MUST match `redeem.yml:31`
    exactly).
  - `concurrency.cancel-in-progress: false`.
  - `timeout-minutes: 10`.
  - `permissions.contents: write`.
  - `actions/cache` path `~/.cache/huggingface`, key
    `hf-${{ hashFiles('config/classifier-model.json') }}`.
  - Env: `DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}` and
    `STFC_ACCOUNTS: ${{ secrets.STFC_ACCOUNTS }}`.
  - Post-step (if: always):
    `git add data/discord data/digests promo-codes.txt`,
    `git diff --cached --quiet || git commit -m "chore(discord-monitor):
    run ${{ github.run_id }}"`,
    `git pull --rebase origin "$GITHUB_REF_NAME" || true`, `git push`.
  - All `uses:` actions pinned to SHA (Security & Compliance Constraints).
  Depends on T026.

**Checkpoint**: User Story 1 is fully functional and independently testable.
Run `npm run skill:discord-monitor` with fixture allow-list. Verify digest
produced at `data/digests/YYYY-MM-DD.md`. Failed codes appear in
`data/discord/cooldowns.json` with 30-day windows. `npm test` must be green.

---

## Phase 4: User Story 2 — Daily Tips/Tricks/Hacks Digest (Priority: P2)

**Goal**: Non-code messages are classified locally (no remote LLM, no
message text leaves the runner), deduplicated across channels and days
using SHA-256 content hash, and surfaced as a curated daily
`data/digests/YYYY-MM-DD.md` (digest writer at `src/digest/index.ts` per
constitution v1.3.0) with category labels, verbatim excerpts (≤ 600
chars), and jump-links.

**Independent Test**: Replay `tests/fixtures/discord/messages-tips.json`
(~50 mixed messages); confirm digest contains correct tip categories,
excludes chatter, each entry has a jump-link to the original Discord
message, and the file is byte-identical on a same-day re-run with no new
input.

### Tests for User Story 2 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US2 Acceptance Scenarios MUST map to a test.**

- [ ] T028 [P] [US2] Write classifier unit tests in
  `tests/discord/classifier.test.ts` **before** implementing
  `src/discord/classifier.ts`. Assert:
  - Tier-1 heuristic discards single-emoji, sub-20-char greeting, and
    raid-ping messages as `chatter` WITHOUT triggering tier-2 (stub
    `globalThis.fetch`; assert zero calls — privacy invariant FR-016 /
    FR-017).
  - `classify()` called on any message makes zero outbound `fetch` calls
    (stub `globalThis.fetch`, assert call count = 0; this is the privacy
    invariant test required by Principle IX).
  - Confidence floor 0.55: output below floor → `label: "unclassified"`,
    which MUST NOT be surfaced into the digest (callers filter it).
  - `classify()` called before `load()` → throws (lifecycle contract).
  - Tier-2 is not invoked for messages tier-1 already discards as
    `chatter`.
  - `unload()` called in a `finally` block frees model memory (lifecycle
    contract).

- [ ] T029 [P] [US2] Write moderation unit tests in
  `tests/discord/moderation.test.ts` **before** implementing
  `src/discord/moderation.ts`. Assert (FR-020):
  - `@everyone` and `@here` mass-mention patterns →
    `isExcludedByModeration` returns `true`; message excluded.
  - Known harassment keyword patterns (curated list) → excluded.
  - Doxxing patterns (street-address regex, phone-number regex) →
    excluded.
  - NSFW-marker conventions → excluded.
  - Excluded message count increments `RunHealth.dropped.moderation`.
  - Clean STFC tip message → `isExcludedByModeration` returns `false`;
    passes through.

- [ ] T030 [P] [US2] Write digest unit tests in
  `tests/digest/digest.test.ts` **before** implementing
  `src/digest/index.ts` (note: tests live under `tests/digest/`, source
  under `src/digest/` — mirrors plan.md § Project Structure). Assert
  (maps to US2 Scenarios 1–3 and digest-writer contract):
  - Same-day re-run with identical input → byte-identical output file;
    `mode: "merged-idempotent"` returned; no file write performed (the
    digest byte-identical-on-no-change idempotency invariant).
  - Same-day re-run with new codes/tips added → merged output;
    `generatedAt` updated; `health.runIds[]` is the union; per-counter
    values summed.
  - Excerpts > 600 chars are truncated with `…` (FR-019).
  - Forbidden tokens NEVER appear in output: JWT-shaped strings,
    `DISCORD_BOT_TOKEN` literal, raw API response body, `STFC_ACCOUNTS`
    literal (FR-025, Principle VII).
  - `<!-- DIGEST_STATE_V1` state block is present, is valid minified
    JSON, and round-trips correctly (parse → re-render → byte-stable).
  - A duplicate tip (same `contentHash`) appearing in two channels →
    appears once in digest with both source locations listed (US2
    Scenario 3).
  - Each digest tip entry has a `jumpLink` URL (US2 Scenario 2 —
    one-click access).

### Implementation for User Story 2

- [ ] T031 [P] [US2] Implement `src/discord/moderation.ts`. Export
  `isExcludedByModeration(contentNormalized: string): boolean`. Uses
  curated harassment keyword list, `@everyone`/`@here` mass-mention
  patterns, NSFW channel-name markers, doxxing regexes (street-address,
  phone-number). Excluded messages are counted in
  `RunHealth.dropped.moderation` and never reach the classifier (FR-020).
  Depends on T029.

- [ ] T032 [P] [US2] Implement tier-1 heuristic in
  `src/discord/classifier.ts` — keyword + regex scoring against STFC
  vocabulary (`tip`, `trick`, `hack`, `event`, `armada`, `hostile`,
  `ops`, `crew`, ship names from `docs/stfc-game-knowledge.md` if
  available). Discard chatter (messages < 20 chars, greetings, single
  emoji, raid-pings) as `chatter` without invoking tier-2. Implement
  `Classifier` interface from `contracts/classifier.contract.md`
  (`load()`, `classify()`, `unload()`). Depends on T028.

- [ ] T033 [US2] Implement tier-2 zero-shot classifier in
  `src/discord/classifier.ts`. Load `Xenova/nli-deberta-v3-xsmall` ONNX
  model via `@xenova/transformers`. On `load()`: read
  `config/classifier-model.json`; probe HuggingFace cache; verify SHA-256
  of weight file against `weightSha256` field — mismatch →
  `ClassifierIntegrityError`, fail run, delete bad file. Download on
  cache miss, re-verify. Labels: `["tip", "trick", "hack", "event-info",
  "patch-note", "chatter"]`. Confidence floor 0.55; below →
  `unclassified`. Call `unload()` in `finally` block of skill
  orchestration (~140 MB RAM freed). No outbound network during
  `classify()`. Populate `config/classifier-model.json` with real `id`,
  `revision`, `weightSha256` values at implementation time (implementer
  downloads and measures at `~/.cache/huggingface`). Depends on T032,
  T028.

- [ ] T034 [US2] Implement `src/digest/index.ts` — `writeDigest(input):
  Promise<DigestWriteResult>`. Output path:
  `data/digests/${YYYY-MM-DD}.md` (UTC date at run start). Idempotency
  per digest-writer contract: read existing file → parse
  `DIGEST_STATE_V1` state block → union prior state with current run →
  re-render → byte-compare → write only if different. Forbidden-content
  guard runs before every write (JWT patterns, token literals). File
  format per digest-writer contract § "File format": codes redeemed
  table, codes failed table, tips grouped by category with verbatim
  excerpts ≤ 600 chars + jump-links, ingestion health section, embedded
  `DIGEST_STATE_V1` JSON comment. NOTE: source location is
  `src/digest/index.ts` (NOT `src/discord/digest.ts` — that path is
  forbidden by constitution v1.3.0). Depends on T030.

**Checkpoint**: User Stories 1 AND 2 independently functional. Run full
pipeline on mixed fixture — digest contains tips with categories, codes
with outcomes, health stats. `npm test` must be green.

---

## Phase 5: User Story 3 — Operator Visibility & Health (Priority: P3)

**Goal**: Every run emits structured health counters to both the daily
digest (§ Ingestion Health) and the GitHub Actions Job Summary. Auth and
channel errors are clearly flagged; the redeemer pipeline is never
silently blocked.

**Independent Test**: Inject a 401 auth response fixture; confirm digest
health section contains `auth_failed` flag, `exitCode: 0` is returned, and
redeemer still runs against `promo-codes.txt` and any previously-queued
candidates (FR-012 / US3 Scenario 2).

### Tests for User Story 3 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US3 Acceptance Scenarios MUST map to a test.**

- [x] T035 [P] [US3] Write `RunHealth` unit tests (extend
  `tests/skills/discordMonitor.test.ts`) **before** wiring health
  counters. Assert (US3 Scenarios 1–2):
  - After a 401 auth failure: `RunHealth.errorsByClass["DiscordAuthError"]
    = 1`; `exitCode: 0`; redeemer still runs and its result is recorded
    (FR-012).
  - After a complete healthy run: all counters populated with
    non-negative integers — `channelsConfigured`, `channelsRead`,
    `messagesScanned`, `candidatesExtracted`, `candidatesSubmitted`,
    `candidatesSuppressedDedup`, `candidatesSuppressedCooldown`,
    `candidatesDeferredCap`, `tipsClassified.*`, `dropped.*`,
    `errorsByClass`.
  - `RunHealth.modelLoaded.sha256Verified` is `true` when model SHA-256
    passes.
  - `channelsRead < channelsConfigured` when one channel returns 403
    (US3 Scenario 1: "1 errored" in health section).
  - `candidatesSuppressedCooldown` increments when a code is filtered by
    `cooldowns.json` (verifies cool-down counter is wired through
    `dedup.ts` from T022).

- [x] T036 [P] [US3] Write Job Summary unit test (add to
  `tests/skills/discordMonitor.test.ts`) **before** implementing summary
  emission. Assert (FR-027):
  - A `RunHealth` block is written to `process.env.GITHUB_STEP_SUMMARY`
    on every completed run, including runs where the digest write itself
    fails.
  - The summary block is well-formed Markdown (no unclosed code fences,
    no forbidden tokens).

### Implementation for User Story 3

- [x] T037 [P] [US3] Wire `RunHealth` counters through the full
  orchestration in `src/skills/discordMonitor.ts`: populate all fields of
  the `RunHealth` interface from `data-model.md` § 10 as each pipeline
  stage completes — ingest stage populates channel/message counters;
  extract stage populates `candidatesExtracted`; dedup stage populates
  `candidatesSuppressedDedup`/`candidatesSuppressedCooldown`/
  `candidatesDeferredCap`; redeem stage populates `candidatesSubmitted`;
  classify stage populates `tipsClassified` and `dropped`; state write
  records model load metrics. Depends on T035, T026.

- [x] T038 [P] [US3] Implement GitHub Actions Job Summary emission
  (FR-027): after digest write, format `RunHealth` as a Markdown summary
  block and write to the file at `process.env.GITHUB_STEP_SUMMARY` (if
  set; no-op if not set, for local runs). Emit even if the digest write
  throws (wrap in its own try/catch). Depends on T036.

**Checkpoint**: All three user stories independently functional and
testable. `npm test` green. Run `workflow_dispatch` on
`discord-monitor.yml` to verify end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Operator documentation verification, state-files contract
hardening, and final hygiene gate validation.

- [x] T039 [P] Validate `specs/001-discord-monitor/quickstart.md`
  operator walkthrough: trace through all steps and confirm § 8 (or
  equivalent operational-dependencies section) contains a clearly-titled
  advisory "Branch protection on `main` will break this feature" with
  exact remediation steps (either disable required PR review for
  `github-actions[bot]`, or enable PR-gated auto-commit mode). If the
  advisory is absent or incomplete, add it to
  `quickstart.md`. Also confirm operator instructions for editing
  `data/discord/suppression.json` (the operator-only file) are documented;
  `data/discord/cooldowns.json` should be documented as skill-managed
  (operators should not hand-edit).

- [x] T040 [P] Add rerun/cursor edge-case documented behavior to
  `specs/001-discord-monitor/contracts/state-files.contract.md` under a
  new § "Rerun behavior after partial failure": a workflow rerun after
  partial failure (where `cursors.json` was not flushed) will re-extract
  messages between the last successful append and the cursor position,
  but `candidates.jsonl` membership dedup prevents re-submission to the
  STFC API. Behavior is bounded and intentional, not a bug.

- [x] T041 [P] Run `npm run typecheck` and `npm test` — confirm all 43
  tasks' deliverables compile and all tests pass. Address any type
  errors or test failures before considering the feature branch ready
  for implementation review.

- [x] T042 [P] Validate artifact hygiene gate end-to-end: inject a
  synthetic forbidden token (JWT-shaped string) into a test file at
  `data/digests/test-hygiene.md`, run
  `scripts/check-artifact-hygiene.mjs`, confirm scanner returns
  non-zero. Repeat for `data/discord/cooldowns.json` (inject + scan).
  Remove synthetic files. Confirm scanner returns zero on a clean
  digest + clean state tree. This proves the T012 extension is wired
  correctly in CI for both digest and state-file paths.

**Checkpoint**: All user stories functional, all tests green, operator
docs complete, hygiene gate verified for both digest + state files.
Feature branch is ready for implementation review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Governance)**: No code dependencies — open immediately.
  BLOCKS all later phases merging to `main`.
- **Phase 1 (Setup)**: Requires Phase 0 landed. T003, T004, T005, T006
  are `[P]` — run together.
- **Phase 2 (Foundational)**: Requires Phase 1. T008, T009, T010, T012
  are `[P]`; T011 depends on T009+T010.
- **Phase 3 (US1)**: Requires Phase 2. Tests T013–T017 are `[P]`; T018
  depends on T017. Impl T019–T021 are `[P]`; T022 depends on T021+T010;
  T023 depends on T016; T024 depends on T011+T017; T025 depends on
  T024+T010+T017; T026 depends on T018+T020+T021+T022+T023+T024+T025;
  T027 depends on T026.
- **Phase 4 (US2)**: Requires Phase 2. Tests T028–T030 are `[P]`;
  T031–T032 are `[P]`; T033 depends on T032+T028; T034 depends on T030.
- **Phase 5 (US3)**: Requires Phase 3 orchestration (T026). Tests
  T035–T036 are `[P]`; impl T037 depends on T035+T026; T038 depends on
  T036.
- **Phase 6 (Polish)**: Requires all Phase 3–5 tasks complete. T039–T042
  are `[P]`.

### Within Each User Story

- Tests MUST be written and FAIL before any corresponding implementation
  task starts (Principle IX).
- Schemas (T009) before state I/O (T010) before client (T024) before
  ingest (T025) before orchestration (T026).
- Cooldown logic (T021) lives between state I/O (T010) and dedup (T022)
  because dedup consumes `cooldown.isInCooldown()` and orchestration
  (T026) consumes `cooldown.recordFailure()` + `evictExpired()`.
- Every spec acceptance scenario maps to at least one test assertion.

### Parallel Opportunities

```bash
# Phase 1 — run all together:
T003 (dirs+config)   T004 (npm deps)   T005 (source stubs)   T006 (test stubs)

# Phase 2 — run T008–T010, T012 together; T011 after T009+T010:
T008 (fixtures)   T009 (schemas)   T010 (state I/O)   T012 (hygiene ext.)
→ T011 (secret loader)

# Phase 3 tests — run all together:
T013 (extractor)   T014 (dedup)   T015 (cooldown)   T016 (seam)   T017 (ingest)

# Phase 4 tests — run all together:
T028 (classifier)   T029 (moderation)   T030 (digest)

# Phase 5 tests — run together:
T035 (health)   T036 (job summary)

# Phase 6 — run all together:
T039 (quickstart)   T040 (contract note)   T041 (typecheck+test)   T042 (hygiene e2e)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 0: Governance (amendment landed on `main`).
2. Phase 1: Setup & Scaffolding.
3. Phase 2: Foundational (CRITICAL — blocks all stories).
4. Phase 3: User Story 1 — codes extracted, redeemed, cool-downs
   recorded, digest produced.
5. **STOP and VALIDATE**: Run `npm test`, run
   `npm run skill:discord-monitor` with fixture.
6. Merge Phase 3 to `main`, enable workflow.

### Incremental Delivery

1. Phase 0+1+2 → Foundation ready.
2. Phase 3 (US1) → Codes auto-redeemed → Deploy (MVP!).
3. Phase 4 (US2) → Tips digest live → Deploy.
4. Phase 5 (US3) → Health surface live → Deploy.
5. Phase 6 (Polish) → Operator docs complete, hygiene gate verified.

---

## Notes

- `[P]` tasks touch different files and have no dependencies on each
  other within their phase.
- `[Story]` labels map each task to a spec user story for traceability.
- Tests MUST fail before implementation — `npm test` must show red
  before any implementation task starts.
- The 3 known short-code gaps (`TNG`, `GQ5`, `GQ7`) are ACCEPTED KNOWN
  GAPS, not regressions — the extractor test suite (T013) must name
  them as expected failures, not as bugs.
- `readCodesForRun` wraps `readPromoCodes(path)` +
  `parsePromoCodes(content)` — these two names are the actual seam
  exports; `loadPromoCodes` does not exist and must never appear.
- **Auto-commit per-run cap: 10 codes** (constant
  `AUTO_COMMIT_PER_RUN_CAP = 10` enforced at T026 step 7; capped from
  the `appendToPromoCodesTxt` call, not from the redeemer call).
- **Cool-down default: 30 days** (constant `COOLDOWN_DEFAULT_DAYS = 30`
  in `src/discord/cooldown.ts` per FR-009; written to
  `data/discord/cooldowns.json` only — NEVER to `suppression.json`).
- **`data/discord/suppression.json` is operator-only** (state-files
  contract cross-file invariant #4). Feature code READS it gracefully
  (missing → `{}`) but NEVER writes to it.
- **Digest writer source path: `src/digest/index.ts`** (constitution
  v1.3.0, post-BLOCKER fix). The path `src/discord/digest.ts` is
  forbidden — any reference to it is a regression of the 2026-05-16
  resolution.
- Runtime allow-list MUST default to empty per FR-001 / Q3
  clarification; no server or channel IDs are hard-coded in source.
- 7 durable inputs (post-refinement: allowlist + classifier-model +
  cursors + candidates + tips-seen + suppression + cooldowns), with
  `data/digests/**` enumerated separately as an artifact tree —
  matching `.specify/memory/constitution.md:33–42`.
- Commit after each task group with Co-authored-by trailer.
