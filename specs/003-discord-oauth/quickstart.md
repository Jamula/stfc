# Quickstart: Onboard a restricted Discord channel

**Audience**: operator (`cyrusj`) adding a new members-only or role-gated
STFC channel to the monitor's allowlist.
**Time to complete**: ~5 minutes once the bot is created.

This walkthrough assumes the v1 Discord monitor (PR #37,
`specs/001-discord-monitor/`) is already deployed and the
`DISCORD_BOT_TOKEN` secret is already set on the repository. If not,
start with `docs/DISCORD-BOT-SETUP.md` (created by this feature) for the
one-time bot-creation steps.

---

## 1. Verify the bot identity (sanity check)

```bash
export DISCORD_BOT_TOKEN="…"   # same value as the GitHub Actions secret
npm run skill:discord-monitor
```

Expected log line on a healthy run:

```text
[discordMonitor] discord bot authenticated  botUsername=<your-bot-name>  botId=<snowflake>
```

If you instead see `DiscordAuthError`, the token is invalid or the
account is not a bot account — go to Discord Developer Portal → Bot →
Reset Token and update the secret with `gh secret set DISCORD_BOT_TOKEN`.

---

## 2. Invite the bot to the target server

Send the server admin this URL (also documented in
`docs/DISCORD-BOT-SETUP.md`):

```text
https://discord.com/api/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=66560
```

`66560 = VIEW_CHANNEL (1024) + READ_MESSAGE_HISTORY (65536)` — minimum
permissions to satisfy FR-002. The bot will appear in the server's
member list once the admin accepts.

If the channel is role-gated, the admin must additionally assign the bot
a role that grants `View Channel` and `Read Message History` on the
target channel (or override the bot specifically in the channel's
permission settings).

---

## 3. Add the channel to the allowlist

Edit `config/discord-allowlist.json` and append a new entry. **No schema
change is needed for restricted channels** (FR-013) — they look identical
to public-channel entries:

```json
{
  "entries": [
    {
      "serverId": "111111111111111111",
      "channelId": "222222222222222222",
      "channelLabel": "stfc-members-only-codes",
      "enabled": true
    }
  ]
}
```

Commit and push. The next scheduled run (every 4 hours per
`discord-monitor.yml`) will pick up the new entry.

---

## 4. Verify ingestion

On the next run, check the daily digest at
`data/digests/<today>.md`. The **Health** section now includes a
remediation line per inaccessible channel. The shapes you may see:

- **Healthy**:
  ```text
  channelsRead: 3
  channelsErrored: []
  ```
- **Bot not in the server**:
  ```text
  - 222222222222222222 — forbidden_guild (Discord code 50001):
      Invite the bot to the server with scope=bot and permissions=66560…
  ```
- **Bot in server but lacks channel perms**:
  ```text
  - 222222222222222222 — forbidden_channel (Discord code 50013):
      Grant the bot VIEW_CHANNEL and READ_MESSAGE_HISTORY in this
      channel's permission overrides (or in a parent category).
  ```

Both error states are **per-channel** — the run continues processing
remaining allow-listed channels (FR-005, US2).

---

## 5. Smoke test with a posted code

Ask a channel admin to post a fake code in the format the extractor
recognises (e.g. `TESTCODE2026`). Within one scheduled cycle:

1. The code appears as a row in `data/discord/candidates.jsonl` with
   `sourceChannelLabel: "stfc-members-only-codes"`.
2. The code is fed through the existing redemption pipeline by the
   `redeem-codes` skill (identical to the public-channel path).

If the code does **not** appear:

- Check the digest health section for that channel.
- Check the monitor log for a count-only warning if message text was empty.
  Empty text does not by itself establish whether the content was unavailable
  or the message was genuinely textless.
- Verify the Developer Portal has **"Message Content Intent"** enabled
  for the bot — without it, `content` is empty in
  `GET /channels/{id}/messages` for messages the bot did not author
  (see `docs/DISCORD-BOT-SETUP.md` § Privileged Intents).

---

## What this feature does **not** do

- It does **not** send messages, reactions, or any write operation to
  Discord (FR-009).
- It does **not** store raw message bodies beyond the existing
  `IngestedMessage` shape (FR-010).
- It does **not** authenticate as a user account or use OAuth2
  authorisation-code grant (FR-008) — bot tokens only.
- It does **not** auto-invite the bot to servers — server admins must
  click the install URL themselves (Discord requires a human admin in
  the loop).

---

## Rollback

The feature is purely additive. To disable, set `enabled: false` on the
relevant `config/discord-allowlist.json` entry and the channel will be
skipped on the next run with no further action required.
