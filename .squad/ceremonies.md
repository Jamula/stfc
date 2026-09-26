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
> Issue instead — a checkout-independent REST API call can always see this.
>
> **Completion-marker note (#248 Copilot review, second pass on the
> satisfiability fix — "using the creation time of any retro-action issue
> as the completion signal creates a race with this workflow's `issues:
> labeled` trigger: creating/labeling the FIRST action item during a
> retrospective can start a heartbeat that sees the fresh issue and resumes
> triage before the retro log and remaining action items have been
> verified"):** the signal is **not** the `retro-action` label those
> individual action items carry (agenda item 4, unchanged — every action
> item still MUST become a GitHub Issue labeled `retro-action`). It is a
> distinct `retro-complete` label, applied to a GitHub Issue **only as the
> final step of a completed retrospective**, after the log is written and
> every action item has been verified as filed — see the new agenda item 5
> below. See `tests/scripts/ralphTriageRetroGate.test.ts` for the regression
> proving a fresh `retro-complete` issue genuinely unblocks the queue, a
> labeled pull request is never mistaken for a genuine issue, and the
> pagination behavior when many labeled PRs precede a genuine issue on a
> later results page. Fail-closed
> contract: `ralph-triage.js`'s `runRound()` proceeds with triage ONLY when
> `retroGate.evaluated === true && retroGate.overdue === false` — an
> unsupported backend, a fetch/spawn fault, or invalid child JSON all block
> the round exactly like a confirmed-overdue result, and
> `squad-heartbeat.yml` gates its later "Assign @copilot issues" step on the
> same condition (not just empty triage `results`).
>
> **Label provisioning (#248 Copilot review — "the repository's current
> label inventory has no `retro-complete` label... every heartbeat blocked
> until undocumented out-of-band setup occurs"):** the `retro-complete`
> label has been created on this repository (color `#0E8A16`) as part of
> this change — it is not merely documented, it exists and is queryable
> today. Anyone re-provisioning this skill on a different repository must
> create the same label before the gate can ever report not-overdue; until
> it exists, `fetchLatestRetroCompletionDate` correctly returns `null` and
> the gate fails closed (overdue), which is the intended behavior for an
> unprovisioned signal, not a bug.
>
> **Staleness note (#248 Copilot review — "updating or relabeling an
> existing dedicated issue does not refresh the completion timestamp...
> following the documented 'update' path leaves the gate permanently
> overdue"):** `fetchLatestRetroCompletionDate` sorts by `created_at`,
> which never changes when an issue is edited or relabeled. Agenda item 5
> above is worded to require opening a **new** Issue every time, never
> reusing or relabeling a prior one — there is no "update" path to follow
> incorrectly.

**Exit-side closure verification (issue #257):** after writing the log and
filing every action item, run
`node scripts/check-retro-overdue.mjs action-items --backend local --retro-log-path <path>`
for `local`/`worktree` backends. For `orphan`/`two-layer`/`git-notes`, read
the log from `log/{filename}` and pass its content through the documented
`action-items --content-stdin` protocol (or `checkActionItemsViaBridge`).
Parse the JSON result; closure requires exit code `0`, `evaluated: true`, and
`ok: true`. A missing/unreadable log, nonzero exit, unevaluated result, or
`ok: false` is a closure fault: surface it and do not create the completion
marker or report the retrospective complete. An `ok: true` result checks for
issue references and open markdown checkboxes; it does not replace confirming
that each action item was actually filed as a `retro-action` Issue.

Only after that check passes, create a new Issue without the
`retro-complete` label as part of agenda item 5. Verify it is an Issue (not a
pull request) and that its `created_at` in UTC is strictly later than the
timestamp encoded in the log filename, parsed with its stated timezone and
normalized to UTC. If issue-type or timestamp validation fails, leave it
unlabeled and surface a closure fault. Only after all checks pass, apply the
`retro-complete` label as the final signaling operation. Because the label
event can trigger CI immediately, do no further ceremony work after applying
it. For `local`/`worktree`, the log remains
under gitignored `.squad/log/` and is the local-backend signal; for governed
backends it remains in the `log/` state namespace. The GitHub marker is the
CI-observable signal. Both the log and marker are required and neither
substitutes for the other. These are coordinator closure checks; the
round-start gate alone does not verify them.

**Agenda:**
1. What shipped this week? (closed issues, merged PRs)
2. What did not ship? (open issues, blockers)
3. Root cause on any failures
4. Action items -- each MUST become a GitHub Issue labeled retro-action
5. **Completion marker (required, last step)** -- after the exit-side closure verification above passes and every action item from step 4 is confirmed filed as a GitHub Issue (not a markdown checkbox), create a **new** GitHub Issue without the `retro-complete` label (never update/relabel a prior one -- see the staleness note below), verify its type and `created_at` as described above, then apply the `retro-complete` label as the final signaling operation. This is the CI-observable signal `ralph-triage.js`'s round-start gate reads (see the "Completion-marker note" above) -- the label must be the LAST thing the ceremony does, never the first, so a heartbeat triggered by the first `retro-action` issue during an in-progress retro can never mistake that for completion.

**Coordinator integration:**
At round start — unconditionally, every round, per `squad.agent.md` → Ceremonies →
Core Logic step 0 — invoke `node scripts/check-retro-overdue.mjs overdue --backend local
--log-dir .squad/log` for `local`/`worktree` backends. For
`orphan`/`two-layer`/`git-notes`, fetch entries with `squad_state_list(dir: "log")`
and pipe `{"entries": [...]}` on stdin to
`node scripts/check-retro-overdue.mjs overdue --backend <backend>`; the reusable
JS adapter for that exact tool-call → JSON stdin → parsed-result boundary lives in
`scripts/retro-gate-bridge.mjs`. Parse the single JSON line on stdout and read its
`overdue` field; never infer overdue/not-overdue from the exit code alone. If it
reports overdue, run this ceremony before any other `before` ceremony or work-batch
spawn. This is the concrete implementation of the skill's `Test-RetroOverdue`.

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
