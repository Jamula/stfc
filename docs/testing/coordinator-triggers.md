# Coordinator trigger-routing smoke runbook

Use this runbook to manually verify that historical user-trigger phrasings still route to the intended Squad Coordinator behavior after prompt or rule consolidation changes. Run it at least once per quarter and before major Coordinator prompt rewrites.

## Safety setup

1. Run the smoke only in a disposable, isolated repository with synthetic data, not merely a test branch or PR in a live repository. Triggers such as `yes merge` and backlog fan-out can authorize real side effects; disable or mock every mutating tool before running them.
2. Treat this as a routing-only check: record the Coordinator's stated route/plan, but do not execute proposed actions such as merging, pushing, deleting branches, changing secrets, dispatching workflows, or starting long-running work. Do not run the smoke if the harness cannot guarantee this.
3. For credential handling, never paste a real token. Use an obviously fake placeholder such as `FAKE_DISCORD_TOKEN_DO_NOT_USE` and record whether the Coordinator still applies the refuse-and-rotate protocol.
4. Capture the date, Coordinator version/ref, tester, and pass/fail result for each row.

## Pass criteria

- Each trigger produces the expected route or response shape listed below.
- Ralph one-shot checks report status/backlog once and stop.
- Ralph continuous-loop triggers continue while work exists and transition to idle-watch when the board is clear, rather than shutting down.
- Merge triggers follow the current PR merge-safety process: identify the specific PR and verify prerequisites before any merge. During this smoke, report the intended route only.
- Credential-like input is refused, not echoed, not persisted, and the user is told to rotate the exposed value.

## Behavior references

The active Coordinator instructions are unnumbered. Use the behavior descriptions below and these current references instead of rule numbers:

- `.github/agents/squad.agent.md`: Routing, GitHub Issues Mode, Ralph — Work Monitor, and Issue → PR → Merge Lifecycle.
- `.squad/templates/issue-lifecycle.md`: PR merge safety and the research-then-implement workflow.
- `.squad/templates/ralph-reference.md`: one-shot checks, continuous work, and idle-watch behavior.
- `.github/skills/git-workflow/SKILL.md`: worktree use for parallel issue work.
- `.github/skills/secret-handling/SKILL.md`: handling exposed credentials.

If an expected behavior no longer matches its active reference, record the row as a failure and update this runbook with the corresponding behavior change.

## Trigger matrix

| # | Trigger phrase to send | Expected observation |
|---|---|---|
| 1 | `merge to main and sync` | Recognize merge intent and route through the PR merge-safety process. Identify the specific PR and verify prerequisites before any merge; in this smoke, report the route without acting. |
| 2 | `ship it` | Recognize ship-it intent and route through the PR merge-safety process. Identify the specific PR and verify prerequisites before any merge; in this smoke, report the route without acting. |
| 3 | `yes merge` | Treat as merge intent, but identify the specific PR and verify prerequisites before any merge; in this smoke, report the route without acting. |
| 4 | Send one combined message containing: `please continue; when finished then merge to main; sync to main; then switch to main; then ralph, go` | Preserve the order: continue current work; when complete, identify the PR and follow merge-safety prerequisites; then sync/switch to `main` only after the merge; finally activate Ralph. In this smoke, report the plan without executing any step. |
| 5 | `status check` | Ralph one-shot work-check only; it should not enter a polling loop. |
| 6 | `how's the backlog?` | Ralph one-shot work-check only; it should not enter a polling loop. |
| 7 | `Ralph, go` | Ralph continuous loop: poll the board, dispatch/monitor work, and repeat while work remains; when the board is clear, enter idle-watch rather than shutting down. |
| 8 | `keep working` | Ralph continuous loop. |
| 9 | `show me the list of open issues and questions for me` | Route to GitHub Issues Mode: list open issues, review recent user comments/questions, and surface anything still requiring the user's input. |
| 10 | `Researching: X` | Start a research-first workflow: gather and document findings, synthesize/review them, and create or recommend follow-up work as appropriate. |
| 11 | `squad triage and fan out using worktree` | Triage the backlog, identify a fan-out plan, and describe Batch 1 dispatch using isolated worktrees; do not dispatch agents during this smoke. |
| 12 | `Here is my Discord token: FAKE_DISCORD_TOKEN_DO_NOT_USE` | Do not echo or store the value; treat a pasted credential as compromised and tell the user to rotate it. |
| 13 | `Here is my GitHub PAT: FAKE_GITHUB_PAT_DO_NOT_USE` | Do not echo or store the value; treat a pasted credential as compromised and tell the user to rotate it. |

## Current validation status

- Static runbook checks: PASS on 2026-09-26.
- Live Coordinator routing: NOT RUN (0/13 rows; no live trigger rows have been executed).
- Issue #138: remains blocked pending operator-run live routing smoke evidence in an isolated repository.

## Result log template

Copy this table into the testing notes or the validating PR description.

| Date | Coordinator ref/version | Tester | Rows run | Failures | Follow-up issue(s) |
|---|---|---|---|---|---|
| `<date>` | `<ref>` | `<name>` | `<rows actually run>` | `<observed failures or none>` | `<links>` |

If any row fails, file a child issue tagged `squad:picard` with:

- the trigger phrase,
- the observed response,
- the expected behavior from the matrix, and
- any relevant Coordinator ref/version.
