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
| **License / attribution requirements** | Redistribution permission has not been established; no content is mirrored here. Bot access and attribution do not establish reuse permission. |
| **Refresh strategy** | Maintain source links only unless reuse terms are verified and capture is separately authorized. Historical capture tooling: `node scripts/fetch-discord-channel.mjs` (requires bot membership/access and `DISCORD_BOT_TOKEN`). |

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

The previous sheet provenance credits this community; it does not independently
verify the channel's contents or establish redistribution permission.
The sheet is now [source links only](../../community-reference-sheet/README.md),
not a local mirror.

## Historical ingest plan (pending reuse verification, authorization, and bot access)

Only if capture is separately authorized, reuse terms are verified, and the
bot has access:

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
- [community-reference-sheet/](../../community-reference-sheet/README.md) — original Google Sheet links and previously recorded community attribution
- [fetch-discord-channel.mjs](../../../../scripts/fetch-discord-channel.mjs) — ingest script (requires bot token)
- Issue [#76](https://github.com/Jamula/stfc/issues/76) — tracking issue
