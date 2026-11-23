# Setup guide

End-to-end instructions for getting `stfc-gift-redeemer` running on your fork
of this repository.

## Product version and releases

The current STFC product version is `0.1.0`. See the
[versioning and release policy](VERSIONING.md) for the MVP freeze,
review and release approval gates, independent component versions and
manual `Release` GitHub Actions workflow. Setting up the hosted token
store or running a redemption job is **not** a product release. The Node.js
version below is a runtime requirement, not a product-version number.

## Prerequisites

- An STFC account with access to the web store and a GitHub repository with Actions enabled.
- The private Azure resources and owner-only PWA configured as described in
  [STFC token PWA setup](STFC-TOKEN-PWA.md). No Azure configuration or deployment
  is performed by this guide.
- Node.js 24+ locally for CLI development and the local `capture-token` utility.

## Hosted token setup

The scheduled workflows read `accounts.json` from private Azure Blob Storage
through GitHub OIDC (`STFC_ACCOUNTS_FILE`) and persist runtime outputs
(`docs/redeem-history.md`, `data/promo-code-dead.json`,
`data/redeem-degraded-state.json`, `promo-codes.txt`) on the
`automation-state` branch; they do not consume `STFC_ACCOUNTS` directly. After
the owner configures the OIDC identities and storage settings, initialize the
empty store once:

1. Keep the existing JSON array in the temporary `STFC_ACCOUNTS` GitHub Actions
   secret.
2. Manually dispatch **Migrate token store**. It validates the data and uploads
   only when the canonical Blob does not already exist.
3. Confirm migration, then delete the legacy `STFC_ACCOUNTS` secret.
4. Once deployed, sign in through the authenticated control panel's **STFC
   token update** tab for all subsequent token updates.

Do not paste tokens into chat, issues, repository files, or workflow logs. The
owner PWA validates the real STFC login token and updates the private Blob
without returning the token to the browser.

## Local CLI token capture

The Playwright capture script is for local CLI use only. It writes the updated
account list to the ignored local `.env`; hosted token updates must use the
owner-only PWA described in [STFC-TOKEN-PWA.md](STFC-TOKEN-PWA.md).

```powershell
pwsh -NoProfile -File .\recover-auth.ps1
```

The recovery launcher requires PowerShell 7 or later, Node.js 24+, project
dependencies, and Playwright's Chromium. Install missing project dependencies
with `npm ci` and Chromium with `npm run playwright:install`.
The launcher checks prerequisites before requesting the backup.

Before recovery, provide the current complete backup and confirm that all
redemption workflows and concurrent `.env` and secret updates are stopped.
GitHub cannot show the current secret. In an independent private official-store
session, verify the intended account and obtain `payload.accountId` from its
`/auth/me` response; do not use a display name or email as a substitute.
At the hidden prompts, enter the exact existing account label and this
independently obtained identifier, then sign in with email and OTP only in the
newly opened official browser window.

The script sends the captured token to `/auth/me` and updates the local backup
only when the returned account identifier matches. A missing, unsupported,
ambiguous, or different identifier stops the update. A successful response
does not guarantee that the store will accept the token for gift operations.
The launcher updates only the local `.env`, never the GitHub secret or hosted
Blob. Use the PWA for hosted token updates. Treat the plaintext `.env` and any
interrupted `.env.local` staging file as sensitive; never commit or share them.

Each recovery requires a complete existing account list and an exact existing
account name. Unselected account JSON is preserved; duplicate accounts and
additional fields on the selected account are rejected. For the one-time
migration, follow the workflow steps above rather than setting a replacement
secret manually.

## Triggering the workflow

Once the private token store and Azure OIDC identities are initialized:

- **Manual:** repo → **Actions** → **Redeem gifts** → **Run workflow**.
- **CLI:** `gh workflow run "Redeem gifts"` (followed by `gh run watch` to
  tail it).
- **Cron:** GitHub requests a run every 10 minutes, but scheduled delivery is
  best-effort and may be delayed or dropped. The job summary on each delivered
  run shows what was claimed, which codes were already used, and any tokens
  that have expired.

## Token refresh

Use the owner-only PWA to refresh hosted tokens. The **Migrate token store**
workflow is not a login or refresh flow; it only imports the legacy secret to
an uninitialized Blob. For local-only CLI use, run `npm run capture-token`.

## Troubleshooting

### `npm run capture-token` says "Failed to launch Chromium"
First run only: `npm run playwright:install`. This downloads a sandboxed
Chromium binary into your user profile (~120 MB). Subsequent runs reuse it.

### Capture timed out without a token
The script waited 5 minutes (the default) without seeing a `/auth/login`
response or a `Bearer` header. The most common cause is closing the browser
window before logging in. Re-run with `--debug` and accept the diagnostic
dump prompt to capture redacted info about what *was* in storage —
that data helps us improve the script if the site changed.

### Token store is not initialized

Run **Migrate token store** while the legacy `STFC_ACCOUNTS` secret is
available. If migration reports that the Blob already exists, do not overwrite
or recreate it; stop and have the repository owner review the canonical store.

### `token is not JWT-shaped` (local CLI error)

A JWT has exactly three base64url segments separated by `.`. If you see this
error locally, re-run `npm run capture-token`. For the hosted store, sign in
again through the owner-only PWA.

### `TOKEN_EXPIRED` outcome on a workflow run
Your stored JWT's `exp` claim is in the past. Sign in through the owner-only
PWA and update the affected account label.

If every configured account returns `TOKEN_EXPIRED` and there are no
infrastructure errors, `run-all` exits with code **2** so the workflow fails as
a clear token-store update signal. Mixed runs (some valid, some expired) still
exit 0; infrastructure failures exit 1.

### Workflow doesn't run on schedule
GitHub Actions disables scheduled workflows on forks after **60 days of
repo inactivity**. Just push a commit (or click **Run workflow** manually)
to wake it up.

## Optional: harvest promo codes & tips from Discord

The **`Discord monitor` workflow** (`.github/workflows/discord-monitor.yml`) is entirely
optional. When enabled, it runs every 4 hours to:

- Ingest messages from a curated list of STFC Discord channels
- Extract candidate promo codes and feed them to the redeemer
- Classify tips/tricks/hacks and produce a daily digest

This feature requires one additional repository secret:

| Secret               | What it is                                                                           |
|----------------------|--------------------------------------------------------------------------------------|
| `DISCORD_BOT_TOKEN`  | Bot token from the Discord Developer Portal. |

**Setup:**

1. Read [DISCORD-BOT-SETUP.md](DISCORD-BOT-SETUP.md) for full operator
   instructions on provisioning the bot, granting least-privilege channel read
   access, setting `DISCORD_BOT_TOKEN`, and registering optional slash commands
   (also see [discord/RUNBOOK.md](../discord/RUNBOOK.md) for the Cloudflare
   Worker interaction bridge and historical feature notes in
   [specs/001-discord-monitor/quickstart.md](../specs/001-discord-monitor/quickstart.md)).
2. The feature is dormant until `config/discord-allowlist.json` is populated and
   the `DISCORD_BOT_TOKEN` secret is set. No danger of breakage by accident.
