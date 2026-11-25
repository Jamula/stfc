# STFC Knowledge — Discord Channels

Reference snapshots ingested from Discord channels in the STFC community servers.
Each channel that has been ingested (or attempted) lives in its own sub-directory
following the naming convention `{guild-slug}-{channel-slug}/`.

No channel content is currently ingested. The procedures below are historical
access guidance, not authorization to collect or redistribute content.
Verify reuse terms and obtain applicable authorization before any capture;
bot membership and attribution alone are insufficient (see [#402](https://github.com/Jamula/stfc/issues/402)).

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
| **License / attribution requirements** | Verified reuse terms and evidence, or `Redistribution permission not established; source link only`. |
| **Refresh strategy** | Maintain source links only unless reuse terms are verified and capture is separately authorized (the former unused `scripts/fetch-discord-channel.mjs` helper was removed). |

## What's here today

| Sub-directory | Guild | Channel | Status |
| --- | --- | --- | --- |
| [`officer-tool-data-collection/`](./officer-tool-data-collection/README.md) | STFC Officer Tool (`639255937869152267`) | `#data-collection` (`1115978499400933473`) | No content ingested; bot membership/access not verified |

## Current status — guild `639255937869152267`

**Last recorded check (2026-05-31):**

The bot token (`DISCORD_BOT_TOKEN`) is stored as a GitHub Actions secret and
was not available in the local development environment. The two API probes
below were documented but not executed, so this repository does not establish
whether the bot is currently a member of the guild or can read the channel.

```bash
# Guild membership check
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/guilds/639255937869152267" | jq .

# Channel access check
curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
  "https://discord.com/api/v10/channels/1115978499400933473" | jq .
```

Both probes require the token in the caller's environment. The lineage stub
exists, the former unused fetcher script was removed, and **no content has been
ingested**.

**Historical context (from `src/discord/` discovery, 2026-05-18):**

The bot was originally deployed to monitor a *different* guild's channels.
Membership in the STFC Officer Tool Discord has not been verified from this
repository.

**What's needed to unblock:**

1. If the bot is not already a member, a **guild admin** of
   `639255937869152267` must invite it using:
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

4. Only after verified reuse terms and applicable authorization, author a
   dedicated authorized capture script under `scripts/` (per the parent
   `docs/stfc-knowledge/README.md` lineage convention; the former unused
   `scripts/fetch-discord-channel.mjs` helper was removed).

**Who to ask:** A maintainer or moderator of the STFC Officer Tool Discord.

## Refresh procedure (only after access, reuse verification, and authorization)

Maintain source links only until reuse terms are verified and capture is
separately authorized. Any future authorized capture script must paginate
through pinned messages first (highest signal), then recent channel history,
writing one markdown file per high-signal post cluster under
`docs/stfc-knowledge/discord-channels/officer-tool-data-collection/` with the
six-field `## Lineage` block.
