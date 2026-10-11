# Discord Slash Commands Setup Runbook

## 1. What This Pipeline Does

When an operator types a Discord slash command (e.g. `/redeem-status`, `/trigger-redeem`, or `/game-state`) in a channel where the bot is active, the message flows through a serverless bridge:

```
┌──────────────┐       ┌──────────────────────┐       ┌──────────────────┐
│   Discord    │       │  Cloudflare Worker   │       │  GitHub Actions  │
│ (slash cmd)  │──────▶│ (verify + defer)     │──────▶│ (execute + reply)│
└──────────────┘       └──────────────────────┘       └──────────────────┘
   User types          Ed25519 check + PONG        repository_dispatch
  `/redeem-*`          then HTTP dispatch           → runs workflow
                       (keeps interaction alive       → posts follow-up
                        for 15 min)
```

**Sequence:**
1. User types `/redeem-status` in Discord → Discord sends interaction to Worker URL
2. Worker verifies the Ed25519 signature against `DISCORD_PUBLIC_KEY`
3. Worker sends immediate "thinking" response (type 5) back to Discord (within 3s limit)
4. Worker fires GitHub `repository_dispatch` event with command metadata
5. `discord-command-handler.yml` workflow runs, executes the command handler, and posts a Discord follow-up message with the result
6. User sees the result update after ~10–30 seconds

**No business logic runs in the Worker.** It is a thin security boundary + bridge only. All command logic lives in `scripts/discord-handler.mjs`.

---

## 2. Prerequisites

- ✅ Discord application with bot already in your server
  - App ID: `1505752454388514916` (public, not a secret)
  - Bot token (`DISCORD_BOT_TOKEN`) already set as a GitHub repo secret
  - Worker allowlist env var `ALLOWED_GUILD_IDS` configured (issue #160) to restrict command dispatch to approved guilds
- ✅ GitHub repo (`Jamula/stfc`) with Actions enabled
- ✅ Cloudflare account (free tier sufficient; requires API Token access)
- Internet access to Discord Developer Portal and Cloudflare dashboard

---

## 3. Step-by-Step Setup

Each step includes: **(a) what to do**, **(b) the exact command or click path**, and **(c) where to verify**.

### Step A: Generate Cloudflare Secrets (one-time)

**A1. Cloudflare API Token**

1. Log in to [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Click your profile icon (bottom left) → **My Profile**
3. Click **API Tokens** tab
4. Click **Create Token**
5. Select **Edit Cloudflare Workers** (or search for it)
6. Under **Account Resources**, select your account
7. Click **Continue to summary** → **Create Token**
8. **Copy the token immediately** — it will not be shown again
9. Store it in a secure place; you will paste it into `gh secret set` in step B

**Verify:** Paste the token into a temporary text editor (not chat) to confirm it starts with `v1.0-` and is ~100 characters.

**A2. Cloudflare Account ID**

1. From [Cloudflare dashboard](https://dash.cloudflare.com/), look at the right sidebar under **Account Information**
2. Copy the **Account ID** (a 32-character alphanumeric string)
3. Store it in a secure place

**Verify:** The ID is exactly 32 characters, all alphanumeric.

**A3. GitHub Personal Access Token (fine-grained PAT)**

1. Log in to [GitHub](https://github.com) and go to Settings → Developer settings → **Personal access tokens** → **Fine-grained tokens**
2. Click **Generate new token**
3. Token name: `stfc-discord-dispatch` (or similar)
4. Expiration: 90 days (rotate quarterly)
5. Resource owner: `Jamula`
6. Repository access: **Only select repositories** → `Jamula/stfc`
7. **Permissions:** Configure the token with:
   - **Contents:** `Read and write` (required for `repository_dispatch`)
   - **Metadata:** `Read only` (required; GitHub always enforces this for any PAT)
   - **Actions:** no additional permission needed for `repository_dispatch`
8. Click **Generate token**
9. **Copy the token immediately** — it will not be shown again
10. Store it in a secure place; you will use it in step D

**Verify:** The token starts with `github_pat_` and is ~100 characters.

**A4. Discord Public Key**

1. Log in to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click your application (ID: `1505752454388514916`)
3. Click **General Information** in the sidebar
4. Under **PUBLIC KEY**, click **Copy**
5. Store it in a secure place; you will use it in step D

**Verify:** The Public Key is a ~64-character hex string (alphanumeric, no dashes or underscores).

---

### Step B: Set GitHub Repo Secrets

Run these commands from your **local terminal** (not in the Codespace chat):

```bash
# From your local machine:
gh secret set CLOUDFLARE_API_TOKEN --repo Jamula/stfc
# Paste your Cloudflare API Token (from A1), then press Enter

gh secret set CLOUDFLARE_ACCOUNT_ID --repo Jamula/stfc
# Paste your Cloudflare Account ID (from A2), then press Enter

gh secret set CLOUDFLARE_R2_ACCESS_KEY_ID --repo Jamula/stfc
# Paste the R2 access key for the private stfc-game-state bucket, then press Enter

gh secret set CLOUDFLARE_R2_SECRET_ACCESS_KEY --repo Jamula/stfc
# Paste the matching R2 secret access key, then press Enter

gh secret set ALLOWED_GUILD_IDS --repo Jamula/stfc
# Comma-separated Discord guild IDs allowed to run slash workflows (e.g. 123,456)
```

**Verify:**
```bash
gh secret list --repo Jamula/stfc | grep CLOUDFLARE
```

Should show:
```
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
DISCORD_BOT_TOKEN          # should already exist from #143
ALLOWED_GUILD_IDS         # required for /game-state handler allowlist re-check
```

---

### Step C: Deploy the Cloudflare Worker (first time only)

1. Go to your repo → **Actions** tab
2. In the left sidebar, click **Deploy Cloudflare Worker**
3. Click **Run workflow** → **Run workflow** again to confirm
4. Wait for the job to complete (~1–2 minutes)
5. Click into the job → scroll to **Deploy Cloudflare Worker** step
6. Under the step output, find the line starting with `Deployed URL:` (or look at the job summary at the bottom)
7. **Copy the URL** (looks like `https://stfc-discord-bridge.<subdomain>.workers.dev`) — you will need it in step E

**Verify:**
- Job shows ✅ (green check)
- Job summary displays a `Deployed URL`
- URL is accessible: `curl <URL>` returns `405 Method not allowed` (expected, since it only accepts POST with valid Discord signature)

---

### Step D: Set Cloudflare Worker Secrets

Run these commands from your **local terminal**:

```bash
cd /path/to/stfc/worker

# One-time CLI auth pre-flight (recommended path: repo-pinned wrangler via npx)
npx wrangler --version
npx wrangler login

# Alternative if you prefer a global install:
# npm install -g wrangler
# wrangler login

# Set the Discord Public Key on the Worker
npx wrangler secret put DISCORD_PUBLIC_KEY
# Paste your Discord Public Key (from A4), then press Enter

# Set the GitHub dispatch token on the Worker
npx wrangler secret put GH_DISPATCH_TOKEN
# Paste your GitHub fine-grained PAT (from A3), then press Enter
```

You can verify auth with `npx wrangler whoami` (or `wrangler whoami` if using a global install) — it should print your Cloudflare account email.

**Verify:**
```bash
npx wrangler secret list
```

Should show:
```
DISCORD_PUBLIC_KEY
GH_DISPATCH_TOKEN
```

---

### Step E: Register the Interactions Endpoint URL in Discord Developer Portal

1. Log in to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click your application (ID: `1505752454388514916`)
3. In the sidebar, click **General Information**
4. Under **Interactions Endpoint URL**, paste the Worker URL from step C
   - Example: `https://stfc-discord-bridge.your-subdomain.workers.dev`
5. Click **Save Changes**

**Expected behavior:**
- Discord will immediately send a PING request to your Worker URL
- Worker responds with PONG (type 1)
- Discord shows a green checkmark ✅ — **Interactions Endpoint URL saved successfully**

**If the save fails:**
- Error: *"Invalid Interactions Endpoint URL"* or timeout
- **Troubleshooting:** See [Troubleshooting](#troubleshooting) → Interactions Endpoint URL save fails

**Verify:**
- The saved URL appears on the General Information page (under Interactions Endpoint URL)
- No error message appears

---

### Step F: Register the Slash Commands

1. Go to your repo → **Actions** tab
2. In the left sidebar, click **Register Discord Commands**
3. Click **Run workflow** → a form appears with options:
   - **guild_id:** Leave empty for **global** registration (propagates to all servers in ~1 hour), OR paste a Discord server ID for **guild-scoped** instant registration (single server only; useful for testing)
   - **dry_run:** Leave as `false` (unless you want to test the payload without calling Discord)
4. Click **Run workflow** again to confirm
5. Wait for the job to complete (~30 seconds)
6. Click into the job → scroll to the **Register commands with Discord** step
7. The step output will show the registered commands (JSON array with command names and Discord IDs)

**Verify:**
- Job shows ✅ (green check)
- Output includes command definitions with `"name": "redeem-status"`, `"name": "trigger-redeem"`, and `"name": "game-state"`
- The `game-state` definition has a required `file` option (type 11, ATTACHMENT) and an optional `note` option (type 3, STRING)
- If you registered guild-scoped, the output will show the guild-scoped URL

---

### Step G: Test in Discord

1. Open the Discord server where the bot is active
2. Type `/` in any channel
3. You should see autocomplete suggestions including `/redeem-status`, `/trigger-redeem`, and `/game-state` (the latter defaults to Administrator permission and only works in an allowlisted server; server administrators can override Discord command permissions)

**Test `/redeem-status`:**
1. Type `/redeem-status` and press Enter
2. The bot should respond: *"Bot is thinking..."*
3. After ~10–30 seconds, the response updates with the last redemption run summary (command, timestamp, status, logs link)

**Test `/trigger-redeem`:**
1. Type `/trigger-redeem` and press Enter (requires ADMINISTRATOR permission in the server, per the command definition)
2. The bot should respond: *"Started run #X — see [GitHub Actions link](https://github.com/Jamula/stfc/actions/runs/X)"*
3. Verify that a new `discord-command-handler` run appears in the Actions tab

**Verify:**
- Both commands appear in autocomplete
- Both commands respond without timing out ("Application did not respond" error)
- `/redeem-status` shows recent execution data
- `/trigger-redeem` triggers a workflow run that you can see in Actions

---

## 4. Troubleshooting

| Symptom | Root Cause | Check | Fix |
|---------|-----------|-------|-----|
| Discord Developer Portal save of Interactions Endpoint URL **fails** (error message: "Invalid Interactions Endpoint URL" or timeout) | Worker not deployed, or `DISCORD_PUBLIC_KEY` not set on Worker | `cd worker && wrangler tail` (watch live logs); check step C deployed successfully; check step D secrets were set | (1) Re-run step C deploy, (2) Verify step D secrets with `wrangler secret list`, (3) Re-try Discord save |
| Slash command appears in autocomplete but responding with **"Application did not respond"** | Worker timing out (Discord enforces 3-second initial response limit), or Worker signature verification failing | `cd worker && npx wrangler tail` (watch logs when you invoke the command); look for errors like "timestamp too skewed" or "invalid signature" | (1) Check Worker secrets in step D — `DISCORD_PUBLIC_KEY` must be exactly correct, (2) Check Discord server system clock is in sync (test: `date` command should be within ±5 min of UTC), (3) If issue persists, re-do step D and step E |
| `/trigger-redeem` responds **"401 Bad Credentials"** | `GH_DISPATCH_TOKEN` wrong, expired, or lacks required scope | (1) Verify token was set in step D: `npx wrangler secret list`, (2) Check token expiry in GitHub UI, (3) Check permissions: re-read step A3 "Permissions" — ensure `Contents: Read and write` is set | Re-generate the GitHub PAT per step A3 and re-set it per step D |
| Slash commands **don't appear at all** in Discord autocomplete | Registration workflow didn't run, or guild_id mismatch (if testing guild-scoped) | (1) Check Actions tab — was the Register Discord Commands workflow triggered? (2) If you registered guild-scoped (step F), verify you're testing in the correct server by comparing server ID to guild_id input | Re-run step F with correct guild_id (or empty for global) |
| Worker deployed but responding with **500 (Server misconfiguration)** when you try to save Interactions Endpoint URL | `DISCORD_PUBLIC_KEY` is invalid (e.g., not a valid hex string) | `wrangler tail` and look for "Invalid signature" or hex parsing errors | Re-check step A4 — Discord Public Key should be a ~64-character hex string (no dashes, spaces, or special chars). Re-copy from Developer Portal and re-set per step D |
| Commands work in one server but not another | Global vs guild-scoped registration mismatch | (1) Check how you registered (step F) — if guild-scoped, commands only appear in that guild, (2) If you registered global, wait ~1 hour for propagation | Re-register either guild-scoped for the target server or global (then wait 1 hour) |
| **CodeQL scanning fails on Worker code** | CodeQL or required CI check on the Worker failed on `wrangler` deployment | Check Actions run logs for CodeQL errors; see [Rule 13a](../.github/copilot-instructions.md#13-codespaces-operational-gotchas) in copilot-instructions.md | Usually resolves on its own; if blocking a deploy, ask in `#stfc` Slack |

---

## 5. Rotation and Maintenance

### GitHub Fine-Grained PAT (`GH_DISPATCH_TOKEN`)
- **Rotation schedule:** Every 90 days
- **Procedure:**
  1. Generate a new PAT per step A3
  2. Update the Worker secret: `cd worker && wrangler secret put GH_DISPATCH_TOKEN`
  3. Paste the new token
  4. No downtime — Worker uses the new token on next invocation
- **Alert:** Set a calendar reminder 85 days from deployment

### Cloudflare API Token (`CLOUDFLARE_API_TOKEN`)
- **Rotation schedule:** Annually, or when team membership changes
- **Procedure:**
  1. Generate a new token per step A2
  2. Update GitHub repo secret: `gh secret set CLOUDFLARE_API_TOKEN --repo Jamula/stfc`
  3. Paste the new token
  4. No downtime — next deploy workflow uses the new token
- **Alert:** Set a calendar reminder annually

### Cloudflare Account ID (`CLOUDFLARE_ACCOUNT_ID`)
- **Rotation schedule:** Never (unless your Cloudflare account is restructured, very rare)
- **Procedure if needed:** Regenerate per step A2, update repo secret

### Cloudflare R2 Game-State Keys (`CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`)
- **Bucket:** `stfc-game-state` (private, automatic region placement)
- **Rotation schedule:** Annually, or when team membership changes
- **Retention:** Forever for this slice. A 90-day archive tier is not implemented; keep issue #164 open until its lifecycle policy is provisioned.
- **Procedure:**
  1. Generate an R2 API token/key pair scoped to write the `stfc-game-state` bucket
  2. Update GitHub repo secrets:
     - `gh secret set CLOUDFLARE_R2_ACCESS_KEY_ID --repo Jamula/stfc`
     - `gh secret set CLOUDFLARE_R2_SECRET_ACCESS_KEY --repo Jamula/stfc`
  3. No downtime — the next `/game-state` handler run uses the new keys
- **Access model:** Objects stay private; committed manifests point to R2 keys and downstream readers should use signed URLs

### Discord Public Key (`DISCORD_PUBLIC_KEY`)
- **Rotation schedule:** Never (unless Discord force-resets it, extremely rare)
- **Procedure if Discord resets it:**
  1. Copy the new Public Key from Discord Developer Portal (step A4)
  2. Update Worker secret: `cd worker && wrangler secret put DISCORD_PUBLIC_KEY`
  3. Paste the new key
  4. No downtime — Worker uses the new key on next invocation

### Discord Bot Token (`DISCORD_BOT_TOKEN`)
- **Rotation schedule:** Only when leaked
- **Procedure:**
  1. Log in to Discord Developer Portal → your app → **Bot** → **Reset Token**
  2. Copy the new token
  3. Update repo secret: `gh secret set DISCORD_BOT_TOKEN --repo Jamula/stfc`
  4. Paste the new token
  5. No downtime — workflows use the new token on next run

---

## 6. Adding a New Command

To add a new slash command (e.g. `/crew-roster`):

### Step 1: Define the Command

Edit `discord/commands.json` and add an entry to the array:

```json
{
  "name": "crew-roster",
  "type": 1,
  "description": "Show the crew roster for the current season",
  "default_member_permissions": "0"
}
```

**Key fields:**
- `"name"`: lowercase, alphanumeric + dashes; Discord identifier
- `"type"`: `1` for slash command (only supported type for now)
- `"description"`: shown to user in autocomplete (max ~100 chars)
- `"default_member_permissions"`: `"0"` for all members, `"8"` for ADMINISTRATOR, or a specific permission bit

**Commands with options** (e.g. `/game-state`) can include an `"options"` array. The
validator (`scripts/validate-discord-commands.mjs`) currently accepts a limited allowlist
of option types: `STRING` (type 3) and `ATTACHMENT` (type 11). Each option must have
`name` (1-32 chars), `description` (1-100 chars), and optionally a boolean `required`.
Subcommands and choices are not yet validated and will be rejected — see issue #159 for
the allowlist rationale.

```json
{
  "name": "game-state",
  "type": 1,
  "description": "Upload a screenshot or video to capture current game state",
  "options": [
    { "name": "file", "description": "The image or video to archive", "type": 11, "required": true },
    { "name": "note", "description": "Optional context", "type": 3, "required": false }
  ]
}
```

Commit the change and submit as a PR.

### Step 2: Register the New Command

Once the PR is merged to `main`:
1. Go to Actions → **Register Discord Commands** → **Run workflow**
2. Leave `guild_id` empty (for global) or paste a test server ID
3. The new command will be registered alongside existing ones

### Step 3: Add Command Handler (if custom logic is needed)

Edit `scripts/discord-handler.mjs` and add a case in the command switch:

```javascript
case 'crew-roster': {
  // custom logic here: fetch data, format response, etc.
  const response = { content: 'Crew roster data...' };
  return response;
}
```

If no custom logic is needed (you just want a static response), you can skip this step.

Commit the change and submit as a PR. The pre-commit tests will validate the command structure.

---

## 7. Debugging and Monitoring

### Worker Logs (real-time)

```bash
cd worker
wrangler tail
```

This streams live logs from the Worker. When you invoke a slash command in Discord, you should see:
- `Received interaction type: 2` (APPLICATION_COMMAND)
- `Dispatching to GitHub...`
- `GitHub dispatch succeeded` or error details

### GitHub Workflow Logs

1. Go to your repo → **Actions** tab
2. Click **Register Discord Commands** or **Discord command handler** workflow run
3. Click the job name to see full step-by-step output

### Discord's Validation

When you save the Interactions Endpoint URL in the Developer Portal (step E), Discord sends a test PING:
- If Worker responds correctly (PONG, type 1), save succeeds
- If Worker doesn't respond or times out, Discord shows error in the portal


### `/game-state` — capture game state to R2 with repository metadata

Use Discord's slash-command picker to attach one file and optionally add a caption:

```text
/game-state file:<screenshot.png>
/game-state file:<screenshot.png> note:"after raid 2026-06-02"
/game-state file:<replay.mp4> note:"alliance war replay"
```

The `file` option is required; `note` is optional and is truncated to 200 characters by the Worker. The handler sanitizes and truncates the persisted note to 120 characters. The command is registered with `default_member_permissions: "8"` (Administrator) as Discord's default command permission. Server administrators can override that permission for other users or roles; the Worker checks the guild allowlist, not the invoking user's permissions. Both the Worker and the handler fail closed unless the server's guild ID is in `ALLOWED_GUILD_IDS`. The attachment URL must use `cdn.discordapp.com` or `media.discordapp.net`; the handler downloads it without a Bot authorization header. Although the command description advertises images and videos, the current Worker and handler do not enforce a MIME-type allowlist.

The Worker acknowledges the interaction, then dispatches it to GitHub Actions. For new captures, the handler uploads the binary to private Cloudflare R2 and commits only metadata on the `automation-state` branch (not `main`). The reply links to the daily manifest at the saved commit and includes the object's R2 key:

```text
R2 key: YYYY-MM-DD/HHMMSSmmm-<sanitized-filename>
data/discord/game-state/YYYY-MM-DD/manifest.json
data/discord/game-state/YYYY-MM-DD/HHMMSSmmm-<sanitized-filename>.lineage.json
data/discord/game-state/YYYY-MM-DD/_index.json
```

The date and timestamp are UTC; `mmm` is the three-digit millisecond component. The stored filename is limited to 100 characters and sanitized to `[A-Za-z0-9._-]`.

Each companion `.lineage.json` currently has this shape:

```json
{
  "discord_message_id": null,
  "channel_id": "<Discord channel ID or null>",
  "guild_id": "<Discord guild ID or null>",
  "uploader": "<Discord user ID or unknown>",
  "uploader_handle": "<currently falls back to the Discord user ID>",
  "captured_at_utc": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "note": "<sanitized note or no note>",
  "source_url": "https://discord.com/channels/<guild>/<channel>/...",
  "content_type": "<Discord attachment type or downloaded response type>",
  "size_bytes": 0,
  "sha256": "<attachment SHA-256>",
  "r2_bucket": "<effective R2 bucket>",
  "r2_key": "YYYY-MM-DD/HHMMSSmmm-<sanitized-filename>",
  "filename_original": "<original Discord filename>",
  "filename_stored": "<sanitized stored filename>"
}
```

`_index.json` contains a `files` array with one entry per capture: `filename`, `captured_at`, `uploader`, `note`, and `size_bytes`. It is updated through a temporary file and rename. There are two lineage discrepancies versus the intended #161 shape: the Worker does not send a Discord message ID, so `discord_message_id` is `null` and `source_url` ends in `/...`; it sends `member_handle`, while the handler reads `uploader_handle`, so the stored handle currently falls back to the user ID. The handler also names the filename fields `filename_original` and `filename_stored`.

`manifest.json` declares the effective `bucket` and a `files` array with R2 bucket/key, SHA-256, size, content type, capture metadata, `access: "signed-url-required"` and `retention: "forever"`. Access requires signed URLs; the manifest URL does not expose a public binary URL. The default bucket is `stfc-game-state`; set the non-secret repository variable `STFC_GAME_STATE_R2_BUCKET` to override it (an unset/empty value uses the default). All entries in a daily manifest must use that bucket. A same-day bucket change or mixed-bucket manifest fails before download/upload or metadata writes; keep the day's existing bucket or explicitly migrate its objects and metadata.

After an R2 upload, metadata-save failures attempt object cleanup. A failed git push first triggers a remote publication check: an accepted commit with a lost acknowledgement counts as success. If remote publication cannot be confirmed, the handler preserves the object, reports its bucket/key through the failure follow-up and exits nonzero. Operators should inspect `automation-state` and the reported R2 object before reconciling; never delete an object referenced by published metadata.

**Size limits and alerts**

- One attachment may be at most **50 MiB (52,428,800 bytes)**. The handler rejects larger files before download/write; there is no warning-only oversized-upload path and no oversized warning in the commit message. This differs from the behavior described in #161.
- The handler also caps each UTC day at 20 files and 100 MiB of indexed attachment bytes. A capture that exceeds either daily cap is rejected before downloading or uploading.
- `storage-size-monitor.yml` checks the total `data/discord/game-state` directory on `automation-state` daily at 06:00 UTC. At **100 MiB total**, it opens an issue titled `[storage] data/discord/game-state exceeds threshold`; later checks comment on that open alert. The monitor does not migrate data to R2 or close the issue automatically.

**Deferred historical migration and lifecycle:** New captures use R2; this slice does not migrate binaries already present in git or rewrite their history. The storage alert does not automatically migrate them. Historical migration and the 90-day archive-tier option in #164 remain unimplemented, so that issue stays open. New R2 objects retain `forever` retention for this slice. Although #164 lists Git LFS as a possible fallback, the current `.gitattributes` has no game-state LFS filter rules, so that fallback is not pre-staged.

**Security and privilege scope:** `/game-state` is a repo-write and R2-write operation. Discord's default permission is Administrator, but server administrators can override it; the Worker and handler enforce the guild allowlist, not the invoking user's role. Restrict any Discord permission overrides to trusted operators and only enable the command in an allowlisted server. The `discord-command-handler.yml` workflow grants `contents: write` and `actions: write`; its game-state handler commits the manifest, lineage, and index to `automation-state`, never the new binary.

### Testing Commands Locally (without Discord)

You can test the command handler logic by running the script directly:

```bash
# Set required env vars, then run the handler
export DISCORD_CLIENT_PAYLOAD='{"command":"redeem-status","interaction_token":"test-token","application_id":"1505752454388514916"}'
export GH_TOKEN="your-github-token"
export DISCORD_BOT_TOKEN="your-bot-token"

node scripts/discord-handler.mjs
```

This runs the handler without going through Discord or GitHub Actions.

---

## 8. Reference Links

- **Discord Developer Portal:** https://discord.com/developers/applications/1505752454388514916
- **Cloudflare Workers:** https://dash.cloudflare.com/
- **GitHub repo secrets:** https://github.com/Jamula/stfc/settings/secrets/actions
- **Workflow runs:** https://github.com/Jamula/stfc/actions
- **Discord Interactions docs:** https://discord.com/developers/docs/interactions/receiving-and-responding
- **Cloudflare Workers docs:** https://developers.cloudflare.com/workers/

---

## 9. Support and Questions

If you encounter issues not covered in [Troubleshooting](#troubleshooting):
1. Check the full epic #143 and related PRs (#144–#148) for context
2. Review `worker/README.md` for Worker-specific details
3. Check GitHub Actions run logs (Actions tab → workflow run → job → step)
4. Ask in `#stfc` Slack channel (mention `@Uhura` for integrations questions)

---

*Runbook created: 2026-06-02; `/game-state` updated: 2026-09-26 | Epic #143 (Discord slash commands) | Issues: #144, #145, #146, #147, #148, #149*
