# Ceremonies

> Team meetings that happen before or after work. Each squad configures their own.

## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving 2+ agents modifying shared systems |
| **Facilitator** | lead |
| **Participants** | all-relevant |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. Review the task and requirements
2. Agree on interfaces and contracts between components
3. Identify risks and edge cases
4. Assign action items

---

## Retrospective

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | build failure, test failure, or reviewer rejection |
| **Facilitator** | lead |
| **Participants** | all-involved |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. What happened? (facts only)
2. Root cause analysis
3. What should change?
4. Action items for next iteration


---

## Retrospective with Enforcement

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | Round start, every round (not task-scoped): no *retrospective* log within the last 7 days, read from the runtime state backend's `log/` listing under `orphan`/`two-layer`/`git-notes`, or the filesystem `.squad/log/` under `local`/`worktree` — see "Log source of truth" below |
| **Facilitator** | lead |
| **Participants** | all |
| **Time budget** | focused |
| **Enabled** | yes |
| **Enforcement skill** | retro-enforcement |

> **Schema note (#248 Garak finding 1, revised after second-round review):**
> `When` was previously `weekly`, a value the ceremony schema never defined
> (`.squad/templates/ceremony-reference.md` only documents `before`/`after`)
> and the coordinator's Core Logic only evaluates `before`/`after`
> ceremonies — so a coordinator following its own authoritative logic never
> selected this row. `When` is now the schema-valid `before`, with an
> explicit "every round, not task-scoped" condition. `squad.agent.md` →
> Ceremonies → Core Logic step 0 names this ceremony and the script that
> evaluates it, but that step is a **prompt instruction for the interactive
> coordinator session** — no external test can prove a live session actually
> executes it, and the PR that introduced step 0 overclaimed otherwise. The
> one place this gate is **independently, externally verifiable** is
> `.github/workflows/squad-heartbeat.yml` → `.squad/templates/ralph-triage.js`,
> a real GitHub Actions job that evaluates it before constructing its own
> triage queue, for `local`/`worktree` backends. Pin tests:
> `tests/scripts/checkRetroOverdue.test.ts` and
> `tests/scripts/checkRetroOverdueCli.test.ts` (the check itself, including a
> spawned-CLI process boundary), `tests/scripts/ralphTriageRetroGate.test.ts`
> (the real dispatcher, including a fake-queue boundary proving overdue
> blocks queue construction), and `tests/agents/retroCoordinatorLifecycle.test.ts`
> (honestly scoped: pins the schema value and the real dispatcher wiring,
> and does NOT claim the interactive coordinator step is independently
> verified). Full round-start enforcement for interactive/CLI coordinator
> sessions remains open under issue #245.
>
> **Satisfiability note (#248 Kirk, round 3 — "the gate is unsatisfiable in
> the only place it actually enforces"):** the first version of this fix
> scanned `.squad/log/` for the retro signal, but that directory is
> gitignored — a fresh `actions/checkout` (what `ralph-triage.js` actually
> runs against) can never see a newly-written retro log, making the gate
> permanently "overdue" no matter how many retrospectives actually ran.
> `evaluateRetroGate` now reads the creation date of the most recent GitHub
> issue labeled `retro-action` instead — the existing, policy-grounded
> convention this ceremony's own agenda item 4 already requires, and one a
> checkout-independent REST API call can always see. See
> `tests/scripts/ralphTriageRetroGate.test.ts` for the regression proving a
> fresh retro-action issue genuinely unblocks the queue, and for the pin
> asserting the gate no longer reads `.squad/log/` directly. Fail-closed
> contract: `ralph-triage.js`'s `runRound()` proceeds with triage ONLY when
> `retroGate.evaluated === true && retroGate.overdue === false` — an
> unsupported backend, a fetch/spawn fault, or invalid child JSON all block
> the round exactly like a confirmed-overdue result, and
> `squad-heartbeat.yml` gates its later "Assign @copilot issues" step on the
> same condition (not just empty triage `results`).

**Agenda:**
1. What shipped this week? (closed issues, merged PRs)
2. What did not ship? (open issues, blockers)
3. Root cause on any failures
4. Action items -- each MUST become a GitHub Issue labeled retro-action

**Coordinator integration:**
At round start — unconditionally, every round, per `squad.agent.md` → Ceremonies →
Core Logic step 0 — invoke `scripts/check-retro-overdue.mjs` (for `local`/`worktree`
backends) or its exported `checkRetroOverdue`/`isRetroOverdue` functions with entries
from `squad_state_list(dir: "log")` (for `orphan`/`two-layer`/`git-notes` backends).
If it reports overdue, run this ceremony before any other `before` ceremony or
work-batch spawn. This is the concrete implementation of the skill's
`Test-RetroOverdue` — the skill file documents the shape, this script is what
actually runs.

**Enforcement skill install path:** `.squad/skills/retro-enforcement/SKILL.md`
(installed 2026-08-23, issue #245; previously only existed at
`.squad/templates/skills/retro-enforcement/`, making this gate silently
unenforceable for its entire existence — 82 days with no retrospective log).

**Fail-loud install check (required — issue #245).** Before trusting this row's
`Enforcement skill` field, the coordinator MUST resolve `retro-enforcement` against
the 5 documented project skill paths, in precedence order (see
`.squad/reference/skill-routing.md`): `.squad/skills/`, `.copilot/skills/`,
`.github/skills/`, `.claude/skills/`, `.agents/skills/` — i.e. check
`{path}/retro-enforcement/SKILL.md` at each in turn.

- **If any of the 5 paths resolve:** the skill is installed — proceed with
  `Test-RetroOverdue` as documented in that skill.
- **If none of the 5 paths resolve:** this ceremony is **unenforced**. Do not
  silently treat the gate as passed and do not silently skip it. Instead:
  1. Treat the retro as **overdue by definition** (fail closed, not open).
  2. Surface it loudly — post a decision/finding (`squad_decide` or
     `memory.write` class `decision`) naming the missing skill and this ceremony,
     so the gap is visible in `decisions.md` rather than silently absorbed.
  3. Do not let other work proceed until either the skill is installed at one of
     the 5 paths or a human explicitly accepts the risk.

This procedure is deliberately inlined here — in the file the coordinator always
reads — rather than living only inside the skill it is checking for; a check for
"is skill X missing" that lives exclusively inside skill X is unreadable in
exactly the case it exists to catch. The skill's own "Fail-loud install check"
section restates this for readers of that file. See `decisions.md`, "A gate that
cannot run must never report as satisfied."

**Executable enforcement (issue #245, action item 5):** `.github/workflows/protected-paths.yml`
requires `.squad/skills/retro-enforcement/SKILL.md` to exist, and its "Assert
ceremony enforcement skills are installed" step parses every "Enforcement skill"
table row out of this file (via `scripts/check-enforcement-skills.mjs`) and fails
the build if the named skill does not resolve at any of the 5 paths above — for
every ceremony, not only this one. (Deliberately not written with literal
double-asterisk emphasis here, so this sentence itself is never mistaken by the
row parser for a malformed table row — see the parser's anchored-row contract in
`check-enforcement-skills.mjs`.) Pin test: `tests/skills/enforcementSkillCheck.test.ts`.

**Log source of truth:** `Test-RetroOverdue`'s log lookup must resolve against the
governed state backend (`squad_state_list`/`squad_state_read`), not the git-tracked
`.squad/log/` directory, whenever `stateBackend` is `orphan`, `two-layer`, or
`git-notes` — see the skill's "State-backend awareness" section for the full
resolution rule.

**Why GitHub Issues, not markdown:**
Production data: 0% completion across 6 retros using markdown checklists, 100% after switching to GitHub Issues.
