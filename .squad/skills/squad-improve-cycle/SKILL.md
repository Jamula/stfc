# Squad Improve Cycle

Use this skill when the user types `squad improve` (or equivalent governance-review
trigger). The cycle produces a DRAFT improvement proposal for
`.github/copilot-instructions.md` — it does NOT edit the file directly.

## Owner

Picard (M2 / Engineering Manager) — governance scope. Tuvok later applies
approved edits surgically.

## Inputs (read in this order)

1. `.github/copilot-instructions.md` — the current rule set
2. `decisions.md` via `squad_state_read` when available — recently ratified
   decisions (last 30 days). Treat this as a logical state key, not a guaranteed
   checkout path. If state tools are unavailable, read
   `.squad/decisions/decisions.md` only for local/worktree backends. For
   orphan, two-layer, or git-notes backends, stop and report the missing state
   bridge; do not inspect a checkout snapshot.
3. `decisions/inbox/` via `squad_state_list`/`squad_state_read` when
   available — **especially active cleanup/refactor proposals in flight**
   (anti-pre-emption check, see below)
4. `.squad/team.md`, `.squad/routing.md`, `.squad/ceremonies.md` — current org shape
5. `log/` and `orchestration-log/` via `squad_state_list`/`squad_state_read`
   when available — last ~10 most-recent files sorted by mtime — primary
   friction signal
6. `agents/scribe/history.md` and `agents/picard/history.md` via
   `squad_state_read` when available — prior learnings and standing verdicts

Inputs 3, 5, and 6 are mutable state. If state tools are unavailable, read
their `.squad/`-relative physical paths only for local/worktree backends (for
example `.squad/decisions/inbox/`, `.squad/log/`, `.squad/orchestration-log/`,
`.squad/agents/scribe/history.md`). For orphan, two-layer, or git-notes
backends, stop and report the missing state bridge; do not inspect a checkout
snapshot.

## Anti-pre-emption check (CRITICAL — run BEFORE drafting)

Scan `decisions/inbox/` (input 3 above) for active cleanup, refactor, or
consolidation proposals (filenames like `*-cleanup-*.md`, `*-refactor-*.md`,
`*-consolidation-*.md`).
If one is in flight and its scope overlaps any candidate finding, do NOT
propose a rule in that scope this cycle. Pre-empting in-flight work creates
conflicting guidance and forces double-work.

Steer new rules to attach at the **tail** of the rule list (next sequential
number) so they survive whatever renumbering the in-flight plan applies. If
that plan renumbers existing rules, Tuvok renumbers the new tail-rules in the
same pass.

## Bar for inclusion (all must be true)

A finding becomes a new rule only if ALL are true:

1. **Recurring** — ≥ 2 independent observations across sessions, OR 1
   observation with severe blast radius.
2. **Not already covered** — by Rules 1–21 or the constitution.
3. **Actionable** — there is a specific behavior change agents can adopt.
4. **Stable** — pattern is unlikely to disappear with a one-off fix.

Findings that fail the bar go into a "considered and rejected" appendix
with a one-line rationale each. This appendix matters — it prevents the
next cycle from re-litigating the same rejected candidates.

## Output format

Deliverable: write with `squad_state_write` to logical key `decisions/inbox/picard-squad-improve-YYYY-MM-DD.md`. Local/worktree physical fallback: `.squad/decisions/inbox/picard-squad-improve-YYYY-MM-DD.md`. On orphan, two-layer, or git-notes backends, stop and report a missing bridge instead of writing a checkout snapshot.

Structure:

```markdown
### YYYY-MM-DD: Squad improve cycle — proposed rule amendments
**By:** Picard (governance), requested by <user>
**Scope:** Proposed additions/amendments to .github/copilot-instructions.md
**Status:** DRAFT — awaiting user approval before Tuvok applies edits

## Summary
{1 paragraph — N proposed new rules, M amendments, K skills}

## Proposed new rules
### Rule N. {Title}
{Full rule text, formatted identically to existing rules}
**Evidence:** {session id / log file / line} — {observation}
**Cross-reference impact:** {files needing follow-up edits}

## Proposed amendments to existing rules
{Minimal diffs with rationale}

## Proposed new skills
{One-paragraph descriptions; full text only with high confidence}

## Considered and rejected
- {Finding} — rejected because {Rule X already covers / one-off / etc.}

## Open questions for the user
- {Clarifications needed before Tuvok applies}
```

## Rule-format conventions (match existing Rules 1–21)

- Numbered heading: `## {N}. {Short imperative title}`
- Opening paragraph: failure mode + observation cite (session id or
  filename) + date
- Required behavior section with bash blocks where useful
- Anti-pattern table or worked example if helpful
- Cross-reference line to related rules

## Cadence guidance

Prior cycles landed 3 rules (Rules 19/20/21 on 2026-05-16). Three is a
healthy upper bound; **quality beats quantity**. If only 1 finding clears
the bar, ship 1. A clean board (zero findings) is also a valid result — say
so explicitly. Do not pad.

## Anti-patterns

- ❌ Editing `.github/copilot-instructions.md` directly in this cycle (proposal only)
- ❌ Proposing rules whose scope overlaps an in-flight cleanup plan
- ❌ Speculation without evidence — every proposed rule MUST cite a specific log,
  decision, or filename
- ❌ Skipping the "considered and rejected" appendix (it shows the analysis)
- ❌ Bundling unrelated findings into one rule to bulk the proposal
- ❌ Re-asserting findings that were rejected in a prior cycle without new evidence

## After the cycle

1. APPEND to `.squad/agents/picard/history.md` under "## Learnings": what
   you found, what patterns recurred, what bar you set.
2. The deliverable file IS the decision inbox drop — do not create a second
   inbox file.
3. If the analysis itself revealed a new reusable pattern, write or update
   the relevant skill (this file is itself an example of that).
