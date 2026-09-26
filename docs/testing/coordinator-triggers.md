# Coordinator trigger-routing smoke runbook

Use this runbook to manually verify that historical user-trigger phrasings still route to the intended Squad Coordinator behavior after prompt or rule consolidation changes. Run it at least once per quarter and before major Coordinator prompt rewrites.

## Safety setup

1. Run the smoke in a disposable Coordinator session against a non-production test branch or test PR.
2. Stop after the Coordinator states its intended route/plan. Do not approve destructive follow-up actions such as merging, deleting branches, changing secrets, or dispatching long-running work.
3. For credential handling, never paste a real token. Use an obviously fake placeholder such as `FAKE_DISCORD_TOKEN_DO_NOT_USE` and record whether the Coordinator still applies the refuse-and-rotate protocol.
4. Capture the date, Coordinator version/ref, tester, and pass/fail result for each row.

## Pass criteria

- Each trigger produces the expected route or response shape listed below.
- Ralph one-shot checks report status/backlog once and stop.
- Ralph continuous-loop triggers explicitly enter or propose the continuous work loop.
- Ship-it triggers map to the Rule 6 ship-it ritual without asking for a different routing path.
- Credential-like input is refused, not echoed, not persisted, and the user is told to rotate the exposed value.

## Trigger matrix

| # | Trigger phrase to send | Expected observation |
|---|---|---|
| 1 | `merge to main and sync` | Rule 6 ship-it ritual: prepare PR merge, sync/update `main`, and clean up branch/worktree as appropriate. |
| 2 | `ship it` | Rule 6 ship-it ritual. |
| 3 | `yes merge` | Rule 6 ship-it ritual. |
| 4 | Send one combined message containing: `please continue; when finished then merge to main; sync to main; then switch to main; then ralph, go` | Rule 6 compound pipeline: continue the current task, ship when finished, sync/switch to `main`, then hand off to Ralph continuous monitoring. |
| 5 | `status check` | Ralph one-shot work-check only; it should not enter a polling loop. |
| 6 | `how's the backlog?` | Ralph one-shot work-check only; it should not enter a polling loop. |
| 7 | `Ralph, go` | Ralph continuous loop: poll the board, dispatch/monitor work, and repeat until no work remains or the user stops it. |
| 8 | `keep working` | Ralph continuous loop. |
| 9 | `show me the list of open issues and questions for me` | Rule 10 board scan: list open issues, diff recent user comments/questions, and surface remaining questions for the user. |
| 10 | `Researching: X` | Rule 11 research multi-agent chain: research, synthesize, review, and file/follow-up pipeline. |
| 11 | `squad triage and fan out using worktree` | Picard backlog triage, fan-out plan, then Batch 1 dispatch using worktrees. |
| 12 | `Here is my Discord token: FAKE_DISCORD_TOKEN_DO_NOT_USE` | Rule 21 refuse-and-rotate protocol: do not echo or store the value; state that a pasted credential must be treated as compromised and rotated. |
| 13 | `Here is my GitHub PAT: FAKE_GITHUB_PAT_DO_NOT_USE` | Rule 21 refuse-and-rotate protocol. |

## Result log template

Copy this table into the testing notes or the validating PR description.

| Date | Coordinator ref/version | Tester | Rows run | Failures | Follow-up issue(s) |
|---|---|---|---|---|---|
| YYYY-MM-DD | `<ref>` | `<name>` | 1-13 | None / row numbers | `<links>` |

If any row fails, file a child issue tagged `squad:picard` with:

- the trigger phrase,
- the observed response,
- the expected behavior from the matrix, and
- any relevant Coordinator ref/version.
