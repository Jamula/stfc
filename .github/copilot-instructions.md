# Project Guide

Opening a pull request does not authorize merging it, enabling auto-merge, or
marking it ready; those actions require an explicit user request.

## Repository facts

- The working directory is `stfc-gift-redeemer`, but **the GitHub repo is `Jamula/stfc`**. Never infer the repo from the folder name.
- Node version comes from `.nvmrc` (currently `24`). Every workflow reads it; no workflow hardcodes a version.
- The repo is worked on from **both Windows and Linux Codespaces**. Keep tooling cross-platform.

## Build, test, and typecheck

`npm test` and `npm run typecheck` are **two independent gates**. `npm test` runs `node --import tsx --test`, which strips types without checking them — a type error can pass tests and still fail CI. Run both before pushing.

```bash
npm test                                  # full suite (~15s)
npx tsx --test tests/skills/runAll.test.ts   # single file — prefer this while iterating
npm run typecheck                         # tsc --noEmit
```

**New test files must be registered.** `npm test` runs a single aggregator, `tests/index.test.ts`, which is just a list of `import` lines. A test file that is not imported there **silently never runs**.

`scripts/*.mjs` have hand-written `.d.mts` declarations next to them. Adding an export to a `.mjs` means adding it to the `.d.mts`, or typecheck fails while tests pass.

Sub-packages have their own suites and dependencies: `web/` (Vite), `worker/` (vitest), `api/` (Azure Functions).

## Git hooks

`npm ci` runs `prepare` → `simple-git-hooks`, which installs pre-commit and pre-push hooks that run the **full test suite** — on whatever machine ran `npm ci`, including CI runners.

Consequence: any workflow that commits generated output must use `git commit --no-verify`. Otherwise an unrelated failing test silently discards the workflow's own results. This is not hypothetical — it cost a redeem run its history rows *after* it had successfully claimed 16 gifts.

Locally, prefer fixing the failing test over habitually bypassing hooks.

## Architecture

- **`src/`** — the TypeScript CLI. `src/cli.ts` dispatches named skills (`run-all`, `check-auth`, `list-gifts`, `redeem-codes`, `discord-monitor`, `roster`, …); each lives in `src/skills/`. `src/api/` is the STFC web-store client (`client.ts` owns timeouts, retries, redaction and the typed-error taxonomy; `schemas.ts` holds permissive zod schemas). `src/lib/` holds cross-cutting helpers (`outcomes.ts`, `jwt.ts`, `redact.ts`, `summary.ts`).
- **`api/`** — Azure Functions backing the web control panel.
- **`web/`** — Vite frontend. **`worker/`** — Cloudflare Worker bridging Discord interactions.
- **`scripts/`** — standalone `.mjs` utilities (token capture, pre-commit checks, CI helpers).
- **`.github/workflows/`** — `redeem.yml` is the core loop: read `STFC_ACCOUNTS`, claim gifts, redeem promo codes, commit `docs/redeem-history.md`.

## Conventions

**Schema tolerance, but never silent failure.** zod `.passthrough()` and all-optional gift fields are deliberate — the upstream API changes without notice. That tolerance must not leak into *failure handling*. Every operation resolves to an `Outcome`, and only genuinely benign outcomes count as expected; `UNKNOWN_RESULT`, `TOKEN_EXPIRED` and `TRANSIENT` mark the account degraded. Failures must be visible in stdout logs, the step summary, and the exit code.

This matters because it has failed before: `isExpectedOutcome()` once treated every outcome as benign, so a dead token produced green runs claiming nothing for 11 days. When adding a code path that can fail, ask what the run *reports* when it does.

**Exit codes from `run-all`:** `0` ok/partial, `1` infrastructure error, `2` all tokens rejected (rotate `STFC_ACCOUNTS`).

**Don't burn API cycles.** Promo codes that return `CODE_INVALID_OR_EXPIRED` are recorded in `data/promo-code-dead.json` and skipped on later runs; transient errors retry twice. Preserve that behaviour.

**Secrets.** Never read `.env` or echo a token. Pipe values straight into `gh secret set` so they never enter logs or transcripts.

**Cross-platform.** No `:`/`*`/`?`/`"`/`<`/`>`/`|` in filenames — they are illegal on Windows, and a colon-named file that reaches the index can block every commit there. Use `2026-08-13T04-38-00Z`. When spawning `npm` from Node, pass `shell: true` on Windows (`npm` is `npm.cmd`). When parsing repo files, normalize CRLF — `core.autocrlf` means a Windows checkout has `\r\n`, and `split("\n")` with `$`-anchored regexes will silently match nothing.
