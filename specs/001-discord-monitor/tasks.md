---
description: "Task list for 001-discord-monitor feature implementation"
---

# Tasks: Discord Community Monitor for Codes & Tips

**Input**: Design documents from `/specs/001-discord-monitor/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Per Constitution Principle IX (Test-First Discipline, NON-NEGOTIABLE), every
user story whose spec defines acceptance criteria MUST include at least one test task that
exercises those criteria, and the test task MUST be ordered BEFORE its corresponding
implementation tasks (test-first). Tests are NOT optional.

**Organization**: Tasks are grouped by phase and user story. Phase 0 is a governance gate
that BLOCKS all implementation. Phases 3–5 map to user stories US1–US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies within same phase)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Source: `src/discord/`, `src/skills/`, `src/lib/`, `src/cli.ts`
- Tests: `tests/discord/`, `tests/skills/`, `tests/fixtures/discord/`
- Config: `config/discord-allowlist.json`, `config/classifier-model.json`
- State: `data/discord/`, `data/digests/`
- Workflow: `.github/workflows/discord-monitor.yml`
- Constitution: `.specify/memory/constitution.md`
- Templates: `.specify/templates/plan-template.md`

---

## Phase 0: Pre-Implementation Governance (Standalone Amendment PR)

**Purpose**: Land the constitution v1.3.0 amendment as a STANDALONE PR before any
implementation code that references or handles `DISCORD_BOT_TOKEN`. Per Picard's
APPROVE WITH CONDITIONS decision, this amendment must be reviewable and revertable
independently of implementation code (Principle VI).

**⚠️ BLOCKER**: No Phase 1+ task may merge to `main` until T000 acceptance criteria
are satisfied and the amendment PR has landed.

### Governance check for Phase 0

- [ ] T000 Verify the v1.3.0 amendment PR satisfies all three P0 findings from
  `.squad/decisions/inbox/tuvok-001-discord-monitor-amendment-audit.md` before
  merging. Acceptance criteria (checklist — all three must be ✅ before merge):
  - **[P0-1]** `.specify/templates/plan-template.md` Principle V guidance text is
    updated: the stale line stating "durable inputs limited to STFC_ACCOUNTS /
    promo-codes.txt (+ refresh-pipeline secrets)" is corrected to reflect the
    7 new durable inputs introduced by v1.3.0 (`config/discord-allowlist.json`,
    `config/classifier-model.json`, `data/discord/cursors.json`,
    `data/discord/candidates.jsonl`, `data/discord/tips-seen.jsonl`,
    `data/discord/suppression.json`, `data/digests/YYYY-MM-DD.md`) — exactly 7,
    not 6 (corrected per Tuvok plan-corrections memo).
  - **[P0-2]** The v1.3.0 Sync Impact Report block in `.specify/memory/constitution.md`
    contains a per-principle change summary field enumerating REVISED / KEPT /
    EXTENDED status for every section (Principles I–IX, Security & Compliance
    Constraints, Development Workflow, Governance, Speckit Reviewer Gates) —
    matching the shape of the v1.2.0 report at `.specify/memory/constitution.md:1–119`.
  - **[P0-3]** The v1.3.0 Sync Impact Report states explicit disposition for all
    three Known Tensions previously committed to v1.3.0 resolution (Principle III
    auth/me overclaim, Principle VII `.github/` scan-path overclaim, redeem/refresh
    concurrency lock un-principled). Each tension MUST either be fully resolved in
    this amendment or explicitly re-targeted to v1.4.0 with written rationale; no
    tension may remain silently unaddressed.

### Implementation for Phase 0

- [ ] T001 Draft v1.3.0 amendment to `.specify/memory/constitution.md` applying all
  six edits enumerated in `plan.md` § Constitution Impact (lines 396–444):
  (1) broaden § V "secret" definition to include third-party API credentials;
  (2) append the 7-path durable-input enumeration (exact paths listed in T000 P0-1);
  (3) append Token Capture Custody sentence: `DISCORD_BOT_TOKEN` MUST NOT be merged
  into `STFC_ACCOUNTS`, MUST NOT be handled by `scripts/capture-token.mjs`, and is
  provisioned only via direct `gh secret set DISCORD_BOT_TOKEN`;
  (4) append outbound network scope for `discord.com/api/v10/...` (read-only) and
  `huggingface.co/...` (model weights, integrity-checked) under Security & Compliance
  Constraints;
  (5) add `discord-monitor.yml` to the SHA-pinning roster in Security & Compliance
  Constraints alongside `redeem.yml`, `refresh-token.yml`, `test.yml`,
  `squad-test-gate.yml`;
  (6) write the full v1.3.0 Sync Impact Report satisfying P0-1, P0-2, P0-3 above.
  Also update `.specify/templates/plan-template.md` for P0-1. Bump version
  string in constitution: `1.2.0 → 1.3.0, MINOR`.

- [ ] T002 Open standalone PR for the v1.3.0 amendment (`.specify/memory/constitution.md`
  + `.specify/templates/plan-template.md`). Collect sign-offs: Tuvok (process audit),
  Borg Queen (claim verification), Bashir (cross-check), Picard (ratification). Merge
  to `main`. This PR contains NO implementation source files.

**Checkpoint**: Constitution v1.3.0 landed on `main`. Implementation phases may begin.

---

## Phase 1: Setup & Scaffolding

**Purpose**: Scaffold all new directories, empty config files, placeholder files, and
`package.json` changes. No runtime logic yet. Run `npm test` — new test stubs must fail.

- [ ] T003 [P] Create directory tree and committed placeholder files:
  `config/discord-allowlist.json` (initial value: `{ "version": 1, "entries": [] }`),
  `config/classifier-model.json` (stub object with fields `id`, `revision`,
  `weightSha256`, `task`, `labels`, `confidenceFloor` — placeholder values),
  `data/discord/.gitkeep`, `data/digests/.gitkeep`. Verify tree matches
  `plan.md` § Project Structure exactly.

- [ ] T004 [P] Add npm runtime dependencies to `package.json`:
  `@discordjs/rest` ^2.5.0, `discord-api-types` ^0.38.x, `@xenova/transformers`
  ^2.17.x. Add `"skill:discord-monitor": "tsx src/cli.ts discord-monitor"` to
  `scripts`. Run `npm install` to update `package-lock.json`. Verify
  `discord-api-types` actual license via `npm view discord-api-types license` (plan
  claimed Apache-2.0; Picard Condition 1 requires verification — MIT is also
  license-compatible per Security & Compliance Constraints).

- [ ] T005 [P] Create empty stub source files (export stubs only — no logic):
  `src/discord/client.ts`, `src/discord/ingest.ts`, `src/discord/extractor.ts`,
  `src/discord/stoplist.ts`, `src/discord/classifier.ts`, `src/discord/moderation.ts`,
  `src/discord/dedup.ts`, `src/discord/digest.ts`, `src/discord/state.ts`,
  `src/discord/schemas.ts`, `src/skills/discordMonitor.ts`. Confirm
  `npm run typecheck` passes with stubs in place.

- [ ] T006 [P] Create empty test files with mandatory failing assertions (red phase —
  Principle IX): `tests/discord/extractor.test.ts`, `tests/discord/classifier.test.ts`,
  `tests/discord/dedup.test.ts`, `tests/discord/digest.test.ts`,
  `tests/discord/moderation.test.ts`, `tests/discord/ingest.test.ts`,
  `tests/skills/discordMonitor.test.ts`. Each file MUST contain at least one
  `assert.fail("not implemented")` test. Run `npm test` and confirm all new test
  files fail (proves tests are live in the runner before any implementation).

- [ ] T007 Register `discord-monitor` skill in `src/cli.ts` as a stub entry that
  returns `{ result: "not-implemented", exitCode: 1 }`. Confirm `npm run typecheck`
  passes. (Unblocks workflow YAML task T025 later without requiring full implementation.)

**Checkpoint**: Directory tree present, deps installed and locked, stubs compile,
new test stubs run and fail. Foundation is visible before a line of logic is written.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure MUST be complete before any user story can be
implemented. Includes: Discord REST fixtures (Principle VIII wire-first), zod schemas,
state I/O, secret loader, artifact hygiene extension.

**⚠️ CRITICAL**: No user story implementation may start until this phase is complete.

- [ ] T008 [P] Write Discord REST fixtures in `tests/fixtures/discord/` (Principle VIII
  wire-first, before any client implementation):
  `messages-codes.json` (sanitized 200 OK array with ≥ 3 code-bearing messages),
  `messages-tips.json` (~20 tip/trick/hack messages, varied categories),
  `messages-mixed.json` (~50 messages: codes + tips + chatter + memes, matching
  the spec § "Independent Test" for US1 and US2),
  `rate-limit-429.json` (429 response body with `retry_after` field per Discord API).
  Fixtures MUST be sanitized: no real tokens, no real account credentials. Discord
  snowflake IDs in fixtures are placeholder values; the operator-seed pair
  (guild `509679626763632640` / channel `509685530108362773`) is reserved for smoke-test
  fixtures and MUST NOT be committed to production state files. Runtime allow-list
  MUST default to empty per FR-001 / Q3 clarification.

- [ ] T009 [P] Implement zod schemas in `src/discord/schemas.ts` for all entities in
  `contracts/state-files.contract.md`: `DiscordAllowlist` (version 1 literal, entries
  array), `IngestionCursorMap` (Record<channelId, cursor>), candidates.jsonl line
  (CandidateCode shape with all 9 status literals), tips-seen.jsonl line (contentHash
  + firstSeenAt + category), `SuppressionMap` (Record<code, entry>),
  `ClassifierModel` (id, revision, weightSha256, task, labels, confidenceFloor).
  Include schema tests (inline or `tests/discord/schemas.test.ts`) covering happy
  path and missing-required-field rejection for each schema. Run `npm test`.

- [ ] T010 [P] Implement `src/discord/state.ts` — load/save for all five state files:
  `config/discord-allowlist.json` (read-only; zod-validate on load, fail on malformed),
  `data/discord/cursors.json` (read → `IngestionCursorMap`; write → pretty-printed
  2-space indent, keys sorted alphabetically — all JSON state files follow this
  convention; missing file → `{}`),
  `data/discord/candidates.jsonl` (append-only write; read uses latest-line-wins
  per value as tombstone semantics),
  `data/discord/tips-seen.jsonl` (append-only write),
  `data/discord/suppression.json` (read/write; evict entries where
  `suppressedUntil < now - 7d` on every write). All writes validated against T009
  schemas. Write unit tests covering round-trip and eviction.

- [ ] T011 Implement `DISCORD_BOT_TOKEN` secret loader in `src/discord/client.ts`:
  read from `process.env.DISCORD_BOT_TOKEN`; require non-empty (fail-fast on missing);
  on any error path the token MUST transit `src/lib/redact.ts` (`redactForLog`)
  before appearing in any log output — same pattern as `src/api/client.ts` for STFC
  credentials (FR-029, Principle I). Token MUST NOT appear in any committed file.
  Depends on T009, T010.

- [ ] T012 [P] Extend `scripts/check-artifact-hygiene.mjs` to scan
  `data/digests/**/*.md` for forbidden tokens: JWT-shaped strings, the literal
  `DISCORD_BOT_TOKEN`, raw upstream API response bodies (per digest-writer contract
  § Forbidden contents and plan § Risks). Verify by injecting a synthetic forbidden
  token into a test Markdown file and confirming the scanner catches it.

**Checkpoint**: Schemas pass, state I/O tested with round-trip coverage, secret loader
redacts on error, hygiene scanner covers digest files. User story phases may now begin.

---

## Phase 3: User Story 1 — Auto-Harvest & Redeem New Promo Codes (Priority: P1) 🎯 MVP

**Goal**: Discord-sourced promo codes are extracted, deduplicated against `promo-codes.txt`
and prior run history, submitted to the existing redeemer via a single in-process seam,
and outcomes are recorded for the daily digest.

**Independent Test**: Replay `tests/fixtures/discord/messages-mixed.json` through the
full pipeline (ingest → extract → dedup → redeem-stub → digest). Confirm the correct
codes are extracted, duplicates suppressed, outcomes recorded.

### Tests for User Story 1 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US1 Acceptance Scenarios MUST map to a test.**

- [ ] T013 [P] [US1] Write extractor unit tests in `tests/discord/extractor.test.ts`
  **before** implementing `src/discord/extractor.ts`. Test suite MUST assert:
  - All 30 non-comment entries in `promo-codes.txt` are exercised against the
    extractor. The 27 that match the core regex `^[A-Z][A-Z0-9]{3,19}$` are
    extracted. The 3 known short-code gaps (`TNG`, `GQ5`, `GQ7`) MUST be reported
    as KNOWN GAPS in the test output (labeled, expected failures — not regressions;
    these are accepted precision trade-offs per Tuvok's plan-corrections memo).
  - The example string in "the code format is `XXXXX-YYYYY`" is NOT extracted
    (hyphenated format must be rejected).
  - Spoiler-tag decoration `||CODE||`, zero-width Unicode characters, and Markdown
    bold/italic wrapping are stripped before the regex is applied.
  - Extraction confidence ≥ 0.6 threshold is applied.
  - Stoplist entries from `src/discord/stoplist.ts` are rejected.
  - Messages inside triple-backtick code fences are not extracted (documentation
    pattern edge case from spec § Edge Cases).

- [ ] T014 [P] [US1] Write dedup unit tests in `tests/discord/dedup.test.ts`
  **before** implementing `src/discord/dedup.ts`. Test suite MUST assert (maps to
  spec § US1 Acceptance Scenarios 1–3):
  - Code present in `promo-codes.txt` → status `already-known`, NOT queued for
    redemption (Scenario 2).
  - Code present in `candidates.jsonl` from a prior run → status `duplicate`.
  - Code in `suppression.json` with `suppressedUntil > now` → status
    `suppressed-cooldown`; re-seen on a later run within cool-down → also suppressed
    (Scenario 3). Default cool-down window: 30 days from `firstFailedAt` (FR-009
    confirmed in plan).
  - Code absent from all three sources → status `pending`, added to fresh list
    (Scenario 1).
  - `suppressedUntil` expiry correctly transitions the code back to evaluable.

- [ ] T015 [P] [US1] Write redeemer-seam unit tests in `tests/skills/redeemCodes.test.ts`
  (modify existing file) **before** implementing seam changes. Assert:
  - `redeemCodes({ extraCandidates: ["CODE1", "CODE2"] })` merges candidates after
    `promo-codes.txt` codes, deduplicated, and passes the unified list to the STFC
    API client.
  - `redeemCodes()` called with no args continues to work unchanged — existing
    behavior is not regressed (Picard architecture review: "no regressions in current
    5 skills").
  - The new `readCodesForRun(opts?)` function in `src/lib/promoCodes.ts` wraps the
    existing seam exports `readPromoCodes(path)` + `parsePromoCodes(content)`. These
    two function names MUST remain unchanged. The name `loadPromoCodes` MUST NOT
    appear (it does not exist; verify import at `src/skills/redeemCodes.ts:9` per
    Tuvok corrections memo P1-6).

- [ ] T016 [P] [US1] Write ingest unit tests in `tests/discord/ingest.test.ts`
  **before** implementing `src/discord/ingest.ts`. Use fixture files from T008 as
  the stubbed REST client responses. Assert:
  - 401 response from `GET /users/@me` → `DiscordAuthError` raised; redeemer half
    continues to run on `promo-codes.txt` (FR-012; maps to US3 Scenario 2).
  - 429 response with `Retry-After: 5` header → `DiscordRateLimitError`; bounded
    retry ≤ 3× per channel; partial completion is recorded in health counters.
  - Per-channel 5-page cap enforced: messages beyond page 5 are deferred (cursor
    not advanced past page 5 boundary).
  - Cursor advances monotonically per channel after each successful page fetch.
  - `GET /api/v10/users/@me` is called exactly once per run (token validation).
  - 403 / 404 → channel marked errored in `RunHealth`, remaining channels continue.

- [ ] T017 [US1] Write integration test in `tests/skills/discordMonitor.test.ts`
  **before** implementing `src/skills/discordMonitor.ts`. Assert (full-run with
  fixture data; no live Discord or STFC connections):
  - Empty `config/discord-allowlist.json` → skill returns `{ exitCode: 0 }`;
    zero Discord REST calls made; digest produced with "0 channels configured"
    health note (FR-001).
  - Mixed-channel fixture → correct codes extracted; dedup filters prior codes;
    `redeemCodes` called exactly once with `{ extraCandidates: [...] }`; zero spy
    calls if `fresh.length === 0`; per-account outcomes recorded in candidates.
  - Per-run auto-commit cap of 10: `appendToPromoCodesTxt` called with at most
    10 codes (truncated from the redeemed list), NOT truncating the redeem call
    itself.
  - Concurrency group string in `.github/workflows/discord-monitor.yml` (once
    created at T025) matches `.github/workflows/redeem.yml:31` exactly:
    `stfc-gift-redeemer` (bit-for-bit; verified as a string assertion in test).
  - Cron expression in `discord-monitor.yml` is literally `15 */4 * * *`;
    cron expression in `redeem.yml` is literally `0 * * * *` — assert both
    literal values (verified facts encoded as test assertions per brief).

### Implementation for User Story 1

- [ ] T018 [P] [US1] Implement `src/discord/stoplist.ts` — curated reject list for
  false-positive code-shaped strings (format-example patterns, common abbreviations,
  high-frequency non-code ALL-CAPS words). Export
  `isOnStoplist(candidate: string): boolean`. Populate with at least the patterns
  used in the extractor tests (T013).

- [ ] T019 [P] [US1] Implement `src/discord/extractor.ts` — precision-first regex
  extractor. Core pattern: `^[A-Z][A-Z0-9]{3,19}$`. Strip Markdown decoration,
  spoiler tags `||…||`, zero-width Unicode characters, and triple-backtick code
  fences before applying the regex. Context-bonus scoring for messages in channels
  labeled with "code" or "promo". Emit `CandidateCode[]` with `extractionConfidence`
  ≥ 0.6 threshold. Integrate `stoplist.ts`. Depends on T013 (must fail first), T018.

- [ ] T020 [P] [US1] Implement `src/discord/dedup.ts` — filter `CandidateCode[]`
  against: (a) `promo-codes.txt` via `readPromoCodes(path)` + `parsePromoCodes(content)`
  (existing exports, unchanged), (b) `candidates.jsonl` history via latest-line-wins
  read from T010, (c) `suppression.json` cool-down via T010. Emit fresh list and
  status-annotated full list. Depends on T014, T010.

- [ ] T021 [US1] Implement redeemer seam changes:
  - Add `export async function readCodesForRun(opts?: { extraCandidates?: string[] }):
    Promise<string[]>` to `src/lib/promoCodes.ts`. It wraps the existing
    `readPromoCodes(path)` + `parsePromoCodes(content)` pipeline; existing callers
    invoking these functions directly continue to work unchanged.
  - Modify `src/skills/redeemCodes.ts` to accept an optional
    `{ extraCandidates?: string[] }` arg in its options and pass it through to
    `readCodesForRun(opts)`. The return shape, exit code semantics, and per-account
    error handling are UNCHANGED.
  - Confirm the `readPromoCodes` import at `src/skills/redeemCodes.ts:9` is correct
    (update name if any rename is needed; `loadPromoCodes` MUST NOT be used).
  Depends on T015.

- [ ] T022 [US1] Implement Discord REST client in `src/discord/client.ts` — thin
  wrapper over `@discordjs/rest`. Typed error classes: `DiscordAuthError` (401),
  `DiscordRateLimitError` (429), `DiscordTransientError` (5xx), `DiscordChannelAccessError`
  (403), `DiscordChannelNotFoundError` (404), `SchemaMismatchError`. GET-only. zod
  schema validation on every response (rejects payloads missing `id`, `channel_id`,
  `content`, `timestamp`). `AbortSignal` timeout. Retry: ≤ 3× per channel on 429
  (honor `Retry-After`), 1× with jitter on 5xx. 401 → non-retrying; token MUST pass
  through `src/lib/redact.ts` before any log line. `DISCORD_BOT_TOKEN` MUST NOT
  appear in any log output or error message. User-Agent header:
  `STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)`. Depends on T011,
  T016.

- [ ] T023 [US1] Implement `src/discord/ingest.ts` — per-channel message pager. Reads
  `config/discord-allowlist.json` (validated by T009 schema); for each enabled entry
  calls `src/discord/client.ts` to page
  `GET /api/v10/channels/{id}/messages?after=<cursor>&limit=100` up to 5 pages per
  channel. Advances cursor in memory (flushed at step 8 of plan sequence). Returns
  `IngestedMessage[]`. On 401 auth failure: marks `RunHealth.errors.auth_failed`,
  skips Discord half, does NOT block the redeemer (FR-012). Depends on T022, T010,
  T016.

- [ ] T024 [US1] Implement main skill orchestration in `src/skills/discordMonitor.ts`
  following the 11-step sequence in `plan.md` § Sequence:
  (1) boot + allow-list load; (2) token check; (3) ingest; (4) extract; (5) classify
  (deferred to T031); (6) dedup + redeem via `redeemCodes({ extraCandidates })`; (7)
  auto-commit up to 10 newly-redeemed codes to `promo-codes.txt`; (8) state write;
  (9) digest (deferred to T032); (10) job summary (deferred to T036); (11) exit.
  Returns `{ result, exitCode }`. MUST NOT call `process.exit`. Register as the real
  implementation in `src/cli.ts` (replacing T007 stub). Depends on T017, T019, T020,
  T021, T022, T023.

- [ ] T025 [US1] Create `.github/workflows/discord-monitor.yml`. Key values (must
  match assertions in T017 bit-for-bit):
  - `cron: "15 */4 * * *"` (4-hourly, 15-min offset from redeemer's `0 * * * *`)
  - `concurrency.group: stfc-gift-redeemer` (MUST match `redeem.yml:31` exactly)
  - `concurrency.cancel-in-progress: false`
  - `timeout-minutes: 10`
  - `permissions.contents: write`
  - `actions/cache` path `~/.cache/huggingface`, key
    `hf-${{ hashFiles('config/classifier-model.json') }}`
  - Env: `DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}` and
    `STFC_ACCOUNTS: ${{ secrets.STFC_ACCOUNTS }}`
  - Post-step (if: always):
    `git add data/discord data/digests promo-codes.txt`,
    `git diff --cached --quiet || git commit -m "chore(discord-monitor): run ${{ github.run_id }}"`,
    `git pull --rebase origin "$GITHUB_REF_NAME" || true`, `git push`
  - All `uses:` actions pinned to SHA (Security & Compliance Constraints).
  Depends on T024.

**Checkpoint**: User Story 1 is fully functional and independently testable.
Run `npm run skill:discord-monitor` with fixture allow-list. Verify digest produced at
`data/digests/YYYY-MM-DD.md`. `npm test` must be green.

---

## Phase 4: User Story 2 — Daily Tips/Tricks/Hacks Digest (Priority: P2)

**Goal**: Non-code messages are classified locally (no remote LLM, no message text leaves
the runner), deduplicated across channels and days using SHA-256 content hash, and surfaced
as a curated daily `data/digests/YYYY-MM-DD.md` with category labels, verbatim excerpts
(≤ 600 chars), and jump-links.

**Independent Test**: Replay `tests/fixtures/discord/messages-tips.json` (~50 mixed
messages); confirm digest contains correct tip categories, excludes chatter, each entry
has a jump-link to the original Discord message, and the file is byte-identical on a
same-day re-run with no new input.

### Tests for User Story 2 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US2 Acceptance Scenarios MUST map to a test.**

- [ ] T026 [P] [US2] Write classifier unit tests in `tests/discord/classifier.test.ts`
  **before** implementing `src/discord/classifier.ts`. Assert:
  - Tier-1 heuristic discards single-emoji, sub-20-char greeting, and raid-ping
    messages as `chatter` WITHOUT triggering tier-2 (stub `globalThis.fetch`;
    assert zero calls — privacy invariant FR-016 / FR-017).
  - `classify()` called on any message makes zero outbound `fetch` calls
    (stub `globalThis.fetch`, assert call count = 0; this is the privacy
    invariant test that Principle IX and Picard Condition 5 both require).
  - Confidence floor 0.55: output below floor → `label: "unclassified"`, which
    MUST NOT be surfaced into the digest (callers filter it).
  - `classify()` called before `load()` → throws (lifecycle contract).
  - Tier-2 is not invoked for messages tier-1 already discards as `chatter`.
  - `unload()` called in a `finally` block frees model memory (lifecycle contract).

- [ ] T027 [P] [US2] Write moderation unit tests in `tests/discord/moderation.test.ts`
  **before** implementing `src/discord/moderation.ts`. Assert (FR-020):
  - `@everyone` and `@here` mass-mention patterns → `isExcludedByModeration` returns
    `true`; message excluded.
  - Known harassment keyword patterns (curated list) → excluded.
  - Doxxing patterns (street-address regex, phone-number regex) → excluded.
  - NSFW-marker conventions → excluded.
  - Excluded message count increments `RunHealth.dropped.moderation`.
  - Clean STFC tip message → `isExcludedByModeration` returns `false`; passes through.

- [ ] T028 [P] [US2] Write digest unit tests in `tests/discord/digest.test.ts`
  **before** implementing `src/discord/digest.ts`. Assert (maps to US2 Scenarios 1–3
  and digest-writer contract):
  - Same-day re-run with identical input → byte-identical output file; `mode:
    "merged-idempotent"` returned; no file write performed (Picard Condition 5 —
    digest byte-identical-on-no-change idempotency invariant).
  - Same-day re-run with new codes/tips added → merged output; `generatedAt`
    updated; `health.runIds[]` is the union; per-counter values summed.
  - Excerpts > 600 chars are truncated with `…` (FR-019).
  - Forbidden tokens NEVER appear in output: JWT-shaped strings, `DISCORD_BOT_TOKEN`
    literal, raw API response body, `STFC_ACCOUNTS` literal (FR-025, Principle VII).
  - `<!-- DIGEST_STATE_V1` state block is present, is valid minified JSON, and
    round-trips correctly (parse → re-render → byte-stable).
  - A duplicate tip (same `contentHash`) appearing in two channels → appears once
    in digest with both source locations listed (US2 Scenario 3).
  - Each digest tip entry has a `jumpLink` URL (US2 Scenario 2 — one-click access).

### Implementation for User Story 2

- [ ] T029 [P] [US2] Implement `src/discord/moderation.ts`. Export
  `isExcludedByModeration(contentNormalized: string): boolean`. Uses curated
  harassment keyword list, `@everyone`/`@here` mass-mention patterns, NSFW channel-name
  markers, doxxing regexes (street-address, phone-number). Excluded messages are
  counted in `RunHealth.dropped.moderation` and never reach the classifier (FR-020).
  Depends on T027.

- [ ] T030 [P] [US2] Implement tier-1 heuristic in `src/discord/classifier.ts` — keyword
  + regex scoring against STFC vocabulary (`tip`, `trick`, `hack`, `event`, `armada`,
  `hostile`, `ops`, `crew`, ship names from `.squad/knowledge/stfc/database.md` if
  available). Discard chatter (messages < 20 chars, greetings, single emoji, raid-pings)
  as `chatter` without invoking tier-2. Implement `Classifier` interface from
  `contracts/classifier.contract.md` (`load()`, `classify()`, `unload()`). Depends on T026.

- [ ] T031 [US2] Implement tier-2 zero-shot classifier in `src/discord/classifier.ts`.
  Load `Xenova/nli-deberta-v3-xsmall` ONNX model via `@xenova/transformers`. On
  `load()`: read `config/classifier-model.json`; probe HuggingFace cache; verify
  SHA-256 of weight file against `weightSha256` field — mismatch → `ClassifierIntegrityError`,
  fail run, delete bad file. Download on cache miss, re-verify. Labels:
  `["tip", "trick", "hack", "event-info", "patch-note", "chatter"]`. Confidence floor
  0.55; below → `unclassified`. Call `unload()` in `finally` block of skill
  orchestration (~140 MB RAM freed). No outbound network during `classify()`.
  Populate `config/classifier-model.json` with real `id`, `revision`, `weightSha256`
  values at implementation time (implementer downloads and measures at
  `~/.cache/huggingface`). Depends on T030, T026.

- [ ] T032 [US2] Implement `src/discord/digest.ts` — `writeDigest(input):
  Promise<DigestWriteResult>`. Output path: `data/digests/${YYYY-MM-DD}.md` (UTC date
  at run start). Idempotency per digest-writer contract: read existing file → parse
  `DIGEST_STATE_V1` state block → union prior state with current run → re-render →
  byte-compare → write only if different. Forbidden-content guard runs before every
  write (JWT patterns, token literals). File format per digest-writer contract §
  "File format": codes redeemed table, codes failed table, tips grouped by category
  with verbatim excerpts ≤ 600 chars + jump-links, ingestion health section, embedded
  `DIGEST_STATE_V1` JSON comment. Depends on T028.

**Checkpoint**: User Stories 1 AND 2 independently functional. Run full pipeline on
mixed fixture — digest contains tips with categories, codes with outcomes, health stats.
`npm test` must be green.

---

## Phase 5: User Story 3 — Operator Visibility & Health (Priority: P3)

**Goal**: Every run emits structured health counters to both the daily digest (§ Ingestion
Health) and the GitHub Actions Job Summary. Auth and channel errors are clearly flagged;
the redeemer pipeline is never silently blocked.

**Independent Test**: Inject a 401 auth response fixture; confirm digest health section
contains `auth_failed` flag, `exitCode: 0` is returned, and redeemer still runs against
`promo-codes.txt` and any previously-queued candidates (FR-012 / US3 Scenario 2).

### Tests for User Story 3 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in spec.md § US3 Acceptance Scenarios MUST map to a test.**

- [ ] T033 [P] [US3] Write `RunHealth` unit tests (extend `tests/skills/
  discordMonitor.test.ts`) **before** wiring health counters. Assert (US3 Scenarios
  1–2):
  - After a 401 auth failure: `RunHealth.errorsByClass["DiscordAuthError"] = 1`;
    `exitCode: 0`; redeemer still runs and its result is recorded (FR-012).
  - After a complete healthy run: all counters populated with non-negative integers —
    `channelsConfigured`, `channelsRead`, `messagesScanned`, `candidatesExtracted`,
    `candidatesSubmitted`, `candidatesSuppressedDedup`, `candidatesSuppressedCooldown`,
    `candidatesDeferredCap`, `tipsClassified.*`, `dropped.*`, `errorsByClass`.
  - `RunHealth.modelLoaded.sha256Verified` is `true` when model SHA-256 passes.
  - `channelsRead < channelsConfigured` when one channel returns 403 (US3 Scenario 1:
    "1 errored" in health section).

- [ ] T034 [P] [US3] Write Job Summary unit test (add to `tests/skills/
  discordMonitor.test.ts`) **before** implementing summary emission. Assert (FR-027):
  - A `RunHealth` block is written to `process.env.GITHUB_STEP_SUMMARY` on every
    completed run, including runs where the digest write itself fails.
  - The summary block is well-formed Markdown (no unclosed code fences, no forbidden
    tokens).

### Implementation for User Story 3

- [ ] T035 [P] [US3] Wire `RunHealth` counters through the full orchestration in
  `src/skills/discordMonitor.ts`: populate all fields of the `RunHealth` interface
  from `data-model.md` § 9 as each pipeline stage completes — ingest stage populates
  channel/message counters; extract stage populates candidatesExtracted; dedup stage
  populates suppressed/deferred; redeem stage populates submitted; classify stage
  populates tipsClassified and dropped; state write records model load metrics.
  Depends on T033, T024.

- [ ] T036 [P] [US3] Implement GitHub Actions Job Summary emission (FR-027): after
  digest write, format `RunHealth` as a Markdown summary block and write to the file
  at `process.env.GITHUB_STEP_SUMMARY` (if set; no-op if not set, for local runs).
  Emit even if the digest write throws (wrap in its own try/catch). Depends on T034.

**Checkpoint**: All three user stories independently functional and testable. `npm test`
green. Run `workflow_dispatch` on `discord-monitor.yml` to verify end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Operator documentation verification, state-files contract hardening, and
final hygiene gate validation.

- [ ] T037 [P] Validate `specs/001-discord-monitor/quickstart.md` operator walkthrough:
  trace through all steps and confirm § 8 (or equivalent operational-dependencies
  section) contains a clearly-titled advisory "Branch protection on `main` will break
  this feature" with exact remediation steps (either disable required PR review for
  `github-actions[bot]`, or enable PR-gated auto-commit mode) — Picard Condition 6.
  If the advisory is absent or incomplete, add it to `quickstart.md`.

- [ ] T038 [P] Add rerun/cursor edge-case documented behavior to
  `specs/001-discord-monitor/contracts/state-files.contract.md` under a new §
  "Rerun behavior after partial failure": a workflow rerun after partial failure (where
  `cursors.json` was not flushed) will re-extract messages between the last successful
  append and the cursor position, but `candidates.jsonl` membership dedup prevents
  re-submission to the STFC API. Behavior is bounded and intentional, not a bug —
  Picard Condition 7.

- [ ] T039 [P] Run `npm run typecheck` and `npm test` — confirm all 40 tasks'
  deliverables compile and all tests pass. Address any type errors or test failures
  before considering the feature branch ready for implementation review.

- [ ] T040 [P] Validate artifact hygiene gate end-to-end: inject a synthetic forbidden
  token (JWT-shaped string) into a test file at `data/digests/test-hygiene.md`, run
  `scripts/check-artifact-hygiene.mjs`, confirm scanner returns non-zero. Remove the
  synthetic file. Confirm scanner returns zero on a clean digest. This proves the T012
  extension is wired correctly in CI.

**Checkpoint**: All user stories functional, all tests green, operator docs complete,
hygiene gate verified. Feature branch is ready for implementation review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Governance)**: No code dependencies — open immediately. BLOCKS all later phases merging to `main`.
- **Phase 1 (Setup)**: Requires Phase 0 landed. T003, T004, T005, T006 are `[P]` — run together.
- **Phase 2 (Foundational)**: Requires Phase 1. T008, T009, T010, T012 are `[P]`; T011 depends on T009+T010.
- **Phase 3 (US1)**: Requires Phase 2. Tests T013–T016 are `[P]`; T017 depends on T016. Impl T018–T020 are `[P]`; T021 depends on T015; T022 depends on T011+T016; T023 depends on T022+T010; T024 depends on T017+T019+T020+T021+T022+T023; T025 depends on T024.
- **Phase 4 (US2)**: Requires Phase 2. Tests T026–T028 are `[P]`; T029–T030 are `[P]`; T031 depends on T030+T026; T032 depends on T028.
- **Phase 5 (US3)**: Requires Phase 3 orchestration (T024). Tests T033–T034 are `[P]`; impl T035 depends on T033+T024; T036 depends on T034.
- **Phase 6 (Polish)**: Requires all Phase 3–5 tasks complete. T037–T040 are `[P]`.

### Within Each User Story

- Tests MUST be written and FAIL before any corresponding implementation task starts (Principle IX)
- Schemas (T009) before state I/O (T010) before client (T022) before ingest (T023) before orchestration (T024)
- Every spec acceptance scenario maps to at least one test assertion

### Parallel Opportunities

```bash
# Phase 1 — run all together:
T003 (dirs+config)   T004 (npm deps)   T005 (source stubs)   T006 (test stubs)

# Phase 2 — run T008–T010, T012 together; T011 after T009+T010:
T008 (fixtures)   T009 (schemas)   T010 (state I/O)   T012 (hygiene ext.)
→ T011 (secret loader)

# Phase 3 tests — run all together:
T013 (extractor tests)   T014 (dedup tests)   T015 (seam tests)   T016 (ingest tests)

# Phase 4 tests — run all together:
T026 (classifier tests)   T027 (moderation tests)   T028 (digest tests)

# Phase 5 tests — run together:
T033 (health tests)   T034 (job summary test)

# Phase 6 — run all together:
T037 (quickstart)   T038 (contract note)   T039 (typecheck+test)   T040 (hygiene e2e)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 0: Governance (amendment landed on `main`)
2. Phase 1: Setup & Scaffolding
3. Phase 2: Foundational (CRITICAL — blocks all stories)
4. Phase 3: User Story 1 — codes extracted, redeemed, digest produced
5. **STOP and VALIDATE**: Run `npm test`, run `npm run skill:discord-monitor` with fixture
6. Merge Phase 3 to `main`, enable workflow

### Incremental Delivery

1. Phase 0+1+2 → Foundation ready
2. Phase 3 (US1) → Codes auto-redeemed → Deploy (MVP!)
3. Phase 4 (US2) → Tips digest live → Deploy
4. Phase 5 (US3) → Health surface live → Deploy
5. Phase 6 (Polish) → Operator docs complete, hygiene gate verified

---

## Notes

- `[P]` tasks touch different files and have no dependencies on each other within their phase
- `[Story]` labels map each task to a spec user story for traceability
- Tests MUST fail before implementation — `npm test` must show red before any implementation task starts
- The 3 known short-code gaps (`TNG`, `GQ5`, `GQ7`) are ACCEPTED KNOWN GAPS, not regressions — the extractor test suite (T013) must name them as expected failures, not as bugs
- `readCodesForRun` wraps `readPromoCodes(path)` + `parsePromoCodes(content)` — these two names are the actual seam exports; `loadPromoCodes` does not exist and must never appear
- Auto-commit per-run cap: 10 codes maximum (R5 — capped from the `appendToPromoCodesTxt` call, not from the redeemer call)
- Suppression cool-down: 30 days from `firstFailedAt` (FR-009 confirmed)
- Runtime allow-list MUST default to empty per FR-001 / Q3 clarification; no server or channel IDs are hard-coded in source
- 7 durable inputs (NOT 6) — the corrected count per Tuvok plan-corrections memo
- Commit after each task group with Co-authored-by trailer
