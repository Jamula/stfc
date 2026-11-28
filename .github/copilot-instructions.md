# Project Guide

Opening a pull request does not authorize merging it, enabling auto-merge, or
marking it ready; those actions require an explicit user request.

## Repository facts

- The working directory is `stfc-gift-redeemer`, but **the GitHub repo is `Jamula/stfc`**. Never infer the repo from the folder name.
- Node version comes from `.nvmrc` (currently `24`). Every workflow reads it; no workflow hardcodes a version.
- The repo is worked on from **both Windows and Linux Codespaces**. Keep tooling cross-platform.

## Technology preferences

- Prefer C# on a supported **.NET LTS** release for new tools and systems.
- When .NET is not viable for the target platform or integration, use **Node.js with JavaScript or TypeScript**.
- Avoid Python when possible; use it only when neither .NET nor Node.js is a suitable choice.
- These preferences guide new technology choices, not unsolicited rewrites of existing systems. Preserve the current stack when maintaining existing code.

## Build, test, and typecheck

`npm test` and `npm run typecheck` are **two independent gates**. `npm test` runs `node --import tsx --test`, which strips types without checking them — a type error can pass tests and still fail CI. Run both before pushing.

```bash
npm test                                  # full suite (~15s)
npx tsx --test tests/skills/runAll.test.ts   # single file — prefer this while iterating
npm run typecheck                         # tsc --noEmit
```

**New test files must be registered.** `npm test` runs a single aggregator, `tests/index.test.ts`, which is just a list of `import` lines. A test file that is not imported there **silently never runs**.

`scripts/*.mjs` have hand-written `.d.mts` declarations next to them. Adding an export to a `.mjs` means adding it to the `.d.mts`, or typecheck fails while tests pass.

Sub-packages have their own suites and dependencies: `web/` (Vite), `worker/` (vitest), `api/` (Azure Functions), `pwa-browser/` and `pwa-token-api/` (Container Apps typechecks).

## Git hooks

`npm ci` runs `prepare` → `simple-git-hooks`, which installs pre-commit and pre-push hooks that run the **full test suite** — on whatever machine ran `npm ci`, including CI runners.

Consequence: any workflow that commits generated output must use `git commit --no-verify`. Otherwise an unrelated failing test silently discards the workflow's own results. This is not hypothetical — it cost a redeem run its history rows *after* it had successfully claimed 16 gifts.

Locally, prefer fixing the failing test over habitually bypassing hooks.

## Architecture

- **`src/`** — the TypeScript CLI. `src/cli.ts` dispatches named skills (`run-all`, `check-auth`, `list-gifts`, `redeem-codes`, `discord-monitor`, `roster`, …); each lives in `src/skills/`. `src/api/` is the STFC web-store client (`client.ts` owns timeouts, retries, redaction and the typed-error taxonomy; `schemas.ts` holds permissive zod schemas). `src/lib/` holds cross-cutting helpers (`outcomes.ts`, `jwt.ts`, `redact.ts`, `summary.ts`).
- **`api/`** — Azure Functions backing the web control panel.
- **`web/`** — Vite frontend. **`worker/`** — Cloudflare Worker bridging Discord interactions.
- **`pwa-token-api/` & `pwa-browser/`** — private Azure Blob token-store API and internal-only headless-Chromium login relay backing the owner-only token-update PWA.
- **`scripts/`** — standalone `.mjs` utilities (token capture, pre-commit checks, CI helpers).
- **`.github/workflows/`** — `redeem.yml` is the core loop: download `accounts.json` from private Azure Blob Storage via GitHub OIDC (`STFC_ACCOUNTS_FILE`; legacy `STFC_ACCOUNTS` secret is unconfigured recovery/migration fallback only), claim gifts, redeem promo codes, and persist live state (`docs/redeem-history.md`, `data/promo-code-dead.json`, `data/redeem-degraded-state.json`, `promo-codes.txt`) to the `automation-state` branch.

## Conventions

**Schema tolerance, but never silent failure.** zod `.passthrough()` and all-optional gift fields are deliberate — the upstream API changes without notice. That tolerance must not leak into *failure handling*. Every operation resolves to an `Outcome`, and only genuinely benign outcomes count as expected; `UNKNOWN_RESULT`, `TOKEN_EXPIRED` and `TRANSIENT` mark the account degraded. Failures must be visible in stdout logs, the step summary, and the exit code.

This matters because it has failed before: `isExpectedOutcome()` once treated every outcome as benign, so a dead token produced green runs claiming nothing for 11 days. When adding a code path that can fail, ask what the run *reports* when it does.

**Exit codes from `run-all`:** `0` ok/partial, `1` infrastructure error, `2` all tokens rejected (refresh hosted tokens via the owner-only STFC token-update PWA, or local `.env` `STFC_ACCOUNTS` for local CLI runs).

**Don't burn API cycles.** Promo codes that return `CODE_INVALID_OR_EXPIRED` are recorded in `data/promo-code-dead.json` and skipped on later runs; transient errors retry twice. Preserve that behaviour.

**Secrets.** Never read `.env` or echo a token. Pipe values straight into `gh secret set` so they never enter logs or transcripts.

**Cross-platform.** No `:`/`*`/`?`/`"`/`<`/`>`/`|` in filenames — they are illegal on Windows, and a colon-named file that reaches the index can block every commit there. Use `2026-08-13T04-38-00Z`. When spawning `npm` from Node, pass `shell: true` on Windows (`npm` is `npm.cmd`). When parsing repo files, normalize CRLF — `core.autocrlf` means a Windows checkout has `\r\n`, and `split("\n")` with `$`-anchored regexes will silently match nothing.

## Operating and review policy

Substantive revisions should receive independent code review before merge. Work autonomously within the user's request: address PR feedback, conflicts, failing tests, and CI; enable Agent merge and automatic merging where authorized and supported. Preserve required approvals and protections, and ask only when a genuine blocker or consequential decision needs a human. Do not mark a PR ready, deploy, run live redemption, change external configuration, or spend money without the applicable user authorization.

Consider fleet mode when work can be split safely, and use separate worktrees for parallel changes. When PRs are requested, use app-native stacked PRs for suitable dependent layers rather than forcing a stack for a small independent change.

## Enforcement gates over existing state

Before adding or tightening a gate, classify every guarded path as static configuration or mutable runtime state. Static configuration must remain trackable and must not be swept into a mutable-state guard. Mutable runtime state—such as runtime-owned logs, sessions, scratch files, caches, and live operational outputs—must be excluded from the `main` source tree (`automation-state` or `.gitignore` as appropriate).

Any gate over existing repository state must ship its companion migration in the same PR. That migration must make the real checkout satisfy the gate, including untracking and ignoring mutable files and removing unsafe merge attributes where applicable. Add a test that inspects the actual repository invariant (for example, `git ls-files` and effective Git attributes), not just synthetic fixtures. Any exception must name the exact path and its required protocol.
