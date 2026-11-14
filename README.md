# stfc-gift-redeemer

A headless TypeScript CLI that automatically redeems web-store gifts and promo
codes from the **Star Trek Fleet Command** store. GitHub Actions requests a
scheduled run every 10 minutes, but schedule delivery is best-effort—not a
10-minute guarantee. Optionally monitors configured Discord channels for new
promo codes and player tips, harvesting both into a daily digest.

---

## Quick start

> **Token recovery requires an independently verified account identifier.** See
> [docs/SETUP.md](docs/SETUP.md#recommended-path-npm-run-capture-token-playwright-driven)
> before attempting recovery.

1. **Recover a token** using the private, identity-bound procedure:

   ```bash
   pwsh -NoProfile -File .\recover-auth.ps1
   ```

   See [docs/SETUP.md](docs/SETUP.md) for prerequisites and safeguards.
2. **Confirm the `STFC_ACCOUNTS` GitHub secret is set.** Before any
   replacement, verify that your full backup is current and complete and
   pause all concurrent secret and `.env` updates.
3. **Enable the `Redeem gifts` workflow** under the Actions tab. GitHub
   requests a run every 10 minutes, but may delay or drop scheduled runs.
   You can also trigger it manually with the **Run workflow** button to verify
   everything works.

> **Token expiry:** the current email-OTP login cannot use the legacy
> `Refresh token` workflow;
> see [docs/SETUP.md](docs/SETUP.md#token-refresh).

> **Optional:** if you want to harvest promo codes and tips from the STFC
> Discord community automatically, enable the **`Discord monitor` workflow**
> and configure your allow-list. See
> [specs/001-discord-monitor/quickstart.md](specs/001-discord-monitor/quickstart.md)
> for setup instructions.

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

The bearer token is sent in the `Authorization` header and stored as a GitHub
Actions secret named `STFC_ACCOUNTS`.

---

## Discord monitor (optional)

When configured, a scheduled workflow (`discord-monitor.yml`) runs every 4 hours to:

- Ingest messages from a curated list of STFC Discord channels
- Extract candidate promo codes using pattern matching
- De-duplicate codes against `promo-codes.txt` and prior run history
- Feed new codes into the existing redeem orchestrator
- Classify non-code messages as "tips/tricks/hacks" vs chatter
- Produce a daily digest summarizing: codes attempted + outcomes, classified guidance, ingestion health

Discord slash-command interactions are handled separately by the Worker and
GitHub Actions bridge; see [`discord/RUNBOOK.md`](discord/RUNBOOK.md).

To set up, see [specs/001-discord-monitor/quickstart.md](specs/001-discord-monitor/quickstart.md).
For the one-time bot creation, privileged-intent toggles, install URL, and
token rotation procedure, see [docs/DISCORD-BOT-SETUP.md](docs/DISCORD-BOT-SETUP.md).
This feature is entirely optional — the core redemption workflow works without it.

## Discord slash commands

Discord slash commands are bridged by a Cloudflare Worker and handled by
GitHub Actions. See the [operator runbook](discord/RUNBOOK.md) for setup and
[`worker/README.md`](worker/README.md) for Worker details.

---

## Crew optimizer

Two local CLI skills help inspect crew readiness from `data/crew/` inputs without touching store credentials:

```bash
# Best crew for a task
npm run skill:optimize-crew -- --account main --task mining-g3 --top 3

# Progression recommendations
npm run skill:progression -- --account main
```

`skill:optimize-crew` writes ranked crews to `docs/crew/{account}-optimize.md`; `skill:progression` writes upgrade recommendations to `docs/crew/{account}-progression.md`.

A roster maintenance family (`skill:roster status|add|promote|rankup|validate`) keeps `data/crew/roster/{account}.yaml` up to date.

The CLI writes reports under `docs/crew/`; there is no automatic crew-report workflow in this repository. Read-only `!crew` commands are also supported through the Discord monitor.

Full operator guide: **[docs/CREW-OPTIMIZER.md](docs/CREW-OPTIMIZER.md)**.

---

## Project structure

The scheduled redemption workflow runs:

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

For system design, deployment, and workflow details, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Setup guides are in `docs/`,
`discord/`, and `worker/`.

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

## Promo codes and automation state

Maintain seed codes in `promo-codes.txt`. Scheduled runs merge them with
operational state on the `automation-state` branch; removing a code from the
seed does not remove its operational copy. Invalid or expired codes are cached
to avoid repeated API requests. Transient failures retry twice, with 1s and 2s
delays. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for merge, recovery,
and serialization behavior.

---

## Token expiry

Expired tokens are reported per account without stopping other accounts.
Interactive re-capture requires the identity-bound procedure in the setup guide.
`run-all` exits 2 when every account is expired and 1 for infrastructure errors.

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

---

## Control panel

The operator dashboard lives in `web/` (frontend) and `api/` (Azure
Functions). See [docs/SWA-SETUP.md](docs/SWA-SETUP.md) for deployment and
operator setup.
