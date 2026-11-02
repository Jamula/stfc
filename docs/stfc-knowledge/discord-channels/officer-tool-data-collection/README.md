# STFC Officer Tool Discord — #data-collection channel

> **Status: No snapshot captured; bot access has not been verified**
>
> No content has been ingested. This file is a stub created to record the
> intent and lineage metadata. See the
> [discord-channels README](../README.md) for unblock steps.

## Lineage

| Field | Value |
| --- | --- |
| **Source URL** | <https://discord.com/channels/639255937869152267/1115978499400933473> |
| **Source name** | STFC Officer Tool Discord — `#data-collection` channel (guild `639255937869152267`, channel `1115978499400933473`) |
| **Author(s) / contributors** | Community contributors in the STFC Officer Tool Discord `#data-collection` channel (usernames not collected; no snapshot exists) |
| **Captured on** | 2026-05-31 (stub only — no content ingested) |
| **License / attribution requirements** | Mirrored from the STFC Officer Tool community Discord. Original authors retain credit. Do not modify mirrored content; refresh via re-ingestion. |
| **Refresh strategy** | `node scripts/fetch-discord-channel.mjs` from the repo root (requires `DISCORD_BOT_TOKEN` env var set to a bot token that is a member of guild `639255937869152267`). Fetches pins first (`GET /channels/1115978499400933473/pins`), then paginates history (`GET /channels/1115978499400933473/messages?limit=100&before={id}`). |

## What this channel contains (anticipated)

Based on cross-references in `docs/stfc-knowledge/community-reference-sheet/`
attribution blocks, the `#data-collection` channel of the STFC Officer Tool
Discord is where:

- Game data contributors post raw data used to populate the community
  reference sheets (Academy/Athena/Duo Waves — M90 & M91).
- JulesVern, Quasel, BlueMandalorian, and other named authors coordinate
  sheet updates and call out new game content.
- Strategy discussions and data corrections relevant to game mechanics are
  recorded as pins and high-reply-count threads.

This content is the upstream source for the Google Sheet already mirrored at
`docs/stfc-knowledge/community-reference-sheet/`. Ingesting this channel
would add the *source-of-source* lineage and any informal knowledge not yet
promoted to the sheet.

## Ingest plan (pending bot access)

Once the bot is in the guild:

1. **Fetch pins first** — these are the highest-signal, editor-curated posts:
   ```bash
   GET /channels/1115978499400933473/pins
   ```
2. **Paginate channel history** back 6–12 months, filtering for:
   - Posts with embeds (data tables, screenshots)
   - Posts with attachments
   - Posts from known authors (JulesVern, Quasel, BlueMandalorian)
   - Posts with high reaction counts
3. **Cluster by topic** — one markdown file per topic cluster, not per message.
   Chatter and off-topic messages are excluded.
4. Each per-topic file carries a full six-field `## Lineage` block with
   `Source URL` deep-linking to the most representative message(s) in the cluster.

## Files (none yet)

| # | Topic | Message anchor | File | Status |
| --- | --- | --- | --- | --- |
| — | *(none ingested)* | — | — | Blocked |

## Related

- [discord-channels/ README](../README.md) — blocker details + unblock steps
- [community-reference-sheet/](../../community-reference-sheet/README.md) — the Google Sheet mirror that credits this channel as a source
- [fetch-discord-channel.mjs](../../../../scripts/fetch-discord-channel.mjs) — ingest script (requires bot token)
- Issue [#76](https://github.com/Jamula/stfc/issues/76) — tracking issue
