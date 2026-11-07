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

The script launches a real Chromium window, waits for you to log in, watches
the actual network traffic for the JWT (much more reliable than scraping
storage), validates it against `/auth/me`, decodes the expiry, writes it to a
local `.env`, and optionally sets the GitHub repo secret via `gh secret set`.

```bash
npm install
npm run playwright:install   # one-time: download Chromium binary (~120 MB)
npm run capture-token        # captures account "main"
```

Steps:

1. The script opens a Chromium window pointing at
   `https://home.startrekfleetcommand.com/store`.
2. **Log in normally** in that window. The script never sees your password —
   it only observes the resulting API traffic.
3. Once it captures a token, it validates and writes it to `.env`. If `gh`
   is on your `PATH` it offers (`y/N`) to also set the GitHub repo secret
   `STFC_ACCOUNTS` for you (passing the JSON via stdin so the token never
   appears in shell history).
4. The browser closes automatically and you're done.

### Multiple accounts

```bash
npm run capture-token -- --name main
npm run capture-token -- --name alt
npm run capture-token -- --name third
```

Each run launches a fresh browser context (no cookies carried over) and
**adds or replaces** the named entry in `STFC_ACCOUNTS`. All previously
captured accounts are preserved.

### Useful flags

- `--timeout <seconds>` — how long to wait for login (default 300).
- `--debug` — on capture failure, prompts to write a redacted dump of
  `localStorage`, `sessionStorage`, and cookie metadata to
  `playwright-diagnostics/`. Helps us improve the script if the API ever
  changes. The dump never includes raw values.
- `--force` — required to overwrite an existing `STFC_ACCOUNTS` value
  that fails to parse as JSON. Default is to refuse and exit non-zero
  rather than destroy data.

### Setting the GitHub secret manually

If you don't have `gh` installed (or just prefer the UI):

1. The script prints the JSON it wrote to `.env`.
2. Go to your repo on GitHub → **Settings → Secrets and variables → Actions
   → New repository secret**.
3. **Name:** `STFC_ACCOUNTS`. **Value:** paste the JSON array.

## Triggering the workflow

Once the secret is set:

- **Manual:** repo → **Actions** → **Redeem gifts** → **Run workflow**.
- **CLI:** `gh workflow run "Redeem gifts"` (followed by `gh run watch` to
  tail it).
- **Cron:** every 10 minutes (144 runs/day) automatically. The job summary on each run shows
  what was claimed, which codes were already used, and any tokens that have
  expired.

## Fallback path: manual JWT extraction (browser-only, no install)

If you can't install Node locally — or just want a quick one-off — open
DevTools on the STFC store after logging in, switch to the **Network**
tab, find any request to `cdn-nv3-webstore-api.startrek.digitgaming.com`,
copy the token portion from the `Authorization` header (remove the
`Bearer ` prefix) and paste it into the `STFC_ACCOUNTS` GitHub secret as
`[{"name":"main","token":"<that JWT>"}]`. The `capture-token` script
automates exactly this and is strongly recommended over the manual
approach.

## Token refresh

The manual `Refresh token` workflow uses legacy password-based login and
cannot complete the current email-OTP flow.

For the current flow, use the local visible-browser capture:

```bash
npm run capture-token -- --name main
```

Enter the one-time code in the browser. The script preserves other named
accounts and can update `STFC_ACCOUNTS` through `gh` after confirmation.
Otherwise, follow [Setting the GitHub secret manually](#setting-the-github-secret-manually).
Do not paste tokens into chat, issues, or repository files.

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
this error, you most likely pasted the wrong value into the secret. Re-run
`npm run capture-token` — it validates each captured value against
`/auth/me` before writing anything, so the result is guaranteed to be a
JWT the API accepts.

### `TOKEN_EXPIRED` outcome on a workflow run
Your stored JWT's `exp` claim is in the past. Re-run
`npm run capture-token -- --name <accountName>` locally for the affected
account. The script preserves your other accounts and only updates the named
one. It can update the GitHub secret if `gh` is available.

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
