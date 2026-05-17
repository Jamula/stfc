---
description: "Task breakdown for Discord OAuth2 Bot Access for Private Channels"
---

# Tasks: Discord OAuth2 Bot Access for Private Channels

**Feature**: `003-discord-oauth` | **Branch**: `003-discord-oauth` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Issue**: #51

**Input**: Design documents from `/specs/003-discord-oauth/`
**Prerequisites**: plan.md ✓ · spec.md ✓ · research.md ✓ · data-model.md ✓ · contracts/discord-oauth.contract.md ✓ · quickstart.md ✓

**Tests**: Mandatory per Constitution Principle IX. Every behaviour change is preceded by a failing test (T1–T7 in the contract test matrix). Pre-commit hook (`scripts/pre-commit.mjs` → `npm test`) gates every commit.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently. Story IDs map to spec.md: **US1** = Monitor Members-Only Channels (P1), **US2** = Graceful Degradation on Insufficient Permissions (P2), **US3** = Bot Token Validation at Startup (P3).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)
- Each task includes the exact file path it touches

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project init needed — feature extends existing `src/discord/` subtree. Only fixture scaffolding is set up here.

- [X] T001 [P] Create sanitised fixture `tests/fixtures/discord/users-me.json` with `{ "id": "<REDACTED>", "username": "<REDACTED>", "discriminator": "0", "bot": true }` (contract §2.1)
- [X] T002 [P] Create sanitised fixture `tests/fixtures/discord/auth-401.json` with `{ "message": "401: Unauthorized", "code": 0 }` (contract §2.2)
- [X] T003 [P] Create sanitised fixture `tests/fixtures/discord/forbidden-50001.json` with `{ "message": "Missing Access", "code": 50001 }` (contract §3.2)
- [X] T004 [P] Create sanitised fixture `tests/fixtures/discord/forbidden-50013.json` with `{ "message": "Missing Permissions", "code": 50013 }` (contract §3.2)

**Checkpoint**: All four fixtures committed; no JWT/bearer-shaped strings (Principle VII). Verify with `grep -rE 'eyJ|Bot [A-Za-z0-9._-]{20,}' tests/fixtures/discord/` → must produce zero hits.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend the shared schema and error type that every user-story phase depends on. Tests-first per Principle IX — schema and error-type additions are pure-data changes whose *consumers* are tested in the per-story phases, so we extend the type surface here and write the first failing client-level test alongside it.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — US1, US2, US3 all consume `ChannelErroredEntrySchema`, `BotIdentitySchema`, and the extended `DiscordChannelAccessError`.

- [X] T005 Extend `src/discord/schemas.ts` to add `BotIdentitySchema` (zod) and export `BotIdentity` type per data-model.md §BotIdentity
- [X] T006 Extend `src/discord/schemas.ts` to add `ChannelErrorReasonSchema` (zod enum: `forbidden_guild` | `forbidden_channel` | `forbidden_other` | `not_found` | `rate_limited` | `transient` | `schema_mismatch` | `unknown`) and `ChannelErroredEntrySchema` (extends existing entry with `reason`, optional `discordErrorCode`, optional `remediation`) per data-model.md §RunHealth.channelsErrored[]
- [X] T007 Extend `DiscordChannelAccessError` in `src/discord/client.ts` to accept and expose `readonly discordErrorCode?: number` via constructor opts per contract §4.2 (no behaviour change yet — body parsing comes in US2/T015)
- [X] T008 Run `npm run typecheck` to confirm schema/error additions compile without breaking existing callers in `src/discord/ingest.ts` and `src/digest/index.ts`

**Checkpoint**: Foundation ready — type surface exists, no behavioural change yet, all existing tests still pass (`npm test`). User-story phases can now proceed in parallel.

---

## Phase 3: User Story 3 — Bot Token Validation at Startup (Priority: P3) 🎯 MVP-ENABLER

> **Ordering note**: US3 is listed first in implementation order despite being P3 because every other story's ingest flow runs *after* `getMe()` — without the validated `BotIdentity` plumbed through, US1's restricted-channel reads and US2's per-channel error reporting cannot be tested end-to-end. This matches the order in plan.md §Phase 2 step 5–6 and contract §4.1/§4.3/§4.4.

**Goal**: Validate `DISCORD_BOT_TOKEN` via `/users/@me` before any channel read; log the bot identity exactly once; fail fast on 401 with a single descriptive error (no per-channel cascade). Satisfies FR-003, FR-004, FR-012, SC-004.

**Independent Test**: Set `DISCORD_BOT_TOKEN` to an invalid value, run `npm run skill:discord-monitor`, confirm exactly one `DiscordAuthError` line is emitted and zero `getChannelMessages` calls occur (US3 AS#2; contract test T5).

### Tests for User Story 3 (REQUIRED — Principle IX) ⚠️

> Write tests FIRST. Each test must FAIL against the current code before its implementation task runs.

- [X] T009 [P] [US3] Write failing test `tests/discord/client-getme-bot-check.test.ts` asserting: `/users/@me` returning `bot: false` throws `DiscordAuthError("token is not a bot token")`; `bot: true` body returns parsed `BotIdentity`; malformed body throws `SchemaMismatchError`; token value never appears in any thrown `err.message` (contract T2)
- [X] T010 [P] [US3] Write failing test `tests/discord/ingest-bot-identity.test.ts` asserting `ingestDiscord(...)` returns `{ ..., botIdentity }` with `botIdentity.username === fixture.username`; token never echoed in stub-captured log output (contract T3, FR-012)
- [X] T011 [P] [US3] Write failing test `tests/discord/ingest-401-fastfail.test.ts` asserting: 401 on `/users/@me` → `ingestDiscord` rejects with `DiscordAuthError` AND the stub `getChannelMessages` call count is exactly 0 (contract T5, FR-004, US3 AS#2)
- [X] T012 [US3] Extend `tests/skills/discordMonitor.test.ts` with cases asserting: captured logs contain exactly one `"discord bot authenticated"` line on the success path; zero on the 401 path; existing pinned cron / concurrency-group assertions preserved (contract T7, per repo Rule 3 — workflow-pinning tests unchanged)

### Implementation for User Story 3

- [X] T013 [US3] Implement `DiscordClient.getMe(): Promise<BotIdentity>` in `src/discord/client.ts`: zod-validate response with `BotIdentitySchema`, throw `DiscordAuthError("token is not a bot token")` if `bot !== true`, preserve existing redaction wrapping on all throw paths (contract §4.1; makes T9 pass)
- [X] T014 [US3] Update `src/discord/ingest.ts` to capture the `getMe()` return value and add `botIdentity: BotIdentity` to the `IngestOutput` interface; keep the existing re-throw of `DiscordAuthError` from the per-channel `try/catch` so 401 fail-fast remains structural (contract §4.3; makes T10 and T11 pass)
- [X] T015 [US3] Update `src/skills/discordMonitor.ts` to log exactly one line `{ msg: "discord bot authenticated", botUsername, botId }` via `createLogger("discordMonitor")` after `ingestDiscord` resolves; preserve existing `{ result, exitCode }` return contract and exit-code-1-on-DiscordAuthError behaviour (contract §4.4; data-model.md §BotIdentity logging contract; makes T12 pass)

**Checkpoint**: US3 fully functional — invalid tokens fail fast with one error; valid tokens emit one identity log line. All four T9–T12 tests pass. `npm test` green.

**Phase commit** (per repo Rule 5): `feat(003-discord-oauth): Phase 3 — US3 token validation (T001–T015)`

---

## Phase 4: User Story 1 — Monitor Members-Only Channels for Gift Codes (Priority: P1) 🎯 MVP

**Goal**: With a valid bot token and a restricted channel in the allowlist, the monitor reads messages from that channel and feeds them through the existing extraction/dedup/redemption pipeline — identical code path to public channels. Satisfies FR-001, FR-002, FR-007, FR-013, SC-001, SC-002, SC-005, SC-006.

**Independent Test**: Add a role-gated test channel to `config/discord-allowlist.json`, post a known test code, run `npm run skill:discord-monitor`, confirm the code appears in `data/discord/candidates.jsonl` with `sourceChannelLabel` set (US1 AS#1, AS#3; quickstart.md §5).

### Tests for User Story 1 (REQUIRED — Principle IX) ⚠️

> No new ingestion code path is added for US1 — restricted channels traverse the existing public-channel pipeline (FR-007). Coverage is therefore a regression-guard test that proves the existing pipeline is unmodified plus the operator-facing runbook documenting the required Developer-Portal toggles.

- [ ] T016 [P] [US1] Verify by running the full suite (`npm test`) that all pre-existing public-channel tests in `tests/discord/` still pass unchanged after Phase 2/3 schema and ingest changes (SC-006: zero regression on public-channel monitoring)

### Implementation for User Story 1

- [ ] T017 [US1] Create operator runbook `docs/DISCORD-BOT-SETUP.md` covering: (1) Developer Portal bot creation, (2) **Message Content Privileged Intent toggle ON** (research §R1 — REST `content` field is empty without it), (3) Server Members Intent (if needed), (4) OAuth2 install URL template `https://discord.com/api/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=66560` (research §R3), (5) least-privilege rationale (`66560 = VIEW_CHANNEL 1024 + READ_MESSAGE_HISTORY 65536`), (6) how to rotate `DISCORD_BOT_TOKEN` via `gh secret set DISCORD_BOT_TOKEN`. No real client IDs, no real tokens (Principle VII)
- [ ] T018 [US1] Cross-link the new runbook from `specs/003-discord-oauth/quickstart.md` §1 and §2 (already references `docs/DISCORD-BOT-SETUP.md` — verify the path resolves) and from `README.md` Discord-monitor section if one exists

**Checkpoint**: US1 deliverable complete — restricted channels are now ingestable as soon as the operator follows the runbook. No code path change to ingestion (FR-007 honoured). `npm test` green; `npm run typecheck` green.

**Phase commit** (per repo Rule 5): `feat(003-discord-oauth): Phase 4 — US1 restricted channel ingestion (T016–T018)`

---

## Phase 5: User Story 2 — Graceful Degradation When Permissions Are Insufficient (Priority: P2)

**Goal**: On any 403 from a per-channel read, parse the Discord error subcode (`50001` vs `50013`) and surface a human-readable remediation in the digest health section. Run continues processing remaining channels. Satisfies FR-005, FR-006, FR-014, SC-003.

**Independent Test**: Configure allowlist with a channel the bot cannot access; run monitor; verify (a) 403 is logged with channel ID and reason, (b) other channels in the same run are still processed, (c) digest health section names the inaccessible channel with verbatim remediation text (US2 AS#1; quickstart.md §4).

### Tests for User Story 2 (REQUIRED — Principle IX) ⚠️

- [ ] T019 [P] [US2] Write failing test `tests/discord/client-403-subcodes.test.ts` asserting: 403 with body `code:50001` → caught `DiscordChannelAccessError.discordErrorCode === 50001`; same for `50013`; 403 with body missing `code` → `discordErrorCode === undefined`; token value never appears in `err.message` (contract T1, FR-012, FR-014)
- [ ] T020 [P] [US2] Write failing test `tests/discord/ingest-remediation.test.ts` asserting per-channel mapping: 403+50001 → health entry `{ reason: "forbidden_guild", discordErrorCode: 50001, remediation: <verbatim string from data-model.md table> }`; 403+50013 → `forbidden_channel`; 404 → `not_found`; 5xx → `transient`; multi-channel run continues past the failing channel and successful channels still advance their cursor (contract T4, FR-005, FR-006, US2 AS#1, AS#2)
- [ ] T021 [P] [US2] Write failing test `tests/digest/health-remediation.test.ts` asserting: rendered digest markdown for a run with one `forbidden_guild` and one `forbidden_channel` entry contains both verbatim remediation strings AND the bot username from US3 in the digest header (contract T6, FR-006, SC-003)

### Implementation for User Story 2

- [ ] T022 [US2] Update `src/discord/client.ts` 403 branch to pre-read response body via `await response.json().catch(() => undefined)`, extract numeric `code` field if present, and throw `DiscordChannelAccessError(message, { discordErrorCode: code })`; preserve `redactString` wrapping; keep `method: "GET"` literal type-enforced read-only constraint (research §R2; contract §3.2; makes T19 pass)
- [ ] T023 [US2] Update `src/discord/ingest.ts` per-channel `catch` block to map caught errors to `ChannelErroredEntrySchema`: `DiscordChannelAccessError.discordErrorCode === 50001` → `forbidden_guild`; `=== 50013` → `forbidden_channel`; other 403 → `forbidden_other`; `DiscordChannelNotFoundError` → `not_found`; `DiscordRateLimitError` → `rate_limited`; `DiscordTransientError` → `transient`; `SchemaMismatchError` → `schema_mismatch`; everything else → `unknown`. Attach verbatim `remediation` strings from data-model.md table. Continue loop; do not re-throw (except `DiscordAuthError`, which still propagates per US3) (contract §3.3–3.6, §4.3; makes T20 pass)
- [ ] T024 [US2] Update `src/digest/index.ts` health-section renderer to emit one line per `channelsErrored[]` entry in the form `- <channelId> — <reason> (Discord code <discordErrorCode>): <remediation>` (or `- <channelId> — <reason>: <remediation>` when `discordErrorCode` is absent); include `botUsername` in the digest health header per quickstart.md §4 (makes T21 pass; FR-006)

**Checkpoint**: US2 fully functional — operators see actionable per-channel remediation in every daily digest. All seven contract tests (T1–T7) now pass. `npm test` green; `npm run typecheck` green.

**Phase commit** (per repo Rule 5): `feat(003-discord-oauth): Phase 5 — US2 graceful degradation (T019–T024)`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation gates. Nothing in this phase modifies feature logic.

- [ ] T025 [P] Run `grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com' .specify/templates/*.md` per repo Rule 1; confirm no template lags constitution v1.4.0 (expected: no diff needed, since no constitution amendment for this feature)
- [ ] T026 [P] Run `grep -rE 'eyJ[A-Za-z0-9_-]+\.|Bot [A-Za-z0-9._-]{50,}' specs/003-discord-oauth/ tests/fixtures/discord/ docs/DISCORD-BOT-SETUP.md` per Principle VII Artifact Hygiene; must produce zero hits
- [ ] T027 Run `npm run typecheck` and `npm test` together; both must be green. Pre-commit hook (`scripts/pre-commit.mjs`) will re-run `npm test` on each commit per Principle IX
- [ ] T028 Execute `specs/003-discord-oauth/quickstart.md` end-to-end against a sandbox Discord server (smoke test): verify bot-identity log line, verify a restricted-channel test message lands in `data/discord/candidates.jsonl`, verify the daily digest contains the expected health-section remediation lines. Document the smoke-test result in the PR description, not in this tasks.md

**Phase commit** (per repo Rule 5): `feat(003-discord-oauth): Phase 6 — polish & validation (T025–T028)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup, fixtures)**: No dependencies — can start immediately.
- **Phase 2 (Foundational, schema)**: Depends on Phase 1 fixtures only for test compilation; BLOCKS all user-story phases (US1, US2, US3 all consume the extended schema and error type).
- **Phase 3 (US3, token validation)**: Depends on Phase 2 — must complete before Phase 4 (US1 ingest needs the `BotIdentity` plumbed) and Phase 5 (US2 health entries embed `botUsername` in the digest header).
- **Phase 4 (US1, restricted channels)**: Depends on Phase 3. May proceed in parallel with Phase 5 once Phase 3 is done; Phase 4 is doc-only so there is no file conflict with Phase 5's code edits.
- **Phase 5 (US2, graceful degradation)**: Depends on Phase 3.
- **Phase 6 (Polish)**: Depends on Phases 3–5 all complete.

### User Story Dependencies

- **US3 (P3)**: Independent — only depends on Foundational.
- **US1 (P1)**: Depends on US3 for the `botIdentity` value plumbed through `IngestOutput`. Independently testable via quickstart.md §5 smoke test once US3 lands.
- **US2 (P2)**: Depends on US3 for the digest-header `botUsername` field; depends on Foundational for `ChannelErroredEntrySchema`. Independently testable via contract T1+T4+T6.

### Within Each User Story

- Tests MUST be written and FAIL before implementation (Principle IX).
- Schema/type changes (Phase 2) before consumers (Phases 3–5).
- Client-layer changes (`src/discord/client.ts`) before ingest-layer (`src/discord/ingest.ts`) before orchestrator-layer (`src/skills/discordMonitor.ts`) before render-layer (`src/digest/index.ts`).

### Parallel Opportunities

- **Phase 1**: T001–T004 are four independent fixture files — fully parallel.
- **Phase 3 tests**: T009, T010, T011 are three independent new test files — fully parallel. T012 modifies an existing file and must run alone.
- **Phase 5 tests**: T019, T020, T021 are three independent new test files — fully parallel.
- **Phase 5 implementation**: T022 → T023 → T024 are sequential (each consumes the previous layer's output).
- **Phase 4 vs Phase 5**: Can overlap once Phase 3 is done — Phase 4 is doc-only (`docs/DISCORD-BOT-SETUP.md`), Phase 5 is code (`src/discord/`, `src/digest/`). No file conflict.
- **Phase 6**: T025, T026 are two independent grep checks — parallel. T027, T028 are sequential gates.

---

## Parallel Example: User Story 3 (test-writing burst)

```bash
# After Phase 2 completes, launch all US3 test files in parallel:
Task: "Write failing test tests/discord/client-getme-bot-check.test.ts (T009)"
Task: "Write failing test tests/discord/ingest-bot-identity.test.ts (T010)"
Task: "Write failing test tests/discord/ingest-401-fastfail.test.ts (T011)"

# Then T012 (modifies existing tests/skills/discordMonitor.test.ts) runs solo.
# Then sequential implementation: T013 → T014 → T015.
```

## Parallel Example: User Story 2 (test-writing burst)

```bash
# After Phase 3 completes, launch all US2 test files in parallel:
Task: "Write failing test tests/discord/client-403-subcodes.test.ts (T019)"
Task: "Write failing test tests/discord/ingest-remediation.test.ts (T020)"
Task: "Write failing test tests/digest/health-remediation.test.ts (T021)"

# Then sequential implementation: T022 (client) → T023 (ingest) → T024 (digest).
```

---

## Implementation Strategy

### MVP First (US3 + US1)

1. Phase 1 (fixtures) + Phase 2 (schema/error-type extension).
2. Phase 3 (US3 token validation + identity logging).
3. Phase 4 (US1 operator runbook).
4. **STOP and VALIDATE**: Operator can now follow the runbook to onboard a restricted channel; gift codes flow through the existing pipeline. This is the shippable MVP.
5. Deploy/demo.

### Incremental Delivery

1. Setup + Foundational → type surface ready.
2. US3 → invalid tokens fail fast, success path logs bot identity. Test & demo.
3. US1 → operator runbook + zero-regression on public channels. Test & demo. **MVP.**
4. US2 → digest now surfaces per-channel remediation. Test & demo.
5. Polish → artifact-hygiene and template-sync gates.

### Single-Operator Strategy (this repo's reality)

Sequential by phase, with each phase auto-committed by the implementer at the phase boundary per repo Rule 5. The user **must not** type `speckit.git.commit` between phases.

---

## Validation Checklist (run before opening PR)

- [ ] All 28 tasks above follow strict format: `- [ ] T### [P?] [Story?] Description with file path`
- [ ] Every user story (US1, US2, US3) has at least one test task that runs BEFORE its implementation task (Principle IX)
- [ ] No task references a new dependency, new env var, new data file, or new outbound destination beyond those enumerated in constitution v1.4.0 Principle V (research §R5)
- [ ] `tests/skills/discordMonitor.test.ts` modifications preserve the existing pinned cron-string and `concurrency.group: stfc-gift-redeemer` assertions (repo Rule 3)
- [ ] No `--no-verify` use anywhere — pre-commit hook (`npm test`) gates every commit (repo Project quick reference)
- [ ] Fixtures and the new runbook contain no real Discord tokens, client IDs, channel IDs, or guild IDs (Principle VII)

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps tasks to spec.md user stories for traceability (US1, US2, US3)
- Each user story is independently completable and independently testable
- Tests must fail before implementation per Principle IX
- Commit at every phase boundary per repo Rule 5; never accumulate WIP across phases
- Avoid: vague tasks, same-file conflicts in [P] groups, cross-story dependencies that break independence
