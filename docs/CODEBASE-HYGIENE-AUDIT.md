# Codebase Hygiene, Duplicate-Blob & `.d.mts` Shim Audit (`#454`)

> Reproducible structural audit of `Jamula/stfc` across `src/`, `scripts/`,
> `api/`, `web/`, `worker/`, `pwa-token-api/`, `pwa-browser/`, `shared/`,
> `fixtures/`, and `.github/workflows/`. Builds directly on PR `#470`
> (`c73aa0b0`), PR `#468` (`b73f657f`), and PR `#467` (`3b542037`).

---

## 1. Executive summary & before/after metrics

| Metric | Pre-M03 crust baseline | Post-`#467`/`#468`/`#470` (`main` `4a77e4ee`) | Post-`#454` (`wt-m03` non-Squad hygiene) | Post-M03 combined (after `remove-squad` merge) |
|---|---:|---:|---:|---:|
| **Tracked files (`git ls-files`)** | `753` | `602` | `603` (`-1` `.d.mts`, `+2` M03 audit/TCO docs) | **`~422`** (`-181` Squad files / `-44%` vs `753`) |
| **Squad surface files** (`.squad/`, `.github/skills/`, `*squad*.yml`, `tests/squad/`) | `245` | `181` (`1,100,701` B) | Untouched in `wt-m03` for clean cherry-pick | **`0`** (removed by companion `remove-squad` branch) |
| **Byte-identical Git-blob groups** | `28+` | `28` (`58` paths) | `28` (`27` Squad mirror groups + `1` test fixture group) | **`1`** (`3` intentional auth-gate test fixtures, `615` B total) |
| **`.mjs` modules (`scripts/`, `shared/`)** | `20` | `19` | `19` (`12` library/hybrid + `7` CLI-only) | `19` |
| **Hand-maintained `.d.mts` shims** | `10` (+ `@ts-ignore` casts) | `13` (`548` lines) | **`12` (`370` lines, `-32.5%` shim LoC)** | **`12`** (`0` `@ts-ignore` casts, `100%` export parity enforced) |
| **Unreferenced exported value symbols in `scripts/*.mjs`** | `21` | `21` | **`0` (`28` unused `.mjs` exports removed)** | **`0`** |
| **Pull-request workflows triggered per PR** | `8` (`4` product + `4` Squad) | `8` | `8` (pre-Squad merge) | **`4`** (`test-gate`, `protected-paths`, `artifact-hygiene`, `swa-deploy`) |

### Prior crust already removed on `main` (`#470` `c73aa0b0` & `#468` `b73f657f`)

- **64** committed `*.local-backup` files across `.github/` and `.squad/templates/` (now `.gitignore`d and regression-tested).
- **70** frozen summer-2026 `data/digests/*.md` files on `main` superseded by `origin/automation-state` (`#241`).
- **4** redundant `.gitkeep` files in non-empty directories (preserving `data/discord/game-state/.gitkeep`).
- **1** unreferenced `scripts/fetch-discord-channel.mjs` script + unreachable dead code below the `#402` guard in `scripts/fetch-community-sheet.mjs`.
- **11** unwired prototype files (`src/crew/ocrPoc.ts`, `tests/crew/ocrPoc.test.ts`, `docs/pwa-login-prototype.md`, `scripts/pwa-demo.ts`, `shared/pwa-demo.ts`, `web/pwa-demo/**`, `web/src/pwa-demo.ts`, `web/vite.demo.config.ts`, `tests/web/pwa-login.test.ts`).

---

## 2. Byte-identical Git-blob inventory (`SHA-256`)

Programmatic `SHA-256` hashing of every tracked blob (`git ls-files`) identified
exactly **28 identical-content groups (58 paths)**:

| Group(s) | SHA-256 prefix | Paths | Bytes / copy | Classification | Disposition & consumer |
|---|---|---|---:|---|---|
| **1 – 27** (`27` groups) | `ade76536…` .. `ccf35630…` | `55` paths pairing `.squad/templates/**` with `.github/skills/*/SKILL.md` (`18`), `.squad/agents/*/charter.md` (`4`), `.squad/{rai,fact-checker}/policy.md` (`2`), `.github/workflows/squad-label-enforce.yml` (`1`), and `.squad/casting-policy.json` (`3`-way mirror) | `723` – `21,268` B (`167,850` B duplicated) | *Squad template mirrors* | **REMOVE (via M03 `remove-squad` branch)** — entire Squad framework, templates, skills, and workflows are retiring per owner direction |
| **28** (`1` group) | `d6cb33ddb8df77cb` | `tests/ci/fixtures/badPosition/_lib/auth.ts`, `tests/ci/fixtures/good/_lib/auth.ts`, `tests/ci/fixtures/goodTryWrap/_lib/auth.ts` | `205` B (`3` copies) | *Intentional test-fixture isolation* | **KEEP** — `tests/ci/check-api-auth.test.ts` invokes `node scripts/ci/check-api-auth.mjs --api-dir <fixtureDir>` against self-contained Function directory trees; enforced as the sole non-Squad allowance in `tests/ci/coding-style-invariants.test.ts` |

---

## 3. Candidate hypothesis dispositions & consumer map

Every candidate area raised in `#454` was traced across `src/`, `scripts/`,
`api/`, `web/`, `worker/`, `pwa-token-api/`, `pwa-browser/`, `shared/`,
`package.json` scripts, `.github/workflows/*.yml`, `staticwebapp.config.json`,
`Dockerfile`s, and `tests/`:

### 3.1 Re-exports, lockfiles, guards & standalone fixtures

| Path(s) | Hypothesis in `#454` | Verified consumers / invariants | Disposition | Rollback if ever changed |
|---|---|---|---|---|
| `api/_lib/github-raw.ts` (`43` B) vs `api/src/_lib/github-raw.ts` (`7,722` B) | Lightweight re-export; check if redundant | **Load-bearing compatibility barrel:** pinned in `.github/workflows/protected-paths.yml` (`REQUIRED_FILES` after the `accf751` 11-day outage), covered in `package.json` `test:coverage` (`--include="api/_lib/**/*.ts"`), and imported directly by `tests/api/github-raw.test.ts`, while `api/src/_lib/dashboard.ts` imports `api/src/_lib/github-raw.ts` | **KEEP (Intentional Compatibility Layer)** | N/A — kept intact |
| `package-lock.json`, `api/package-lock.json`, `web/package-lock.json`, `worker/package-lock.json`, `pwa-browser/package-lock.json`, `pwa-token-api/package-lock.json` | 6 lockfiles across tree | Each backs an independent deployable build root (`Node 24` CLI, `Node 22` Azure Functions, Vite SPA, Cloudflare Worker, 2 isolated Docker builds) and is pinned in `test-gate.yml` `cache-dependency-path` (`tests/workflows/workflow-consolidation.test.ts`) and `.github/dependabot.yml` | **KEEP (Distinct Deployable Packages)** | N/A — kept intact |
| `scripts/fetch-community-sheet.mjs` (`616` B) | Unreferenced from `src/` or workflows | Intentional fail-closed `#402` redistribution guard (`Community sheet mirroring is disabled (#402)`), referenced in `docs/stfc-knowledge/community-reference-sheet/README.md` and `tests/scripts/communitySheetLinks.test.ts` | **KEEP (Licensing & IP Guard `#402`)** | N/A — coordinate with `#402` before removing |
| `fixtures/artifact-hygiene/contaminated-spec.md` (`2,324` B) | Lone root `fixtures/` directory outside `tests/` | Must live outside `scripts/check-artifact-hygiene.mjs`'s `WATCHED_PREFIXES` (`tests/` is watched, so placing negative secret samples under `tests/` would break repo-wide hygiene runs). Now actively executed by `tests/ci/coding-style-invariants.test.ts` to prove all 6 secret regexes fail closed | **KEEP + ACTIVE TEST COVERAGE** | `git checkout HEAD -- fixtures/artifact-hygiene/contaminated-spec.md` |
| `src/crew/diff.ts` (`93` LoC) | Imported by `tests/crew/diff.test.ts`, not yet wired to a CLI verb | Documented Crew Optimizer domain primitive (`docs/ARCHITECTURE.md` §3.3, `specs/004-crew-optimizer/research.md`) with symmetric delta unit coverage (`tests/crew/diff.test.ts`), ready for roster import/sync reporting (`spocks.club` `#473` / `#453`) | **KEEP (Documented Domain Primitive)** | N/A — kept intact |
| `src/discord/redditFeed.ts` (`296` LoC) | Currently imported by `tests/discord/redditFeed.test.ts` | Newly landed in PR `#473` (`4a77e4ee`, `2026-11-27`) for M01/M02 Reddit Atom/RSS promo discovery (`#369`) | **KEEP (Active M01/M02 Feature Module)** | N/A — active stream |
| `scripts/ci/check-api-auth.mjs` & `scripts/ci/check-bundle-budget.mjs` | Not invoked as standalone steps in `test-gate.yml` | Executed as subprocesses inside `tests/ci/check-api-auth.test.ts` and `tests/ci/check-bundle-budget.test.ts` during every `npm test` run; documented in `docs/ARCHITECTURE.md` §5.4 | **KEEP (Enforced via `npm test`)** | N/A — kept intact |
| `scripts/azure/create-swa.sh` & `recover-auth.ps1` | Not imported by TS | Operator bootstrap/recovery entrypoints documented in `docs/SWA-SETUP.md` and `docs/SETUP.md` | **KEEP (Operator Entrypoints)** | N/A — kept intact |

### 3.2 `.mjs` + `.d.mts` pairing audit & dead-export pruning

`tests/scripts/pre-commit.test.ts` (`evaluateMjsDeclarationPairing` and
`findTsStyleAndImportViolations`, added in PR `#467` `3b542037`) enforces two
real-repository invariants across `scripts/` and `shared/`:

1. Every `.mjs` file that exports at least one value symbol **must** have a
   paired `.d.mts` file with **exact 1:1 value-export parity**.
2. Active `.ts` files **must not** suppress `.mjs` imports with `// @ts-ignore`
   or `// @ts-expect-error`.

Auditing all `19` `.mjs` modules against actual external callers revealed **28
module-internal symbols** that were unnecessarily marked `export` in `4` `.mjs`
scripts — forcing hand-written `.d.mts` shims (including an entire standalone
`60`-line `.d.mts` file on a CLI-only script with zero importers):

| `.mjs` module | Paired `.d.mts` | External runtime / workflow callers | Test importers | Action taken in `#454` |
|---|---|---|---|---|
| `scripts/discord-ops/set-discord-app-metadata.mjs` | ~~`set-discord-app-metadata.d.mts`~~ (**deleted**, `-60` LoC) | `.github/workflows/discord-ops.yml` (CLI subprocess only; FR-009 forbids `src/` imports) | Subprocess/text tests (`set-discord-app-metadata.test.ts`, `partial-success.test.ts`, `endpoint-narrowing.test.ts`) — **zero ESM imports** | Unexported `11` internal CLI symbols (`DISCORD_API_BASE`, `redactString`, `parseArgs`, `detectImageMime`, `probeImageDimensions`, `loadIconAsDataUri`, `validateDescription`, `validateUsername`, `DiscordApiError`, `discordPatch`, `runCli`) and **removed `scripts/discord-ops/set-discord-app-metadata.d.mts`** |
| `scripts/discord-handler.mjs` | `scripts/discord-handler.d.mts` (`241` → `130` LoC, `-111` LoC) | `.github/workflows/discord-command-handler.yml` (CLI) | `tests/scripts/discordHandler.test.ts` (`sanitizeFilename`, `updateDailyIndexAtomic`, `updateDailyManifestAtomic`, `uploadR2Object`, `resolveResponseText`, `runCli`) | Unexported `13` internal-only helpers (`validatePayload`, `validateGameStatePayload`, `sanitizeLine`, `parseAllowedGuildIds`, `assertGuildAllowed`, `validateCdnUrl`, `formatRedeemStatus`, `triggerRedeemWorkflow`, `postDiscordFollowup`, `downloadDiscordAttachment`, `r2ConfigFromEnv`, `deleteR2Object`, `handleGameStateCommand`) and pruned their `.d.mts` declarations |
| `scripts/discord-monitor-state.mjs` | `scripts/discord-monitor-state.d.mts` (`16` → `12` LoC) | `.github/workflows/discord-monitor.yml` (CLI) | `tests/scripts/discordMonitorState.test.ts`, `tests/workflows/automation-state-race.test.ts` | Unexported `3` internal path constants (`DISCORD_MONITOR_STATE_FILES`, `DISCORD_MONITOR_STATE_DIRECTORIES`, `DISCORD_MONITOR_PROMO_CODES`) and pruned `.d.mts` |
| `scripts/dead-token-alert.mjs` | `scripts/dead-token-alert.d.mts` (`46` → `44` LoC) | `.github/workflows/redeem.yml` (CLI), `scripts/degraded-gift-alert.mjs` (`findAlertIssue`, `resolveDeadTokenAlert`) | `tests/scripts/deadTokenAlert.test.ts` | Unexported unused `DEFAULT_REQUIRED_LABELS` constant and pruned `.d.mts` |
| `scripts/automation-state-retry.mjs` | `scripts/automation-state-retry.d.mts` | `redeem.yml`, `discord-monitor.yml`, `scripts/discord-handler.mjs` | `tests/workflows/automation-state-git.test.ts` | **KEEP** — all `3` exports actively imported |
| `scripts/capture-token.mjs` | `scripts/capture-token.d.mts` | `package.json`, `recover-auth.ps1`, `pwa-browser/src/playwright-login.ts`, `scripts/refresh-account.mjs` | `tests/scripts/captureTokenMerge.test.ts`, `tests/scripts/captureTokenOtp.test.ts` | **KEEP** — all `7` exports actively imported across `pwa-browser/` and tests |
| `scripts/degraded-gift-alert.mjs` | `scripts/degraded-gift-alert.d.mts` | `.github/workflows/redeem.yml` (CLI) | `tests/scripts/degradedGiftAlert.test.ts`, `tests/skills/runAll.test.ts` | **KEEP** — all `4` exports exercised by tests |
| `scripts/lib/generate-contracts.mjs` | `scripts/lib/generate-contracts.d.mts` | `scripts/build-contracts.mjs`, `scripts/ci/check-contracts-types.mjs` | `tests/contracts/types-sync.test.ts` | **KEEP** — all `5` exports actively imported |
| `scripts/merge-promo-codes.mjs` | `scripts/merge-promo-codes.d.mts` | `redeem.yml`, `scripts/discord-monitor-state.mjs` | `tests/scripts/mergePromoCodes.test.ts` | **KEEP** — all `4` exports actively imported |
| `scripts/pre-commit-checks.mjs` | `scripts/pre-commit-checks.d.mts` | `scripts/pre-commit.mjs` | `tests/scripts/pre-commit.test.ts` | **KEEP** — all `2` exports actively imported |
| `scripts/pre-push.mjs` | `scripts/pre-push.d.mts` | `package.json` (`simple-git-hooks`) | `tests/scripts/pre-push.test.ts`, `tests/scripts/pre-commit.test.ts` | **KEEP** — all `3` exports actively imported |
| `scripts/refresh-account.mjs` | `scripts/refresh-account.d.mts` | `redeem.yml`, `check-recovery-auth.yml` | `tests/workflows/refresh-account.test.ts` | **KEEP** — all `9` exports actively imported |
| `scripts/validate-token-accounts.mjs` | `scripts/validate-token-accounts.d.mts` | `refresh-token.yml` | Shared validator export `validateTokenAccountsJson` | **KEEP** — paired `1`-export validator |
| `shared/token-account-schema.mjs` | `shared/token-account-schema.d.mts` | `shared/token-accounts.ts`, `scripts/refresh-account.mjs`, `scripts/validate-token-accounts.mjs`, `redeem.yml`, `check-recovery-auth.yml` | Indirect via `token-pwa.test.ts` & `refresh-account.test.ts` | **KEEP** — cross-boundary JS/TS schema contract |
| `scripts/{build-contracts,check-artifact-hygiene,fetch-community-sheet,pre-commit,validate-discord-commands}.mjs`, `scripts/ci/{check-api-auth,check-bundle-budget,check-contracts-types}.mjs` (`8` CLI scripts — note `check-contracts-types.mjs` also has `0` exports) | None (`0` exports) | `package.json`, `.github/workflows/*.yml`, `tests/ci/*.test.ts` | Subprocess CLI invocation | **KEEP** — zero exports, no `.d.mts` needed |

### 3.3 Pull-request workflow deduplication inventory

| Workflow | Trigger | Purpose & status | Disposition |
|---|---|---|---|
| `.github/workflows/test-gate.yml` | `pull_request` (`**`) | Canonical required CI check (`npm test (required)`): artifact-hygiene diff scan + root, `api`, `web`, `pwa-browser`, `pwa-token-api`, `worker` installs, typechecks, and tests | **KEEP (Required Ruleset Gate)** |
| `.github/workflows/protected-paths.yml` | `pull_request` / `push` (`main`) | Canonical required shell-only path & Windows-filename guard (`verify`, `~10s`) | **KEEP (Required Ruleset Gate)** |
| `.github/workflows/artifact-hygiene.yml` | `pull_request` (watched paths) | Posts actionable PR remediation comment when secret patterns match; pinned by `tests/workflows/workflow-consolidation.test.ts` | **KEEP (PR Remediation Commenter)** |
| `.github/workflows/swa-deploy.yml` | `pull_request` / `push` (`main`) | Validates `api/` build & module load on **Node 22** (`api/.nvmrc`, distinct from `test-gate.yml`'s Node 24) and manages SWA preview/prod deploys | **KEEP (Node 22 Runtime Gate + Preview Deploy)** |
| `.github/workflows/auto-merge.yml` | `pull_request_target` + `*/15` cron | Enrolls eligible non-draft same-repo PRs in squash auto-merge when `AUTO_MERGE_APP_*` is configured | **KEEP** (`tests/workflows/auto-merge.test.ts` updated to validate 40-hex SHA pin on `actions/create-github-app-token` rather than hardcoding `v3.3.0`, unblocking Dependabot `#462`) |
| `squad-ci.yml`, `squad-preview.yml`, `squad-docs.yml`, `squad-heartbeat.yml` (+ `7` issue/release Squad workflows) | `pull_request`, `issues`, `push`, `workflow_run` | Duplicate Squad governance/validation workflows (`41.0%` of recent Actions runs) | **REMOVE (Handled in companion M03 `remove-squad` branch)** |

---

## 4. Rollback procedure

All `#454` hygiene changes are isolated to `.mjs`/`.d.mts` internal export
visibility, `.github/dependabot.yml` subpackage coverage, `auto-merge.test.ts`
SHA-format pinning, invariant tests in `tests/ci/coding-style-invariants.test.ts`,
and documentation:

```bash
# Full rollback of the M03 hygiene & policy commit if ever needed:
git revert <commit-sha>

# Or restore an individual declaration shim from git history:
git checkout <parent-sha> -- scripts/discord-ops/set-discord-app-metadata.mjs scripts/discord-ops/set-discord-app-metadata.d.mts
```
