# Contract: Discord Bot Integration

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13

## Auth

- **Application type:** Discord bot application (NOT user account, NOT webhook).
- **Token name:** `DISCORD_BOT_TOKEN` (single secret).
- **Custody:** GitHub Actions encrypted secrets + local `.env`. NO other surface.
  Token MUST pass through `src/lib/redact.ts` on every error path that may surface it
  (FR-029, Principle I).
- **Scopes (bot permissions, OAuth invite URL):**
  - `READ_MESSAGE_HISTORY` (0x40)
  - `VIEW_CHANNEL` (0x400)
- **Forbidden scopes** (must NOT appear in the invite URL): `SEND_MESSAGES`,
  `MANAGE_*`, `KICK_MEMBERS`, `BAN_MEMBERS`, `ADMINISTRATOR`, `MENTION_EVERYONE`,
  any voice scope, any application-command scope.
- **Gateway intents:** none. This integration uses REST only.

## Endpoints used (Discord API v10)

| Method | Path                                                          | Purpose                                                  | Frequency                     |
|--------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------|
| GET    | `/api/v10/users/@me`                                          | Verify token validity, surface bot identity into health  | Once per workflow run         |
| GET    | `/api/v10/channels/{channel.id}/messages?after={id}&limit=100` | Page newer messages since last cursor                  | ≤ 5 pages × N channels per run |

No other endpoints. No `POST`, `PUT`, `PATCH`, `DELETE` of any kind. No
gateway connection. No application commands. No webhooks.

## Sanitized request shape

```http
GET /api/v10/channels/<channel-id-redacted>/messages?after=<snowflake-redacted>&limit=100
Authorization: Bot <REDACTED>
User-Agent: STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)
```

## Sanitized success shape (200 OK)

```json
[
  {
    "id": "<snowflake>",
    "channel_id": "<snowflake>",
    "author": { "id": "<snowflake>", "username": "<placeholder>", "bot": false },
    "content": "<message text>",
    "timestamp": "2026-05-13T00:00:00.000000+00:00",
    "edited_timestamp": null,
    "type": 0
  }
]
```

Only the fields above are read. All other response fields are ignored.
Schema validation via `zod` rejects payloads missing `id`, `channel_id`,
`content`, or `timestamp`; emits `SchemaMismatchError` consistent with
`src/api/client.ts` typed-error contract (Principle III).

## Error handling (Principle III posture)

| Status | Class                       | Action                                                                     |
|--------|-----------------------------|----------------------------------------------------------------------------|
| 200    | success                     | parse, validate, advance cursor                                            |
| 401    | `DiscordAuthError`          | log via `redactForLog`; mark run health `auth_failed`; do NOT retry; do NOT block downstream redeem orchestrator |
| 403    | `DiscordChannelAccessError` | mark channel disabled in run-health; surface in digest; continue other channels |
| 404    | `DiscordChannelNotFoundError` | same as 403                                                              |
| 429    | `DiscordRateLimitError`     | honor `Retry-After` header; bounded retry up to 3× per channel; partial completion is OK |
| 5xx    | `DiscordTransientError`     | retry once with jitter (Principle III: GET only); then mark channel errored |
| other  | `DiscordApiError`           | log redacted; mark channel errored; continue                               |

## Rate-limit budget

- Discord global limit: 50 req/sec per bot token. We expect ≤ 5 pages × 10
  channels = 50 requests per run, well below the per-second ceiling and
  trivially within the per-route bucket allowances.
- Per-channel hard cap: 5 pages (500 messages) per run. Excess deferred to
  next run.

## Outbound network scope

- `https://discord.com/api/v10/...` — added by this contract. Requires
  constitution v1.3.0 amendment (see `plan.md` § Constitution Impact).

## Out of scope

- Sending any message, reaction, or DM (matches spec § Out of scope).
- Reading private channels, voice channels, or threads in private/forum
  channels.
- Reading attachments, embeds, or images (no OCR — FR-003 / spec § Out of scope).
- Reacting to gateway events. We are pull-only on a cron.

## Source of contract (Principle VIII)

- [x] Upstream documentation: Discord developer docs,
      `https://discord.com/developers/docs/resources/channel#get-channel-messages`
      and `https://discord.com/developers/docs/topics/rate-limits`.
- [ ] Captured request/response pair: TO BE ADDED to `tests/fixtures/discord/`
      during /speckit.tasks before client code is implemented.
- [ ] Measured test against a real bot: TO BE ADDED in /tasks once a test
      bot token is provisioned.
