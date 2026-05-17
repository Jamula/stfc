# Contract: Discord Bot REST Access for Restricted Channels

**Feature**: `003-discord-oauth` | **Date**: 2026-05-22

This contract freezes the external interface this feature relies on
(Discord REST + error-JSON envelope) and the internal test matrix that
proves we honour it. It is the source of truth for `/speckit.tasks`.

---

## 1. External (Discord) — REST endpoints touched

Both endpoints are **already** consumed by the v1 monitor. This feature
adds **no new endpoint**.

| Method | Path | Auth header | Used for |
|--------|------|-------------|----------|
| GET | `/users/@me` | `Authorization: Bot <REDACTED>` | Token validation; bot-identity log line (US3) |
| GET | `/channels/{channel.id}/messages` | `Authorization: Bot <REDACTED>` | Restricted-channel ingestion (US1, US2) |

**Base URL**: `https://discord.com/api/v10`
**`User-Agent`**: `STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)`
**Request timeout**: `AbortSignal.timeout(10_000)`

---

## 2. Response contract: `GET /users/@me`

### 2.1 Success — `200 OK`

```json
{
  "id": "<REDACTED>",
  "username": "<REDACTED>",
  "discriminator": "0",
  "bot": true
}
```

- `bot` **MUST** be `true`. A response with `bot: false` MUST cause
  `DiscordAuthError("token is not a bot token")` — treated identically
  to a 401 (fail-fast, abort run).

### 2.2 Failure — `401 Unauthorized`

```json
{
  "message": "401: Unauthorized",
  "code": 0
}
```

- Mapped to `DiscordAuthError`. Re-thrown by `ingestDiscord` →
  propagated by `discordMonitor` → orchestrator exits non-zero.
- **Exactly one error message** is emitted; no per-channel cascade
  (FR-004).

---

## 3. Response contract: `GET /channels/{channel.id}/messages`

### 3.1 Success — `200 OK`

Existing array-of-message shape; unchanged from v1. See
`DiscordMessageArraySchema` in `src/discord/schemas.ts`.

### 3.2 Failure — `403 Forbidden`

Discord's 403 body **always** includes a JSON envelope with a numeric
`code`:

```json
{ "message": "Missing Access",      "code": 50001 }
```

```json
{ "message": "Missing Permissions", "code": 50013 }
```

**Subcode mapping** (consumed by `src/discord/client.ts` 403 branch):

| `code` | `RunHealth.channelsErrored[].reason` | `remediation` (verbatim) |
|--------|---------------------------------------|--------------------------|
| `50001` | `"forbidden_guild"` | "Invite the bot to the server with scope=bot and permissions=66560 (VIEW_CHANNEL + READ_MESSAGE_HISTORY). See docs/DISCORD-BOT-SETUP.md." |
| `50013` | `"forbidden_channel"` | "Grant the bot VIEW_CHANNEL and READ_MESSAGE_HISTORY in this channel's permission overrides (or in a parent category)." |
| other / missing | `"forbidden_other"` | "Discord returned 403 with an unrecognised error code. Re-check the bot's server-level role assignments." |

In **all** 403 cases the run continues (FR-005, US2 AS#1/AS#2).

### 3.3 Failure — `404 Not Found`

```json
{ "message": "Unknown Channel", "code": 10003 }
```

→ `reason: "not_found"`. Run continues.

### 3.4 Failure — `429 Too Many Requests`

```json
{
  "message": "You are being rate limited.",
  "retry_after": 1.5,
  "global": false
}
```

Headers may also include `Retry-After`. Existing bounded-retry logic
(`rateLimitRetryCap` default 3) is **unchanged**. After cap exhaustion:
`reason: "rate_limited"`. Run continues.

### 3.5 Failure — `5xx` or network error

Existing one-shot retry-with-jitter (`src/discord/client.ts:201–215`)
unchanged. On failure: `reason: "transient"`. Run continues.

### 3.6 Schema mismatch

Any 200 response whose body fails `DiscordMessageArraySchema.safeParse`
→ `reason: "schema_mismatch"`. Run continues for other channels (per
existing behaviour); the schema mismatch is recorded for operator
follow-up.

---

## 4. Internal contracts

### 4.1 `DiscordClient.getMe(): Promise<BotIdentity>`

- Returns parsed `BotIdentity` (zod-validated, see
  [data-model.md](../data-model.md#botidentity-new-in-memory-only)).
- Throws `DiscordAuthError` on 401 OR on `bot !== true`.
- Throws `SchemaMismatchError` on body shape mismatch.
- Token MUST NOT appear in any thrown error message.

### 4.2 `DiscordChannelAccessError`

Extended with an optional `discordErrorCode: number` property:

```ts
export class DiscordChannelAccessError extends Error {
  override readonly name = "DiscordChannelAccessError";
  readonly discordErrorCode?: number;
  constructor(message: string, opts?: { discordErrorCode?: number }) {
    super(message);
    this.discordErrorCode = opts?.discordErrorCode;
  }
}
```

### 4.3 `ingestDiscord` output

- `health.channelsErrored[]` entries match `ChannelErroredEntrySchema`
  (see data-model.md).
- Returns the validated `BotIdentity` so the orchestrator can log the
  username (US3 AS#1).

```ts
export interface IngestOutput {
  messages: IngestedMessage[];
  newCursors: IngestionCursorMap;
  health: Partial<RunHealth>;
  botIdentity: BotIdentity;   // NEW
}
```

### 4.4 `discordMonitor` skill

- Logs exactly one line on success:
  `{ msg: "discord bot authenticated", botUsername, botId }`.
- Continues to honour the existing `{ result, exitCode }` return
  contract (Principle II).
- Exit code `1` on `DiscordAuthError`; existing `0` on success-with-per-channel-errors.

---

## 5. Test matrix (Principle IX — tests written first)

| # | File | Asserts |
|---|------|---------|
| T1 | `tests/discord/client-403-subcodes.test.ts` | 403 + body `code:50001` → `DiscordChannelAccessError.discordErrorCode === 50001`. Same for `50013`. Same for body without `code` → `discordErrorCode === undefined`. Token never appears in `err.message`. |
| T2 | `tests/discord/client-getme-bot-check.test.ts` | `/users/@me` returning `bot: false` throws `DiscordAuthError`. `bot: true` returns `BotIdentity`. Schema mismatch throws `SchemaMismatchError`. |
| T3 | `tests/discord/ingest-bot-identity.test.ts` | `ingestDiscord(...)` returns `botIdentity.username === fixture.username`. Token never echoed in stub-captured log output. |
| T4 | `tests/discord/ingest-remediation.test.ts` | Per-channel 403 with `50001` → health entry `{ reason: "forbidden_guild", discordErrorCode: 50001, remediation: <matches doc string> }`. Same for `50013` → `"forbidden_channel"`. 404 → `"not_found"`. 5xx → `"transient"`. |
| T5 | `tests/discord/ingest-401-fastfail.test.ts` | 401 on `/users/@me` → `ingestDiscord` rejects with `DiscordAuthError` AND `getChannelMessages` is **never called** (stub call count assertion). |
| T6 | `tests/digest/health-remediation.test.ts` | Digest markdown for a run with one `forbidden_guild` and one `forbidden_channel` contains both remediation strings verbatim and the bot username in the digest header. |
| T7 | `tests/skills/discordMonitor.test.ts` (extend) | Captured logs include exactly one `"discord bot authenticated"` line on the success path; zero on the 401 path. Pinned exit codes preserved. |

All tests use stubbed `fetchImpl` and fixtures under
`tests/fixtures/discord/`. No live Discord traffic.

---

## 6. Sources

- [Discord API Reference — Authentication](https://discord.com/developers/docs/reference#authentication)
- [Discord API Reference — Get Current User](https://discord.com/developers/docs/resources/user#get-current-user)
- [Discord API Reference — Get Channel Messages](https://discord.com/developers/docs/resources/message#get-channel-messages)
- [Discord JSON Error Codes](https://discord.com/developers/docs/topics/opcodes-and-status-codes#json-json-error-codes)
- [Discord Permissions](https://discord.com/developers/docs/topics/permissions)
- [Discord OAuth2 Bot Authorization Flow](https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow)
- [Message Content Privileged Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055)
- In-repo: `src/discord/client.ts`, `src/discord/ingest.ts`,
  `src/discord/schemas.ts`, `specs/001-discord-monitor/plan.md`,
  `.specify/memory/constitution.md` (v1.4.0)
