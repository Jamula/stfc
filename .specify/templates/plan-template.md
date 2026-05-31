# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For every principle below, state PASS / FAIL / N/A and (if not PASS) describe
the mitigation or record an entry in Complexity Tracking. The constitution
lives at `.specify/memory/constitution.md`.

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | User Safety & Trust First (NON-NEGOTIABLE) | | Acts only as a logged-in player could via the official store; credential-bearing strings surfaced from `src/` pass through `src/lib/redact.ts`; helper-script secret surfaces stay within the sanctioned channels in Principle V. **Chat-input addendum (v2.0.0):** if the change introduces a chat surface or any code path that lets external chat content (user messages, retrieved corpus, recent digests) reach a tool dispatcher, the dispatch MUST be gated by an HMAC-signed confirmation token bound to a canonical payload (actor, session, tool, args, reason, request_id, idempotency_key); execution MUST reject any mismatch. |
| II | Skill-Isolated CLI Architecture | | New behaviour lives behind the `src/cli.ts` dispatcher and a `src/skills/*.ts` module; skills return `{ result, exitCode }` and do not call `process.exit` from `src/`; shared logic stays in `src/lib/` and `src/api/`. |
| III | Resilient Upstream-API Automation | | All STFC-API traffic from `src/` goes through `src/api/client.ts` / `src/api/endpoints.ts`; responses validated by zod; typed errors (`TokenExpiredError`, `TransientError`, `SchemaMismatchError`, `ApiError`); GET retried once with jitter, POST/PUT not retried; `AbortSignal` timeout. |
| IV | Type-Safe Headless TypeScript CLI | | Changes covered by `tsconfig.json` strict surface (no React/Shadcn/Tailwind/extension/build pipeline introduced into `src/`); `npm run typecheck` clean; `tsx` runtime preserved. **Web Control Panel carve-out (v2.0.0):** if the change adds the SWA static bundle (under `web/` or `swa/`, Lit + Vite browser runtime) or the linked Azure Functions API (under `api/` or `swa/api/`, Node 24 server runtime), those directories live OUTSIDE `tsconfig.json`'s include set, have their own typecheck and bundle-budget gates, MUST NOT import from `src/`, and MUST NOT consume any STFC/Discord secret. |
| V | Stateless Operation & Secret Custody | | No persisted run state. Constitution v2.0.0 enumerates the following durable inputs and committed artifacts: `STFC_ACCOUNTS` (env-only secret; sanctioned writers: `scripts/capture-token.mjs` + GitHub Actions `Refresh token` workflow; 2-writer gate strictly preserved), `promo-codes.txt`, refresh-pipeline secrets (`STFC_EMAIL`, `STFC_PASSWORD`/`cj_pwd`, `STFC_REFRESH_PAT`), `DISCORD_BOT_TOKEN` (env-only secret, read-only Discord bot auth for the `discord-monitor` runtime, never written to disk), `config/discord-allowlist.json` (operator-curated, may be empty at launch), `config/classifier-model.json` (SHA-256-pinned model metadata), `data/discord/cursors.json`, `data/discord/candidates.jsonl`, `data/discord/tips-seen.jsonl`, `data/discord/suppression.json` (operator-written allow/deny rules — feature code reads only), `data/discord/cooldowns.json` (skill-written FR-009 cool-down telemetry, written by `src/discord/cooldown.ts`), `data/digests/YYYY-MM-DD.md` (daily digest artifact tree, written by `src/digest/index.ts`; v2.0.0 declares this tree TRACKED rather than ignored, `.gitignore` removal scheduled for Phase 3 of the 005-web-control-panel epic), `config/model-tiers.json` (operator-maintained model tier classification), `data/telemetry/sessions.jsonl` (append-only session telemetry records), `data/telemetry/collection-log.jsonl` (append-only collection audit log), `data/telemetry/reports/*.md` (generated summary reports), and the v1.6.0 crew-optimizer durable inputs: `data/crew/officers.json` (hand-curated officer DB; human-operator writer; reviewed PR), `data/crew/tasks/*.yaml` (task definitions; human-operator writer), `data/crew/roster/*.yaml` (per-account rosters, tracked-by-default with a documented `.gitignore` opt-out in `docs/CREW-OPTIMIZER.md`; writers: the `skill:roster` maintenance subcommands AND human operator, both preserving stable key order and auto-bumping `last_updated`), and `docs/crew/{account}.md` (generated per-account reports; writer: `.github/workflows/optimize-crew.yml` only when the input hash changes, rebase-before-push per Rule 4). **v2.0.0 web-control-panel durable outputs (SWA + linked Functions runtime):** `data/runs/*.json` (per-workflow-run state-change-only emission, schema-versioned per `specs/005-web-control-panel/contracts/run-result.json`; writers: the redeem / discord-monitor / refresh-token workflows via a shared emitter step), `data/audit/*.jsonl` (append-only redacted audit log of SWA-initiated write calls, schema-versioned per `specs/005-web-control-panel/contracts/audit-event.json`; writer: the SWA Function audit emitter, via the App installation token; redacted per `redact.ts` before commit). **v2.0.0 web-control-panel sanctioned secrets (SWA Function runtime only — never in `src/`, never in any `npm run skill:*` script, never in `redeem.yml` / `refresh-token.yml` / `discord-monitor.yml`):** `GITHUB_APP_PRIVATE_KEY` (installation-token-minting key, scopes `actions:write` + `contents:read` on `Jamula/stfc` only), `MODELS_API_TOKEN` (GitHub PAT scoped `models:read` only; MUST be a DIFFERENT secret value from `GITHUB_APP_PRIVATE_KEY`), `GEMINI_API_KEY` (optional Gemini Flash fallback), `SWA_DEPLOYMENT_TOKEN` (or OIDC federated-credential reference per the Phase 1 deploy-contract spike), `AZURE_TABLE_CONNECTION_STRING` (Azure Table Storage free-tier connection string for the refresh-token cooldown cache). **Operator-only one-shot ops scripts under `scripts/discord-ops/` (v1.5.0 carve-out) MAY issue `PATCH`/`PUT`/`POST` to `https://discord.com/api/v10/users/@me` and `https://discord.com/api/v10/applications/@me` using `DISCORD_BOT_TOKEN` for application-metadata management (bot avatar, description, username); these scripts MUST live outside `src/`, MUST NOT be loaded by the monitor runtime, and MUST redact `DISCORD_BOT_TOKEN` from every error path per FR-012. No new outbound destinations or new secrets are introduced by the v1.5.0 carve-out — the existing `discord.com/api/v10` destination and `DISCORD_BOT_TOKEN` secret are reused.** **v2.0.0 outbound network scope additions:** the SWA Function runtime additionally calls `https://models.inference.ai.azure.com/...` (GitHub Models primary) and `https://generativelanguage.googleapis.com/...` (Gemini Flash fallback) — both sanctioned for the SWA Function runtime ONLY; the orchestrator (`src/`), `discord-monitor`, and `scripts/discord-ops/` MUST NOT call either host. **v2.0.0 workflow-input obligation:** every `workflow_dispatch`-eligible workflow callable from the SWA control panel (today: `redeem.yml`, `discord-monitor.yml`, `refresh-token.yml`) MUST declare `correlation_id`, `triggered_by`, `reason` inputs (default empty so cron still works); the dispatcher MUST populate all three; the audit log MUST persist them. **v2.0.0 isolation invariant:** no STFC/Discord secret (JWT, `STFC_ACCOUNTS`, `STFC_EMAIL`, `STFC_PASSWORD`/`cj_pwd`, `STFC_REFRESH_PAT`, `DISCORD_BOT_TOKEN`) MAY be provisioned as a SWA Function app setting or returned in any SWA/Function HTTP response. Any new feature MUST extend this enumeration via constitution amendment before introducing a new durable input or sanctioned writer. Secrets only in sanctioned surfaces; `scripts/capture-token.mjs` honours its `--ci` / interactive / `--debug` obligations. |
| VI | Specification-First Governance | | Speckit trigger threshold met (or documented bypass per Principle VI's "Direct PR permitted" list). |
| VII | Artifact Hygiene | | No JWTs, real tokens, account names, gift IDs, or live response bodies in spec/plan/tasks. CI scanner enforced. |
| VIII | Wire-First Discovery | | Parser/error/retry changes backed by captured request/response, upstream docs, or a measured test. |
| IX | Test-First Discipline (NON-NEGOTIABLE) | | Acceptance criteria mapped to tests; bug fixes include reproducing test; `npm test` green. |
| — | Artifact Hygiene Check (CI gate) | | Spec/plan/tasks files contain no JWT-shaped or bearer-token strings. CI workflow under `.github/workflows/` enforces. |

Re-run this table after Phase 1 design and document any newly introduced
deviations in Complexity Tracking before continuing.

## Process Compliance

*Required for plans touching more than one phase or more than one component (Rule 17).*

- [ ] Rubber-duck review: <!-- agent_id / findings link — must be checked before plan is approved -->

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
