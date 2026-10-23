# stfc-gift-redeemer

A headless TypeScript CLI that automatically redeems web-store gifts and promo
codes from the **Star Trek Fleet Command** store. It is designed to run as a
scheduled GitHub Action every 15 minutes (~96 runs/day), so daily login bonuses,
free packs, and promotional codes are claimed without you ever opening the store
in a browser. Optionally monitors configured Discord channels for new promo codes
and player tips, harvesting both into a daily digest.

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
   [docs/SETUP.md](docs/SETUP.md) for multi-account and flag options.
2. **Confirm the `STFC_ACCOUNTS` GitHub secret is set.** If you let
   `capture-token` use `gh`, it's already done. Otherwise, paste the JSON
   `capture-token` wrote to `.env` into *Settings → Secrets and variables →
   Actions → STFC_ACCOUNTS*.
3. **Enable the `Redeem gifts` workflow** under the Actions tab. It will run
   on the cron schedule (every 15 minutes) from then on. You can also trigger
   it manually with the **Run workflow** button to verify everything works.

> **Optional 1:** if you'd rather never re-capture your JWT by hand when it
> expires (~30 days), set up the **`Refresh token` workflow** that logs in
> for you in CI. See [docs/SETUP.md](docs/SETUP.md#optional-fully-automated-token-refresh-in-ci)
> for the (small) extra setup.

> **Optional 2:** if you want to harvest promo codes and tips from the STFC
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

The JWT used as the `Authorization: Bearer …` header is taken from your
normal browser session (via the `npm run capture-token` Playwright helper)
and stored encrypted in a GitHub Actions secret named `STFC_ACCOUNTS`.

Optionally, you can also store your Scopely email + password as repo
secrets and let the **`Refresh token` workflow** log in for you weekly so
the JWT never goes stale — see
[docs/SETUP.md](docs/SETUP.md#optional-fully-automated-token-refresh-in-ci).

---

## Discord monitor (optional)

When configured, a scheduled workflow (`discord-monitor.yml`) runs every 4 hours to:

- Ingest messages from a curated list of STFC Discord channels
- Extract candidate promo codes using pattern matching
- De-duplicate codes against `promo-codes.txt` and prior run history
- Feed new codes into the existing redeem orchestrator
- Classify non-code messages as "tips/tricks/hacks" vs chatter
- Produce a daily digest summarizing: codes attempted + outcomes, classified guidance, ingestion health

**Currently shipped (Phases 0–3):**
- Ingestion, extraction, deduplication, cool-down management
- Auto-redeem integration (codes are attempted on the next scheduled redeem run)
- Daily digest with code outcomes and classified tips

**In development (Phase 4+):**
- Tips classification refinement and daily digest roll-up

To set up, see [specs/001-discord-monitor/quickstart.md](specs/001-discord-monitor/quickstart.md).
For the one-time bot creation, privileged-intent toggles, install URL, and
token rotation procedure, see [docs/DISCORD-BOT-SETUP.md](docs/DISCORD-BOT-SETUP.md).
This feature is entirely optional — the core redemption workflow works without it.

## Discord slash commands

Discord slash commands (e.g. `/redeem-status`, `/trigger-redeem`) are bridged via a Cloudflare Worker. The Worker verifies the Ed25519 signature, defers the interaction, and fires a `repository_dispatch` so the actual work runs in GitHub Actions.

**To set up the pipeline from scratch, see [`discord/RUNBOOK.md`](discord/RUNBOOK.md).** For technical details on the Worker, see [`worker/README.md`](worker/README.md).

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

The `optimize-crew.yml` workflow (pending PR #102) fires on push to `data/crew/**` and regenerates `docs/crew/` reports automatically.

v1.5 (iPhone OCR roster refresh) and v2 (read-only Discord `!crew` commands) are in development — see issues [#85](https://github.com/Jamula/stfc/issues/85) and [#91](https://github.com/Jamula/stfc/issues/91).

Full operator guide: **[docs/CREW-OPTIMIZER.md](docs/CREW-OPTIMIZER.md)**.

> A `.github/workflows/optimize-crew.yml` workflow regenerates `docs/crew/*.md` on every push that changes `data/crew/**`.

---

## Project structure

Built with help from [the Squad](docs/squad.md) — an AI team that lives under `.squad/`, managing the roadmap, code review, testing, and documentation. Read the squad page to understand who does what and how to route work.

### Squad Reviewer Gate (Recommended)

The **Squad Reviewer Gate** workflow has been reactivated (Actions state
`active`, verified 2026-10-10). It evaluates PR events and PR comments using
default-branch code, then publishes the **`Squad reviewer gate`** commit status
on the PR's current head SHA.

Every non-Dependabot PR must list required reviewers under `## Reviewer lanes`
in its body. Kirk provides technical review; Garak's independent co-review is
also required for `feat(*)` PRs touching `src/` and implementations of
Kirk-authored designs. Each declared reviewer posts a new PR comment beginning
with `**APPROVE**` (the ✅ emoji is conventional, not required), followed by
`**Reviewer:** Name` and `**Head:**` with the full current 40-character SHA in
backticks. The latest valid verdict by comment creation time wins; numeric
comment ID breaks equal-timestamp ties. Editing an older comment does not renew
it. Pushes make prior-head approvals stale. Missing lanes/verdicts, malformed
verdict comments, stale approvals, or a latest `**CHANGES_REQUESTED**` (⚠️ is
conventional, not required) fail the status.
PRs authored by `dependabot[bot]` are exempt.

Reactivation does **not** clear old failures or prove that branch protection
requires this status. A successful PR-triggered run has completed
([run #38109821087](https://github.com/Jamula/stfc/actions/runs/38109821087)),
but it was for a Dependabot PR, whose successful status is exempt from
reviewer-verdict evaluation. The successful-run condition listed in [Issue
#345](https://github.com/Jamula/stfc/issues/345) is therefore met; the issue
remains open. Green checks and reviewer approvals do not authorize merging: an
explicit user request is still required. See [the verdict contract and
enforcement limits](docs/REVIEWER-GATE.md) for the exact comment format and
break-glass runbook.

For issue-session and Ralph operation while the unidentified landing path in
[#220](https://github.com/Jamula/stfc/issues/220) remains unresolved, follow the
[PR landing safety runbook](docs/PR-LANDING-SAFETY.md). Assignment prompts are
guarded; host-side enforcement and post-idle acceptance still need owner evidence.

---

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
│       ├── redeem.yml              # scheduled gift redemption (every 10 min, 144/day)
│       ├── discord-monitor.yml     # optional: harvest codes & tips from Discord (every 4 hours)
│       ├── refresh-token.yml       # weekly JWT refresh via Playwright auto-login
│       ├── squad-test-gate.yml      # required typecheck + test gate on PRs
│       └── squad-reviewer-gate.yml  # current-head reviewer-verdict status
├── docs/
│   ├── SETUP.md                    # end-to-end setup guide
│   ├── squad.md                    # AI team members, capabilities, and how they work
│   ├── stfc-game-knowledge.md      # STFC game domain reference (Scopely sources)
│   ├── stfc-knowledge/
│   │   ├── README.md                       # knowledge-base lineage convention (6 fields)
│   │   └── community-reference-sheet/      # mirror of the JulesVern/Quasel/BlueMandalorian sheet
│   └── redeem-history.md           # frozen main seed; live log is on automation-state
├── specs/
│   └── 001-discord-monitor/
│       ├── spec.md                 # feature specification
│       ├── plan.md                 # architecture and design
│       └── quickstart.md           # operator setup for Discord monitor
├── scripts/
│   ├── capture-token.mjs           # Playwright-driven JWT capture
│   └── fetch-community-sheet.mjs   # refresh docs/stfc-knowledge community sheet mirror
├── src/                            # TypeScript source (api client, orchestrator, skills)
├── tests/                          # node:test suite
├── promo-codes.txt                 # human-maintained seed; operational copy is on automation-state
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

## Promo codes and automation state

Humans add and edit codes in `promo-codes.txt` on `main`. The scheduled
workflows keep their live operational copy, current redeem history, dead-code
cache, Discord state, and digests on the `automation-state` branch. The format
is dead simple:

- One code per line.
- Lines starting with `#` are ignored.
- Inline comments after a code (whitespace + `#`) are stripped.

```
# Star Trek Day 2024 promo
STARTREKDAY2024
FLEETCMD-WELCOME    # one-time welcome bonus
```

Each redeem and Discord-monitor run builds an additive union rooted in
`automation-state`:

1. start from the operational `automation-state` file, preserving its existing
   order and line representation (including Discord discoveries); then
2. append any *main-only* seed codes beneath `# --- seeded from main@<sha> ---`.

Codes are keyed by `trim().toUpperCase()` after stripping `#` comments.
Duplicate normalized lines are collapsed within each input before merging. For
a duplicate across both inputs, the `automation-state` line wins. Removing or
editing a code on `main` does **not** rewrite or delete the operational copy;
true deletion is intentionally deferred. The dead-cache lookup remains
case-sensitive and is a separate known limitation.

Codes are resubmitted on every scheduled run. If a code returns
`CODE_INVALID_OR_EXPIRED`, the orchestrator marks it dead in
`data/promo-code-dead.json` and skips it on future runs (no per-code API call
for skipped entries). Deleting the frozen file on `main` no longer resets
anything. To re-attempt all codes, make a normal forward commit on
`automation-state` that removes `data/promo-code-dead.json`.

### Automation-state operations

- **First run:** the writer creates a linked worktree from the authenticated
  checkout, switches it to an orphan `automation-state` branch, clears the
  inherited index, and commits only allowlisted state. No PAT, deploy key,
  bypass actor, or standalone `git init` repository is used.
- **Consumers:** `/redeem-status` reads live `docs/redeem-history.md`;
  `/game-state` reads and writes live `data/discord/game-state`; the storage
  monitor checks out `automation-state` directly.
- **Writer serialization:** `redeem.yml`, `discord-monitor.yml`,
  `refresh-token.yml`, and the `/game-state` path of
  `discord-command-handler.yml` share one `stfc-gift-redeemer` concurrency
  group so their `automation-state` pushes never interleave (a monitor run
  fetching the tip after a handler push landed previously let a wholesale
  directory replace silently delete the handler's upload). All four declare
  `queue: max`: up to 100 runs wait pending in FIFO order instead of the
  default `single`, which keeps only one pending run and lets a newer
  shared-group run cancel it. Past 100 pending runs the extra run is
  **cancelled visibly by Actions** and needs an operator re-dispatch — a
  loss-bounded queue, not a durable one. `queue: max` must never be combined
  with `cancel-in-progress: true`. `/redeem-status` and `/trigger-redeem`
  never write `automation-state` themselves, so each is isolated on its own
  per-command group instead of queuing behind scheduled runs.
- **Reset:** use `git revert` on `automation-state` to undo a bad state commit.
  Do not force-push. A proposed deletion/non-fast-forward-only ruleset (no
  required checks or bypass actors) is not installed and still requires fresh
  Picard approval.
- **Rollback:** preserve the live allowlisted files in a reviewed `main` PR,
  then revert the workflow change. The state branch can remain for audit; there
  are no credentials or live ruleset changes to unwind.
- **Validation:** GitHub Actions currently provides zero execution evidence
  while the account-level billing block in #218 prevents jobs from starting.
  Local gates are `npm test` and `npm run typecheck`. After #218, dispatch
  redeem twice (run 2 must retain run 1 history), dispatch Discord monitor,
  exercise `/redeem-status` and `/game-state`, and verify `main`'s tip SHA is
  unchanged while commits land on `automation-state`.

Promo-code redemption retries transient failures up to **3 total attempts**
(initial + 2 retries), sleeping **1s then 2s** by default:

- Transient: network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`,
  `EAI_AGAIN`, `ECONNREFUSED`), HTTP `500/502/503/504` (and other 5xx), and
  HTTP `429` (uses `Retry-After` when present, otherwise default sleep).
- Non-transient: HTTP 4xx except 429, `TOKEN_EXPIRED`, and
  `CODE_INVALID_OR_EXPIRED` (dead-code path, not retried).

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
**not** stop other accounts from being processed. If every configured account
returns **TOKEN_EXPIRED** and there are no infrastructure errors, the
`run-all` skill exits with code **2** so the workflow fails as a clear
secret-rotation signal. Mixed runs still exit 0; infrastructure failures exit 1.

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

A web-based operator dashboard is in progress under `web/` (frontend) and `api/` (Azure
Functions). It is deployed as an Azure Static Web App — see **[docs/SWA-SETUP.md](docs/SWA-SETUP.md)**
for the one-time Azure resource creation runbook and deployment-token setup.
