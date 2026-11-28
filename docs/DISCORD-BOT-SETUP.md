# Discord bot setup (operator runbook)

One-time setup for the Discord monitor's bot account. Follow this guide
before adding restricted (members-only or role-gated) channels to
`config/discord-allowlist.json`. Public-channel monitoring also relies on
the same bot account, so this is the canonical setup reference.

**Audience**: operator with admin access to the GitHub repo and to the
Discord Developer Portal account that will own the bot.
**Time to complete**: ~10 minutes.

All placeholder values in this document use angle-bracket form (e.g.
`<APPLICATION_ID>`, `<CHANNEL_ID>`). Never commit real client IDs, bot
tokens, snowflakes, or anything resembling a JWT.

---

## 1. Create the bot application

1. Sign in to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name (e.g. `stfc-gift-redeemer`),
   accept the developer ToS.
3. In the left sidebar, open **Bot**. Discord auto-provisions a bot user
   tied to the application.
4. Optionally set a username and avatar — these will appear in the
   `discord bot authenticated` log line on each run.
5. Note the **Application ID** from the **General Information** page.
   You will substitute this for `<APPLICATION_ID>` in §3 below.

---

## 2. Verify message-content access

The monitor reads messages with Discord's REST API; it does not use a
WebSocket gateway. Do not assume that REST polling bypasses Discord's
current message-content restrictions, or that a portal toggle alone
proves the bot can read a channel. Discord's
[privileged-intent guidance](https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent)
describes when message content fields are restricted and which
exemptions apply.

After an administrator approves a specific channel and the bot has
least-privilege read access, verify a bounded REST read of a known
text-bearing message in that channel. Confirm that the response contains
the expected `content` and record safe counts and the run link; do not
copy message bodies or credentials into the evidence. If content is
unavailable, check the current Discord policy and the application's
intent eligibility/approval before changing settings. An empty `content`
field or the monitor's count-only warning is not, by itself, proof of a
permission or intent failure; a message may genuinely contain no text.

The monitor does not need Server Members or Presence intents.

---

## 3. Generate the install URL

Server admins install the bot by visiting an OAuth2 authorization URL
that pre-declares the scopes and permissions the bot needs. Always send
admins the same minimum-permissions URL — never the
`permissions=8` (Administrator) variant.

Template:

```text
https://discord.com/api/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=66560
```

Substitute `<APPLICATION_ID>` with the value from §1 step 5.

The bot will appear in the server's member list once the admin accepts
the install dialog. For role-gated channels, the admin must additionally
either:

- Assign the bot a role that has `View Channel` + `Read Message History`
  on the target channel, **or**
- Add the bot directly to the channel's permission overrides with those
  two permissions allowed.

---

## 4. Why permission bitmask `66560` (least privilege)

The monitor only reads messages. It never sends, reacts, edits, deletes,
joins voice, manages channels, or modifies roles. The OAuth2 install URL
in §3 encodes exactly two Discord permission flags:

| Bit value | Permission name        | Why we need it                                |
| --------- | ---------------------- | --------------------------------------------- |
| `1024`    | `VIEW_CHANNEL`         | Required to see the channel exists at all.    |
| `65536`   | `READ_MESSAGE_HISTORY` | Required for `GET /channels/{id}/messages`.   |
| **Total** | **`66560`**            | `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY`.      |

If a server admin asks for justification, point them at this table. Do
**not** ask for `Administrator` (`8`), `Manage Channels` (`16`),
`Send Messages` (`2048`), or anything else — the monitor will not use
them, and broader permissions make the bot harder to approve.

---

## 5. Capture the bot token and store it as a GitHub secret

1. In **Developer Portal → Bot**, click **Reset Token** (the token is
   only displayed once at creation; resetting reveals a fresh one).
2. Copy the token value to your clipboard. It is the credential — treat
   it like a password. **Never** paste it into a PR, an issue comment,
   a commit message, a chat log, or any file in the repo.
3. Store it as the `DISCORD_BOT_TOKEN` GitHub Actions secret:

   ```bash
   gh secret set DISCORD_BOT_TOKEN
   # Paste the token at the prompt; press Ctrl-D to submit.
   ```

   This is the only env var the monitor consumes for Discord
   authentication. No additional secrets are required.

4. Verify the secret was set:

   ```bash
   gh secret list | grep DISCORD_BOT_TOKEN
   ```

The next scheduled `discord-monitor.yml` run will pick up the new token
automatically. The startup `getMe()` call will fail fast with a
single `DiscordAuthError` if the token is invalid, so you'll see the
problem in the run log immediately rather than as a cascade of 401s.

---

## 6. Rotating the bot token

Rotate whenever:

- The token may have been exposed (accidental paste, leaked log, lost
  device).
- The bot owner's Developer Portal account changes hands.
- On a routine schedule of your choice (Discord does not enforce one).

Procedure:

1. **Developer Portal → Bot → Reset Token** — this invalidates the old
   token immediately, so the next scheduled run will fail until step 2
   completes.
2. `gh secret set DISCORD_BOT_TOKEN` — paste the new value, press
   Ctrl-D.
3. Optionally trigger the workflow manually to confirm the new token
   works:

   ```bash
   gh workflow run discord-monitor.yml
   gh run watch
   ```

   Look for the `discord bot authenticated` log line — that confirms
   `getMe()` succeeded with the new token.

No code change or redeploy is required.

---

## Troubleshooting quick reference

| Symptom                                                           | Likely cause                                                       | Fix                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `DiscordAuthError` at startup                                     | Token invalid, revoked, or not a bot token                         | Reset token in Developer Portal; re-run `gh secret set DISCORD_BOT_TOKEN`.            |
| Messages ingested but `content` is empty                          | The message may be textless, or Discord may restrict content fields | Verify a known text-bearing message with a bounded REST read and consult current Discord intent policy. The count-only warning does not identify the cause. |
| Health section shows `forbidden_guild` (Discord code `50001`)     | Bot is not a member of the target server                           | Send the server admin the URL from §3.                                                |
| Health section shows `forbidden_channel` (Discord code `50013`)   | Bot is in the server but lacks per-channel View / Read History     | §3 — admin grants permissions via role or channel override.                           |
| Health section shows `not_found` (Discord code `10003` / HTTP 404)| Channel ID is wrong, channel was deleted, or bot was never invited | Verify `channelId` in `config/discord-allowlist.json`; re-check the install in §3.    |
| Health section shows `rate_limited` | Discord returned 429 after the channel's three-retry budget | Honor the reported retry delay; reduce monitored channels or increase the interval. |
| `StateWriteError` or `DigestWriteError` | Durable state or digest could not be written | Inspect the run error and state-branch persistence; after repair, rerun with authorization so messages are replayed. |

Channel read failures leave the affected channel's cursor unchanged while
healthy channels continue. A channel, state, digest, or configured job-summary
write failure returns exit code 1; Discord authentication failures return 2.
Cursors are saved only after candidate/cooldown state and the digest are written,
so a failed handoff can be retried without skipping the affected messages.

For the channel-onboarding walkthrough (allowlist edit, smoke test, and
expected digest output), see
[`specs/003-discord-oauth/quickstart.md`](../specs/003-discord-oauth/quickstart.md).

---

## 7. Receiving official STFC announcements via Discord "Follow"

Discord only permits installing a private bot (`DISCORD_BOT_TOKEN`) into servers
where you hold **Manage Server** permission, so you cannot install your own bot
directly into Scopely's official *Star Trek Fleet Command* Discord server.

To ingest official promo-code announcements without admin access on third-party
servers, use Discord's built-in **Announcement Channel Follow** feature:

1. Create a private Discord server you own (or reuse your personal operator
   server) and create a dedicated text channel such as `#stfc-promo-feed`.
2. Install your bot into **your** private server using the least-privilege URL
   in §3 (`permissions=66560`: `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY`).
3. Open Scopely's official STFC Discord server (or any community server that
   publishes announcements via a Discord Announcement channel), click **Follow**
   in the channel header, and select your private server's `#stfc-promo-feed`
   channel as the destination.
4. Add an entry for your private `#stfc-promo-feed` channel in
   `config/discord-allowlist.json` matching `DiscordAllowlistEntrySchema`
   (include `"promo"` or `"code"` in `channelLabel` so the extractor applies the
   promo-channel confidence bonus):

   ```json
   {
     "version": 1,
     "entries": [
       {
         "serverId": "<YOUR_PRIVATE_SERVER_ID>",
         "serverLabel": "stfc-operator-relay",
         "channelId": "<YOUR_PRIVATE_CHANNEL_ID>",
         "channelLabel": "official-promo-codes",
         "addedAt": "2026-11-26T00:00:00Z",
         "addedBy": "<GITHUB_HANDLE>",
         "enabled": true
       }
     ]
   }
   ```

Published announcements automatically syndicate into `#stfc-promo-feed`, where
`discord-monitor` reads them with standard REST permissions.

The monitor restores the shared `data/promo-code-dead.json` cache from
`automation-state` for read-only filtering. Codes already marked invalid or
expired are not submitted again, and repeated reports in one run are submitted
at most once. The digest and job summary count cache-suppressed candidates;
suppression is not a new redemption attempt. When a promo scan is enabled, a
malformed or unreadable cache fails the run before ingest or command replies
and leaves Discord cursors unchanged so messages can be retried after the
cache is repaired. An absent cache is valid on the first run; command-only
monitoring does not use it.

---

## Slash commands

### `discord/commands.json` — single source of truth

`discord/commands.json` is the canonical definition of every slash command
this bot exposes. The registration workflow and the command handler use this
file; **do not add or rename commands without updating it**.

Current commands:

| Command | Type | Description | Permission |
|---|---|---|---|
| `/redeem-status` | CHAT_INPUT (1) | Show the latest redemption run results | (all members) |
| `/trigger-redeem` | CHAT_INPUT (1) | Manually trigger the next gift redemption run | ADMINISTRATOR (`"8"`) |
| `/game-state` | CHAT_INPUT (1) | Upload an image or video with an optional note | ADMINISTRATOR (`"8"`) |

`default_member_permissions: "8"` is Discord's bitmask for the
`ADMINISTRATOR` permission (bit 3, value 8). Only server administrators can
invoke `/trigger-redeem` and `/game-state`. See [Discord permission docs](https://discord.com/developers/docs/topics/permissions).

### Validator

```bash
node scripts/validate-discord-commands.mjs
```

Exits 0 if every command satisfies Discord's CHAT_INPUT schema constraints
(name 1–32 chars matching `^[-_\p{L}\p{N}]+$`, description 1–100 chars,
valid `type`, string `default_member_permissions`). Exits 1 with errors on
stderr if validation fails. Runs automatically in CI as part of `npm test`.


### Registering slash commands — `discord-register-commands.yml`

Slash commands must be registered with Discord before they appear in the chat box.
Use the **Register Discord slash commands** workflow — a one-off, manually triggered
`workflow_dispatch` that reads `discord/commands.json` and calls Discord's bulk-overwrite
PUT endpoint.

#### How to run

1. Go to **Actions → Register Discord slash commands → Run workflow**.
2. Fill in the inputs:

   | Input | Required | Description |
   |---|---|---|
   | `guild_id` | No | Server (guild) ID for **instant** guild-scoped registration. Leave empty for **global** registration (~1 hour propagation to all servers). |
   | `dry_run` | No (default `false`) | Check to validate `discord/commands.json` and print what *would* be sent — without calling Discord. |

3. Click **Run workflow**.

#### What to expect

- The **Validate** step runs `scripts/validate-discord-commands.mjs` first. If validation
  fails, the workflow aborts before touching Discord.
- The **Register** step does a `PUT` bulk-overwrite — this **replaces all existing
  commands** of the chosen scope (guild or global) with the contents of
  `discord/commands.json`.
- On success, the **job summary** shows the HTTP 200 response from Discord, including
  each registered command's assigned ID.

#### Verifying commands appeared

- **Discord client:** Open your server, type `/` in any channel — the registered
  commands should appear in the autocomplete popup within seconds (guild-scoped)
  or up to ~1 hour (global).
- **API:** `GET https://discord.com/api/v10/applications/{APP_ID}/guilds/{GUILD_ID}/commands`
  with your bot token should return the registered command list.

> **Tip:** Use `dry_run: true` first to confirm the payload is valid without side
> effects. Then re-run with `dry_run: false` to register.

> **Tip:** Prefer guild-scoped registration during development — it takes effect
> instantly and only affects one server. Switch to global once the commands are stable.

### Command routing (`discord-command-handler.yml`)

The Cloudflare Worker bridge dispatches `repository_dispatch` events with
`event_type: "discord-command"`. Workflow
`.github/workflows/discord-command-handler.yml` routes the payload to:

- `redeem-status` — reads live history from `docs/redeem-history.md` on
  `automation-state`
- `trigger-redeem` — starts `redeem.yml` and replies with the run ID + link
- `game-state` — uploads the attachment to the configured private R2 bucket
  and records metadata on `automation-state`
- any other command — replies with `Unknown command: <name>`

To add a new slash command end-to-end:

1. Add the command to `discord/commands.json`
2. Re-register commands (`discord-register-commands.yml`)
3. Add a new command case in `scripts/discord-handler.mjs` and, if needed,
   configure the Worker dispatch and handler workflow.
4. Add/update tests (`tests/discord/commandsJson.test.ts`,
   `tests/scripts/discordHandler.test.ts`)

Discord interaction tokens are valid for ~15 minutes. Keep command follow-up
responses short and immediate (especially for `trigger-redeem`, which replies
as soon as the workflow run is started).
