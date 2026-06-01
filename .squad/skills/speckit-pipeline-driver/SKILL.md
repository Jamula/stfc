# Skill — Speckit Pipeline Driver (rolled-up P0–P5 + bundled constitution amendment in one worktree)

> Reusable pattern for driving a multi-phase speckit pipeline AND a
> companion constitution amendment in a single worktree, with
> phase-boundary commits and per-phase validation.

## When to use

A feature issue asks you to:
1. Author the full speckit chain (`spec.md`, `plan.md`, `research.md`,
   `data-model.md`, `contracts/*`, `quickstart.md`, `tasks.md`).
2. AND amend `.specify/memory/constitution.md` (Principle V durable
   inputs, Principle II sanctioned skills, or Security & Compliance
   constraints).
3. AND re-sync `.specify/templates/plan-template.md` per Rule 1.
4. In ONE PR with `Closes #N` for the feature issue.

## Anti-pattern this skill prevents

- WIP accumulated across all phases → committed only at the end.
  Symptom: a session interruption forces "continue from where you
  stopped" five times. Per copilot-instructions Rule 5, **commit at
  every phase boundary**.
- Constitution amendment that breaks an existing pinning test.
  Symptom: pre-commit hook fails on a `tests/constitution/*.test.ts`
  assertion because the new SIR landed above the body that the test
  reads via `indexOf(literal-path)`.
- Issue cross-references invented from the source plan's draft
  numbering rather than the live board's actual numbering. Symptom:
  references in spec/plan to "issue #79" when #79 is actually a
  different phase on the board.

## Execution order

```
0. spec.md          → commit "Phase 0 — spec.md (T001)"
1. clarify (encode answers inline)  (skip commit if no file change)
2. plan + research + data-model + quickstart + contracts/
                    → commit "Phase 2 — plan + research + data-model + contracts (T002–T007)"
3. constitution amendment + Tuvok editorial + Rule 1 plan-template re-sync
                    → commit "Phase 3 — v{X.Y.Z} → v{X'.Y'.Z'} + plan-template re-sync (T008–T010)"
4. speckit.analyze cross-artifact sweep (fix issues; verify against live board)
                    → commit "Phase 4 — speckit.analyze (T011)"
5. tasks.md
                    → commit "Phase 5 — tasks.md (T012–T013)"
6. rebase + push + gh pr create
```

Each commit subject: `feat({NNN-feature}): Phase N — {name} (T{XXX}–T{YYY})`.

## Detailed checklist

### Phase 0 — `spec.md`

- 1 spec, 5–7 user stories (P1 for the core deliverable, P2 for
  secondary surfaces, P3 for gated future scope).
- Number FRs FR-001..FR-NNN sequentially. Cross-reference these from
  every other artifact.
- Resolve pre-determined decisions inline with `(Clarified Qn.)`
  annotations so Phase 1 can skip a clarify round.

### Phase 1 — `clarify`

- For each open question in the source plan, write the resolution
  into the spec inline. No separate `clarify.md` artifact.
- If there are no genuine open questions left after the
  Coordinator's pre-decisions, no commit needed.

### Phase 2 — `plan + research + data-model + contracts`

- `plan.md` — must include a Constitution Check table that lists
  every principle touched (PASS / FAIL / N/A) and an amendment plan
  if Principle II / V / Security need extending.
- `research.md` — close every Phase-1 clarify question with an Rx
  decision note + alternatives considered + rejected reasons.
- `data-model.md` — shapes + invariants. Reference FR-NNN.
- `contracts/` — one file per externally-visible interface (CLI
  surface, file format, workflow contract).
- `quickstart.md` — operator walkthrough; forward-references to
  later-phase doc anchors if applicable.

### Phase 3 — constitution amendment + Tuvok + Rule 1

- Prepend a new SYNC IMPACT REPORT block at the top of
  `.specify/memory/constitution.md`. Preserve all prior SIRs
  verbatim below.
- **CRITICAL:** avoid literal strings in the new SIR that are pinned
  by `indexOf(literal)`-style tests under `tests/constitution/`.
  Example: don't write `scripts/discord-ops/` literally in the SIR;
  write "the operator-only one-shot ops-script carve-out" instead.
  Check `tests/constitution/*.test.ts` BEFORE writing the SIR.
- Edit the relevant principle bodies + Security & Compliance
  enumeration + version footer (TWO places: the `**Version:** X.Y.Z`
  header at the top of the principles section AND the
  `**Version**: X.Y.Z | **Ratified**: ... | **Last Amended**: ...`
  footer at the bottom).
- Bump policy: MAJOR (principle removal / backward-incompat), MINOR
  (new principle / new obligation / new sanctioned skill / new
  durable input), PATCH (wording).
- Dispatch Tuvok (haiku model) for surgical editorial pass. Pass
  him the file paths + the amendment scope. He flags
  out-of-scope claims; he doesn't make scope decisions.
- **Rule 1 re-sync grep** (verbatim):
  ```bash
  grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|<NEW PATHS>|<NEW SKILLS>|<NEW WORKFLOW>' .specify/templates/*.md
  ```
  Append the new paths/skills/workflow patterns to the alternation
  for the feature being added. Cross-check every match against the
  new body of `constitution.md`. Update lagging templates. The SIR's
  "Templates needing re-sync" line is derived from THIS grep, not
  from a structural "no principles renamed" argument.

### Phase 4 — `speckit.analyze` cross-artifact sweep

- FR coverage: every FR-NNN in spec is referenced somewhere else; no
  dangling refs from plan/research/data-model/contracts.
- Version refs consistent (spec/plan reference the new constitution
  version; constitution footer matches).
- Issue cross-references: **AUDIT AGAINST THE LIVE BOARD** with:
  ```bash
  gh issue list --state all --search "<plan-key> in:body" --json number,title --limit 30
  ```
  Build a `T### → #N` map from the live numbers, not from the
  source plan's draft numbering. Fix every reference in
  spec/plan/research/data-model/contracts/quickstart.

### Phase 5 — `tasks.md`

- T001..T### map onto every commit + every implementation issue on
  the board.
- Include a "Hand-off note for #{first impl issue}" so the next
  implementer doesn't have to re-derive context.
- If `speckit.taskstoissues` is explicitly skipped (per the source
  plan), say so loudly at the top of `tasks.md`.

### Final push

- `git fetch origin && git rebase origin/main` (Rule 4 — `main`
  drifts every 15 min from `chore(history)` commits; rebase is
  conflict-free for spec PRs).
- `git push -u origin <branch>`.
- `gh pr create --title "feat({NNN-feature}): {phase summary}" --body "$(cat <<'EOF' ... Closes #{N} ... EOF)"` — one `Closes #N` per line per Rule 6.

## Failure modes observed

1. **Pre-commit hook trips on constitution amendment** because a new
   SIR phrase shadows a body string that an existing
   `tests/constitution/*.test.ts` reads via `indexOf`. Fix: rephrase
   the SIR to avoid the literal token; do not weaken the test.
2. **Issue cross-references drift** when the spec was drafted from
   the source plan's `#1..#19` numbering but the actual GitHub
   issues are `#77..#95`. Fix in Phase 4 via the `gh issue list
   --search '<plan-key> in:body'` query.
3. **Worktree path confusion** — never `cd` to the main checkout
   `/workspaces/<repo>`; stay inside `/workspaces/<repo>-<N>`. Run
   `git branch --show-current` after every `gh pr checkout`-style
   command (copilot-instructions Rule 9a).

## Companion artifacts

- Coordinator dispatch drops `.squad/decisions/inbox/picard-{slug}.md`
  capturing the scope-split decisions for Scribe to merge.
- Picard history (`.squad/agents/picard/history.md`) appends the
  learnings under `## Learnings`.

## Token-efficient prompt for a future dispatch

> Drive issue #N (rolled-up speckit pipeline + constitution
> amendment) in worktree `/workspaces/<repo>-<N>`. Read the session
> plan at `~/.copilot/session-state/.../plan.md`. Follow
> `.squad/skills/speckit-pipeline-driver/SKILL.md` — phase-boundary
> commits, Rule 1 grep verbatim, audit issue refs against the live
> board, single `Closes #N` per line.
