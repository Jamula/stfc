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
tokens, snowflakes, or anything resembling a JWT (Principle VII).

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

## 2. Enable the required Privileged Intents

This is the most common reason a bot reads messages but sees empty
`content` fields. The REST endpoint `GET /channels/{id}/messages`
returns `content: ""` for any message the bot did not author **unless**
the bot's application has the Message Content Intent enabled — even
when the bot is not using a gateway connection.

In **Bot → Privileged Gateway Intents**:

- **Message Content Intent** → **ON** (required — without it, every
  candidate code extraction silently fails because `content` is empty)
- **Server Members Intent** → **ON** only if you need the bot to see
  member-role information (not required for code monitoring; leave OFF
  unless a future feature needs it)
- **Presence Intent** → leave OFF (not needed)

Click **Save Changes**. The change takes effect immediately for new
REST calls.

> Apps in 100+ servers must apply for intent verification with Discord.
> The stfc bot is single-server / low-scale; verification is not
> required.

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
automatically. The startup `getMe()` call (US3) will fail fast with a
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
| Messages ingested but `content` is empty                          | Message Content Intent is OFF                                      | §2 — toggle the intent ON; no redeploy needed.                                        |
| Health section shows `forbidden_guild` (Discord code `50001`)     | Bot is not a member of the target server                           | Send the server admin the URL from §3.                                                |
| Health section shows `forbidden_channel` (Discord code `50013`)   | Bot is in the server but lacks per-channel View / Read History     | §3 — admin grants permissions via role or channel override.                           |
| Health section shows `not_found` (Discord code `10003` / HTTP 404)| Channel ID is wrong, channel was deleted, or bot was never invited | Verify `channelId` in `config/discord-allowlist.json`; re-check the install in §3.    |

For the channel-onboarding walkthrough (allowlist edit, smoke test, and
expected digest output), see
[`specs/003-discord-oauth/quickstart.md`](../specs/003-discord-oauth/quickstart.md).

---

## Slash commands

### `discord/commands.json` — single source of truth

`discord/commands.json` is the canonical definition of every slash command
this bot exposes. Downstream workflows (#145 registration, #147 handler)
read this file; **do not add or rename commands without updating it**.

Current commands:

| Command | Type | Description | Permission |
|---|---|---|---|
| `/redeem-status` | CHAT_INPUT (1) | Show the latest redemption run results | (all members) |
| `/trigger-redeem` | CHAT_INPUT (1) | Manually trigger the next gift redemption run | ADMINISTRATOR (`"8"`) |

`default_member_permissions: "8"` is Discord's bitmask for the
`ADMINISTRATOR` permission (bit 3, value 8). Only server administrators can
invoke `/trigger-redeem`. See [Discord permission docs](https://discord.com/developers/docs/topics/permissions).

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

- `redeem-status` — reads recent lines from `docs/redeem-history.md`
- `trigger-redeem` — starts `redeem.yml` and replies with the run ID + link
- any other command — replies with `Unknown command: <name>`

To add a new slash command end-to-end:

1. Add the command to `discord/commands.json`
2. Re-register commands (`discord-register-commands.yml`)
3. Add a new command case in `scripts/discord-handler.mjs`
4. Add/update tests (`tests/discord/commandsJson.test.ts`,
   `tests/scripts/discordHandler.test.ts`)

Discord interaction tokens are valid for ~15 minutes. Keep command follow-up
responses short and immediate (especially for `trigger-redeem`, which replies
as soon as the workflow run is started).
