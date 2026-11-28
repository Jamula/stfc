# Hosting, CI & Token-Service TCO and Target Topology (`#455`)

> Evidence-based monthly and annual total-cost-of-ownership (TCO) inventory and
> consolidation analysis for `Jamula/stfc` (`0.1.0` baseline). Separates
> **verified measured repository telemetry**, **published provider rates and
> free-tier caps**, and **unmeasured external-account unknowns** requiring
> separate Azure or Cloudflare billing read access.
>
> **Status:** Architecture & cost baseline (`M03.01` / `#455`). Phase A
> hygiene/simplification actions require zero paid cloud changes; Phase B
> single-plane consolidation remains a roadmap evaluation alongside `#453`
> (read-only companion MCP surface) and `#416` (structured vision extraction),
> not an active migration without explicit owner authorization.

---

## 1. Data sources, measurement window & billing API probes

All repository-accessible measurements below were captured read-only on
**`2026-11-28T03:21Z–03:23Z`** against `Jamula/stfc`:

| Probe / source | Result / HTTP status | Measured value |
|---|---|---|
| `gh api repos/Jamula/stfc` | `HTTP 200 OK` | `visibility: "public"` (`private: false`), repo size `12,424 KB` (`12.13 MiB`), created `2026-01-14T06:23:04Z` |
| `gh api repos/Jamula/stfc/actions/cache/usage` | `HTTP 200 OK` | `41` active caches totaling **`7,579,957,478` bytes (`7.06 GiB` / `7.58 GB`)** — `75.8%` of GitHub's `10 GB` per-repo LRU cache cap |
| `gh api 'repos/Jamula/stfc/actions/runs?per_page=100&page=1..3'` | `HTTP 200 OK` | `607` retained runs total; latest `300` runs span `64.74` hours (`2026-11-25T10:37:13Z` → `2026-11-28T03:21:32Z`, **~`111.2` runs/day** during active M01–M03 development) |
| `git ls-tree -r -l origin/automation-state` | Exit `0` | `115` tracked blobs totaling **`208,358` bytes (`203.5 KiB`)**; `data/discord/game-state` holds `0` binary bytes in Git (`100 MB` alert threshold in `storage-size-monitor.yml`) |
| `gh variable list --repo Jamula/stfc` | Exit `0` | `0` repository Actions variables configured (`AZURE_*` OIDC variables and `AUTO_MERGE_APP_CLIENT_ID` are currently unset) |
| `gh secret list --repo Jamula/stfc --json name` | Exit `0` | `8` secret names present (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DISCORD_BOT_TOKEN`, `STFC_ACCOUNTS`, one `STFC_ACCOUNT_REFRESH_*` override, `STFC_EMAIL`, `STFC_PASSWORD`, `STFC_REFRESH_PAT`); `AZURE_STATIC_WEB_APPS_API_TOKEN` is currently unset |
| `gh api orgs/Jamula/settings/billing/actions` & `/shared-storage` | `HTTP 410 Gone` | Legacy GitHub billing v1 REST endpoints are retired; enhanced org billing (`/organizations/{org}/settings/billing/usage`) requires `admin:org` / billing-manager scope unavailable to standard session tokens |
| `gh api users/Jamula/settings/billing/actions` & `user/settings/billing/actions` | `HTTP 404 Not Found` | Legacy user billing endpoints unavailable for org-owned repository `Jamula/stfc` |
| Azure Cost Management / Container Apps / Storage metrics | Not connected | **Unmeasured unknown** — requires owner-approved Azure Reader / Cost Management Reader access |
| Cloudflare R2 / Workers analytics | Not connected | **Unmeasured unknown** — requires owner-approved Cloudflare Analytics / R2 read token |

---

## 2. Active service, identity, storage & workflow inventory

### 2.1 Compute, storage, and identity surfaces (`0.1.0` baseline)

| # | Service / runtime | Source directory / config | Identity & auth boundary | Region / tier | Measurable usage unit | Current live state (`2026-11-28`) | Cost classification |
|---|---|---|---|---|---|---|---|
| 1 | **GitHub Actions** (`ubuntu-latest` 2-vCPU Linux runners) | `.github/workflows/*.yml` (`29` workflows pre-Squad removal; `18` non-Squad) + dynamic CodeQL / Dependabot / Copilot | Per-job `GITHUB_TOKEN`, optional `azure/login` OIDC (`id-token: write`), optional `AUTO_MERGE_APP_*` | GitHub-hosted standard Linux (`public` repo) | Runner minutes, cache GB (`7.58 GB / 10 GB`), artifact MB | Active (`~111` runs/day during dev; crons underdeliver per `#184`) | **Verified `$0.00/mo` while public** (unlimited standard runner minutes on public repos) |
| 2 | **Git operational store** (`origin/automation-state`) | Orphan branch restored/pushed via detached worktrees (`redeem.yml`, `discord-monitor.yml`, `discord-command-handler.yml`) | `GITHUB_TOKEN` (`contents: write`) + `Automation state protection` ruleset + `stfc-gift-redeemer` `queue: max` lock | GitHub Git storage | Repo size (`12.13 MiB` total; `203.5 KiB` on `automation-state`) | Active (`108` daily digests + dead-code/degraded JSON + `redeem-history.md`) | **Verified `$0.00/mo`** (included in GitHub repo hosting; grows ~`640 KiB/yr`) |
| 3 | **Azure Static Web Apps + Managed Functions** (`stfc-control-panel`) | `web/` (Lit 3 + Vite SPA), `api/` (Azure Functions v4, Node 22), `staticwebapp.config.json`, `scripts/azure/create-swa.sh` | GitHub OAuth `stfc_operator` role + `requireAllowedUser` (`STFC_ALLOWED_USERS`) + `requireOwner` (`STFC_OWNER`) | `eastus` default, **Free SKU** | Bandwidth (`100 GB/mo` free), static bundle (`<80 KiB` gzipped), Function calls | `AZURE_STATIC_WEB_APPS_API_TOKEN` unset in GitHub (`deploy` job skips; `validate-api-node-22` runs) | **Free within caps (`$0.00/mo`)** on SWA Free SKU; Azure portal state **unmeasured** |
| 4 | **Token API Container App** (`pwa-token-api/`) | `pwa-token-api/Dockerfile` (Node 24 HTTP server) | Shared bearer `PWA_TOKEN_API_KEY` from SWA gateway + System-Assigned Managed Identity (`Storage Blob Data Contributor`) | Owner Azure subscription, Container Apps Consumption | vCPU-seconds, GiB-seconds, HTTP requests, ACR/GHCR image storage | Provisioning & `minReplicas` **unknown** in repo (`AZURE_*` vars unset in GitHub) | **Free within grant (`$0.00/mo`) if `minReplicas: 0` + GHCR**; **est. `$8–$35/mo` if warm (`minReplicas: 1`)** |
| 5 | **Browser Relay Container App** (`pwa-browser/`) | `pwa-browser/Dockerfile` (Node 24 + headless Chromium Playwright, `maxReplicas: 1`) | Internal-only Container Apps ingress + shared `PWA_BROWSER_KEY`; **zero** Azure Blob or public network identity | Owner Azure subscription, Container Apps Consumption (`maxReplicas: 1`) | vCPU-seconds, GiB-seconds during interactive OTP login (~`60–120s`/session) | Provisioning & `minReplicas` **unknown** in repo | **Free within grant (`$0.00/mo`) if `minReplicas: 0`**; **est. `$16–$35/mo` if kept warm (`minReplicas: 1`)** |
| 6 | **Azure Blob Storage + Entra OIDC** (`accounts.json`) | Read by `redeem.yml` & `discord-monitor.yml`; written via ETag by `pwa-token-api/` | Entra Federated Credential (`Storage Blob Data Reader` on `refs/heads/main`) + separate migration identity | Owner Azure Storage account (Hot LRS) | Stored GB (`<10 KiB` JSON), read/write ops (`~100–4,500` reads/mo) | `AZURE_*` repo variables unset (`redeem.yml` uses secret fallback; `discord-monitor.yml` fails preflight) | **Est. `<$0.02/mo` (`<$0.25/yr`)** at Hot LRS published rates when active |
| 7 | **Cloudflare Worker** (`stfc-discord-bridge`) | `worker/` (`wrangler.toml`, `@noble/ed25519` over Web Crypto) | Discord Ed25519 signature check + `ALLOWED_GUILD_IDS` fail-closed + fine-grained `GH_DISPATCH_TOKEN` | Cloudflare global edge (Workers Free) | Requests/day (`100,000/day` free), CPU ms (`10 ms/invocation` free) | `CLOUDFLARE_ACCOUNT_ID` & `CLOUDFLARE_API_TOKEN` secrets present; `deploy-cloudflare-worker.yml` green | **Free within caps (`$0.00/mo`)** at operator command volume (`<100` req/mo) |
| 8 | **Cloudflare R2** (`stfc-game-state`) | `scripts/discord-handler.mjs` (`/game-state` S3 SigV4 `PUT`/`DELETE`, metadata committed to `automation-state`) | Scoped R2 S3 API credentials (`CLOUDFLARE_R2_*`), `access: "signed-url-required"`, daily cap `20` files / `100 MiB` | Cloudflare R2 (`auto` region), `retention: "forever"` | Stored GB-mo (`10 GB/mo` free), Class A ops (`1M/mo` free), Class B ops (`10M/mo` free), `$0` egress | Active code path; actual stored object count/bytes in R2 **unknown** without R2 API read access | **Free within caps (`$0.00/mo`) up to `10 GB`**; `$0.015/GB-mo` beyond `10 GB` |

### 2.2 External non-billed upstream dependencies

- **Scopely STFC Web Store v2 API** (`cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2`, `home.startrekfleetcommand.com`): player-authenticated HTTPS store endpoints (`0` direct cost; rate-limit / token-expiry governed by `src/api/client.ts` bounded retries and `data/promo-code-dead.json` dead-code cache).
- **Discord REST & Interactions API v10** (`discord.com/api/v10`): free bot/webhook API within standard per-route rate limits (`src/discord/` enforces `PER_CHANNEL_PAGE_CAP` and `!crew` per-user/channel rate limits).
- **Reddit public Atom/RSS feed** (`www.reddit.com/r/startrekfleetcommand/new/.rss`): read-only public XML/JSON discovery (`src/discord/redditFeed.ts`, `#473`).
- **`spocks.club` manual export import** (`src/crew/spocksClub.ts`, `#473`): offline local CLI file import (`0` runtime network dependency).
- **HuggingFace / npmjs artifacts** (`@huggingface/transformers` `Xenova/all-MiniLM-L6-v2` local ONNX embeddings rebuilt only on `docs/stfc-knowledge/**`, `data/crew/officers.json`, or `data/crew/tasks/**` pushes via `knowledge-rebuild.yml`).

### 2.3 Measured GitHub Actions workflow volume & billable-minute profile

GitHub rounds each job's execution duration **up to the next whole minute** when
computing private-repository billable minutes. The table below combines exact
cron schedules from `.github/workflows/*.yml` with measured wall-clock durations
from the 300-run sample (`64.74` hours):

| Workflow Category | Workflows | Trigger / Nominal Schedule | Observed Runs / Day (`64.74h` sample) | Avg / P90 Wall-Clock | Private-Repo Billable Min / Run | Observed Est. Min / Mo | Nominal Ceiling Min / Mo (if 100% cron delivery) |
|---|---|---|---:|---:|---:|---:|---:|
| **Scheduled gift redemption** | `redeem.yml` | `*/10 * * * *` (`144/day` nominal) | `2.97` (`37.2` in `#184`) | `38s` / `47s` | `1 min` | `90 – 1,120` | `4,320` |
| **Scheduled PR auto-merge sweep** | `auto-merge.yml` | `*/15 * * * *` + `pull_request_target` (`96/day` nominal) | `14.46` (`3.0` cron + `11.5` PR) | `9s` / `10s` | `1 min` | `434` | `2,880+` |
| **Scheduled Discord monitor** | `discord-monitor.yml` | `15 */4 * * *` (`6/day` nominal) | `2.22` | `36s` / `50s` | `1 min` | `67 – 180` | `180` |
| **Scheduled storage monitor** | `storage-size-monitor.yml` | `0 6 * * *` (`1/day` nominal) | `1.11` | `9s` / `11s` | `1 min` | `30 – 33` | `30` |
| **Core PR & push CI gates** | `test-gate.yml`, `protected-paths.yml`, `artifact-hygiene.yml`, `swa-deploy.yml` | `pull_request` / `push` | `27.8` (dev burst) / `~3` steady-state | `test-gate` `132s` (`3m`), others `10–12s` (`1m`–`2m`) | `1 – 3 min` | `180` (steady) / `1,350` (burst) | Activity-driven |
| **Dynamic security & Dependabot** | CodeQL (`code-scanning` + `code-quality`), Dependabot (`7` weekly groups), Copilot review | Weekly + `push`/`pull_request` | `15.9` (dev burst) / `~2` steady-state | `31–80s` (`1–2m`), review `314s` (`6m`) | `1 – 6 min` | `90` (steady) / `750` (burst) | Activity-driven |
| **On-demand / release ops** | `deploy-cloudflare-worker.yml`, `knowledge-rebuild.yml`, `release.yml`, `discord-command-handler.yml`, `cleanup-old-runs.yml`, `check-recovery-auth.yml`, `refresh-token.yml`, `discord-ops.yml`, `discord-register-commands.yml`, `secrets-check.yml` | `workflow_dispatch` / path-filtered `push` / `repository_dispatch` | `2.2` | `23–50s` | `1 – 2 min` | `20 – 80` | On-demand |
| **Squad multi-agent workflows (Retiring in M03)** | `squad-triage`, `squad-label-enforce`, `squad-issue-assign`, `squad-preview`, `squad-ci`, `squad-heartbeat`, `squad-docs`, `squad-release`, `squad-promote`, `squad-insider-release`, `sync-squad-labels` (`11` files) | `issues`, `pull_request`, `push`, `workflow_run` | **`45.6` (`41.0%` of all runs!)** | `2–29s` | `1 min` | **`0` post-M03** (`~1,370` pre-M03) | Eliminated |

**Key CI telemetry takeaways:**
1. **While `Jamula/stfc` remains public, GitHub Actions compute TCO is `$0.00/mo`.**
2. **If `Jamula/stfc` ever switches to private visibility**, `redeem.yml` (`*/10`) + `auto-merge.yml` (`*/15`) have a combined nominal schedule of **`7,200` billable minutes/month** (exceeding GitHub Free's `2,000` min/mo and Pro's `3,000` min/mo quotas, adding **~$25–$31/mo** at `$0.006/min` standard 2-core Linux overage if GitHub delivers every cron tick, or ~$0–$6/mo under typical cron throttling). Reducing `redeem.yml` to `*/30` (`1,440` min/mo) and making `auto-merge.yml` event-only (`pull_request_target` + `check_suite`, dropping `2,880` idle cron runs/mo) keeps private-repo Actions completely inside the Free `2,000` min/mo tier.
3. **Retiring the 11 Squad workflows immediately removes `41.0%` of observed workflow dispatches** and eliminates 3 duplicate PR validation runs (`squad-ci.yml`, `squad-preview.yml`, `squad-docs.yml`) on every pull request.

---

## 3. Monthly & annual TCO matrix and sensitivity analysis

| Cost component | Verified actual (`0.1.0` public repo) | Free-tier / included cap | Low / Scale-to-Zero estimate | High / Misconfigured or Private-Repo sensitivity | Unknowns requiring cloud read access |
|---|---:|---|---:|---:|---|
| **GitHub Actions compute** | **`$0.00 / mo`** (`$0 / yr`) | Unlimited on public repos (`2,000`–`3,000` Linux min/mo if private) | `$0.00 / mo` | `$15.00 – $33.00 / mo` (`$180 – $396 / yr`) *only if repo becomes private without cron tuning* | Org-level private-repo Actions minutes consumed by sibling repos in `Jamula` |
| **GitHub Actions cache & artifacts** | **`$0.00 / mo`** (`7.58 GB` cache) | `10 GB` cache (LRU auto-evicted, never billed); `500 MB`–`2 GB` artifacts | `$0.00 / mo` | `$0.00 / mo` (cache evicts LRU > `10 GB`; no workflows upload large retained artifacts) | None (measured via `actions/cache/usage`) |
| **Azure Static Web Apps + Functions** | Unmeasured (`deploy` skipped) | Free SKU: `$0.00/mo`, `100 GB` egress, `0.5 GB` app, `25` users | **`$0.00 / mo`** (`$0 / yr`) | `$9.00 / mo` (`$108 / yr`) *only if manually upgraded to Standard SKU* | Confirm whether `stfc-control-panel` is provisioned on Free SKU or absent |
| **Azure Container Apps (`pwa-token-api` + `pwa-browser`)** | Unmeasured | `180k` vCPU-s, `360k` GiB-s, `2M` req/mo free per Azure sub | **`$0.00 / mo`** (`minReplicas: 0`, `<20` OTP logins/mo) | **`$24.00 – $70.00 / mo`** (`$288 – $840 / yr`) *if `minReplicas >= 1` keeps Playwright warm 24/7* | Confirm `minReplicas: 0` and whether containers are deployed |
| **Container Registry (ACR vs GHCR)** | Unmeasured | GHCR public/org free (`500 MB` private); ACR Basic `$5.00/mo` (`$0.167/day`) | **`$0.00 / mo`** (using `ghcr.io`) | **`$5.00 / mo`** (`$60 / yr`) *if Azure Container Registry Basic is provisioned* | Confirm whether an ACR instance exists in `stfc-control-panel-rg` |
| **Azure Blob Storage + Entra OIDC** | `$0.00 / mo` (vars unset) | Entra OIDC `$0`; Blob Hot LRS ~`$0.02/GB-mo` + `$0.004/10k` reads | **`$0.01 – $0.03 / mo`** (`<$0.36 / yr`) | `$0.10 / mo` (`$1.20 / yr`) even at 10× polling | Confirm whether storage account exists and holds other workloads |
| **Cloudflare Worker (`stfc-discord-bridge`)** | Unmeasured (`$0` expected) | `100,000` req/day free (`$0.00/mo`) | **`$0.00 / mo`** (`$0 / yr`) | `$5.00 / mo` (`$60 / yr`) *only if Workers Paid plan is enabled account-wide* | Confirm Workers Free vs Paid plan on `CLOUDFLARE_ACCOUNT_ID` |
| **Cloudflare R2 (`stfc-game-state`)** | Unmeasured | `10 GB-mo` storage, `1M` Class A, `10M` Class B, `$0` egress | **`$0.00 / mo`** (`<10 GB`, ~`2,000` 5 MB captures) | `$0.23 – $1.35 / mo` (`$2.70 – $16.20 / yr`) at `25–100 GB` (`retention: "forever"`) | Actual R2 bucket byte size and lifecycle rules (`#158` / `#164`) |
| **Total TCO** | **`$0.00 / mo` verified GitHub** | — | **`$0.00 – $0.05 / mo` (`<$0.60 / yr`)** | **`$29.00 – $118.00 / mo` (`$348 – $1,416 / yr`)** | Azure & Cloudflare billing consoles |

**Primary cost risk is NOT GitHub Actions or R2 — it is accidental idle compute (`minReplicas >= 1` on Azure Container Apps or an unused `$5/mo` Azure Container Registry).**

---

## 4. Consolidation options & tradeoff assessment

| Dimension | Option 0: Current `0.1.0` Baseline (6 runtimes, 2 clouds + Squad) | Option 1: Bounded Simplification — **Phase A (Recommended Now)** | Option 2A: Consolidated Cloudflare Edge Host — **Phase B Variant** | Option 2B: Consolidated `.NET LTS` Aspire Host — **Phase B Variant** |
|---|---|---|---|---|
| **Compute & state topology** | GitHub Actions (`29` workflows), `automation-state` branch, Azure SWA + Functions, 2 Container Apps, Azure Blob, CF Worker + R2 | **Retire 11 Squad workflows**; keep `src/` + SWA Free + CF Worker/R2; enforce `minReplicas: 0` + GHCR on Container Apps (or local `recover-auth.ps1`); add R2 `90d` lifecycle or `8 GB` cap | Single Cloudflare Worker (`fetch` + `scheduled` Cron Triggers) + **D1 / KV** state + **R2** media + Worker Secrets/KV for tokens + read-only MCP route (`#453`) | Single **C# `.NET LTS` Aspire** host (Azure Container App / Functions Isolated) + **Azure Table Storage** + **Key Vault / Blob** + read-only MCP route (`#453`) |
| **Monthly / annual TCO** | `$0.00–$0.05/mo` (or `$29–$75/mo` if CA warm / ACR Basic) | **`$0.00–$0.03/mo` (`<$0.36/yr`)** on public repo (`$0.00/mo` if private with `*/30` cron + event-only `auto-merge`) | **`$0.00–$5.00/mo` (`$0–$60/yr`)** within Workers/D1/KV/R2 free/paid tiers; independent of GitHub repo visibility | **`$0.00–$15.00/mo` (`$0–$180/yr`)** depending on timer wake strategy vs Consumption free grant |
| **Security & owner-only privacy boundary** | Strong: OIDC read-only Blob, `requireOwner` + internal-only `pwa-browser`, Ed25519 Discord verify; **but** `automation-state` history/digests are world-readable while repo is public | **Preserves all existing boundaries**; retiring Squad removes 4 `issues`/`pull_request_target` workflow surfaces; keeps `STFC_ACCOUNTS` out of browser/logs | **Improves data privacy**: moves `redeem-history`, `cursors`, and `digests` out of public `origin/automation-state` Git branch into private D1/KV | **Improves data privacy & single-cloud IAM**: moves operational state into private Azure Table/Blob under Entra Managed Identity; eliminates cross-cloud secrets |
| **Operational-state race & cron reliability** | Subject to GitHub cron underdelivery (`#184`: `1.55/hr` vs `6/hr`) and `stfc-gift-redeemer` `queue: max` (`100`-run cap) + linked-worktree rebase loops | Unchanged for `redeem.yml`/`discord-monitor.yml` (mitigated and regression-tested in `automation-state-race.test.ts`), `-41%` runner noise | **Eliminates Git worktree push races** (transactional SQLite D1 / atomic KV) and delivers deterministic sub-minute Cron Triggers + `<200 ms` slash commands | **Eliminates Git worktree push races** (ETag Table Storage) and delivers direct HTTP slash commands without `repository_dispatch` queuing |
| **Token OTP recovery UX** | Hosted `pwa-browser` Playwright relay OR local `recover-auth.ps1` / `scripts/refresh-account.mjs` | Same; recommends local `recover-auth.ps1` unless hosted mobile OTP capture is actively needed (with `minReplicas: 0`) | Local `recover-auth.ps1` pushing encrypted secret/KV, or Cloudflare Browser Rendering (requires Workers Paid `$5/mo`) | Native Playwright container sidecar (`minReplicas: 0`) inside the same Aspire deployment or local `recover-auth.ps1` |
| **Migration effort & risk** | None (status quo) | **Low (hours, zero runtime rewrite)** — M03 Squad removal + Dependabot/hygiene gates + operator checklist | **Medium–High (1–2 weeks)** — port Node `fs`/Playwright/ONNX RAG assumptions to WinterCG Worker APIs + migrate `automation-state` readers | **High (2–3 weeks)** — rewrite TypeScript skills into C# `.NET LTS` (aligned with repo technology preference for net-new systems) |
| **Reversibility** | Baseline | **Instant** (`git revert` on workflow/config changes; zero data migration) | Moderate (export D1/KV snapshot back to `automation-state` markdown/JSON) | Moderate (export Azure Table/Blob snapshot back to `automation-state`) |

---

## 5. Prioritized recommendations & acceptance gates

### Phase A — Execute immediately (`$0` spend, zero cloud provisioning)

1. **Retire all 11 Squad GitHub Actions workflows and template mirrors** (concurrent M03 `remove-squad` stream), eliminating `41.0%` of Actions run volume and 3 duplicate PR checks.
2. **Verify zero-idle Azure billing posture before enabling OIDC variables** (owner console check, no automated cloud mutation):
   - Confirm `pwa-token-api` and `pwa-browser` either do not exist yet or set **`minReplicas: 0` / `maxReplicas: 1`** (`az containerapp show --query properties.template.scale`).
   - Prefer **`ghcr.io/jamula/...`** over Azure Container Registry Basic to avoid a fixed `$5.00/mo` (`$60/yr`) registry floor.
   - Either populate the 6 `AZURE_*` OIDC repository variables so `discord-monitor.yml` stops failing preflight (`6/6` recent runs failed fast in `36s`), or disable `discord-monitor.yml`'s schedule until the Blob token store is active.
3. **Right-size cron schedules if `Jamula/stfc` ever becomes private:**
   - Remove `*/15 * * * *` from `auto-merge.yml` while `AUTO_MERGE_APP_CLIENT_ID` is unset (saving `2,880` no-op runs/mo), and change `redeem.yml` from `*/10` to `*/30` (`1,440` vs `4,320` nominal runs/mo) if private-repo runner quotas apply.
4. **Enforce Dependabot weekly grouped updates across all 6 npm manifests** (`/`, `/api`, `/web`, `/worker`, `/pwa-browser`, `/pwa-token-api`) + `github-actions` (`#316`) so security/routine bumps batch into at most `7` weekly PRs rather than per-package floods.

### Phase B — Defer single-plane runtime consolidation until `#453` / `#416` gate

Do **not** rewrite the working `0.1.0` redemption CLI solely for cost: on a
public repository with scale-to-zero containers, verified hosting TCO is already
**`~$0.00–$0.03/mo`**. Trigger Phase B consolidation **only** when one of these
explicit gates is met:

- **Privacy gate:** Owner decides to make `Jamula/stfc` **private** or move `redeem-history.md` / Discord digests off a public Git branch.
- **Feature gate (`#453` / `#416`):** Owner authorizes building the always-reachable authenticated read-only MCP companion server (`#453`) or live Discord screenshot vision ingestion (`#416`), where replacing `automation-state` Git worktree persistence with managed transactional state (Cloudflare D1/KV in Variant 2A, or C# `.NET LTS` Aspire + Azure Table Storage in Variant 2B per repository technology guidelines) pays back its engineering cost.

---

## 6. Zero-cost operator cost & storage alert thresholds

All thresholds below use native free provider controls or existing repository
workflows — **zero paid monitoring infrastructure** and **zero billing/account
identifiers in committed logs**:

| Surface | Metric | Warning threshold | Action / automated control |
|---|---|---|---|
| **GitHub `automation-state` Git tree** | `data/discord/game-state` size | **`>= 100 MB`** (`75 MB` clear target) | Already enforced daily by `.github/workflows/storage-size-monitor.yml` (`0 6 * * *`), opening `[storage] data/discord/game-state exceeds threshold` |
| **GitHub Actions cache** | `active_caches_size_in_bytes` | **`>= 8.5 GB`** (`85%` of `10 GB` LRU cap) | Probe via `gh api repos/Jamula/stfc/actions/cache/usage`; prune stale branch caches with `gh cache delete` if hit rate degrades |
| **GitHub Actions run history** | Retained `workflow_runs` count | **`>= 1,000` runs** | Dispatch manual `.github/workflows/cleanup-old-runs.yml` (`older_than_days: 7`) |
| **Azure subscription** (owner portal) | Monthly actual & forecasted spend | **`$1.00` actual / `$5.00` forecasted** | Configure a free **Azure Cost Management Budget** email alert on `stfc-control-panel-rg` (catches accidental `minReplicas: 1` or Standard SKU drift within 24h) |
| **Cloudflare R2** (owner dashboard) | `stfc-game-state` bucket storage & Class A ops | **`>= 8 GB` storage** (`80%` of `10 GB` free cap) or **`>= 800,000` Class A ops/mo** | Add a free **Cloudflare R2 bucket object-lifecycle expiration rule** (`90` or `180` days) once historical archive policy (`#164`) is approved |
