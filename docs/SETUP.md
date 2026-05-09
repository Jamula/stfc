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
- **Cron:** every 4 hours automatically. The job summary on each run shows
  what was claimed, which codes were already used, and any tokens that have
  expired.

## Fallback path: bookmarklet (browser-only, no install)

If you can't install Node locally — or you just want a quick one-off — see
[`BOOKMARKLET.md`](BOOKMARKLET.md). It's a JS snippet you paste into
DevTools that scans storage for JWT-shaped strings and copies the working
one to your clipboard.

> ⚠️ The bookmarklet is **less reliable** than `capture-token`. It depends
> on the JWT being present in `localStorage`/`sessionStorage` as an
> extractable JWT string, which isn't always the case. If you see "No
> valid token found in storage", switch to `capture-token`.

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
`npm run capture-token -- --name <accountName>` for the affected account.
The script preserves your other accounts and only touches the named one.
Then update the GitHub secret (the script does this for you if `gh` is
available).

### Workflow doesn't run on schedule
GitHub Actions disables scheduled workflows on forks after **60 days of
repo inactivity**. Just push a commit (or click **Run workflow** manually)
to wake it up.

