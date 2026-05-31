# STFC Knowledge — Discord Channels

Reference snapshots ingested from Discord channels in the STFC community servers.
Each channel that has been ingested (or attempted) lives in its own sub-directory
following the naming convention `{guild-slug}-{channel-slug}/`.

## Access model

All channel reads use the project's Discord bot (`DISCORD_BOT_TOKEN`, a GitHub
Actions encrypted secret). The bot uses Discord's REST API — **no WebSocket
gateway, no user-token automation** (both are prohibited by Discord ToS §9 and
by this project's constitution). The only sanctioned path is:

- Bot account invited to the guild by a guild admin with `VIEW_CHANNEL` +
  `READ_MESSAGE_HISTORY` at the channel level.
- Ingest script calls `GET /channels/{id}/messages` (paginated) and
  `GET /channels/{id}/pins`.

## Lineage convention — every snapshot must declare it

Same six-field block used across `docs/stfc-knowledge/`. See the
[parent README](../README.md#lineage-convention--every-ingested-artifact-must-declare-it).

For Discord channels the fields map as follows:

| Field | Discord mapping |
| --- | --- |
| **Source URL** | `https://discord.com/channels/{guild}/{channel}/{messageId}` — deep-link to the specific message. Use the channel URL `https://discord.com/channels/{guild}/{channel}` as a fallback for the index README. |
| **Source name** | `{Guild name} Discord — #{channel-name} channel` |
| **Author(s) / contributors** | Discord username (stable handle, not display name). List all contributors quoted in the artifact. |
| **Captured on** | ISO date (YYYY-MM-DD) the snapshot was taken. Refreshes update this. |
| **License / attribution requirements** | `Mirrored from the {Guild name} community Discord. Original authors retain credit. Do not modify mirrored content; refresh via re-ingestion.` |
| **Refresh strategy** | `node scripts/fetch-discord-channel.mjs` (requires `DISCORD_BOT_TOKEN` in env); re-fetches pins + recent messages and rewrites the snapshot files. |

## What's here today

| Sub-directory | Guild | Channel | Status |
| --- | --- | --- | --- |
| [`officer-tool-data-collection/`](./officer-tool-data-collection/README.md) | STFC Officer Tool (`639255937869152267`) | `#data-collection` (`1115978499400933473`) | ⚠️ **Blocked — bot not in guild** (see below) |

## ⚠️ Current blocker — guild `639255937869152267`

**What was attempted (2026-05-31):**

The bot token (`DISCORD_BOT_TOKEN`) is stored exclusively as a GitHub Actions
encrypted secret. It is not present in the local development environment. Two
API probes were staged but could not be executed without the token:

```bash
# Guild membership check
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/639255937869152267" | jq .

# Channel access check
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/channels/1115978499400933473" | jq .
```

Both probes require the token in the caller's environment. The ingest was
staged (fetcher script written, directory structure created, lineage stubs
placed) but **no content has been ingested** because guild access cannot be
confirmed.

**Historical context (from `src/discord/` discovery, 2026-05-18):**

The bot was originally deployed to monitor a *different* guild's channels. The
STFC Officer Tool Discord (guild `639255937869152267`) has not been explicitly
targeted before. Guild membership is unknown but likely absent.

**What's needed to unblock:**

1. **A guild admin** of `639255937869152267` must invite the bot using:
   ```
   https://discord.com/api/oauth2/authorize?client_id={CLIENT_ID}&scope=bot&permissions=66560
   ```
   Replace `{CLIENT_ID}` with the Discord application's client ID (visible at
   <https://discord.com/developers/applications>). The permission bitmask `66560`
   grants `VIEW_CHANNEL` (1024) + `READ_MESSAGE_HISTORY` (65536) only — no write,
   no admin.

2. The guild to join: **STFC Officer Tool Discord** at <https://discord.gg/BRhru6Vcnj>
   (invite from `docs/stfc-knowledge/community-reference-sheet/` attribution block).

3. Once the bot is a guild member, verify access:
   ```bash
   curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
     "https://discord.com/api/v10/channels/1115978499400933473" | jq .id
   # Expect: "1115978499400933473"
   ```

4. Then run `node scripts/fetch-discord-channel.mjs` from the repo root.

**Who to ask:** A maintainer or moderator of the STFC Officer Tool Discord.
See the outreach package at `.squad/agents/uhura/outreach/stfc-discord-bot-request.md`
for a ready-to-send DM draft and a technical scope summary suitable for admins.

## Refresh procedure (once unblocked)

```bash
export DISCORD_BOT_TOKEN="<your-bot-token>"
node scripts/fetch-discord-channel.mjs
```

The script paginates through pinned messages first (highest signal), then recent
channel history, writing one markdown file per high-signal post cluster under
`docs/stfc-knowledge/discord-channels/officer-tool-data-collection/`.
