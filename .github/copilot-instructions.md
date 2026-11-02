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

## Squad operating policy

Seven coordinates; Spock implements and tests; Data independently reviews the current substantive revision; Uhura owns documentation and operational guidance. `@copilot` is optional and is not automatically assigned.

Work autonomously within the user's request: address PR feedback, conflicts, failing tests, and CI; enable Agent merge and automatic merging where authorized and supported. Preserve required approvals and protections, and ask only when a genuine blocker or consequential decision needs a human. Do not mark a PR ready, deploy, run live redemption, change external configuration, or spend money without the applicable user authorization.

Consider fleet mode when work can be split safely, and use separate worktrees for parallel changes. When PRs are requested, use app-native stacked PRs for suitable dependent layers rather than forcing a stack for a small independent change.

The `two-layer` backend owns mutable Squad state. Read and write decisions and histories through the Squad state bridge, and use the native atomic casting protocol for the registry/history pair. Do not use direct `.squad/` file or Git operations as a fallback if the bridge is unavailable.

<!-- squad:copilot-instructions:start -->
# Copilot Coding Agent — Squad Instructions

You are working on a project that uses **Squad**, an AI team framework. When picking up issues autonomously, follow these guidelines.

## Coordinator Canary Check

**IMPORTANT — run this check on EVERY session start, before doing any work:**

Inspect your `agent_instructions` for the coordinator canaries. This is a **two-state payload-integrity check within a known Squad coordinator session**; it verifies whether the coordinator payload loaded fully or was visibly truncated. It is **not** proof that an agent with no canaries is safely non-Squad — wholly absent payloads and proven non-Squad agents require a host-level identity beacon before custom-agent instruction ingestion.

1. If the HEAD canary `SQUAD_COORDINATOR_CANARY_HEAD_b7d2` is **absent**, the Squad coordinator payload is not observable from inside this prompt. Treat non-Squad discrimination as an **OPEN host-level concern**; do not claim this check proved the current agent is non-Squad.
2. If the HEAD canary `SQUAD_COORDINATOR_CANARY_HEAD_b7d2` is **present** and the EOF canary `SQUAD_COORDINATOR_CANARY_a8f3` is **present**, the coordinator prompt loaded fully. Proceed with normal Squad behavior.
3. If the HEAD canary `SQUAD_COORDINATOR_CANARY_HEAD_b7d2` is **present** but the EOF canary `SQUAD_COORDINATOR_CANARY_a8f3` is **absent**, the coordinator prompt loaded but was **truncated** before the end.

**When the coordinator prompt is truncated, you MUST:**
1. **STOP** — do not proceed with standard Squad behavior.
2. **WARN the user** with this exact message:
   ```
   ⚠️ Squad coordinator (squad.agent.md) loaded but appears to be truncated before the EOF canary. Do NOT proceed with standard Squad behavior — Squad's safety rails are incomplete. Please restart your session.
   ```
3. Do not continue with normal Squad routing, spawning, PR, or branch-protection behavior after emitting the warning.

## Team Context

Before starting work on any issue:

1. Read `.squad/team.md` for the team roster, member roles, and your capability profile.
2. Read `.squad/routing.md` for work routing rules.
3. If the issue has a `squad:{member}` label, read that member's charter at `.squad/agents/{member}/charter.md` to understand their domain expertise and coding style — work in their voice.

## Capability Self-Check

Before starting work, check your capability profile in `.squad/team.md` under the **Coding Agent → Capabilities** section.

- **🟢 Good fit** — proceed autonomously within the authorized assignment.
- **🟡 Needs review** — proceed within the authorized assignment and flag the scope for review.
- **🔴 Not suitable** — do NOT start work. Instead, comment on the issue:
  ```
  🤖 This issue doesn't match my capability profile (reason: {why}). Suggesting reassignment to a squad member.
  ```

## Branch Naming

Use the squad branch convention:
```
squad/{issue-number}-{kebab-case-slug}
```
Example: `squad/42-fix-login-validation`

## PR Guidelines

When opening a PR:
- Use `Closes #{issue-number}` only when the work fully resolves the issue; otherwise use a non-closing reference.
- If the issue had a `squad:{member}` label, mention the member: `Working as {member} ({role})`
- Data independently reviews every substantive revision, including changes by `@copilot`.
- Read relevant project decisions through the configured Squad state bridge.

## Decisions

Before any state mutation, verify your own `squad_state_health` response and the checkout-root health probe described in `.squad/templates/spawn-reference.md`; a parent session's result does not transfer. If you make a decision that affects other team members, create an inbox entry through `squad_state_create_if_absent` and verify it through `squad_state_read`. If creation or verification fails or cannot be attempted, report the unpersisted or unverified decision and its content in your handoff. Do not use `squad_decide`, which can overwrite another decision. Read relevant inbox entries as pending proposals, not accepted policy. If the verified `two-layer` state bridge is unavailable, report the limitation; do not write directly to `.squad/decisions/`.

The pinned runtime's memory index can lose concurrent updates. Do not use `memory.write` or other mutating `memory.*` tools; `memory.search` may be incomplete.
<!-- squad:copilot-instructions:end -->
