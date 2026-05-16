# Setup guide

End-to-end instructions for getting `stfc-gift-redeemer` running on your fork
of this repository.

## Prerequisites

- A Scopely account that you log in to the STFC web store with.
- A fork (or clone) of this repository on GitHub with Actions enabled.
- **Recommended:** Node.js 22+ locally so you can use the `capture-token`
  script. Optional: GitHub CLI (`gh`) so the script can set the secret for
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
- **Cron:** every 15 minutes (~96 runs/day) automatically. The job summary on each run shows
  what was claimed, which codes were already used, and any tokens that have
  expired.

## Fallback path: manual JWT extraction (browser-only, no install)

If you can't install Node locally — or just want a quick one-off — open
DevTools on the STFC store after logging in, switch to the **Network**
tab, find any request to `cdn-nv3-webstore-api.startrek.digitgaming.com`,
copy the `Authorization` header value (everything after `Bearer `), and
paste it into the `STFC_ACCOUNTS` GitHub secret as
`[{"name":"main","token":"<that JWT>"}]`. The `capture-token` script
automates exactly this and is strongly recommended over the manual
approach.

## Optional: fully automated token refresh in CI

The store JWT lives ~30 days. If you'd rather never re-capture by hand,
the **`Refresh token` workflow** (`.github/workflows/refresh-token.yml`) can
run weekly in GitHub Actions, log in for you with Playwright, and update
the `STFC_ACCOUNTS` secret automatically.

This is opt-in — it requires three additional secrets:

| Secret               | What it is                                                                                       |
|----------------------|---------------------------------------------------------------------------------------------------|
| `STFC_EMAIL`         | The email address you log in to the Scopely store with.                                           |
| `STFC_PASSWORD`      | Your Scopely password. (The workflow also accepts the legacy name `cj_pwd` if you've already set that.) |
| `STFC_REFRESH_PAT`   | A **fine-grained PAT** with `Secrets: Read & write` permission for this repo. The default `GITHUB_TOKEN` cannot write secrets, hence the PAT requirement. |

### Creating the PAT

1. <https://github.com/settings/personal-access-tokens/new>
2. **Resource owner**: `Jamula` (or whoever owns the fork).
3. **Repository access**: *Only select repositories* → pick `stfc-gift-redeemer`.
4. **Permissions** → **Repository permissions**:
   - **Actions: Read** (default — keep it)
   - **Secrets: Read and write** (set this; default is none)
5. **Generate token** and copy the value.
6. Go to your repo → *Settings → Secrets and variables → Actions* and add
   it as **`STFC_REFRESH_PAT`**.

### How it runs

- **Weekly**: cron `0 4 * * 0` (Sunday 04:00 UTC).
- **On demand**: the **Run workflow** button on the Actions tab. You can
  pass a different `account_name` input if you have multiple accounts.

The workflow is `concurrency`-grouped with the redeem workflow, so the two
never race each other on writes.

### When auto-refresh fails

The most common failure is **Scopely serving a CAPTCHA or MFA challenge to
the headless browser**. The workflow's job summary will say so explicitly
and you can fall back to running `npm run capture-token` locally — that
uses a visible browser and you can solve any challenge interactively.

### A note on credential safety

- The workflow masks the captured JWT (and any existing tokens in
  `STFC_ACCOUNTS`) so they don't appear in the live log even if a step
  prints them by accident.
- The new value is piped into `gh secret set --body-file -` via stdin —
  it never lands on a command line.
- The PAT lives only in GitHub's encrypted secret store; the workflow
  reads it as `${{ secrets.STFC_REFRESH_PAT }}`.

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
Your stored JWT's `exp` claim is in the past. Either:
- Trigger the **Refresh token** workflow manually (if you've set up the
  three secrets above), or
- Re-run `npm run capture-token -- --name <accountName>` locally for the
  affected account. The script preserves your other accounts and only
  touches the named one. Then update the GitHub secret (the script does
  this for you if `gh` is available).

### `Refresh token` workflow says "Scopely served a CAPTCHA"
Headless-browser bot detection. Run `npm run capture-token` locally with
the visible browser and solve the challenge there.

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

This feature requires two additional secrets:

| Secret               | What it is                                                                           |
|----------------------|--------------------------------------------------------------------------------------|
| `DISCORD_BOT_TOKEN`  | OAuth token from a Discord bot your Discord server admin has invited to the server. |

**Setup:**

1. Read [specs/001-discord-monitor/quickstart.md](../specs/001-discord-monitor/quickstart.md)
   for full operator instructions — this covers provisioning the bot, setting the token,
   configuring the allow-list, and troubleshooting.
2. The feature is dormant until the allow-list is populated and the `DISCORD_BOT_TOKEN`
   secret is set. No danger of breakage by accident.

