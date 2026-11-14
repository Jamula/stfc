# Setup guide

End-to-end instructions for getting `stfc-gift-redeemer` running on your fork
of this repository.

## Prerequisites

- A Scopely account that you log in to the STFC web store with.
- A fork (or clone) of this repository on GitHub with Actions enabled.
- **Recommended:** Node.js 24+ locally to match the repository toolchain and use
  the `capture-token` script. The Azure Static Web Apps managed API is
  configured to use Node.js 22. Optional: GitHub
  CLI (`gh`) so the script can set the secret for
  you.

## Recommended path: `npm run capture-token` (Playwright-driven)

Interactive recovery compares the captured token's `/auth/me`
`payload.accountId` with an identifier obtained independently from the
official signed-in session. This field is observed in that response, not a
documented guarantee that identifiers never change. An absent, unsupported,
ambiguous or different identifier stops recovery. Non-CI `--headless` is
refused. Do not use the legacy `--ci` path or `Refresh token` workflow for
this recovery.

The Windows recovery entry point requires PowerShell 7 or later:

```powershell
pwsh -NoProfile -File .\recover-auth.ps1
```

Ensure Node.js 24+, GitHub CLI, project dependencies, and Playwright's
Chromium are installed before starting. If dependencies or Chromium are
missing, install them first with `npm ci` and `npm run playwright:install`;
`npm ci` also installs this repository's Git hooks. The launcher checks
dependencies and Chromium before requesting the backup.

First confirm that the full backup is current and complete, and wait for any
redemption workflow to finish. Pause all redemption workflows and concurrent
`.env` and `STFC_ACCOUNTS` updates until completion. GitHub cannot reveal
the current secret. Never share the backup, identifier, response, email, OTP,
or tokens in chat or screenshots.

1. In an independent private official-store session, verify the intended
   account and find `payload.accountId` in its `/auth/me` response. Keep it
   private; do not rely on the current browser's display name or email alone.
2. In a private PowerShell 7 terminal, run the command above. If this
   worktree already has an `.env`, the launcher stops without overwriting it.
   At its masked prompt, provide the complete backup; confirm the safeguards
   and the explicit `github.com/Jamula/stfc` upload target. The backup is
   stored as plaintext in the ignored local `.env`.
3. Confirm the safeguards again, enter the exact existing account label at
   the hidden prompt, and enter the independently obtained `accountId` at
   the next hidden prompt. Sign in with email and OTP only in the newly
   opened official browser window.
4. The browser closes after capture. The script sends the exact captured
   token to `/auth/me`, compares its identifier, and only then updates the
   local backup. If prompted, approve the GitHub update and reconfirm the
   backup and concurrency conditions. A failed or unconfirmed upload exits
   nonzero; establish the current secret baseline before retrying. An
   interrupted local write may leave an ignored `.env.local` staging file;
   treat it as sensitive and remove it only after confirming it is not
   another user's file.

The comparison identifies the response associated with the token; an HTTP 200
alone does not guarantee the store will accept the token for gift operations.

### Multiple accounts

Each run requires an existing complete local backup and an exact existing
account name. Unselected account JSON is preserved; ambiguous or duplicate
accounts and additional selected-account fields are rejected. If the launcher
already created the backup and stopped before the GitHub update, establish
the current baseline first, then use `npm run capture-token` in a private
terminal to retry without overwriting the existing `.env`.

### Useful flags

- `--timeout <seconds>` — how long to wait for login (default 300).
- `--name`, `--debug`, `--force`, and non-CI `--headless` are rejected for
  interactive recovery; account labels are entered privately.

### Setting the GitHub secret manually

If you don't have `gh` installed (or just prefer the UI):

1. Copy the JSON from the local `.env` securely; the script does not print it.
2. Go to your repo on GitHub → **Settings → Secrets and variables → Actions
   → New repository secret**.
3. **Name:** `STFC_ACCOUNTS`. **Value:** paste the JSON array.

## Triggering the workflow

Once the secret is set:

- **Manual:** repo → **Actions** → **Redeem gifts** → **Run workflow**.
- **CLI:** `gh workflow run "Redeem gifts"` (followed by `gh run watch` to
  tail it).
- **Cron:** GitHub requests a run every 10 minutes, but scheduled delivery is
  best-effort and may be delayed or dropped. The job summary on each delivered
  run shows what was claimed, which codes were already used, and any tokens
  that have expired.

## Fallback path: manual JWT extraction (browser-only, no install)

This is not an automated recovery procedure. Before changing the secret,
confirm the full backup is current and complete and pause all concurrent
updates. Replacing the whole secret with a single account discards the others.
If you manually verify token ownership, open
DevTools on the STFC store after logging in, switch to the **Network**
tab, find any request to `cdn-nv3-webstore-api.startrek.digitgaming.com`,
copy the token portion from the `Authorization` header (remove the
`Bearer ` prefix) and paste it into the `STFC_ACCOUNTS` GitHub secret as
`[{"name":"main","token":"<that JWT>"}]` only if that is the complete
intended secret. Do not rely on the current browser identity alone to verify
ownership of a token captured earlier.

## Token refresh

The manual `Refresh token` workflow uses legacy password-based login and
cannot complete the current email-OTP flow.

Use the identity-bound visible-browser procedure above. Do not run a secret
update based only on the current browser identity or an account label.

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

### `STFC_ACCOUNTS not valid JSON` (workflow error)
Make sure you pasted **raw JSON** into the secret value, with no
surrounding quotes and no leading/trailing whitespace. The value should
start with `[` and end with `]`. (`capture-token` writes the right format
automatically — this only happens with manual edits.)

### `token is not JWT-shaped` (workflow error)
A JWT has exactly three base64url segments separated by `.`. If you see
this error, you most likely pasted the wrong value into the secret. HTTP validation
alone does not establish which account a token belongs to.

### `TOKEN_EXPIRED` outcome on a workflow run
Your stored JWT's `exp` claim is in the past. Follow the identity-bound
recovery procedure above.

If every configured account returns `TOKEN_EXPIRED` and there are no
infrastructure errors, `run-all` exits with code **2** so the workflow fails as
a clear secret-rotation signal. Mixed runs (some valid, some expired) still
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

1. Read [specs/001-discord-monitor/quickstart.md](../specs/001-discord-monitor/quickstart.md)
   for full operator instructions — this covers provisioning the bot, setting the token,
   configuring the allow-list, and troubleshooting.
2. The feature is dormant until the allow-list is populated and the `DISCORD_BOT_TOKEN`
   secret is set. No danger of breakage by accident.
