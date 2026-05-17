# Implementation Plan: Discord OAuth2 Bot Access for Private Channels

**Branch**: `003-discord-oauth` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-discord-oauth/spec.md`
**Issue**: #51

## Summary

Extend the existing read-only Discord monitor (`src/discord/`, `src/skills/discordMonitor.ts`,
shipped in PR #37 under `specs/001-discord-monitor/`) so the monitor can ingest messages
from members-only / role-gated channels using the **already-provisioned**
`DISCORD_BOT_TOKEN` (enumerated in constitution v1.4.0 Principle V).

This is a **behaviour-and-diagnostics** feature, not a credential-mechanism feature:

1. **No new auth mechanism.** The current client (`src/discord/client.ts`) already sends
   `Authorization: Bot <token>` to `https://discord.com/api/v10` and already calls
   `GET /users/@me` once per run via `ingestDiscord(...)`. Per-channel reads already work
   for any channel the bot's effective Discord permissions grant access to — restricted
   channels included.
2. **No Gateway / no intents in code.** The existing implementation is **REST-only** —
   no `discord.js` Gateway client, no WebSocket, no `GatewayIntentBits`. Therefore
   `MESSAGE_CONTENT` and `GUILD_MESSAGES` are **not** code-level toggles for this
   project; they are **Developer-Portal toggles on the bot identity** that the operator
   sets once. The spec implicitly recognises this (it lists only REST endpoints in the
   API Contract). See [research § R1](./research.md#r1-rest-vs-gateway-and-the-message_content-privileged-intent).
3. **No new secrets.** `DISCORD_BOT_TOKEN` is already env-only, already redaction-routed,
   already enumerated in Principle V. No constitution amendment required.
4. **Gaps to close** (see [research § R2–R5](./research.md)): (a) log the validated bot
   identity at startup (US3 AS#1); (b) distinguish per-channel 403 from
   bot-not-in-guild 403 by parsing the Discord error subcode (`50001` vs `50013`,
   FR-014); (c) extend the existing `RunHealth.channelsErrored` shape with a
   human-readable `remediation` string and surface it in the digest health section
   (FR-006); (d) operator documentation for the Developer-Portal toggles and the
   OAuth2 install URL the operator pastes into a server admin's browser.

The change touches `src/discord/client.ts` (error-subcode extraction),
`src/discord/ingest.ts` (capture bot username, attach remediation), `src/discord/schemas.ts`
(extend `RunHealth` error entry), `src/digest/index.ts` (render remediation), and adds
`docs/DISCORD-BOT-SETUP.md`. No new dependencies. No new workflow files. No new
durable inputs (existing `data/discord/`, `data/digests/` paths cover all writes).

## Technical Context

**Language/Version**: TypeScript 5.7 on Node ≥ 24, executed via `tsx` (unchanged).

**Primary Dependencies**: None new. Existing `zod` ^3.25 schemas are extended;
the bespoke fetch-based `DiscordClient` in `src/discord/client.ts` is extended —
we deliberately do **not** introduce `@discordjs/rest` here because the current
client already meets all needs and matches the project's `src/api/client.ts` injection
seam (per `src/discord/client.ts:1–14` block comment).

**Storage**: No new files. Writes continue to land in the already-enumerated
`data/discord/cursors.json`, `data/digests/YYYY-MM-DD.md`, etc.

**Testing**: Node built-in runner via `npm test`. New tests under
`tests/discord/client-403-subcodes.test.ts`, `tests/discord/ingest-bot-identity.test.ts`,
`tests/discord/ingest-remediation.test.ts`, `tests/digest/health-remediation.test.ts`.
All Discord traffic stubbed via fixtures under `tests/fixtures/discord/`
(`forbidden-50001.json`, `forbidden-50013.json`, `users-me.json`, `auth-401.json`).
Pre-commit hook (`npm test`) gates the work end-to-end (per Principle IX).

**Target Platform**: GitHub Actions `ubuntu-latest`, Node 24 (unchanged).

**Project Type**: cli (single TypeScript Node project; this feature stays within
the existing `tsconfig.json` include set).

**Performance Goals**: Identical to the v1 monitor — ≤ 50 REST requests/run,
≤ 5 min wall-clock. No new API calls beyond the existing `/users/@me` + paged
`/channels/{id}/messages`.

**Constraints**:
- Strictly read-only (FR-009): no `POST`/`PUT`/`PATCH`/`DELETE` to Discord. The
  existing client only declares a `method: "GET"` literal in `requestJson` — this
  constraint is enforced by the type (`private async requestJson(method: "GET", ...)`).
- `DISCORD_BOT_TOKEN` MUST never appear in any log, error, or telemetry artifact
  (FR-012; existing `redactString` wrapping on every throw path is preserved).
- No raw message archival (FR-010); existing `IngestedMessage` schema already
  strips to `contentNormalized` plus metadata — this feature does not relax that.
- 403 handling continues per-channel; only 401 is fail-fast (FR-004, FR-005).
- Channel content stays on-runner (Constitution Principle IV / Stateless): no
  remote LLM, no third-party text API touches restricted-channel content.

**Scale/Scope**: Same as v1 (≤ 10 channels, ≤ 5,000 msgs/run).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | User Safety & Trust First (NON-NEGOTIABLE) | PASS | No new credentials. Every new error path routes through `redactString` (`src/lib/redact.ts`); bot username (already public on the Discord API) is the only identity datum logged — token itself is never echoed (FR-012). |
| II | Skill-Isolated CLI Architecture | PASS | All changes stay behind the existing `discord-monitor` skill registered in `src/cli.ts:23,41`; no new skill, no new `npm run skill:*` script. `discordMonitor.ts` continues to return `{ result, exitCode }`. |
| III | Resilient Upstream-API Automation | PASS (Discord-scoped) | Principle III text targets the STFC store API; the Discord client follows the same posture by analogy: typed errors (`DiscordAuthError`, `DiscordChannelAccessError`, `DiscordChannelNotFoundError`, `DiscordRateLimitError`, `DiscordTransientError`, `SchemaMismatchError`), zod-validated responses, `AbortSignal` timeout, bounded 429/5xx retry — all already in place. This feature adds error-subcode parsing inside the existing 403 branch; no new retry behaviour. |
| IV | Type-Safe Headless TypeScript CLI | PASS | All edits land in files already inside `tsconfig.json`'s include set (`src/discord/**`, `src/digest/**`). `npm run typecheck` must stay green. No UI/extension surface introduced. |
| V | Stateless Operation & Secret Custody | PASS | `DISCORD_BOT_TOKEN` is already enumerated in v1.4.0. No new secret. No new durable input — writes go to the existing enumerated paths (`data/discord/cursors.json`, `data/digests/YYYY-MM-DD.md`). No new sanctioned writer of `STFC_ACCOUNTS`. No constitution amendment required. |
| VI | Specification-First Governance | PASS | Issue #51 → spec (`specs/003-discord-oauth/spec.md`) → this plan, in order. Speckit trigger threshold met. |
| VII | Artifact Hygiene | PASS | Spec/plan/tasks contain no JWT-shaped strings, no real channel/guild IDs, no captured tokens. Fixtures under `tests/fixtures/discord/` use the `<REDACTED>` placeholder used by the v1 monitor's existing fixtures. |
| VIII | Wire-First Discovery | PASS | The 403-subcode behaviour is grounded in [Discord API Reference — JSON Error Codes](https://discord.com/developers/docs/topics/opcodes-and-status-codes#json-json-error-codes) (codes `50001 Missing Access`, `50013 Missing Permissions`). Captured-shape fixtures committed under `tests/fixtures/discord/forbidden-*.json` (sanitised). |
| IX | Test-First Discipline (NON-NEGOTIABLE) | PASS | Every behavioural change is preceded by a failing test (see [contracts/discord-oauth.contract.md](./contracts/discord-oauth.contract.md) test matrix). Pre-commit `npm test` enforces. |
| — | Artifact Hygiene Check (CI gate) | PASS | No bearer-token-shaped strings in spec/plan/contracts. |

**Re-evaluation after Phase 1 design**: PASS — no new violations introduced.
Phase 1 added only `docs/DISCORD-BOT-SETUP.md` (operator runbook) and the
schema extension to `RunHealth.channelsErrored`, neither of which crosses any
principle gate.

## Project Structure

### Documentation (this feature)

```text
specs/003-discord-oauth/
├── plan.md                        # This file
├── spec.md                        # Feature specification (input)
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/
│   └── discord-oauth.contract.md  # Phase 1 output — REST/error-subcode contract
├── checklists/                    # Pre-existing
└── tasks.md                       # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

This feature modifies files already present in the repo. The "Source Code"
view below shows the existing single-project TypeScript CLI layout and marks
the files this feature touches:

```text
src/
├── cli.ts                          # unchanged — `discord-monitor` skill already registered
├── discord/
│   ├── client.ts                   # MODIFY — parse Discord error JSON, extract subcode (50001/50013) on 403
│   ├── ingest.ts                   # MODIFY — capture `getMe()` result, log bot username, populate health remediation
│   ├── schemas.ts                  # MODIFY — extend RunHealth.channelsErrored entry with { reason, remediation? }
│   ├── classifier.ts               # unchanged
│   ├── extractor.ts                # unchanged
│   ├── dedup.ts                    # unchanged
│   ├── moderation.ts               # unchanged
│   ├── state.ts                    # unchanged
│   ├── cooldown.ts                 # unchanged
│   └── stoplist.ts                 # unchanged
├── digest/
│   └── index.ts                    # MODIFY — render new remediation text in health section
├── skills/
│   └── discordMonitor.ts           # MODIFY (small) — propagate bot-identity log line at orchestrator level
└── lib/
    └── redact.ts                   # unchanged — already wraps all Discord error throws

tests/
├── discord/
│   ├── client-403-subcodes.test.ts        # NEW — 50001 vs 50013 mapping
│   ├── ingest-bot-identity.test.ts        # NEW — username logged, token never echoed
│   ├── ingest-remediation.test.ts         # NEW — per-channel remediation populated
│   └── ingest-401-fastfail.test.ts        # NEW — single error, no per-channel cascade (FR-004)
├── digest/
│   └── health-remediation.test.ts         # NEW — digest renders remediation text
├── skills/
│   └── discordMonitor.test.ts             # MODIFY — assert bot-identity log line on success path
└── fixtures/discord/
    ├── users-me.json                       # NEW — sanitised /users/@me success body
    ├── auth-401.json                       # NEW — sanitised 401 body
    ├── forbidden-50001.json                # NEW — Missing Access (bot not in guild)
    └── forbidden-50013.json                # NEW — Missing Permissions (channel-level)

docs/
└── DISCORD-BOT-SETUP.md            # NEW — operator runbook: portal config, OAuth2 install URL, privileged intents

config/
└── discord-allowlist.json          # unchanged schema — restricted channels add no new fields (FR-013)

.specify/memory/
└── constitution.md                 # unchanged — v1.4.0 already covers DISCORD_BOT_TOKEN

.github/
└── workflows/                      # unchanged — `discord-monitor.yml` cron, env, concurrency all unchanged
```

**Structure Decision**: Single-project TypeScript CLI (Option 1 from the
template). Layout matches the constitutional baseline in Principle IV.
This feature is a localised extension of the `src/discord/` and `src/digest/`
subtrees — no new top-level directories.

## Phase 0 — Research

See [research.md](./research.md). Headline findings:

- **R1** REST-only client means MESSAGE_CONTENT/GUILD_MESSAGES are
  Developer-Portal toggles, not code changes.
- **R2** Discord error JSON carries a stable numeric `code` field —
  `50001` distinguishes "bot not in guild" from `50013` "missing channel
  permission" (FR-014).
- **R3** Recommended bot OAuth2 install URL uses scope `bot` + permission
  integer **66560** (`VIEW_CHANNEL` 1024 + `READ_MESSAGE_HISTORY` 65536).
- **R4** 401 fail-fast is already structurally enforced by
  `ingestDiscord()` calling `getMe()` first and re-throwing
  `DiscordAuthError`; we only need to verify the orchestrator exit path.
- **R5** No new dependency required — bespoke fetch client is sufficient
  and matches `src/api/client.ts` test-injection convention.

All `NEEDS CLARIFICATION` markers resolved (there were none in the spec —
the spec is already clarified).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — extends `RunHealth.channelsErrored`
  entry shape and adds the `BotIdentity` record.
- [contracts/discord-oauth.contract.md](./contracts/discord-oauth.contract.md) —
  freezes the REST + error-subcode contract this feature relies on, plus
  the full test matrix.
- [quickstart.md](./quickstart.md) — operator-facing 5-minute walkthrough
  for adding a restricted channel to the allowlist.

**Agent-context update**: `.github/copilot-instructions.md` reference between
`<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` is updated to point at
`specs/003-discord-oauth/plan.md` (this file). Done as part of Phase 1.

## Phase 2 — Planning approach (for `/speckit.tasks`)

Tasks will be ordered:

1. Add fixtures under `tests/fixtures/discord/` (`users-me.json`, `auth-401.json`,
   `forbidden-50001.json`, `forbidden-50013.json`).
2. Write failing tests (`tests/discord/client-403-subcodes.test.ts` first;
   ingest tests next; digest test last).
3. Extend `src/discord/schemas.ts` (`RunHealth.channelsErrored` entry adds
   `reason: "forbidden_guild" | "forbidden_channel" | "not_found" | "rate_limited" | "transient" | "schema_mismatch"` and optional `remediation`).
4. Update `src/discord/client.ts` to read the response body on 403 and
   throw `DiscordChannelAccessError` with a `discordErrorCode` property
   (50001/50013/other) attached — preserving redaction.
5. Update `src/discord/ingest.ts` to (a) capture `getMe()` return value
   and pass through to the orchestrator and (b) map caught Discord errors
   to the new health entry shape with remediation strings.
6. Update `src/skills/discordMonitor.ts` to log the bot username via
   `createLogger("discordMonitor")` on success.
7. Update `src/digest/index.ts` to render remediation in the health section.
8. Create `docs/DISCORD-BOT-SETUP.md`.
9. Re-run `npm test`, `npm run typecheck`. Pre-commit hook gates.

(`tasks.md` itself is produced by `/speckit.tasks`, not by `/speckit.plan`.)

## Complexity Tracking

No constitutional violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Stop & report

- **Branch**: `003-discord-oauth`
- **Plan**: `specs/003-discord-oauth/plan.md`
- **Artifacts generated this run**:
  - `specs/003-discord-oauth/plan.md`
  - `specs/003-discord-oauth/research.md`
  - `specs/003-discord-oauth/data-model.md`
  - `specs/003-discord-oauth/quickstart.md`
  - `specs/003-discord-oauth/contracts/discord-oauth.contract.md`
- **Agent context updated**: `.github/copilot-instructions.md` SPECKIT
  marker block now references this plan.

Next: run `/speckit.tasks` to materialise `tasks.md`.
