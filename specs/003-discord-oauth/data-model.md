# Data Model: Discord OAuth2 Bot Access for Private Channels

**Feature**: `003-discord-oauth` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

This feature does not introduce new persisted entities. It extends one
existing in-memory entity (`RunHealth.channelsErrored[]`) and introduces
one new in-memory record (`BotIdentity`) returned by `getMe()` and
threaded through the orchestrator.

All entity references below correspond to declarations in
`src/discord/schemas.ts` unless otherwise noted.

---

## Entities

### BotIdentity (NEW; in-memory only)

**Source**: parsed response of `GET /users/@me`.
**Lifetime**: one run; never persisted.
**Schema** (zod, added to `src/discord/schemas.ts`):

```ts
export const BotIdentitySchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),         // Discord snowflake
  username: z.string().min(1).max(32),
  discriminator: z.string().default("0"),
  bot: z.literal(true),                         // MUST be true; we reject user tokens
});
export type BotIdentity = z.infer<typeof BotIdentitySchema>;
```

**Validation rules**:

- `bot === true` MUST hold. If `/users/@me` returns `bot: false` (user
  account token), `ingestDiscord` raises `DiscordAuthError("token is not
  a bot token")` — fail fast per FR-004.
- `id` MUST match Discord snowflake format (17–20 decimal digits).
- Token value is **never** stored in this record (FR-012).

**Logging contract**:

- The orchestrator (`src/skills/discordMonitor.ts`) MUST log
  `{ msg: "discord bot authenticated", botUsername: identity.username,
  botId: identity.id }` exactly once per successful run (US3 AS#1).
- The token MUST NOT appear in the log line; `createLogger("discordMonitor")`
  output passes through `redactForLog`.

---

### RunHealth.channelsErrored[] entry (EXTENDED)

**Existing shape** (`src/discord/schemas.ts:316`):

```ts
channelsErrored: Array<{ channelId: string; errorClass: string }>;
```

**New shape**:

```ts
export const ChannelErrorReasonSchema = z.enum([
  "forbidden_guild",      // 403 with Discord code 50001 → bot not in guild
  "forbidden_channel",    // 403 with Discord code 50013 → missing perm on channel
  "forbidden_other",      // 403 with another / missing Discord code
  "not_found",            // 404
  "rate_limited",         // 429 after retry cap exhausted
  "transient",            // 5xx / network
  "schema_mismatch",      // upstream returned unexpected shape
  "unknown",
]);
export type ChannelErrorReason = z.infer<typeof ChannelErrorReasonSchema>;

export const ChannelErroredEntrySchema = z.object({
  channelId: z.string(),
  errorClass: z.string(),                         // existing — JS error name
  reason: ChannelErrorReasonSchema,               // NEW
  discordErrorCode: z.number().int().optional(),  // NEW — the upstream `code` if present
  remediation: z.string().optional(),             // NEW — human-facing fix suggestion
});
```

**Backwards compatibility**: This entry is produced fresh every run
and consumed only by the in-process digest writer. It is **not**
persisted to disk (`channelsErrored` lives inside `RunHealth`, which is
serialised into the daily digest markdown as rendered text — not as
JSON). Therefore the schema extension is non-breaking for any on-disk
artifact.

**Remediation strings** (`src/discord/ingest.ts`):

| `reason` | `remediation` text |
|----------|---------------------|
| `forbidden_guild` | `"Invite the bot to the server with scope=bot and permissions=66560 (VIEW_CHANNEL + READ_MESSAGE_HISTORY). See docs/DISCORD-BOT-SETUP.md."` |
| `forbidden_channel` | `"Grant the bot VIEW_CHANNEL and READ_MESSAGE_HISTORY in this channel's permission overrides (or in a parent category)."` |
| `forbidden_other` | `"Discord returned 403 with an unrecognised error code. Re-check the bot's server-level role assignments."` |
| `not_found` | `"Channel ID does not exist or is no longer visible. Remove it from config/discord-allowlist.json if the channel was deleted."` |
| `rate_limited` | `"Rate-limited after retry budget exhausted. Reduce channel count or increase scrape interval."` |
| `transient` | `"Discord upstream transient error; safe to ignore if it does not recur next run."` |
| `schema_mismatch` | `"Upstream response shape changed. Capture the response, open an issue, and update src/discord/schemas.ts."` |
| `unknown` | `"Unclassified error; see logs."` |

---

### Discord allow-list entry (UNCHANGED)

Per **FR-013**, the existing `config/discord-allowlist.json` schema —
`{ serverId, channelId, channelLabel, enabled }` — already supports
restricted channels without modification. A channel ID is a channel ID
regardless of whether it is gated. **No schema change.**

---

## State transitions

This feature is fundamentally stateless within a run. The only
"transition" is per-channel and lives entirely inside one
`ingestDiscord()` invocation:

```text
                    getMe() → BotIdentity (logged once)
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
   For each allow-listed channel:
            │
            ├── 200 → ingest messages, advance cursor
            ├── 403 → parse JSON body → derive reason → record in
            │         channelsErrored[] with remediation; continue
            ├── 404 → record reason="not_found"; continue
            ├── 429 (post-retry-cap) → record reason="rate_limited"; continue
            └── 5xx / network → record reason="transient"; continue
            ▲
            └── 401 anywhere → re-throw DiscordAuthError (fail-fast)
```

Cursor state (`data/discord/cursors.json`) is unchanged: only channels
that successfully returned messages advance their cursor.

---

## Persistence summary

| File | Read by feature? | Written by feature? | Schema change? |
|------|------------------|---------------------|----------------|
| `config/discord-allowlist.json` | Yes (existing) | No | **No** (FR-013) |
| `data/discord/cursors.json` | Yes (existing) | Yes (existing) | No |
| `data/discord/candidates.jsonl` | No | Yes (downstream of ingest, existing) | No |
| `data/digests/YYYY-MM-DD.md` | No | Yes (existing) | **Render-only** change — new remediation lines in health section |
| `DISCORD_BOT_TOKEN` (env) | Yes (existing) | Never (FR-012) | N/A |

No file is added. No file is removed. No new sanctioned writer of
`STFC_ACCOUNTS`.
