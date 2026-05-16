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
| I | User Safety & Trust First (NON-NEGOTIABLE) | | Acts only as a logged-in player could via the official store; credential-bearing strings surfaced from `src/` pass through `src/lib/redact.ts`; helper-script secret surfaces stay within the sanctioned channels in Principle V. |
| II | Skill-Isolated CLI Architecture | | New behaviour lives behind the `src/cli.ts` dispatcher and a `src/skills/*.ts` module; skills return `{ result, exitCode }` and do not call `process.exit` from `src/`; shared logic stays in `src/lib/` and `src/api/`. |
| III | Resilient Upstream-API Automation | | All STFC-API traffic from `src/` goes through `src/api/client.ts` / `src/api/endpoints.ts`; responses validated by zod; typed errors (`TokenExpiredError`, `TransientError`, `SchemaMismatchError`, `ApiError`); GET retried once with jitter, POST/PUT not retried; `AbortSignal` timeout. |
| IV | Type-Safe Headless TypeScript CLI | | Changes covered by `tsconfig.json` strict surface (no React/Shadcn/Tailwind/extension/build pipeline introduced); `npm run typecheck` clean; `tsx` runtime preserved. |
| V | Stateless Operation & Secret Custody | | No persisted run state. Constitution v1.3.0 enumerates the following durable inputs and committed artifacts: `STFC_ACCOUNTS` (env-only secret; sanctioned writers: `scripts/capture-token.mjs` + GitHub Actions `Refresh token` workflow; 2-writer gate strictly preserved), `promo-codes.txt`, refresh-pipeline secrets (`STFC_EMAIL`, `STFC_PASSWORD`/`cj_pwd`, `STFC_REFRESH_PAT`), `DISCORD_BOT_TOKEN` (env-only secret, read-only Discord bot auth, never written to disk), `config/discord-allowlist.json` (operator-curated, may be empty at launch), `config/classifier-model.json` (SHA-256-pinned model metadata), `data/discord/cursors.json`, `data/discord/candidates.jsonl`, `data/discord/tips-seen.jsonl`, `data/discord/suppression.json` (operator-written allow/deny rules — feature code reads only), `data/discord/cooldowns.json` (skill-written FR-009 cool-down telemetry, written by `src/discord/cooldown.ts`), `data/digests/YYYY-MM-DD.md` (daily digest artifact tree, written by `src/digest/index.ts`). Any new feature MUST extend this enumeration via constitution amendment before introducing a new durable input or sanctioned writer. Secrets only in sanctioned surfaces; `scripts/capture-token.mjs` honours its `--ci` / interactive / `--debug` obligations. |
| VI | Specification-First Governance | | Speckit trigger threshold met (or documented bypass per Principle VI's "Direct PR permitted" list). |
| VII | Artifact Hygiene | | No JWTs, real tokens, account names, gift IDs, or live response bodies in spec/plan/tasks. CI scanner enforced. |
| VIII | Wire-First Discovery | | Parser/error/retry changes backed by captured request/response, upstream docs, or a measured test. |
| IX | Test-First Discipline (NON-NEGOTIABLE) | | Acceptance criteria mapped to tests; bug fixes include reproducing test; `npm test` green. |
| — | Artifact Hygiene Check (CI gate) | | Spec/plan/tasks files contain no JWT-shaped or bearer-token strings. CI workflow under `.github/workflows/` enforces. |

Re-run this table after Phase 1 design and document any newly introduced
deviations in Complexity Tracking before continuing.

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
