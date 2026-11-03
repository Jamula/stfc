# Research — Crew Optimizer

## R1. Optimizer scoring model

**Decision:** Weighted-sum scoring over closed-vocabulary tags, gated by
slot legality. Brute-force enumeration; no heuristic search needed at
the v1 scale (~100 owned officers × 3 slots × ~20 tasks ≈ 2M crew
candidates per optimizer call worst-case, pruned aggressively by slot
constraints to <10k legal crews per task).

**Alternatives considered:**

- **Branch-and-bound / beam search.** Rejected: roster size doesn't
  justify the complexity. Brute force at this scale runs in <500ms on a
  developer laptop (the perf goal in `plan.md`).
- **ILP / constraint solver.** Rejected: heavy dependency, opaque
  rationale, hard to explain in a per-crew note.
- **ML-ranked.** Rejected: no labelled dataset, no need for
  generalisation, and "explainable" is a hard requirement (the
  rationale is half the value).

**Why this matters for v1:** The optimizer is the pure-compute heart of
the feature. A deterministic weighted-sum is testable (golden snapshots
against the tiny-world fixture), explainable (the contributing tags
appear in the rationale), and fast enough to run inside the GitHub
Actions workflow without provisioning a large runner.

## R2. Officer DB seeding strategy (Clarify Q1 — resolved)

**Decision:** Hand-curate ~30–50 officers for v1 from
`docs/stfc-game-knowledge.md` section 6. Defer `stfc.space` scraping
to v1.x with a separate licensing check.

**Alternatives considered:**

- **Scrape stfc.space once.** Rejected for v1: licensing un-cleared
  (the site doesn't ship a clear API ToS for bulk extraction), and the
  hand-curated seed is sized to cover the operator's actual roster +
  documented BDA roles. Re-evaluate when the operator's roster exceeds
  the seed coverage.
- **No seed; lazy-populate as the operator adds officers.** Rejected:
  the optimizer cannot return useful recommendations against an empty
  DB, and the unknown-officer error (FR-010) would fire constantly on
  first use.

At the time this plan was written, further scrape research had not landed;
the resolution above stands regardless (hand-curate for v1, revisit later).

## R3. Tag vocabulary (Clarify Q2 — resolved)

**Decision:** Lock the v1 enum (FR-002) at fifteen tags covering
mining, hostile, armada, isolytic, PvP, station defense, and the
support tags (warp range, cargo, dispatch speed, repair cost, morale).

**Alternatives considered:**

- **Grow per task PR.** Rejected: tag drift between officer entries
  and task definitions silently weakens the scoring function. A locked
  enum keeps scoring deterministic.
- **Open-world strings.** Rejected: typo-driven mismatches would
  silently zero out a contribution.

## R4. Roster privacy default (Clarify Q3 — resolved pre-clarify)

**Decision:** TRACKED-BY-DEFAULT. `data/crew/roster/*.yaml` is
committed. Operators wanting private rosters opt out via a documented
`.gitignore` snippet in `docs/CREW-OPTIMIZER.md`.

**Rationale:** Tracked-by-default keeps the optimizer reproducible
across operator machines and lets the CI workflow regenerate
`docs/crew/{account}.md` reliably. Privacy-conscious operators have a
trivial single-line opt-out; the optimizer handles missing roster
files gracefully (skip the account with a warning, exit 0 for
other accounts).

**Alternatives considered:**

- **Gitignore-by-default with explicit opt-in.** Rejected: surprising
  empty `docs/crew/{account}.md` in CI for first-time operators; the
  `skill:roster` family would need a "first-run helper" to register a
  new account.

## R5. Multi-account aggregation (Clarify Q4 — resolved)

**Decision:** Defer to v2+ unless cheap. v1 ships per-account only.

**Rationale:** A combined-roster optimizer requires a cross-account
fairness policy ("which account gets the best Kirk?") that needs more
operator input than v1 can absorb. Per-account reports cover the
single-operator common case and don't preclude a future aggregator.

## R6. `skill:roster` UX (Clarify Q5 — resolved)

**Decision:** Subcommand style matching the existing `src/cli.ts`
pattern: `skill:roster status`, `skill:roster add`, etc.

**Rationale:** The existing CLI dispatcher already maps
`skill:<name>` to a single `src/skills/<name>.ts` module; the
subcommand pattern keeps `skill:roster` a single registered skill
while exposing five operator-visible verbs. This matches the way
`run-all` already accepts mode flags.

## R7. Staleness policy

**Decision:** `last_updated` per account; warn at 7 days, strong-warn
at 14 days. Override per account via `staleness_overrides: { warn: N,
error: M }`. Surface in every output (CLI, workflow summary, report
header, optional Discord post).

**Alternatives considered:**

- **No staleness check.** Rejected: silent stale rosters degrade
  recommendations without any signal.
- **Hard-fail on stale.** Rejected: the operator may have a 30-day-old
  alt account that they intentionally don't update.

## R8. Per-account report regeneration

**Decision:** Input-hash check (officers + tasks + that account's
roster). Regenerate only when the hash changes. One file per account.

**Alternatives considered:**

- **Always regenerate on push.** Rejected: noise in `git log`, false
  merge conflicts.
- **Single combined report file.** Rejected: every roster edit by any
  account touches the single file; merge train.

## R9. v1.5 OCR transport (gated)

**Decision deferred to issue #85** — the POC measurement step. The
acceptance bar (≥95% accuracy on 20 screenshots, ≤2 min review per
batch, ≤500MB model, ≤30s per screenshot, ≤2-min cold start) is
encoded as FR-020. If any criterion misses, v1.5 is dropped and v1
stands alone.

For the gated transport, `/game-state` stores capture binaries in private
Cloudflare R2 and commits metadata, index, and lineage to `automation-state`.
OCR consumes binaries from R2, not from a dated repository folder or a
Discord CDN URL. The authorized access path and the metadata-based capture
selection/account-association contract are unresolved implementation
prerequisites for #87/#88; this research does not prescribe their mechanics
or assume production R2 access is available.

**Pre-decision:** if POC passes, use a deterministic detection pipeline
(template-match for fixed sprites, OCR only the name + level fields)
rather than a single end-to-end ML model. Template-matching for rank
stars and promotion dots is exact-bytes against checked-in sprite
fixtures, so those fields don't need OCR at all.

## R10. v2 freeform knowledge query

**Decision:** Embedding-based retrieval with **no LLM generation**.
Top-3 chunks returned with line-anchored citations.

**Alternatives considered:**

- **LLM-generated answer.** Rejected: hallucination risk, new outbound
  surface (LLM API), and the citations are the part the operator
  actually wants (so they can read the source).
- **Full-text search.** Rejected: misses semantic queries ("what's the
  best Romulan crew for mining?" should hit officer entries tagged
  `mining_rate` + `faction: romulan` without those exact words
  appearing in the question).

**Model:** `Xenova/all-MiniLM-L6-v2` via the already-installed
`@huggingface/transformers`. ~25 MB. CPU-only on `ubuntu-latest`.
Confirm whether the existing classifier carve-out (constitution v1.5,
Security & Compliance Constraints) is model-id-specific or broadly
`huggingface.co` — this drives whether v2 needs a constitution
amendment for the model id.

## R11. Test layers

`research.md` enumerates the test layers that map onto the FRs. The
per-phase test matrix from the source plan (Part 2) is reproduced in
`tasks.md` and lives as closing criteria on issues #78–#95.

| Layer | Lives in | Catches |
|---|---|---|
| Schema | `tests/crew/schemas.test.ts` | zod schemas accept valid examples and reject each malformed case. |
| Data layer | `tests/crew/database.test.ts`, `tests/crew/roster.test.ts`, `tests/crew/tasks.test.ts` | YAML/JSON round-trip stability, validation error messages, unknown-officer error path. |
| Real-data validation | `tests/crew/realdata.test.ts` | Validates committed `data/crew/officers.json` + every `data/crew/tasks/*.yaml` + `data/crew/roster/demo.yaml` against the schemas. Catches schema drift between code changes and seed data. |
| Engine | `tests/crew/optimizer.test.ts`, `tests/crew/progression.test.ts`, `tests/crew/staleness.test.ts`, `tests/crew/diff.test.ts` | Synergy bonuses, slot legality, scoring determinism, staleness thresholds, diff symmetry. |
| CLI | `tests/skills/roster.test.ts`, `tests/skills/optimizeCrew.test.ts`, `tests/skills/progression.test.ts` | stdout/stderr/exit-code/YAML side-effects. Temp dirs only — NEVER touches live `data/crew/roster/`. |
| Fixtures | `tests/crew/fixtures/` | tiny.yaml / tiny-officers / tiny-tasks. End-to-end ranked-output assertion. |
| Report | `tests/crew/report.test.ts` | Markdown byte-stability for fixed inputs. Snapshot against a checked-in golden. |
| Pinning (workflow) | `tests/skills/optimizeCrew.test.ts` | Per Rule 3: `on:` triggers, concurrency group, action SHA pins. |
| OCR (v1.5) | `tests/crew/ocr.test.ts` | Template-matching against fixture screenshots; diff-vs-overwrite logic. |
| R2-backed image input (v1.5) | `tests/crew/r2ImageInput.test.ts` | Verify metadata-driven input selection and authorized access behavior once the #87/#88 access contract is defined; do not model direct Discord CDN ingestion. |
| PR-opening (v1.5) | `tests/skills/rosterSync.test.ts` | Mocked `gh` CLI; branch name; PR body; `Closes #N` line emission per Rule 6. |
| Command parser (v2) | `tests/discord/commandParser.test.ts` | `!crew` prefix; allowlist; rate-limit; help output. |
| Command handlers (v2) | `tests/crew/commandHandlers.test.ts` | One test per verb; mocked roster/DB; Discord-output snapshots. |
| Knowledge (v2) | `tests/crew/knowledge.test.ts` | Chunking determinism; embedding cache invalidation; top-k similarity ordering. |
| Knowledge-rebuild pinning (v2) | `tests/skills/knowledgeRebuild.test.ts` | Per Rule 3: triggers, group, action SHAs. |

**Convention (non-negotiable):** every new test file MUST be added to
`tests/index.test.ts` as an `import` line in the same PR that adds the
file. Files not imported there silently never run.
