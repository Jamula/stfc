# stfc-gift-redeemer (`Jamula/stfc`)

An automation and player-companion toolkit for **Star Trek Fleet Command**
(`0.1.0` MVP baseline). Built for a mobile-first operator so daily web-store
gift claims, ephemeral community promo codes, crew and progression planning,
game-state capture, and token renewal do not depend on repetitive manual store
logins.

### What lives in this repository

| Subsystem | Paths | Purpose |
| --- | --- | --- |
| **Store gift & promo-code redeemer** | `src/`, `.github/workflows/redeem.yml` | Headless Node 24 TypeScript CLI targeting the STFC Web Store v2 API, persisting run history and dead-code caches to the `automation-state` branch. GitHub Actions requests a run every 10 minutes (best-effort schedule delivery, not a hard interval guarantee). |
| **Private token store & browser relay** | `pwa-token-api/`, `pwa-browser/`, [docs/STFC-TOKEN-PWA.md](docs/STFC-TOKEN-PWA.md) | Stores account JWTs in private Azure Blob Storage read via GitHub OIDC (`STFC_ACCOUNTS_FILE`), refreshed from an owner-only PWA tab backed by isolated Container Apps rather than long-lived GitHub secrets. |
| **Discord community monitor & digest** | `src/discord/`, `src/digest/`, `.github/workflows/discord-monitor.yml` | Optional 4-hour read-only scanner extracting candidate promo codes and classifying player tips/tricks into daily digests. |
| **Discord slash-command & capture bridge** | `worker/`, [`discord/RUNBOOK.md`](discord/RUNBOOK.md) | Cloudflare Worker and GitHub Actions bridge handling `/redeem-status`, `/trigger-redeem`, and `/game-state` media uploads to private R2 storage. |
| **Offline crew optimizer & knowledge base** | `src/crew/`, `data/crew/`, [docs/CREW-OPTIMIZER.md](docs/CREW-OPTIMIZER.md) | Zero-credential CLI (`skill:optimize-crew`, `skill:progression`, `skill:roster`) and read-only `!crew` queries over curated officer/task data and link-only community references ([docs/stfc-knowledge/README.md](docs/stfc-knowledge/README.md)). |
| **Operator web control panel** | `web/`, `api/`, [docs/SWA-SETUP.md](docs/SWA-SETUP.md) | Lit 3 + Vite dashboard and Azure Functions API on Azure Static Web Apps with two-layer operator/owner authentication. |

**Release status:** Current product version is **`0.1.0`** (see
[CHANGELOG.md](CHANGELOG.md); the earlier `v1.0.0` tag predates the 2026-11-08
reset to the `0.1.0` MVP baseline and is preserved as historical).

---

## Quick start

1. **Configure the private account-token store.** Follow
   [docs/STFC-TOKEN-PWA.md](docs/STFC-TOKEN-PWA.md) to provision the owner-only
   PWA services, private Azure Blob container, and GitHub OIDC reader identity.
   The workflow cannot run until those external resources and settings exist.
2. **Initialize the token store once.** Set the legacy `STFC_ACCOUNTS` secret
   temporarily, then manually dispatch **Migrate token store**. The workflow
   uploads it only if the canonical Blob does not already exist. Remove the
   legacy secret after confirming migration.
3. **Enable the `Redeem gifts` workflow** under the Actions tab. Scheduled
   delivery is best-effort; you can also trigger it manually.

> **Token expiry:** after the PWA is deployed and configured, sign in through
> its **STFC token update** tab to replace a token in the private store. The
> `refresh-token.yml` workflow no longer performs a provider login; **Migrate
> token store** is only the one-time migration path.

> **Local development:** run `pwsh -NoProfile -File .\recover-auth.ps1` for the
> guided, identity-bound recovery. With a prepared local `.env`, you can also
> run the capture script directly:

   ```bash
   npm run capture-token
   ```

   The flow requires independently verifying the account identifier and writes
   only to a local `.env`; hosted token updates use the owner-only PWA.
   See [docs/SETUP.md](docs/SETUP.md) for local CLI instructions.

> **Optional Discord monitor:** to harvest promo codes and tips from configured
> STFC Discord channels automatically, enable the **`Discord monitor` workflow**
> and configure your allow-list. See
> [docs/DISCORD-BOT-SETUP.md](docs/DISCORD-BOT-SETUP.md) (and historical feature
> notes in [specs/001-discord-monitor/quickstart.md](specs/001-discord-monitor/quickstart.md)).

---

## How it works

The orchestrator talks to the official STFC web-store API at:

```
https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2
```

For each account it performs:

- `GET  /auth/me`             — verify the JWT is still valid and identify the player.
- `GET  /offers/gifts`        — list pending gifts (daily login, mail attachments, etc).
- `POST /offers/gifts/claim`  — claim each pending gift.
- `POST /redeem/claim`        — submit each promo code from `promo-codes.txt`.

The bearer token is sent in the `Authorization` header. Scheduled workflows
read the account list from private Azure Blob Storage using GitHub OIDC
(`STFC_ACCOUNTS_FILE`). The owner-only PWA updates that store after validating
a real STFC login.

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

For bot creation, privileged-intent toggles, install URL, and token rotation,
see [docs/DISCORD-BOT-SETUP.md](docs/DISCORD-BOT-SETUP.md). This feature is
optional — the core redemption workflow runs independently without it.

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

## CLI skills & diagnostics

The scheduled redemption workflow runs:

```bash
npm run skill:run-all
```

which iterates every configured account (`STFC_ACCOUNTS_FILE` in hosted
workflows, or `STFC_ACCOUNTS` in local `.env` runs) through the full pipeline
(check auth → list gifts → claim gifts → redeem codes) and prints a per-account
summary with explicit outcome classification.

For local diagnostics you can run individual steps:

| Skill                       | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `npm run skill:check-auth`  | Decode the JWT and confirm `/auth/me` accepts it.        |
| `npm run skill:list-gifts`  | List pending gifts without claiming them.                |
| `npm run skill:claim-gifts` | Claim pending gifts.                                     |
| `npm run skill:redeem-codes`| Submit every code in `promo-codes.txt`.                  |

For system design, deployment, and workflow details, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Setup guides live in `docs/`,
`discord/`, and `worker/`.

---

## Multi-account support

The orchestrator accepts a JSON array from `STFC_ACCOUNTS` for local runs or
`STFC_ACCOUNTS_FILE` for scheduled workflows. Scheduled workflows load the
account list from private Azure Blob Storage using GitHub OIDC; the legacy
`STFC_ACCOUNTS` secret is used only for the one-time migration:

```json
[
  {"name": "main",  "token": "<JWT-1>"},
  {"name": "alt",   "token": "<JWT-2>"},
  {"name": "farm",  "token": "<JWT-3>"}
]
```

The local capture utility opens a fresh browser context for each account.

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
`run-all` exits `2` when every account is expired and `1` for infrastructure errors.

---

## Notifications

By design this tool is **summary-only**: it does not send emails, push
notifications, or Discord webhooks. Everything you need is on the workflow run
page (Actions tab → Redeem gifts → latest run → job summary), plus automated
issue alerts when all tokens fail or a gift bundle degrades repeatedly.

If you want to be notified when a run fails, enable
*Settings → Notifications → Actions → Send notifications for failed workflows
only* in your personal GitHub settings.

---

## Local development

Node.js comes from `.nvmrc` (currently Node 24; `api/.nvmrc` uses Node 22 for
Azure Static Web Apps Functions). `npm test` strips TypeScript types without
checking them, so run both gates locally:

```bash
npm ci
npm --prefix api ci && npm --prefix web ci && npm --prefix pwa-token-api ci && npm --prefix pwa-browser ci
npm test
npm run typecheck
```

To run skills locally against your own account, copy your `STFC_ACCOUNTS` JSON
into a `.env` file in the repo root:

```
STFC_ACCOUNTS=[{"name":"main","token":"<JWT>"}]
```

then run e.g. `npm run skill:check-auth`. The `.env` file is gitignored and
must never be committed or read by automated agents.

---

## Contributing, security, sponsorship & license

- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md) for test-first bug
  fixes, test registration (`tests/index.test.ts`), cross-platform rules, and PR
  gates.
- **Security:** see [SECURITY.md](SECURITY.md) to report vulnerabilities
  privately via GitHub Security Advisories. Never paste live tokens, OTPs, or
  account data into issues or pull requests.
- **Sponsorship:** support ongoing maintenance via
  [GitHub Sponsors (@cyrusjamula)](https://github.com/sponsors/cyrusjamula) (configured in
  [`.github/FUNDING.yml`](.github/FUNDING.yml)).
- **License:** original project code is licensed under the
  [Apache License 2.0](LICENSE) (`Copyright 2026 Jamula, Inc.`). Third-party
  materials (including MIT-licensed upstream Squad templates under `.squad/` and
  `.github/skills/`) and linked external community references remain subject to
  their own license terms.

---

## Disclaimer

Automating interactions with the STFC web store may be against the
**Scopely** / **Star Trek Fleet Command** Terms of Service. Use at your own
risk — you, the operator, assume all responsibility for any consequences,
including but not limited to account suspension. This project is provided
for educational purposes and is not affiliated with or endorsed by Scopely,
Digit Game Studios, CBS, or Paramount.

---

## Control panel

The operator dashboard lives in `web/` (frontend) and `api/` (Azure
Functions). See [docs/SWA-SETUP.md](docs/SWA-SETUP.md) for deployment and
operator setup.
