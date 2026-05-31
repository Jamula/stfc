# Implementation Plan: Crew Optimizer

**Branch**: `squad/77-speckit-pipeline` | **Date**: 2026-05-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-crew-optimizer/spec.md`
**Issue**: #77 (this spec pipeline) — implementation tracked under #78–#95

## Summary

Add a crew-optimizer capability to the headless TypeScript CLI. v1 ships
the pure-compute optimizer + progression report + `skill:roster` family
+ `optimize-crew.yml` workflow, driven by hand-edited YAML rosters on a
developer machine. v1.5 (gated on an OCR POC) adds the iPhone → Discord
→ PR loop for roster ingestion. v2 (parallel-gated on v1 ship) adds
read-only `!crew` Discord commands plus a retrieval-only freeform
knowledge query. No new STFC API surface; v1 introduces no new outbound
network destination.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22.x (`.nvmrc` pinned)
**Primary Dependencies**: zod (schemas — already in tree), `js-yaml`
  (YAML round-trip; add only if not already present), Node stdlib for
  compute. v1.5 adds the existing `@huggingface/transformers` for OCR
  pre-processing + a SHA-pinned OCR model. v2 reuses
  `@huggingface/transformers` for the sentence-transformer embedding model.
**Storage**: Committed JSON/YAML under `data/crew/` (officers, tasks,
  roster) plus generated reports under `docs/crew/`. v2 adds
  `data/crew/knowledge-embeddings.json` (regenerated artifact).
**Testing**: `node:test` + `tsx` via `tests/index.test.ts` (existing
  pattern). All new test files MUST be imported in `tests/index.test.ts`
  in the same PR; this is non-negotiable.
**Target Platform**: GitHub Actions `ubuntu-latest` for CI; macOS/Linux
  developer machines for local CLI.
**Project Type**: Headless TypeScript CLI (Option 1 — single project).
**Performance Goals**: Optimizer must rank crews for a 100-officer
  roster against any single task in <500ms on a developer laptop.
  Workflow report generation per account <2s.
**Constraints**: Pure compute, no network from `src/crew/**`. Stable YAML
  round-trip (byte-for-byte equivalent diffs on idempotent operations).
  Closed-vocabulary tag enum (FR-002).
**Scale/Scope**: 1–10 accounts per operator; ~30–50 officers in
  `officers.json` at v1 launch; up to ~200 over the project lifetime;
  4–20 task definitions; ≤100 roster entries per account.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For every principle below, state PASS / FAIL / N/A and (if not PASS)
describe the mitigation or record an entry in Complexity Tracking. The
constitution lives at `.specify/memory/constitution.md`.

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | User Safety & Trust First (NON-NEGOTIABLE) | PASS | No new credential surface. Optimizer is pure compute; v1.5 reuses `DISCORD_BOT_TOKEN`; v2 reuses the existing classifier-model fetch carve-out. No new error path surfaces tokens. |
| II | Skill-Isolated CLI Architecture | PASS — requires v1 amendment | New skills `skill:roster` (+subcommands), `skill:optimize-crew`, `skill:progression` registered in `src/cli.ts` and added to Principle II's sanctioned-skills enumeration via the v1 amendment in this same PR (per issue #77 acceptance criterion 4). Each skill returns `{ result, exitCode }` and does not call `process.exit` from `src/`. |
| III | Resilient Upstream-API Automation | N/A | No STFC API traffic. v1.5 reuses `src/discord/client.ts` (which already routes through the typed-error/schema-validated pattern). |
| IV | Type-Safe Headless TypeScript CLI | PASS | New `src/crew/**` lives inside the existing `tsconfig.json` include set. No UI/extension/bundler additions. |
| V | Stateless Operation & Secret Custody | PASS — requires v1 amendment | New durable inputs `data/crew/officers.json`, `data/crew/tasks/*.yaml`, `data/crew/roster/*.yaml`, generated `docs/crew/*.md` enumerated in Principle V via the v1 amendment in this same PR. No new secrets. v1.5 and v2 amendments are SEPARATE PRs filed later (issues #87 and #93/#94 respectively). |
| VI | Specification-First Governance | PASS | This very plan is the speckit artifact. Trigger threshold met (new feature, multi-file, cross-skill). |
| VII | Artifact Hygiene | PASS | No real tokens / account names / live response bodies anywhere under `specs/004-crew-optimizer/**`. CI scanner enforced. |
| VIII | Wire-First Discovery | N/A for v1 (pure compute). v1.5 OCR contract grounded in the POC measurement table (issue #85). v2 retrieval-only — no upstream contract. |
| IX | Test-First Discipline (NON-NEGOTIABLE) | PASS | Acceptance criteria mapped to test layers in `research.md`. Every new test file wired into `tests/index.test.ts` is enforced as a closing criterion on each implementation issue (#78–#83). |
| — | Artifact Hygiene Check (CI gate) | PASS | Spec/plan/tasks files contain no JWT-shaped or bearer-token strings. |

**Re-check after Phase 1 design:** No new violations introduced. The
constitution amendment in `.specify/memory/constitution.md` (drafted by
`speckit.constitution`, editorial pass by Tuvok) is the only governance
mutation; Principle V's durable-inputs enumeration and Principle II's
sanctioned-skills enumeration each gain a single bullet block.

## Project Structure

### Documentation (this feature)

```text
specs/004-crew-optimizer/
├── plan.md              # This file
├── research.md          # Phase 0 output — closed alternatives + test layers
├── data-model.md        # Phase 1 output — schemas + shapes + invariants
├── quickstart.md        # Phase 1 output — operator setup walkthrough
├── contracts/           # Phase 1 output
│   ├── officer-db.contract.md
│   ├── roster.contract.md
│   ├── task.contract.md
│   └── optimizer-cli.contract.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli.ts                         # extended with skill:roster / skill:optimize-crew / skill:progression
├── api/                           # unchanged
├── discord/                       # unchanged in v1; extended in v1.5 (#88) and v2 (#91–#93)
├── lib/                           # unchanged
├── skills/                        # extended with new skill entry points
│   ├── roster.ts                  # NEW (#80)
│   ├── optimizeCrew.ts            # NEW (#81)
│   ├── progression.ts             # NEW (#81)
│   └── knowledgeRebuild.ts        # NEW v2 (#93)
└── crew/                          # NEW namespace — v1 (#78–#81)
    ├── schemas.ts                 # zod for officer / roster / task
    ├── database.ts                # loads + validates officers.json
    ├── roster.ts                  # loads + validates roster YAML; stable round-trip
    ├── tasks.ts                   # loads + validates task YAML
    ├── optimizer.ts               # pure-compute scoring/search
    ├── progression.ts             # roster-gap analysis
    ├── staleness.ts               # last_updated → warn/error policy
    ├── diff.ts                    # roster diffing (shared by roster + ocr later)
    ├── report.ts                  # markdown report rendering
    ├── ocr.ts                     # NEW v1.5 (#88) — OCR pipeline
    ├── commandParser.ts           # NEW v2 (#91)
    ├── commandHandlers.ts         # NEW v2 (#92)
    └── knowledge.ts               # NEW v2 (#93) — chunk + embed + top-k

data/
└── crew/
    ├── officers.json              # NEW (#78) — committed seed (~30–50 officers)
    ├── tasks/
    │   ├── mining-g3.yaml         # NEW (#78)
    │   ├── hostile-grind.yaml
    │   ├── armada-25.yaml
    │   └── station-defense.yaml
    ├── roster/
    │   ├── .gitkeep
    │   └── example.yaml           # NEW (#78) — schema documentation
    └── knowledge-embeddings.json  # NEW v2 (#93) — regenerated artifact

docs/
├── CREW-OPTIMIZER.md              # NEW (#83) — operator guide
└── crew/
    └── {account}.md               # generated per-account report

tests/
├── crew/                          # NEW namespace
│   ├── schemas.test.ts
│   ├── database.test.ts
│   ├── roster.test.ts
│   ├── tasks.test.ts
│   ├── realdata.test.ts           # validates committed data/crew/** vs schemas
│   ├── optimizer.test.ts
│   ├── progression.test.ts
│   ├── staleness.test.ts
│   ├── diff.test.ts
│   ├── report.test.ts
│   ├── ocr.test.ts                # v1.5
│   ├── commandHandlers.test.ts    # v2
│   ├── knowledge.test.ts          # v2
│   └── fixtures/
│       ├── tiny-officers.json
│       ├── tiny-roster.yaml
│       └── tiny-tasks/*.yaml
├── skills/
│   ├── roster.test.ts             # NEW
│   ├── optimizeCrew.test.ts       # NEW (includes Rule 3 pinning)
│   ├── progression.test.ts        # NEW
│   ├── rosterSync.test.ts         # NEW v1.5
│   └── knowledgeRebuild.test.ts   # NEW v2
└── discord/
    ├── imageAttachments.test.ts   # NEW v1.5
    └── commandParser.test.ts      # NEW v2

.github/workflows/
├── optimize-crew.yml              # NEW (#82) — push on data/crew/**, no cron
├── roster-sync.yml                # NEW v1.5 (#88)
└── knowledge-rebuild.yml          # NEW v2 (#94)
```

**Structure Decision**: Single-project layout (Option 1). The optimizer
is a new namespace `src/crew/**` plus a small set of skill entry points
under `src/skills/`. `data/crew/` is a sibling of `data/discord/` and
`data/telemetry/` and follows the same committed-inputs convention.

## Constitution amendment (v1) — bundled in THIS PR

The v1 amendment is in scope of issue #77 (acceptance criterion 4). It
amends `.specify/memory/constitution.md`:

- **Principle V — Durable inputs:** add `data/crew/officers.json`,
  `data/crew/tasks/*.yaml`, `data/crew/roster/*.yaml` (operator-curated,
  tracked-by-default with documented opt-out via `.gitignore` snippet)
  and the generated `docs/crew/*.md` (skill-written; one file per
  account; regenerated only on input-hash change).
- **Principle II — Sanctioned skills:** add `skill:roster` (with the
  five subcommands: `status`, `add`, `promote`, `rankup`, `validate`),
  `skill:optimize-crew`, `skill:progression`.
- **Workflow surface:** the new `optimize-crew.yml` has no cron, uses a
  new concurrency group `stfc-crew-optimizer`, triggers on `push` to
  `data/crew/**` and on `workflow_dispatch`, and is subject to the
  third-party action SHA-pinning rule.
- **Outbound network scope:** no change for v1. The v1 amendment
  explicitly notes that v1.5 (`cdn.discordapp.com` image fetch) and
  v2 (re-confirmation of the `huggingface.co` carve-out for the
  sentence-transformer model) will require **separate** amendments
  filed at the time those phases are unblocked.

**Expected version bump: MINOR** — adds new sanctioned skills, new
durable inputs, and a new workflow surface. No principle removed.
No existing obligation narrowed. v1.5.0 → v1.6.0.

After the constitution edits land in the worktree, **Rule 1 plan-template
re-sync** is run per `.github/copilot-instructions.md` Rule 1. The
grep used is:

```bash
grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml' .specify/templates/*.md
```

Every match is cross-checked against the new body of `constitution.md`.
The SIR's "Templates needing re-sync" line is derived from this grep,
not from a structural "no principles renamed" argument.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | _(none)_   | _(none)_ |

No constitution principle is violated. The v1 amendment adds a new
namespace under the existing Principle V framework; no carve-out, no
deviation from the existing patterns.

## Phasing inside #77

| Phase | What | Status |
|---|---|---|
| 0 | `speckit.specify` → `spec.md` | Done |
| 1 | `speckit.clarify` → 5 Qs resolved | Done (encoded in spec FR-001..FR-004) |
| 2 | `speckit.plan` → `plan.md` + `research.md` + `data-model.md` + `contracts/` + `quickstart.md` | In progress |
| 3 | `speckit.constitution` → v1 amendment + Tuvok editorial pass | Pending |
| 4 | Rule 1 plan-template re-sync grep | Pending |
| 5 | `speckit.analyze` → cross-artifact consistency | Pending |
| 6 | `speckit.tasks` → `tasks.md` | Pending |
| 7 | Push + open PR with `Closes #77` (single line, per Rule 12) | Pending |

Per `.github/copilot-instructions.md` Rule 5, each phase ends with its
own `feat(004-crew-optimizer): Phase N — {name} (T{XXX}–T{YYY})` commit.
