# Skill: Verify Discord Bot Guild Access

**Owner:** Uhura (Integrations Dev) — codified from issue #76 (2026-05-31)
**Status:** Active

## When to use

Use this skill whenever you need to check whether the project's Discord bot
has access to a specific guild or channel before attempting any ingestion,
monitoring setup, or API call.

## Prerequisites

- `DISCORD_BOT_TOKEN` must be available in the environment. In Codespace/CI
  this is a GitHub Actions encrypted secret — **it is never available locally
  by default**. If it isn't set, treat guild membership as unknown and report
  the blocker (do not attempt to infer membership from other sources).

## Verification steps

### 1. Check token is present

```bash
if [ -z "$DISCORD_BOT_TOKEN" ]; then
  echo "BLOCKER: DISCORD_BOT_TOKEN not set. Cannot verify guild access locally."
  echo "The token is a GitHub Actions encrypted secret (DISCORD_BOT_TOKEN)."
  exit 1
fi
```

### 2. Probe guild membership

```bash
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/{GUILD_ID}" | jq '{id, name, owner_id}'
```

| HTTP status | Meaning |
| --- | --- |
| `200` | Bot is a member of the guild |
| `403` | Bot is NOT a member (or lacks `GUILD_MEMBERS` intent — less common) |
| `404` | Guild does not exist |
| `401` | Token is invalid or expired |

### 3. Probe channel access (if guild check passes)

```bash
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/channels/{CHANNEL_ID}" | jq '{id, name, type}'
```

| HTTP status | Meaning |
| --- | --- |
| `200` | Bot can see the channel |
| `403` | Bot is in the guild but lacks `VIEW_CHANNEL` on this channel |
| `404` | Channel does not exist (or bot can't see it — same to the API) |

## If access is blocked

1. **Do NOT attempt** to use a user token, personal OAuth, or browser scraping.
   Discord ToS §9 prohibits user-token automation. See the tracked, durable
   `.squad/decisions-archive.md` (2026-05-18 verdict, "User-token automation —
   rejected per Discord ToS + Constitution Principle V") for the permanent record.
   Uhura's `history-archive.md` is backend-owned runtime state (gitignored, not
   tracked) and must not be cited as the durable source.

2. **Obtain bot invite URL:**
   ```
   https://discord.com/api/oauth2/authorize?client_id={CLIENT_ID}&scope=bot&permissions=66560
   ```
   Permission bitmask `66560` = `VIEW_CHANNEL` (1024) + `READ_MESSAGE_HISTORY` (65536).
   `{CLIENT_ID}` is visible at <https://discord.com/developers/applications>.

3. **Contact a guild admin** — see `.squad/agents/uhura/outreach/stfc-discord-bot-request.md`
   for a ready-to-send DM draft.

4. **Document the blocker** in the PR body and in the relevant
   `docs/stfc-knowledge/discord-channels/` stub.

## Key facts

- The project uses **REST polling only** — no WebSocket gateway, no Message
  Content Intent for the ingest path. This is a selling point when contacting
  admins (low surface area).
- Permission bitmask `66560` is the project canonical for read-only monitoring.
  Documented in `docs/DISCORD-BOT-SETUP.md`.
- The bot's User-Agent string is `STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)` —
  admins who check their logs can trace it back to the repo immediately.

## Related

- `.squad/agents/uhura/outreach/stfc-discord-bot-request.md` — outreach package
- `docs/DISCORD-BOT-SETUP.md` — permission scope justification table
- `src/discord/client.ts` — REST client implementation
- `scripts/fetch-discord-channel.mjs` — channel ingest script
