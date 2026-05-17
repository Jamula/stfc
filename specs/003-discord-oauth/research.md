# Research: Discord OAuth2 Bot Access for Private Channels

**Feature**: `003-discord-oauth` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

This document resolves every open question raised by the feature spec
before Phase 1 design begins. There were no `NEEDS CLARIFICATION`
markers in the spec; the questions below are derived from the user-level
plan request (gateway intents, gateway-vs-REST authentication, gap
analysis against the existing `src/discord/` implementation).

---

## R1 — REST vs Gateway, and the `MESSAGE_CONTENT` privileged intent

**Decision**: Stay REST-only. Do **not** introduce a Gateway / WebSocket
client. `MESSAGE_CONTENT` and `GUILD_MESSAGES` are toggled in the
Discord Developer Portal on the bot identity and require **no code
changes**.

**Rationale**:

- The existing client (`src/discord/client.ts`, shipped in PR #37) is
  a bespoke `fetch`-based REST client targeting
  `https://discord.com/api/v10`. It calls only:
  - `GET /users/@me`
  - `GET /channels/{channel.id}/messages?after=…&limit=…`
- The `Authorization` header is `Bot <token>` (correct; required for
  bot identity authentication per
  [Discord API Reference § Authentication](https://discord.com/developers/docs/reference#authentication)).
- "Gateway intents" (`GatewayIntentBits.MessageContent`,
  `GatewayIntentBits.GuildMessages`) are concepts that exist **only for
  Gateway/WebSocket consumers** (e.g. `discord.js` bots that receive
  real-time `MESSAGE_CREATE` events). They do **not appear in REST
  requests**.
- However, the **privileged `MESSAGE_CONTENT` intent toggle in the
  Developer Portal** *does* affect REST: without it, `GET /channels/{id}/messages`
  returns messages with an **empty `content` field** for messages the
  bot did not author, was not mentioned in, and that are not in a DM.
  This is documented in [Discord API — Message Content Intent](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ).
- Therefore the operator-facing setup runbook (`docs/DISCORD-BOT-SETUP.md`)
  MUST instruct the operator to flip "Message Content Intent" ON in the
  Developer Portal → Bot page. No code change.

**Alternatives considered**:

- **Switch to `@discordjs/rest`** — rejected. The bespoke client already
  meets every requirement, mirrors the `src/api/client.ts` injection seam
  used by the rest of the codebase (per the block comment at
  `src/discord/client.ts:1–14`), and avoids pulling in the larger
  `discord.js` event-emitter surface.
- **Add a Gateway client to receive real-time `MESSAGE_CREATE`** —
  rejected. The monitor runs on a cron schedule (every 4 h per
  `discord-monitor.yml`); polling REST is the right execution model for
  a stateless GitHub Actions runner and avoids long-lived WebSocket
  state.

**Citation**:
- `src/discord/client.ts:23, 230–240` (REST base URL, `Bot ` prefix)
- `src/discord/ingest.ts:72–78` (`getMe()` once per run)
- [Discord Authentication docs](https://discord.com/developers/docs/reference#authentication)
- [Message Content Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055)

---

## R2 — Distinguishing "bot not in guild" from "missing channel permission"

**Decision**: On any 403 response, read the response JSON body and
extract the integer `code` field. Map `50001 → "forbidden_guild"` and
`50013 → "forbidden_channel"`; everything else maps to `"forbidden_other"`.
Attach this onto the existing `DiscordChannelAccessError` as a
`discordErrorCode: number | undefined` property, and let `ingestDiscord`
map it into the new `RunHealth.channelsErrored[].reason` field.

**Rationale**:

- Discord returns 403 for *both* "bot is not a member of this guild at
  all" and "bot is in the guild but lacks `VIEW_CHANNEL` /
  `READ_MESSAGE_HISTORY` on this specific channel". The HTTP status is
  identical; only the JSON body `code` distinguishes them.
- The two well-known codes are:
  - `50001 Missing Access` — bot lacks access to the resource (typically
    "bot is not in the guild" or the channel is in a category the bot
    can't see).
  - `50013 Missing Permissions` — bot is in the guild but lacks a
    specific permission bit on the channel.
- This distinction directly satisfies **FR-014** ("clear, actionable
  error … distinguishing [missing guild membership] from a per-channel
  permission issue").
- Today, the client throws `DiscordChannelAccessError` with only the URL
  path; the response body is **discarded** in `requestJson` (see
  `src/discord/client.ts:160–164`). We will pre-read the body before
  throwing on 403, parse the JSON `{ code, message }` envelope, and
  attach `discordErrorCode`. The error message remains redaction-wrapped
  and still does not include the token (FR-012).

**Alternatives considered**:

- **Probe `GET /guilds/{guild.id}/members/{bot.id}` to detect missing
  membership** — rejected. Adds an extra REST request per 403 channel
  (worse against rate-limit budget), and the JSON-body subcode is already
  authoritative.
- **Treat all 403s as "permission missing"** — rejected. Fails FR-014
  and produces actively misleading remediation text ("grant the bot
  VIEW_CHANNEL on this channel") when the real problem is that the bot
  is not even invited to the server.

**Citation**:
- [Discord JSON Error Codes](https://discord.com/developers/docs/topics/opcodes-and-status-codes#json-json-error-codes)
  (canonical list including `50001`, `50013`)
- `src/discord/client.ts:140–145` (current 403 branch)
- Spec FR-014

---

## R3 — OAuth2 install URL for server admins

**Decision**: Document the install URL operators give to server admins as:

```text
https://discord.com/api/oauth2/authorize
  ?client_id=<APPLICATION_ID>
  &scope=bot
  &permissions=66560
```

where `66560` = `VIEW_CHANNEL` (1024) + `READ_MESSAGE_HISTORY` (65536).

**Rationale**:

- This is the minimum permission set required to satisfy FR-002. Any
  larger permission set (e.g. `Administrator`) would violate the
  least-privilege intent of the spec ("read-only access only", FR-009).
- The `bot` scope is sufficient — we do **not** request `applications.commands`
  (no slash commands), `messages.read` (a user-OAuth scope, not bot), or
  any write scopes.
- This URL is documentation only; the operator never embeds it in code.
  No "OAuth2 redirect URL", no client secret, and no
  authorization-code-grant flow is required for the bot-only model.

**Alternatives considered**:

- **Use the broader `View Channels + Read Message History + Read Messages/View Channels`
  with `Send Messages` excluded explicitly** — Discord's permission model
  has only the two relevant bits for our use case; nothing further is
  needed.
- **Use OAuth2 user-account flow (`identify` / `guilds.members.read`)** —
  explicitly rejected by FR-008 ("System MUST NOT require any user-account
  OAuth2 tokens — bot tokens only").

**Citation**:
- [Discord Permissions reference](https://discord.com/developers/docs/topics/permissions)
  (`VIEW_CHANNEL = 0x400`, `READ_MESSAGE_HISTORY = 0x10000`)
- [Discord OAuth2 Bot Authorization Flow](https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow)
- Spec FR-002, FR-008, FR-009

---

## R4 — 401 fail-fast contract verification

**Decision**: The fail-fast contract (FR-004) is already structurally
enforced. Add a regression test (`tests/discord/ingest-401-fastfail.test.ts`)
that asserts a 401 on `/users/@me` produces exactly one
`DiscordAuthError` throw and zero subsequent `getChannelMessages` calls.

**Rationale**:

- `ingestDiscord()` calls `client.getMe()` as **step 0**, before the
  per-channel loop (`src/discord/ingest.ts:72–78`).
- A 401 from `/users/@me` raises `DiscordAuthError` (`src/discord/client.ts:134–138`).
- The per-channel `try/catch` in `ingest.ts` **re-throws**
  `DiscordAuthError` instead of converting it to a per-channel error
  (`src/discord/ingest.ts:112–115`).
- Therefore the error propagates to `discordMonitor.ts`, which exits
  with a non-zero `exitCode`.
- All three legs of this chain exist today, but no test pins the
  contract end-to-end. Adding the regression test satisfies Principle IX
  and prevents future regressions.

**Citation**:
- `src/discord/ingest.ts:72–78, 112–115`
- `src/discord/client.ts:134–138`
- Spec FR-003, FR-004, US3 AS#2

---

## R5 — No new dependencies; no new durable inputs

**Decision**: Add zero new npm packages. Add zero new durable input
paths. No constitution amendment required.

**Rationale**:

- The error-subcode parsing in R2 uses native `Response.json()` — no
  parser library needed.
- All writes by this feature land in already-enumerated paths:
  - `data/discord/cursors.json` (existing, enumerated in v1.4.0
    Principle V)
  - `data/digests/YYYY-MM-DD.md` (existing, enumerated in v1.4.0
    Principle V)
- `DISCORD_BOT_TOKEN` is already enumerated in v1.4.0 Principle V as an
  env-only secret. No new secret name introduced.
- Operator-facing `docs/DISCORD-BOT-SETUP.md` is documentation, not a
  durable input read or written by feature code. (Per Principle V,
  enumeration applies to "durable inputs and committed artifacts" the
  application reads or writes at runtime, not to human-facing docs.)

**Alternatives considered**:

- **Persist bot identity to a new `data/discord/bot-identity.json`** —
  rejected. Identity is cheap to re-fetch (one REST call per run) and
  persisting it would introduce a new durable input requiring a
  constitution amendment for no functional gain.
- **Persist a per-channel "last-known access state"** — rejected. The
  digest already serves as the per-run health record; persisted state
  would risk going stale and producing misleading remediation text.

**Citation**:
- Constitution v1.4.0, Principle V (`DISCORD_BOT_TOKEN`,
  `data/discord/cursors.json`, `data/digests/YYYY-MM-DD.md` all
  enumerated)
- `specs/001-discord-monitor/plan.md` § Constitution Impact
