# Feature Specification: Crew Optimizer

**Feature Branch**: `004-crew-optimizer`
**Created**: 2026-05-31
**Status**: Draft
**Input**: User description: "Add a capability to recommend optimal crews for STFC tasks and surface progression gaps. The game is played on iPhone; bootstrap/refresh of game state must work iPhone-first."
**Issue**: #77 (spec pipeline) and #78–#95 (implementation phases)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Best-crew-for-task recommendation (Priority: P1)

cyrusj runs `npm run skill:optimize-crew -- --account main --task mining-g3` (or
relies on the `optimize-crew.yml` workflow that fires when `data/crew/**`
changes) and gets a ranked list of the top crews for the named task, each
crew annotated with the synergy/captain/officer-ability rationale that drove
the score. The recommendation respects the operator's actual owned roster
(`data/crew/roster/main.yaml`), the closed-vocabulary tag library, and the
staleness policy.

**Why this priority**: The whole feature exists to answer "who should I put
on this slot?" — every other surface in v1 (progression, status, the
workflow report) is downstream of having an optimizer that produces stable,
explainable rankings.

**Independent Test**: With the tiny-world fixture (`tests/crew/fixtures/`
— `tiny.yaml` + `tiny-officers.json` + `tiny-tasks/*.yaml`),
running `optimize-crew --account fixture --task tiny-mining` returns a
deterministic ranked list whose top entry matches the golden output. Re-run
yields byte-identical results.

**Acceptance Scenarios**:

1. **Given** a roster YAML, the officer database, and a task definition,
   **When** the operator runs `skill:optimize-crew --account X --task T`,
   **Then** the CLI prints a ranked list (top-3 by default) of legal crews
   for that task with a per-crew rationale citing the matched tags and the
   captain maneuver / officer ability that contributed.
2. **Given** a roster that does not own a required slot's preferred officer,
   **When** the optimizer runs, **Then** the next-best legal crew is
   returned and the rationale flags the missing officer with the suggested
   acquisition (officer id + faction + rank-curve note from `officers.json`).
3. **Given** a roster YAML older than the staleness warn threshold (7 days),
   **When** the optimizer runs, **Then** the output includes a header
   warning "roster is N days old" before the recommendations.
4. **Given** a roster referencing an officer id not in `officers.json`,
   **When** the optimizer runs, **Then** it exits non-zero with the error
   "roster references officer 'X' which is not in data/crew/officers.json"
   (per the unknown-officer error path in Part 3 of the source plan).

---

### User Story 2 — Progression report (Priority: P1)

cyrusj runs `npm run skill:progression -- --account main` and gets a
prioritized list of what to work on next: officers close to the next rank
boundary, unlocks that would close a synergy gap, and rank-up candidates
ordered by impact across the operator's current task mix.

**Why this priority**: Captains know "who's strong now"; what they need is
"what's the highest-leverage next promotion." This is the second core
deliverable from the kickoff decision ("Both — best-crew-for-task AND
progression report").

**Independent Test**: With a fixture where one officer is one promotion
away from completing the dominant synergy group, `skill:progression` returns
that officer at the top of the recommendation list with the synergy-closure
rationale; the assertion is exact-text against a golden snapshot.

**Acceptance Scenarios**:

1. **Given** a roster and the active task mix, **When** the operator runs
   `skill:progression --account X`, **Then** the CLI lists the top
   progression candidates with the marginal-utility rationale.
2. **Given** a recently-promoted officer, **When** the operator runs
   `skill:roster promote ... && skill:progression --account X`, **Then**
   the now-promoted officer is removed from the candidate list and the next
   candidate moves up.

---

### User Story 3 — Roster maintenance from a developer machine (Priority: P1)

cyrusj edits the roster from a laptop using
`skill:roster {status,add,promote,rankup,validate}`. Each maintenance verb
auto-bumps `last_updated`, writes YAML with a stable key order, and rejects
unknown officer ids loudly. `skill:roster validate` is the CI check.

**Why this priority**: This is the v1 freshness loop. Without it, the
operator has no way to keep the roster current absent the Discord/OCR
transport (v1.5). Without `validate`, schema drift between code and
committed data goes unnoticed until the optimizer fails.

**Independent Test**: A CLI integration test runs the full sequence
`status → add → promote → rankup → validate` in a temp directory and
asserts the resulting YAML is byte-stable, `last_updated` bumped, and
`validate` exits zero. Tests NEVER touch live `data/crew/roster/`.

**Acceptance Scenarios**:

1. **Given** an empty roster, **When** `skill:roster add --account X
   --officer kirk --level 60 --rank 3 --promotions 2` runs, **Then** a
   roster YAML is written with the officer entry, `last_updated` set to the
   current UTC ISO timestamp, and exit code 0.
2. **Given** an unknown officer id, **When** `skill:roster add` or
   `skill:roster validate` runs, **Then** the CLI emits the unknown-officer
   error verbatim and exits non-zero.
3. **Given** a valid roster, **When** `skill:roster status --account X`
   runs, **Then** the CLI prints the account age (N days), unknown-officer
   count (zero for a clean roster), and validation result.

---

### User Story 4 — Per-account report file regenerated only on input change (Priority: P2)

The `optimize-crew.yml` workflow fires on `push` to `data/crew/**` and on
`workflow_dispatch`. For each account, it writes `docs/crew/{account}.md`
**only if** the hash of the inputs (officers + tasks + that account's
roster) has changed since the last commit. No cron. Output also lands in
the GitHub Actions Job Summary.

**Why this priority**: Auto-regenerated reports on a cron cause merge
trains. Push-on-change with per-account files keeps diff blast radius
small and merge conflicts rare.

**Independent Test**: Pinning test in `tests/skills/optimizeCrew.test.ts`
asserts the workflow's `on:`, `concurrency.group: stfc-crew-optimizer`, and
SHA-pinned third-party actions. A separate integration test runs the skill
twice against unchanged inputs and asserts the second run is a no-op
(no file rewrite).

**Acceptance Scenarios**:

1. **Given** a push that modifies `data/crew/roster/main.yaml`, **When**
   the `optimize-crew.yml` workflow runs, **Then** `docs/crew/main.md` is
   regenerated and committed via a rebase-before-push step (Rule 4).
2. **Given** a push that touches an unrelated file under `data/crew/`,
   **When** the workflow runs, **Then** the input-hash check skips
   per-account regeneration and the job summary records "no changes".
3. **Given** the workflow runs concurrently with itself, **When** GitHub
   evaluates the concurrency group `stfc-crew-optimizer`, **Then** the
   second run waits or cancels per the policy declared in the workflow.

---

### User Story 5 — iPhone → Discord → R2-backed OCR loop (Priority: P3, v1.5 gated)

The operator submits roster screenshots through the existing `/game-state`
capture path. Capture binaries are stored in private Cloudflare R2; only
metadata, index, and lineage are committed to the `automation-state` branch.
The `roster-sync.yml` workflow consumes the applicable private R2 objects,
OCRs name/level/rank/promotions, diffs against the current roster YAML, and
opens a PR titled `Roster sync (main): N changes from M screenshots`. It
must use an authorized R2 access path, which remains to be implemented and
verified. The committed metadata is not the binary source. The operator
reviews on GitHub mobile, merges → the v1 optimizer re-runs and posts fresh
recommendations to a Discord `#stfc-recommendations` channel.

The capture-selection and account-association contract, including any
roster-specific allowlist, remains to be specified in the gated v1.5 work.
This spec does not define R2 access mechanics or assume that R2 is provisioned
or production-accessible for OCR.

**Why this priority**: This is the entire reason the v1 transport story
isn't "edit YAML by hand." But it ships only if the OCR POC clears the
acceptance bar (≥95% field accuracy on 20 representative screenshots,
≤2 minutes per-batch review, ≤500 MB model on CPU `ubuntu-latest` ≤30s
per screenshot, ≤2-minute cold start). Fail any criterion → OCR is
dropped and v1 stands alone.

**Independent Test**: Local CLI `skill:bootstrap-roster --account X
--screenshots ./shots/` runs the same OCR module the workflow uses;
acceptance is the POC measurement table posted to issue #85.

**Acceptance Scenarios**:

1. **Given** an eligible capture whose metadata is committed to
   `automation-state` and whose binary is in private R2, **When**
   `roster-sync.yml` runs with an authorized R2 access path, **Then** it
   processes the binary from R2, diffs against
   `data/crew/roster/{account}.yaml`, and opens a PR on
   `roster-sync/{account}-{timestamp}`. Metadata, index, and lineage are
   lookup/lineage records only; they are not image bytes. The access path
   and capture/account selection contract remain implementation prerequisites.
2. **Given** the OCR confidence on a field is below the per-field
   threshold, **When** the PR is opened, **Then** that field is annotated
   with a confidence flag in the PR body so the operator knows where to
   hand-edit.
3. **Given** a merge to `main` of a roster-sync PR, **When**
   `optimize-crew.yml` fires on the push, **Then** new recommendations
   land in `docs/crew/{account}.md` and are optionally posted to
   `#stfc-recommendations`.

---

### User Story 6 — Read-only Discord interactive commands (Priority: P3, v2 gated)

cyrusj types `!crew best mining-g3 --account main` in an allowlisted
command channel. The existing `discord-monitor` poll cycle picks up the
message and dispatches to the right read-only command. Commands include
`best`, `status`, `progression`, `explain <officer>`, `synergy <group>`,
`tasks`, `officers`, `roster show`, `knowledge <free-text>`, and `help`.
Freeform `knowledge` queries are **retrieval-only** via embedding search
over `docs/stfc-game-knowledge.md` + officers + tasks — no LLM generation.

**Why this priority**: The bot already has read access to the repo in CI;
turning that into operator-addressable read-only commands is a clean
extension that closes the "ask from anywhere" loop. Slash commands are
deferred to v3 (lower latency requires a public HTTPS endpoint).

**Independent Test**: A unit test per verb with mocked roster/DB inputs
asserts the Discord-formatted response is byte-stable against a golden
snapshot. A parser test asserts `!crew` prefix detection, allowlist
scoping, and rate-limit enforcement.

**Acceptance Scenarios**:

1. **Given** a message starting with `!crew ` in an allowlisted command
   channel, **When** the monitor poll cycle picks it up, **Then** the
   parser dispatches to the named verb and the bot posts a Discord-formatted
   reply citing the data source.
2. **Given** a message starting with `!crew` in a non-allowlisted channel,
   **When** the monitor poll runs, **Then** the message is ignored
   silently (no reply, no log noise beyond standard message processing).
3. **Given** `!crew knowledge how do I beat an Armada 25?`, **When** the
   handler runs, **Then** the response cites the top-3 chunks from
   `docs/stfc-game-knowledge.md` (or officer/task entries) with
   line-anchored citations and zero generated prose.
4. **Given** a per-user or per-channel rate-limit breach, **When** the
   parser inspects the recent-message window, **Then** the message is
   ignored and a single ephemeral rate-limit notice is posted.

---

### Edge Cases

- **Roster missing on an allowlisted account** → optimizer skips the
  account with a single warning; CI exit code unchanged (other accounts
  succeed independently per the `runAll` convention).
- **Officer DB grows mid-PR** → unknown-officer error path catches the
  drift; the operator adds the officer (PR welcomed) or removes the
  reference.
- **Roster YAML hand-edit drift** → `skill:roster validate` is the CI
  check; staleness warnings show in every output surface (CLI, workflow
  summary, per-account report header, optional Discord post).
- **Discord CDN image URL rotation** (v1.5) → CDN URLs are not the
  durable binary source; OCR reads the private R2 object referenced by
  the capture metadata. The PR cites a stable capture reference when
  available and includes the decoded fields.
- **Authorized R2 access path is unavailable or unverified** (v1.5) →
  OCR cannot proceed; the metadata location is not treated as image bytes.
  Access and failure behavior must be established and verified in #88.
- **Two `optimize-crew.yml` runs race** → concurrency group
  `stfc-crew-optimizer` serializes them; second run rebases before push
  per Rule 4.
- **Freeform `!crew knowledge` query has no high-confidence match**
  (v2) → response says "no high-confidence match — try `!crew help` or
  see `docs/stfc-game-knowledge.md`" rather than returning low-quality
  hits.

## Requirements *(mandatory)*

### Functional Requirements

**v1 — core**

- **FR-001**: The system MUST store officer definitions in committed
  `data/crew/officers.json` (a JSON array of officer entries). The shape
  is `{ id, name, faction, synergy_groups[], captain_maneuver: { text,
  tags[] }, officer_ability: { text, tags[] }, bda_role, rank_curve,
  added_in_patch, source }`. Seeded for v1 with ~30–50 officers
  hand-curated from `docs/stfc-game-knowledge.md` section 6.
- **FR-002**: The tag vocabulary MUST be a **closed enum** locked in
  v1. The v1 tag set is `mining_rate, hostile_crit, hostile_mitigation,
  armada_damage, armada_mitigation, isolytic_damage,
  isolytic_mitigation, warp_range, cargo_capacity, station_defense,
  pvp_damage, pvp_mitigation, dispatch_speed, repair_cost,
  morale_recovery`. New tags require a constitution amendment (Principle
  II / sanctioned skills) only if they expand the optimizer's surface;
  otherwise a vocabulary update via PR is sufficient. (Clarified Q2.)
- **FR-003**: The system MUST store task definitions in committed
  `data/crew/tasks/*.yaml`, one task per file. Each task names the slot
  requirements (captain + 2 officers), the tag preferences (weighted),
  and an optional `notes` field.
- **FR-004**: The system MUST store per-account rosters in committed
  `data/crew/roster/*.yaml`, one file per account. The roster is
  **tracked by default**; operators who want private rosters can opt
  out via a documented `.gitignore` snippet in `docs/CREW-OPTIMIZER.md`.
  (Clarified Q3.)
- **FR-005**: The system MUST validate `officers.json`, every
  `tasks/*.yaml`, and every `roster/*.yaml` against zod schemas declared
  in `src/crew/schemas.ts`. Validation failures throw a typed error and
  cause the CLI to exit non-zero.
- **FR-006**: `skill:roster` MUST expose subcommands `status`, `add`,
  `promote`, `rankup`, `validate`. Each maintenance subcommand auto-bumps
  `last_updated` to the current UTC ISO timestamp and writes YAML with a
  stable key order so diffs stay minimal. The subcommand shape matches
  the existing `src/cli.ts` style. (Clarified Q5.)
- **FR-007**: `skill:optimize-crew --account X --task T` MUST return a
  ranked list of legal crews with a per-crew rationale citing the matched
  tags + captain maneuver + officer ability that contributed to the
  score.
- **FR-008**: `skill:progression --account X` MUST return a prioritized
  list of next promotions / rank-ups, ordered by marginal utility across
  the operator's active task mix.
- **FR-009**: Both `skill:optimize-crew` and `skill:progression` MUST
  honour the `runAll` exit-code convention (0 for normal completion,
  1 for infrastructure-class errors, schema mismatches loud, per-account
  failures continue).
- **FR-010**: If a roster references an officer id absent from
  `officers.json`, `skill:roster validate` and `skill:optimize-crew`
  MUST emit the verbatim error `ERROR: roster references officer 'X'
  which is not in data/crew/officers.json. Add the officer (PR welcomed)
  or remove it from the roster.` and exit non-zero.
- **FR-011**: The system MUST track `last_updated` per account and
  surface staleness warnings (warn ≥7 days, strong-warn ≥14 days) in
  every output surface: CLI output, workflow job summary, per-account
  report header, and the optional Discord post. Per-account override
  via `staleness_overrides: { warn: N, error: M }` MUST be honoured.
- **FR-012**: A new workflow `.github/workflows/optimize-crew.yml` MUST
  trigger on `push` to `data/crew/**` and on `workflow_dispatch`. **No
  cron.** It MUST use a new concurrency group `stfc-crew-optimizer`
  (separate from `stfc-gift-redeemer` and `discord-monitor`), pin every
  third-party action to a full commit SHA, and use rebase-before-push
  for any commit it makes.
- **FR-013**: The workflow MUST regenerate `docs/crew/{account}.md`
  **only** when the input hash (officers.json + tasks/* + that account's
  roster) has changed since the last commit. One file per account; no
  combined-roster file in v1.
- **FR-014**: A Rule 3 pinning test in `tests/skills/optimizeCrew.test.ts`
  MUST assert the workflow's `on:` triggers, the `concurrency.group`
  value, and that every third-party action reference is SHA-pinned.
- **FR-015**: All CLI tests for `skill:roster` MUST be scoped to temp
  directories and fixtures; they MUST NEVER read or write under live
  `data/crew/roster/`.

**v1.5 — Discord/OCR transport (gated on POC pass)**

- **FR-016**: `skill:bootstrap-roster --account X --screenshots PATH`
  MUST run the same OCR pipeline locally that the workflow runs in CI.
  This local path supports the POC and local use; it does not define the
  workflow's production binary source or R2 access.
- **FR-017**: `roster-sync.yml` MUST use capture metadata, index, and
  lineage committed to `automation-state` to identify applicable capture
  binaries stored in private R2, and process those binaries through an
  authorized R2 access path. The access path and capture-selection and
  account-association contract remain to be established in #87/#88.
  Metadata files are not binary inputs; the workflow MUST NOT treat
  repository folders or Discord CDN URLs as the screenshot source. It MUST
  diff against the current roster YAML and open a PR on
  `roster-sync/{account}-{timestamp}` titled `Roster sync ({account}):
  N changes from M screenshots`.
- **FR-018**: The PR body MUST include per-change diff + per-field
  confidence flag + a stable capture reference supported by the committed
  metadata/lineage when available; it MUST NOT use a Discord CDN URL as
  the durable binary reference.
- **FR-019**: The roster-sync workflow MUST NOT auto-merge. Human review
  is the gate.
- **FR-020**: The OCR POC MUST be measured against the acceptance bar
  on 20 representative screenshots from the operator's actual gameplay
  before any v1.5 implementation work proceeds (issues #85–#90).

**v2 — read-only interactive Discord commands (gated on v1 ship)**

- **FR-021**: The `discord-monitor` poll cycle MUST detect messages
  starting with `!crew ` in allowlisted command channels (a third
  allowlist class) and dispatch to the named verb. Messages outside the
  allowlist MUST be ignored.
- **FR-022**: The parser MUST enforce per-channel and per-user
  rate limits; breach posts a single ephemeral notice and the message is
  ignored.
- **FR-023**: The v2 command surface MUST be **read-only**. No bot reply
  is a repo mutation; YAML writes still go through the v1.5 OCR PR flow
  or the local `skill:roster` CLI.
- **FR-024**: `!crew knowledge <text>` MUST be **retrieval-only**:
  embed the question with the same sentence-transformer model used to
  build the index, return the top-3 chunks from
  `docs/stfc-game-knowledge.md` + per-officer + per-task entries with
  line-anchored citations. No LLM generation.
- **FR-025**: A new committed durable input
  `data/crew/knowledge-embeddings.json` MUST be regenerated by a
  `knowledge-rebuild.yml` workflow on push to
  `docs/stfc-game-knowledge.md`, `data/crew/officers.json`, or
  `data/crew/tasks/**`. New concurrency group `stfc-knowledge-rebuild`.
- **FR-026**: A new sanctioned skill `skill:knowledge-rebuild` MUST
  regenerate the embeddings file on demand from a developer machine.

### Key Entities

- **Officer**: A canonical officer entry in `officers.json` carrying
  identity, faction, synergy groups, captain maneuver, officer ability,
  BDA role, rank curve, and provenance.
- **Roster entry**: A per-account ownership record:
  `{ id, owned, level, rank, promotions }` plus optional notes.
- **Task definition**: A YAML-declared scoring target: slot
  requirements, weighted tag preferences, and notes.
- **Crew**: An ordered triple `(captain, officer-1, officer-2)`
  candidate for a task. Pure compute artifact, not persisted.
- **Recommendation**: A scored crew with rationale citing matched tags
  and contributing abilities.
- **Knowledge chunk** (v2): A section of
  `docs/stfc-game-knowledge.md` (or one officer / one task) plus its
  precomputed embedding vector, line anchor, and heading path.

### API Contract *(N/A for v1)*

v1 introduces no external API surface. v1.5 consumes image binaries from
private Cloudflare R2 and metadata/index/lineage from `automation-state`.
The authorized R2 access path and any additional network scope remain to
be implemented and verified; this spec does not prescribe access mechanics
or make `https://cdn.discordapp.com` the OCR binary source. v2 reuses the
v1.5 amendments plus optionally fetches the sentence-transformer model from
`https://huggingface.co/...` — confirm against the existing carve-out
during the v2 constitution check.

## Out of Scope (Explicit Non-Goals)

- **No new STFC web-store API surface.** This feature does not touch
  `src/api/**` or the redeem orchestrator.
- **No third-party companion-app runtime sync** (PRIME, RaidBot, stfc.space).
- **No automatic roster updates without human review.** Every YAML change
  is a reviewed PR or a CLI command the operator explicitly ran.
- **No "execute the recommended crew" in-game.**
- **No scheduled cron on `optimize-crew.yml`.**
- **No combined-roster (multi-account aggregation) optimizer in v1.**
  Deferred to v2+ unless cheap. (Clarified Q4.)
- **No screenshot binaries committed to the repo.** Private R2 is the
  binary store; `automation-state` holds only metadata, index, and lineage
  for captures. The roster repo holds only derived YAML.
- **No auto-merge of `roster-sync` PRs.** Human review is the gate.
- **No LLM generation in `!crew knowledge`.** Retrieval-only.
- **No slash commands in v2.** Deferred to v3 (requires public HTTPS
  interactions endpoint + Discord application config + constitution
  amendment).
- **No stfc.space scraping in v1.** Hand-curated officer DB; scraping
  deferred to v1.x with a separate licensing check. (Clarified Q1.)
