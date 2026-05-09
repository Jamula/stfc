# stfc-gift-redeemer

A headless TypeScript CLI that automatically redeems web-store gifts and promo
codes from the **Star Trek Fleet Command** store. It is designed to run as a
scheduled GitHub Action every hour, so daily login bonuses, free packs, and
promotional codes are claimed without you ever opening the store in a browser.

---

## Quick start

1. **Capture your store token (recommended).** Run the Playwright-driven
   capture script:

   ```bash
   npm install
   npm run playwright:install   # one-time: download Chromium (~120 MB)
   npm run capture-token        # opens browser, watches network, writes .env
   ```

   It opens a Chromium window pointing at the STFC store. Log in normally;
   the script captures the JWT from the network traffic, validates it, and
   writes it to your local `.env`. If `gh` is on your `PATH`, it also
   offers to set the GitHub repo secret for you. See
   [docs/SETUP.md](docs/SETUP.md) for multi-account, flags, and the
   browser-only [bookmarklet](docs/BOOKMARKLET.md) fallback.
2. **Confirm the `STFC_ACCOUNTS` GitHub secret is set.** If you let
   `capture-token` use `gh`, it's already done. Otherwise, paste the JSON
   `capture-token` wrote to `.env` into *Settings → Secrets and variables →
   Actions → STFC_ACCOUNTS*.
3. **Enable the `Redeem gifts` workflow** under the Actions tab. It will run
   on the cron schedule (every hour) from then on. You can also trigger
   it manually with the **Run workflow** button to verify everything works.

> **Optional:** if you'd rather never re-capture your JWT by hand when it
> expires (~30 days), set up the **`Refresh token` workflow** that logs in
> for you in CI. See [docs/SETUP.md](docs/SETUP.md#optional-fully-automated-token-refresh-in-ci)
> for the (small) extra setup.

---

## How it works

The orchestrator talks to the official STFC web-store API at:

```
https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2
```

For each account it performs roughly:

- `GET  /auth/me`             — verify the JWT is still valid and identify the player.
- `GET  /offers/gifts`        — list pending gifts (daily login, mail attachments, etc).
- `POST /offers/gifts/claim`  — claim each pending gift.
- `POST /redeem/claim`        — submit each promo code from `promo-codes.txt`.

The JWT used as the `Authorization: Bearer …` header is taken from your
normal browser session (via the `npm run capture-token` Playwright helper)
and stored encrypted in a GitHub Actions secret named `STFC_ACCOUNTS`.

Optionally, you can also store your Scopely email + password as repo
secrets and let the **`Refresh token` workflow** log in for you weekly so
the JWT never goes stale — see
[docs/SETUP.md](docs/SETUP.md#optional-fully-automated-token-refresh-in-ci).

---

## Available skills

The CI workflow runs:

```bash
npm run skill:run-all
```

which iterates every account in `STFC_ACCOUNTS` and runs the full pipeline
(check auth → list gifts → claim gifts → redeem codes), printing a per-account
summary at the end.

For local diagnostics you can run individual steps:

| Skill                       | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `npm run skill:check-auth`  | Decode the JWT and confirm `/auth/me` accepts it.        |
| `npm run skill:list-gifts`  | List pending gifts without claiming them.                |
| `npm run skill:claim-gifts` | Claim pending gifts.                                     |
| `npm run skill:redeem-codes`| Submit every code in `promo-codes.txt`.                  |

---

## Project layout

```
.
├── .github/
│   └── workflows/
│       ├── redeem.yml       # scheduled gift redemption (every 4h)
│       └── test.yml         # typecheck + tests on push/PR
├── docs/
│   ├── BOOKMARKLET.md       # one-click token grabber
│   └── SETUP.md             # end-to-end setup guide
├── src/                     # TypeScript source (api client, orchestrator, skills)
├── tests/                   # vitest suite
├── promo-codes.txt          # one promo code per line, # for comments
├── package.json
└── README.md
```

---

## Multi-account support

`STFC_ACCOUNTS` is a JSON **array**, one entry per account. The orchestrator
iterates the entire array, so you can manage as many accounts as you like with
a single secret:

```json
[
  {"name": "main",  "token": "<JWT-1>"},
  {"name": "alt",   "token": "<JWT-2>"},
  {"name": "farm",  "token": "<JWT-3>"}
]
```

Capture each token from a different browser profile (cookies are profile-scoped).

---

## Promo codes

Promo codes live in `promo-codes.txt`. The format is dead simple:

- One code per line.
- Lines starting with `#` are ignored.
- Inline comments after a code (whitespace + `#`) are stripped.

```
# Star Trek Day 2024 promo
STARTREKDAY2024
FLEETCMD-WELCOME    # one-time welcome bonus
```

Codes are resubmitted on every scheduled run. The API returns
`CODE_ALREADY_USED` for codes you have already redeemed, so the file is
**naturally idempotent** — no local state is tracked. Just append new codes
whenever you find them; old ones will quietly no-op.

---

## Token expiry

JWTs from the STFC store have an `exp` claim (typically a few weeks out). The
orchestrator decodes every token at the start of a run and prints something
like:

```
[main] token expires in 12 days
```

When a token has fewer than a few days left it is highlighted, and once it
actually expires the run summary clearly flags it as **TOKEN_EXPIRED** so you
know to re-capture and update the secret. Expired tokens for one account do
**not** stop other accounts from being processed.

---

## Notifications

By design this tool is **summary-only**: it does not send emails, push
notifications, or Discord webhooks. Everything you need is on the workflow run
page (Actions tab → Redeem gifts → latest run → job summary).

If you want to be notified when a run fails, enable
*Settings → Notifications → Actions → Send notifications for failed workflows
only* in your personal GitHub settings.

---

## Disclaimer

Automating interactions with the STFC web store may be against the
**Scopely** / **Star Trek Fleet Command** Terms of Service. Use at your own
risk — you, the operator, assume all responsibility for any consequences,
including but not limited to account suspension. This project is provided
for educational purposes and is not affiliated with or endorsed by Scopely,
Digit Game Studios, CBS, or Paramount.

---

## Local development

```bash
npm install
npm test
npm run typecheck
```

To run skills locally against your own account, copy your `STFC_ACCOUNTS` JSON
into a `.env` file in the repo root:

```
STFC_ACCOUNTS=[{"name":"main","token":"<JWT>"}]
```

then run e.g. `npm run skill:check-auth`. The `.env` file is gitignored.

