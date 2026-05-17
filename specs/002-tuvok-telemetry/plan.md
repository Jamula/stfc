# Implementation Plan: Tuvok Token-Usage Telemetry

**Branch**: `002-tuvok-telemetry` | **Date**: 2026-05-17 | **Spec**: `specs/002-tuvok-telemetry/spec.md`
**Input**: Feature specification from `specs/002-tuvok-telemetry/spec.md`
**Issue**: #15

## Summary

Enhance Tuvok (Process Auditor) to collect token-usage telemetry from the
cloud session store after agent sessions, store structured records locally in
`data/telemetry/sessions.jsonl`, and generate summary reports with model-selection
recommendations. The telemetry pipeline reads usage metadata from the `events` table
(`assistant.usage` rows), hashes session IDs for privacy, resolves model tiers from
`config/model-tiers.json`, and produces actionable reports in
`data/telemetry/reports/YYYY-MM-DD.md`. No user message content is collected.
A constitution amendment (v1.3.0 → v1.4.0) is required to enumerate the new
durable inputs/outputs.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js ≥ 24, `tsx` runtime  
**Primary Dependencies**: `zod` (schema validation), `node:crypto` (SHA-256 hashing), `session_store_sql` (cloud session store queries)  
**Storage**: Append-only JSONL files in `data/telemetry/`, JSON config in `config/model-tiers.json`  
**Testing**: `node:test` via `node --import tsx --test tests/index.test.ts` (90+ existing tests)  
**Target Platform**: Linux (GitHub Actions runner, Codespaces)  
**Project Type**: CLI skill (headless Node CLI per Principle II)  
**Performance Goals**: Collection for a single session < 5 seconds (SC-007); report generation < 30 seconds for ≤ 1,000 sessions (SC-003)  
**Constraints**: No user content in telemetry (FR-009); no raw session IDs (FR-010); all processing local to runner  
**Scale/Scope**: ≤ 1,000 sessions per report cycle; ≤ 200 sessions per collection batch

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For every principle below, state PASS / FAIL / N/A and (if not PASS) describe
the mitigation or record an entry in Complexity Tracking. The constitution
lives at `.specify/memory/constitution.md`.

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | User Safety & Trust First (NON-NEGOTIABLE) | PASS | Telemetry collects only aggregate usage metadata (token counts, model names, durations). No credentials, no user content, no account data. Session IDs are SHA-256 hashed before storage (FR-010). No new credential surfaces introduced. |
| II | Skill-Isolated CLI Architecture | PASS | New `telemetry` skill registered in `src/cli.ts`, implemented at `src/skills/telemetry.ts`, returns `{ result, exitCode }`. Does not call `process.exit`. Core logic in `src/telemetry/` (shared lib). Follows the exact pattern of `discord-monitor`. |
| III | Resilient Upstream-API Automation | N/A | Telemetry does not call the STFC store API. It queries the cloud session store (read-only), which is a platform-provided service, not an upstream third-party API. Defensive parsing (zod validation) is applied to session store results. |
| IV | Type-Safe Headless TypeScript CLI | PASS | All new code in `src/telemetry/*.ts` and `src/skills/telemetry.ts` covered by `tsconfig.json` strict surface. No React/UI/build pipeline introduced. `npm run typecheck` clean. |
| V | Stateless Operation & Secret Custody | **REQUIRES AMENDMENT** | Three new durable inputs/outputs: `config/model-tiers.json` (operator-written), `data/telemetry/sessions.jsonl` (skill-written), `data/telemetry/collection-log.jsonl` (skill-written), `data/telemetry/reports/*.md` (skill-written). Per Principle V: "Any new feature MUST extend this enumeration via constitution amendment." Amendment v1.3.0 → v1.4.0 (MINOR) is a prerequisite task. No new secrets introduced. |
| VI | Specification-First Governance | PASS | This feature follows the full speckit chain: specify → clarify → plan → tasks → implement. Multi-file, cross-module, new user-facing capability — meets all trigger thresholds. |
| VII | Artifact Hygiene | PASS | No JWTs, real tokens, account names, or live response bodies in spec/plan/tasks. Session IDs use `<REDACTED>` placeholders per FR-010. Telemetry records contain only aggregate metadata. CI scanner scope covers `specs/` and `data/` paths. |
| VIII | Wire-First Discovery | N/A | No STFC API changes. Session store schema was verified by querying the live `events` table columns and sample data during research (see `research.md` R-001). |
| IX | Test-First Discipline (NON-NEGOTIABLE) | PASS | All telemetry modules will have tests written before implementation. Test files registered in `tests/index.test.ts`. Acceptance criteria from spec mapped to test cases. `npm test` must pass at every commit (pre-commit hook enforced). |
| — | Artifact Hygiene Check (CI gate) | PASS | Spec/plan/tasks files contain no JWT-shaped or bearer-token strings. All examples use placeholder values. |

### Post-Phase-1 Re-evaluation

Constitution Check re-run after Phase 1 design:

| # | Principle | Status | Delta from pre-design |
|---|-----------|--------|----------------------|
| I | User Safety & Trust First | PASS | No change. Privacy constraints confirmed in contracts. |
| II | Skill-Isolated CLI Architecture | PASS | No change. Skill contract defined in `contracts/telemetry-skill.contract.md`. |
| V | Stateless Operation & Secret Custody | **REQUIRES AMENDMENT** | Confirmed: 3 new durable files + 1 config file. Amendment scope documented in research.md R-004. Must be completed as Phase 1 task before implementation. |
| IX | Test-First Discipline | PASS | No change. Test file layout defined in quickstart.md. |

## Project Structure

### Documentation (this feature)

```text
specs/002-tuvok-telemetry/
├── plan.md                                     # This file
├── spec.md                                     # Feature specification
├── research.md                                 # Phase 0 research findings
├── data-model.md                               # Phase 1 entity definitions
├── quickstart.md                               # Phase 1 developer guide
├── contracts/
│   ├── state-files.contract.md                 # State file schemas & invariants
│   └── telemetry-skill.contract.md             # CLI skill contract
└── tasks.md                                    # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli.ts                   # Dispatcher — add "telemetry" skill registration
├── skills/
│   └── telemetry.ts         # CLI skill entry point (subcommand routing)
├── telemetry/
│   ├── schemas.ts           # Zod schemas for all telemetry entities
│   ├── collector.ts         # Session store query → sessions.jsonl
│   ├── reporter.ts          # sessions.jsonl → reports/*.md
│   ├── recommender.ts       # sessions.jsonl → model recommendations
│   └── tiers.ts             # Model tier resolution from config
└── lib/                     # (existing) Shared utilities — no changes expected

config/
├── model-tiers.json         # NEW: operator-maintained model → tier mapping
├── classifier-model.json    # (existing)
└── discord-allowlist.json   # (existing)

data/
├── telemetry/               # NEW: telemetry data directory
│   ├── sessions.jsonl       # Append-only telemetry records
│   ├── collection-log.jsonl # Append-only collection audit
│   └── reports/
│       └── YYYY-MM-DD.md    # Generated summary reports
├── discord/                 # (existing)
└── digests/                 # (existing)

tests/
├── telemetry/
│   ├── schemas.test.ts      # Schema validation tests
│   ├── collector.test.ts    # Collection logic tests
│   ├── reporter.test.ts     # Report generation tests
│   ├── recommender.test.ts  # Recommendation logic tests
│   └── tiers.test.ts        # Tier resolution tests
├── skills/
│   └── telemetry.test.ts    # Skill integration tests
└── index.test.ts            # Add imports for new test suites
```

**Structure Decision**: Follows the established single-project CLI pattern.
New telemetry logic goes in `src/telemetry/` (parallel to `src/discord/`),
with the skill entry point at `src/skills/telemetry.ts` (parallel to
`src/skills/discordMonitor.ts`). This mirrors the `discord-monitor` feature's
module organization exactly.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle V — new durable inputs without current enumeration | Telemetry requires persistent storage (FR-003) for session records, audit logs, and reports. These files must survive across runs for aggregation (FR-005) and recommendation (FR-006). | In-memory-only processing rejected because reports must be human-reviewable artifacts (FR-011) and the audit trail must be traceable (FR-012). Non-committed temporary files rejected because they don't survive runner lifecycle and violate FR-003's "local, append-only data file within the repository" requirement. |

**Mitigation**: Constitution amendment v1.3.0 → v1.4.0 is a blocking prerequisite task. The amendment adds the four new files to Principle V's durable-inputs enumeration with their writers. No principle is removed or weakened; this is a MINOR version bump (enumeration expansion only).
