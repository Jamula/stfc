# Tasks: Tuvok Token-Usage Telemetry

**Input**: Design documents from `/specs/002-tuvok-telemetry/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Per Constitution Principle IX (Test-First Discipline,
NON-NEGOTIABLE), every user story whose spec defines acceptance criteria
MUST include at least one test task that exercises those criteria, and the
test task MUST be ordered BEFORE its corresponding implementation tasks
(test-first). Bug-fix tasks MUST include a reproducing test task that fails
before the fix and passes after. Tests are NOT optional.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root (per plan.md structure)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization — directory scaffolding, config files, npm script, and data directory creation.

- [x] T001 Create `data/telemetry/` directory with `.gitkeep` and `data/telemetry/reports/` subdirectory with `.gitkeep`
- [x] T002 Create model tier config at `config/model-tiers.json` with all known model → tier mappings from research.md R-002
- [x] T003 Add `"skill:telemetry": "tsx src/cli.ts telemetry"` npm script to `package.json`
- [x] T004 [P] Create empty module files: `src/telemetry/schemas.ts`, `src/telemetry/collector.ts`, `src/telemetry/reporter.ts`, `src/telemetry/recommender.ts`, `src/telemetry/tiers.ts`
- [x] T005 [P] Create empty test files: `tests/telemetry/schemas.test.ts`, `tests/telemetry/collector.test.ts`, `tests/telemetry/reporter.test.ts`, `tests/telemetry/recommender.test.ts`, `tests/telemetry/tiers.test.ts`, `tests/skills/telemetry.test.ts`
- [x] T006 Register new test imports in `tests/index.test.ts` (append telemetry test suite imports)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Constitution amendment and core schemas that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Constitution Amendment (Blocking Gate — plan.md Principle V)

- [x] T007 Amend `.specify/memory/constitution.md` from v1.3.0 → v1.4.0: add `config/model-tiers.json` (operator-written), `data/telemetry/sessions.jsonl` (skill-written), `data/telemetry/collection-log.jsonl` (skill-written), and `data/telemetry/reports/*.md` (skill-written) to Principle V durable-inputs enumeration
- [x] T008 Re-sync `.specify/templates/plan-template.md` with updated constitution per copilot-instructions.md Rule 1 (grep and cross-check durable inputs)

### Core Schemas (shared by all user stories)

- [x] T009 [P] Implement Zod schemas for `TelemetryRecord`, `ModelUsage`, and `CollectionLog` entities in `src/telemetry/schemas.ts` (per data-model.md Entity 1 + Entity 4)
- [x] T010 [P] Implement Zod schemas for `TelemetrySummary`, `ModelSummary`, `AgentSummary`, `CategorySummary`, `OutcomeSummary` in `src/telemetry/schemas.ts` (per data-model.md Entity 2)
- [x] T011 [P] Implement Zod schemas for `ModelRecommendation`, `RecommendationEvidence` in `src/telemetry/schemas.ts` (per data-model.md Entity 3)
- [x] T012 [P] Implement Zod schema for `ModelTierMap` config in `src/telemetry/schemas.ts` (per data-model.md Entity 5)
- [x] T013 Implement model tier resolution module in `src/telemetry/tiers.ts` — load `config/model-tiers.json`, validate with Zod, resolve model → tier with `defaultTier` fallback, log warning for unmapped models

**Checkpoint**: Constitution amended, all schemas defined, tier resolution working — user story implementation can now begin.

---

## Phase 3: User Story 1 — Collect Token-Usage Data After Agent Sessions (Priority: P1) 🎯 MVP

**Goal**: Tuvok extracts token-usage telemetry from the cloud session store and writes structured records to `data/telemetry/sessions.jsonl` with an audit log in `data/telemetry/collection-log.jsonl`.

**Independent Test**: Provide mock session data with known event values, verify collector extracts correct fields, writes valid JSONL, handles missing fields gracefully, deduplicates, and logs the collection run.

### Tests for User Story 1 (REQUIRED — Principle IX) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.
> Every Given/When/Then in the spec MUST map to at least one test task.**

- [ ] T014 [P] [US1] Schema validation tests in `tests/telemetry/schemas.test.ts` — valid TelemetryRecord passes, invalid sessionHash/timestamps/negative tokens rejected, ModelUsage array must be non-empty
- [ ] T015 [P] [US1] Tier resolution tests in `tests/telemetry/tiers.test.ts` — known model returns correct tier, unknown model returns `defaultTier`, invalid config rejected, missing file handled gracefully
- [ ] T016 [P] [US1] Collector tests in `tests/telemetry/collector.test.ts` — US1-S1: extracts correct fields from mock session data; US1-S2: missing optional fields recorded as null/unknown; US1-S3: interrupted session marked `partial`; US1-S4: idempotent collection skips already-collected sessionHash (FR-004); session ID hashed with SHA-256 truncated to 16 hex chars (FR-010); collection-log.jsonl entry written (FR-012)

### Implementation for User Story 1

- [ ] T017 [US1] Implement `collectTelemetry()` in `src/telemetry/collector.ts` — query `session_store_sql` for sessions in lookback window, extract usage events, hash session IDs (SHA-256 truncated 16 hex), derive `taskCategory` via keyword matching (research.md R-005), derive `outcome` heuristically from `session_refs` (research.md R-006), resolve model tiers via `src/telemetry/tiers.ts`
- [ ] T018 [US1] Implement JSONL append logic in `src/telemetry/collector.ts` — read existing `data/telemetry/sessions.jsonl` for dedup check by `sessionHash`, append new records, validate each record against Zod schema before write
- [ ] T019 [US1] Implement collection audit logging in `src/telemetry/collector.ts` — append `CollectionLog` entry to `data/telemetry/collection-log.jsonl` with `runAt`, `sessionsProcessed`, `sessionsSkipped`, `errors`, `durationMs` (FR-012)
- [ ] T020 [US1] Create CLI skill entry point at `src/skills/telemetry.ts` — implement `telemetry()` function returning `{ result: TelemetryResult; exitCode: number }`, route `collect` subcommand to `collectTelemetry()`, handle infrastructure errors with exit code 1 (per telemetry-skill.contract.md)
- [ ] T021 [US1] Register `telemetry` skill in `src/cli.ts` — add to `SKILLS` tuple, `SKILL_FNS` record, and `isSkillName()` type guard; telemetry skill does NOT require `accounts` (per contract)

**Checkpoint**: At this point, `npm run skill:telemetry collect` works end-to-end. US1 is fully functional and testable independently.

---

## Phase 4: User Story 2 — Generate Telemetry Summary Reports (Priority: P2)

**Goal**: Generate human-readable Markdown summary reports from collected telemetry, showing aggregate token usage broken down by model, agent, task category, and outcome.

**Independent Test**: Seed `sessions.jsonl` with known records covering multiple models and agents, generate a report, verify totals/averages/breakdowns match expected values. Verify empty-data case produces "no data available" message.

### Tests for User Story 2 (REQUIRED — Principle IX) ⚠️

- [ ] T022 [P] [US2] Reporter tests in `tests/telemetry/reporter.test.ts` — US2-S1: per-model totals correct for input/output tokens and session count; US2-S2: per-agent breakdowns with avg tokens/session and avg duration; US2-S3: success/failure rates per model and per agent; US2-S4: empty data produces "No data collected" message (not empty/misleading output); report is valid Markdown (FR-011)

### Implementation for User Story 2

- [ ] T023 [US2] Implement `generateReport()` in `src/telemetry/reporter.ts` — read `data/telemetry/sessions.jsonl`, parse and validate records with Zod, aggregate into `TelemetrySummary` (by model, agent, category, outcome), compute totals/averages/success rates
- [ ] T024 [US2] Implement Markdown rendering in `src/telemetry/reporter.ts` — render `TelemetrySummary` to `data/telemetry/reports/YYYY-MM-DD.md` following the report template in state-files.contract.md §3; handle empty-data case with "No data collected" message; overwrite existing report for same date (idempotent)
- [ ] T025 [US2] Wire `report` subcommand in `src/skills/telemetry.ts` — route to `generateReport()`, return report path in `TelemetryResult.reportPath`

**Checkpoint**: At this point, `npm run skill:telemetry report` generates a complete summary report. US1 + US2 both work independently.

---

## Phase 5: User Story 3 — Surface Model-Selection Recommendations (Priority: P3)

**Goal**: Produce actionable model-selection recommendations from accumulated telemetry — identifying cost-saving and quality-improving opportunities with supporting evidence.

**Independent Test**: Seed telemetry with patterns that should trigger specific recommendations (e.g., Agent X fails 60% on Model A but succeeds 95% on Model B), verify correct recommendations are produced with supporting data. Verify insufficient data is handled gracefully.

### Tests for User Story 3 (REQUIRED — Principle IX) ⚠️

- [ ] T026 [P] [US3] Recommender tests in `tests/telemetry/recommender.test.ts` — US3-S1: cost-saving recommendation generated when lower-tier model has similar success rate at fewer tokens; US3-S2: quality-improving recommendation generated when failure rate >50% on a model; US3-S3: agents/models with fewer than `minSessionsForRecommendation` sessions excluded with insufficient-data note; confidence level set correctly based on data volume

### Implementation for User Story 3

- [ ] T027 [US3] Implement `generateRecommendations()` in `src/telemetry/recommender.ts` — read `data/telemetry/sessions.jsonl`, group by agent+model, compare success rates and token efficiency across models for the same agent/category, generate `ModelRecommendation` records with evidence
- [ ] T028 [US3] Implement recommendation filtering in `src/telemetry/recommender.ts` — enforce `minSessionsForRecommendation` threshold (default: 10), set confidence levels (`low`/`medium`/`high`) based on session count, exclude insufficient-data combinations with explanatory note
- [ ] T029 [US3] Integrate recommendations into report output in `src/telemetry/reporter.ts` — append "Recommendations" section to report Markdown with human-review warning (FR-011), call `generateRecommendations()` during report generation
- [ ] T030 [US3] Wire `recommend` subcommand in `src/skills/telemetry.ts` — route to `generateRecommendations()`, return recommendation count in `TelemetryResult.recommendations`

**Checkpoint**: At this point, `npm run skill:telemetry recommend` produces actionable recommendations. US1 + US2 + US3 all work independently.

---

## Phase 6: User Story 4 — Tuvok Audit Trail Integration (Priority: P3)

**Goal**: Integrate telemetry collection and reporting into Tuvok's existing Squad audit workflow so that telemetry-driven decisions have traceable provenance.

**Independent Test**: Run a telemetry collection and report cycle, verify outputs are referenced in expected audit locations.

### Tests for User Story 4 (REQUIRED — Principle IX) ⚠️

- [ ] T031 [P] [US4] Skill integration tests in `tests/skills/telemetry.test.ts` — US4-S1: full cycle (collect → report → recommend) runs successfully and returns expected `TelemetryResult` shape; default (no subcommand) runs all three steps in sequence; exit code 0 for zero sessions; exit code 1 for infrastructure errors; US4-S2: `TelemetryResult` contains all fields needed for audit trail reference (sessionsCollected, reportPath, recommendations count)

### Implementation for User Story 4

- [ ] T032 [US4] Implement default subcommand flow in `src/skills/telemetry.ts` — when no subcommand is provided, run `collect` → `report` → `recommend` in sequence, aggregate results into single `TelemetryResult`
- [ ] T033 [US4] Add structured logging to `src/skills/telemetry.ts` and `src/telemetry/collector.ts` — use `createLogger("telemetry")` for collection events, report generation, and recommendation output so audit trail is traceable in Tuvok's session history

**Checkpoint**: Full telemetry lifecycle works end-to-end. All user stories complete and independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories — edge cases, hardening, documentation.

- [ ] T034 [P] Add edge-case handling across all modules: batch processing for large backlogs (≤ 200 sessions per batch, oldest first), zero-token sessions recorded with zero values, graceful handling of session store unreachability with retry on next cycle
- [ ] T035 [P] Add privacy validation assertions across all modules: verify no `user_content`/`assistant_content` columns are ever queried (FR-009), verify raw session IDs never appear in output files (FR-010), verify no secrets in any output
- [ ] T036 Run `npm test` full suite — confirm all new telemetry tests pass alongside existing 90+ tests, verify no regressions
- [ ] T037 Run `npm run typecheck` — confirm zero type errors with strict TypeScript
- [ ] T038 Run quickstart.md validation — execute `npm run skill:telemetry` and verify all output paths exist and match documented formats

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — **BLOCKS all user stories** (constitution amendment is a hard gate per plan.md)
- **User Story 1 (Phase 3)**: Depends on Foundational — **BLOCKS US2/US3** (no telemetry data → no reports → no recommendations)
- **User Story 2 (Phase 4)**: Depends on US1 (needs `sessions.jsonl` data to generate reports)
- **User Story 3 (Phase 5)**: Depends on US2 (recommendations are appended to reports; uses same aggregation patterns)
- **User Story 4 (Phase 6)**: Depends on US1 (skill integration tests need collector), can start after Phase 3
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 — needs collected data in `sessions.jsonl` to generate reports
- **User Story 3 (P3)**: Depends on US2 — recommendations are rendered into report Markdown
- **User Story 4 (P3)**: Can start after US1 — skill integration is independent of report/recommend logic

### Within Each User Story

- Tests MUST be written and FAIL before implementation (Principle IX, test-first)
- Schemas before modules that use them
- Core logic before CLI wiring
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: T004 and T005 can run in parallel (different directories)
- **Phase 2**: T009, T010, T011, T012 can all run in parallel (different schema groups, same file but independent sections)
- **Phase 3**: T014, T015, T016 can all run in parallel (different test files)
- **Phase 4**: T022 can run in parallel with other [P] tasks in the phase
- **Phase 5**: T026 can start as soon as Phase 4 is complete
- **Phase 6**: T031 can start as soon as Phase 3 is complete (parallel with US2/US3)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for US1 together (different files, no dependencies):
Task: "Schema validation tests in tests/telemetry/schemas.test.ts"       # T014
Task: "Tier resolution tests in tests/telemetry/tiers.test.ts"           # T015
Task: "Collector tests in tests/telemetry/collector.test.ts"             # T016

# Then implement sequentially (shared file dependencies):
# T017 → T018 → T019 (all in collector.ts, sequential)
# T020 (skill entry point, after collector is done)
# T021 (CLI registration, after skill entry point)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T006)
2. Complete Phase 2: Foundational — constitution amendment + schemas (T007–T013)
3. Complete Phase 3: User Story 1 — collection pipeline (T014–T021)
4. **STOP and VALIDATE**: Run `npm run skill:telemetry collect` against the session store
5. Verify `data/telemetry/sessions.jsonl` contains valid records
6. Verify `data/telemetry/collection-log.jsonl` has an audit entry
7. Deploy/demo if ready — data collection is the foundational capability

### Incremental Delivery

1. Setup + Foundational → Constitution gate cleared, schemas ready
2. Add US1 → Test independently → `collect` works (MVP!)
3. Add US2 → Test independently → `report` generates summaries
4. Add US3 → Test independently → `recommend` surfaces insights
5. Add US4 → Test independently → Full audit trail integration
6. Polish → Edge cases, hardening, quickstart validation
7. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (Principle IX)
- Commit at each phase boundary per copilot-instructions.md Rule 5
- `npm test` must pass at every commit (pre-commit hook enforced)
- Constitution amendment (T007–T008) is a hard prerequisite — do not skip
- Privacy constraints (FR-009, FR-010) are NON-NEGOTIABLE — verify at every phase
