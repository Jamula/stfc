# Quickstart — Discord Community Monitor

**Branch**: `001-discord-monitor` | **Date**: 2026-05-13 |
**Audience:** developer onboarding to this feature locally.

> This is a planning artifact. The skill itself is implemented in
> `/speckit.tasks` → `/speckit.implement`. Steps that reference
> `npm run skill:discord-monitor` will start working at that point;
> the secret-setup, bot-invite, and verification steps are valid today.

---

## 1. Provision the Discord bot (one-time, per operator)

1. Visit <https://discord.com/developers/applications> and click
   **New Application**. Name it `STFC Monitor (cyrusj)` (or similar).
2. Open **Bot** → **Add Bot**. Disable **Public Bot** (we never want a
   third party to invite this token to their server). Disable
   **Message Content Intent** is NOT possible — it MUST be **enabled**
   (privileged intent) so we can read `content`. **Enable** it.
3. Click **Reset Token**, copy the token. This is the only time it is
   shown. Treat it as a live secret immediately.
4. **Bot permissions (OAuth2 → URL Generator):**
   - Scopes: `bot`
   - Bot permissions: `View Channel` (0x400) + `Read Message History` (0x40)
   - Numeric permissions integer: `66560`
5. The generated invite URL goes to a Discord server admin to install.
   No other scope, no `applications.commands`, no write permissions.

## 2. Store the token

**Locally** (for `npm run skill:discord-monitor --dry-run`):

```bash
# Append to .env (which is gitignored)
echo "DISCORD_BOT_TOKEN=<paste-token-here>" >> .env
```

**In CI** (for the scheduled workflow):

```bash
gh secret set DISCORD_BOT_TOKEN --body-file -
# paste token, then Ctrl-D
```

The token MUST live ONLY in `.env` and `secrets.DISCORD_BOT_TOKEN`. Per
Principle V (and the v1.3.0 amendment proposed in `plan.md`), no other
storage surface is sanctioned. If you accidentally paste the token
elsewhere, rotate it immediately at the Developer Portal.

## 3. Add a server / channel to the allow-list

The allow-list ships empty. To monitor a channel:

1. Get the server's guild ID and the channel ID (Discord client →
   Settings → Advanced → Developer Mode → right-click → Copy ID).
2. Edit `config/discord-allowlist.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "serverId": "111111111111111111",
      "serverLabel": "STFC Community",
      "channelId": "222222222222222222",
      "channelLabel": "promo-codes",
      "addedAt": "2026-05-13T00:00:00Z",
      "addedBy": "cyrusj",
      "enabled": true
    }
  ]
}
```

3. Open a PR. Allow-list edits are human-reviewed (no bot self-modifies it).
4. Ensure the bot has been invited (Step 1.5) and that the target channel
   is visible to the bot's role (Discord side: channel permissions →
   add the bot's role with View Channel + Read Message History).

## 4. Local dry-run (read-only, no auto-commit, no redeem)

```bash
npm install            # picks up @discordjs/rest + @xenova/transformers
npm run typecheck
npm run skill:discord-monitor -- --dry-run
```

Expected output:
- A health summary listing channels read, messages scanned, candidates
  extracted (without submitting to the redeemer), tips classified.
- A *preview* of `data/digests/YYYY-MM-DD.md` printed to stdout.
- **No** writes to `data/`, `promo-codes.txt`, or any cursor file.
- **No** outbound calls to the STFC API.

## 5. Verify the model loaded correctly

First run downloads the classifier model (~71 MB, ~25 s on a typical
connection):

```text
[discord-monitor] loading classifier Xenova/nli-deberta-v3-xsmall@<rev>
[discord-monitor]   cache miss; downloading...
[discord-monitor]   verifying SHA-256 against config/classifier-model.json
[discord-monitor]   ✓ SHA-256 verified, loaded in 1.8s
```

Subsequent runs hit the cache (`~/.cache/huggingface/`) and load in ~2 s.

If you see `ClassifierIntegrityError`, the downloaded weights do not
match the pinned SHA-256. **Do NOT** edit `config/classifier-model.json`
to make the error go away — that would defeat the integrity check.
Instead, delete the cache directory and retry; if it still fails, file
an issue.

## 6. Verify a digest writes correctly

```bash
npm run skill:discord-monitor          # NOT --dry-run
ls data/digests/                        # 2026-05-13.md
git status                              # candidates.jsonl, cursors.json, digest expected
```

Re-run immediately on the same day:

```bash
npm run skill:discord-monitor
git status                              # should be CLEAN — idempotent re-run
```

If the second run produces a diff, the digest writer is not idempotent —
that is a bug; check the state block at the bottom of the digest file.

## 7. Run the test suite

```bash
npm test
```

The new tests live under `tests/skills/discordMonitor.test.ts`,
`tests/discord/extractor.test.ts`, `tests/discord/classifier.test.ts`,
and `tests/discord/digest.test.ts`. Fixtures are under
`tests/fixtures/discord/`. None of them require live Discord access — the
REST client is stubbed.

## 8. Trigger the scheduled workflow manually

```bash
gh workflow run discord-monitor.yml
gh run watch
```

Inspect the resulting commit on `main` (workflow-attributed bot identity).
If the run added a successful new code, you'll see a follow-up commit:
`chore(promo-codes): auto-append N codes from Discord monitor (run ...)`.

## 9. Rotate the bot token

```bash
# 1. At developer portal: Bot → Reset Token
# 2. Locally:
gh secret set DISCORD_BOT_TOKEN --body-file -
# 3. Update .env if you use it locally
```

The old token is invalidated by Discord on reset. Run
`gh workflow run discord-monitor.yml` to confirm the new token works.

## Troubleshooting

| Symptom                                       | Likely cause                                                              |
|-----------------------------------------------|---------------------------------------------------------------------------|
| `DiscordAuthError: 401`                       | Token rotated, revoked, or never set in CI. Re-run Step 2.                |
| `DiscordChannelAccessError: 403`              | Bot is not in the server, or its role lacks View Channel for that channel. Re-do Step 3.4. |
| `ClassifierLoadError: model file missing`     | Workflow's HuggingFace cache step failed; manually clear cache and re-run. |
| Empty digest after a busy day                 | Allow-list empty (Step 3 not done) or moderation filter too aggressive — inspect `RunHealth.dropped`. |
| Auto-commit failed on `main`                  | Branch protection rejected `GITHUB_TOKEN`. Adjust protection or temporarily approve via PR. |
