# Tasks — Crew Optimizer

> **Scope of this file.** Per the Part-1 plan decision in
> `~/.copilot/session-state/.../plan.md` and the issue body of #77,
> this `tasks.md` is for **in-spec consumption only**. It is NOT used
> to generate additional GitHub issues; the 19 issues on the board
> (#77 + #78..#95) are the authoritative work breakdown.
> `speckit.taskstoissues` is explicitly **skipped** for this feature.

## Conventions

- Per-task IDs are `T###` and stable across edits.
- Each task references the GitHub issue it lands under.
- "Wired into `tests/index.test.ts`" is required for every new test
  file in the same PR.
- All maintenance verbs auto-bump `last_updated` (FR-006); all
  workflow YAML edits ship with the matching Rule 3 pinning test
  update in the same commit (`.github/copilot-instructions.md` Rule 3).

## Phase 0 — `speckit.specify` (issue #77)

- **T001** Author `specs/004-crew-optimizer/spec.md` covering v1, v1.5,
  v2 with FR-001..FR-026, the POC acceptance bar verbatim, and the
  pre-resolved decisions (tracked-by-default roster, v1 tag enum
  locked). _Status: done._

## Phase 1 — `speckit.clarify` (issue #77)

- **T002** Resolve the 5 open questions from the source plan Part 3
  ("Open questions to resolve in P1") and encode answers into the
  spec. _Status: done — Q1 hand-curate for v1 (research R2); Q2 lock
  v1 tag enum (FR-002 / R3); Q3 tracked-by-default (FR-004 / R4); Q4
  defer multi-account to v2+ (R5); Q5 subcommand UX (FR-006 / R6)._

## Phase 2 — `speckit.plan` (issue #77)

- **T003** Author `plan.md` with the Constitution Check table,
  technical context, project structure, and the v1 amendment plan.
- **T004** Author `research.md` (R1–R11) covering scoring model,
  officer DB seeding, tag enum lock, roster privacy, multi-account,
  CLI UX, staleness, report regeneration, v1.5 OCR (deferred), v2
  knowledge retrieval, and the test-layer matrix.
- **T005** Author `data-model.md` with the Officer / Task / Roster /
  Recommendation / KnowledgeChunk shapes and their invariants.
- **T006** Author `quickstart.md` (v1 operator walkthrough).
- **T007** Author the four contract docs:
  `contracts/officer-db.contract.md`,
  `contracts/roster.contract.md`,
  `contracts/task.contract.md`,
  `contracts/optimizer-cli.contract.md`. _Status: T003–T007 done._

## Phase 3 — `speckit.constitution` + plan-template re-sync (issue #77)

- **T008** Draft v1 amendment to `.specify/memory/constitution.md`:
  Principle II adds skill:roster (+5 subcommands), skill:optimize-crew,
  skill:progression. Principle V adds the four crew-optimizer durable
  inputs (officers, tasks, roster tracked-by-default, generated
  per-account report). Security & Compliance adds optimize-crew.yml
  to the SHA-pinning enumeration. Version bump v1.5.0 → v1.6.0.
- **T009** Tuvok editorial pass on the amendment (haiku model). Apply
  surgical grammar fixes; flag any out-of-scope claim for Picard.
- **T010** Rule 1 plan-template re-sync: run the grep
  `grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml' .specify/templates/*.md`,
  cross-check each match, update lagging templates. Single match in
  `plan-template.md:44` updated to enumerate the new durable inputs
  and reference v1.6.0. _Status: T008–T010 done._

## Phase 4 — `speckit.analyze` (issue #77)

- **T011** Cross-artifact consistency sweep. Verdict: PASS.
  Issue cross-references audited against `gh issue list --search
  'crew-plan-id in:body'`; #79/#81/#82/#83/#90/#91/#92/#93 references
  corrected to #85/#87/#88/#83/#91/#92/#93/#94 per the live board.
  _Status: done._

## Phase 5 — `speckit.tasks` (issue #77)

- **T012** Author this `tasks.md`. _Status: done._
- **T013** Open PR with `Closes #77` (single line, per Rule 12),
  title `feat(004-crew-optimizer): P0–P5 spec pipeline + v1
  constitution amendment`. Reviewer-gate dispatch (Garak hostile
  fact-check + Kirk technical + Picard governance) follows the
  standard reviewer protocol.

## Implementation tasks (in-spec map for the 19-issue board)

> These T### identifiers are referenced inside the spec/plan/research
> artifacts for future cross-linking. They are NOT issue creation
> targets. The board issues are the authoritative work breakdown.

### v1 — core

| T### | Maps to issue | Scope | Test acceptance |
|---|---|---|---|
| T100 | #78 (Scotty) | Data layer: `src/crew/{schemas,database,roster,tasks}.ts` + `data/crew/officers.json` seed (~30–50 officers) + `data/crew/tasks/*.yaml` (4 tasks: `mining-g3`, `hostile-grind`, `armada-25`, `station-defense`) + `data/crew/roster/example.yaml` | `tests/crew/{schemas,database,roster,tasks,realdata}.test.ts`; unknown-officer error path verbatim; wired into `tests/index.test.ts` |
| T101 | #79 (Scotty + Bashir review) | Engine: `src/crew/{optimizer,progression,staleness,diff}.ts` + tiny-world fixtures under `tests/crew/fixtures/` | Engine tests + ≥1 fixture end-to-end run; wired into `tests/index.test.ts` |
| T102 | #80 (Scotty) | `skill:roster` family (5 subcommands) with stable YAML round-trip + auto-bump `last_updated` + temp-dir-scoped CLI tests | Per-subcommand CLI tests + byte-stable round-trip assertion; tests NEVER touch live `data/crew/roster/`; wired into `tests/index.test.ts` |
| T103 | #81 (Scotty) | `skill:optimize-crew` + `skill:progression`, wired into `src/cli.ts`, honour `runAll` exit-code convention | Per-account iteration + exit-code tests; wired into `tests/index.test.ts` |
| T104 | #82 (O'Brien) | `.github/workflows/optimize-crew.yml` (no cron, group `stfc-crew-optimizer`, push on `data/crew/**` + `workflow_dispatch`, rebase-before-push) + Rule 3 pinning tests | `tests/skills/optimizeCrew.test.ts` asserts triggers, group, SHA-pinned actions; `pre-commit-checks.mjs` workflow-pinning gate passes |
| T105 | #83 (Tuvok + Scotty) | Operator docs: `README.md` section, `docs/CREW-OPTIMIZER.md` (incl. `.gitignore` opt-out snippet), `data/crew/roster/example.yaml`, quickstart cross-ref | `example.yaml` validates via T100's real-data test |
| T106 | #84 (Garak → Kirk → Picard) | v1 reviewer gate: APPROVE comments on every v1 PR per Rule 9b | Verdict comments live on the PRs; issue closes when all linked PRs merged |

### v1.5 — Discord/OCR (gated on OCR POC)

| T### | Maps to issue | Scope | Test acceptance |
|---|---|---|---|
| T200 | #85 (Uhura) | OCR POC spike — measure against the FR-020 acceptance bar on 20 real screenshots | POC measurement table posted to issue #85 |
| T201 | #86 (Picard) | POC gate decision: PASS → unblock #87..#90; FAIL → close #85..#90 as wontfix | Verdict comment with `**APPROVE** ✅` or `**CHANGES_REQUESTED** ⚠️` per Rule 9b |
| T202 | #87 (Tuvok) | Constitution v1.5 amendment (`roster-sync.yml` workflow + `cdn.discordapp.com` inbound + `skill:bootstrap-roster` + roster-channel allowlist) + plan-template re-sync | Rule 1 grep is green post-amendment |
| T203 | #88 (Uhura + Scotty + O'Brien) | `src/crew/ocr.ts` + image-attachment ingestion + `.github/workflows/roster-sync.yml` + PR-opening logic + Rule 3 pinning tests | `tests/crew/ocr.test.ts` + `tests/discord/imageAttachments.test.ts` + `tests/skills/rosterSync.test.ts`; re-check `tests/skills/discordMonitor.test.ts` per Rule 3; wired into `tests/index.test.ts` |
| T204 | #89 (Tuvok) | v1.5 operator docs (screenshot capture guide, device resolution, Discord channel setup, troubleshooting) | Doc-only |
| T205 | #90 (Garak → Kirk → Picard) | v1.5 reviewer gate | APPROVE comments on every v1.5 PR |

### v2 — Read-only interactive Discord commands (gated on v1 ship)

| T### | Maps to issue | Scope | Test acceptance |
|---|---|---|---|
| T300 | #91 (Uhura) | `src/crew/commandParser.ts` (allowlist class + rate limit + `!crew help`) | `tests/discord/commandParser.test.ts`; wired into `tests/index.test.ts` |
| T301 | #92 (Uhura + Scotty) | `src/crew/commandHandlers.ts` for the 8 read-only verbs (`best`, `status`, `progression`, `explain`, `synergy`, `tasks`, `officers`, `roster show`) | `tests/crew/commandHandlers.test.ts` per verb + integration test via the parser; wired into `tests/index.test.ts` |
| T302 | #93 (Uhura + Scotty) | `src/crew/knowledge.ts` (chunking + embeddings) + `data/crew/knowledge-embeddings.json` + `skill:knowledge-rebuild` + `!crew knowledge` handler — RETRIEVAL-ONLY, no LLM generation (FR-024) | `tests/crew/knowledge.test.ts` (chunking determinism + cache invalidation + top-k ordering); wired into `tests/index.test.ts` |
| T303 | #94 (O'Brien) | `.github/workflows/knowledge-rebuild.yml` (triggers on push to `docs/stfc-game-knowledge.md` / `data/crew/officers.json` / `data/crew/tasks/**`; group `stfc-knowledge-rebuild`) + Rule 3 pinning tests | `tests/skills/knowledgeRebuild.test.ts` asserts triggers, group, action SHAs |
| T304 | #95 (Tuvok + Garak + Kirk + Picard) | v2 operator docs (Discord commands section, `!crew help` output documented, v3 slash-commands deferred-scope note) + v2 reviewer gate | APPROVE comments on every v2 PR |

## Hand-off note for #78 (the first impl issue after #77 merges)

When Scotty picks up #78:

1. The schemas in `src/crew/schemas.ts` MUST match the shapes in
   `data-model.md` exactly. zod validation errors should be human-
   readable (the unknown-officer error is verbatim per FR-010).
2. The `officers.json` seed (~30–50 entries) sources from
   `docs/stfc-game-knowledge.md` section 6. Every tag in the
   `captain_maneuver.tags` and `officer_ability.tags` arrays MUST be a
   member of the locked v1 enum (FR-002).
3. `data/crew/roster/example.yaml` is the schema-documentation file
   that operators copy when bootstrapping. It MUST validate against
   the schema in `tests/crew/realdata.test.ts`.
4. Tests are wired into `tests/index.test.ts` in the SAME PR (Part 2
   of the source plan; non-negotiable per the closing criteria).
