# Ralph Instructions
<!-- User-owned: customize this file to override Ralph's autonomous-execution behavior.
     squad init creates this file on first install; squad upgrade never overwrites it. -->

<!--
  PURPOSE
  -------
  When `.squad/ralph-instructions.md` exists, `squad watch --execute` instructs the
  spawned Copilot session to read this file and follow ALL sections here instead of
  the built-in fallback prompt.  If the file is absent, the built-in prompt is used.

  CONTRACT (stable — safe to build on)
  --------------------------------------
  YOU CAN  customize via this file:
    • Extra instructions given to Ralph at session start (Teams/Slack notifications,
      calendar checks, post-task hooks, MCP-powered side effects, escalation paths)
    • Additional eligibility rules or priority ordering for issue selection
    • Agent persona, tone, or verbosity for session output

  YOU CANNOT override via this file:
    • Parallelism — Ralph always spawns agents for all actionable issues simultaneously
    • Core eligibility filter (squad/squad:* label required, not blocked, not assigned)
    • The underlying `gh` / Copilot CLI command used to spawn each session

  TRUST IMPLICATIONS
  ------------------
  This file is read by the spawned Copilot session with full agent permissions.
  Treat it like code — never paste untrusted content here.  Anyone with write access
  to this file can influence what the agent does on your behalf.

  If this file is missing or empty, `squad watch --execute` falls back to the
  built-in prompt with no behavioral change.

  PLACEHOLDERS
  ------------
  The following values are injected by execute.ts before the session reads this file:
    (none currently — Ralph builds the issue list dynamically at runtime)

  FORMAT
  ------
  Plain markdown.  Structure with ## sections.  The spawned session reads the whole
  file, so keep it concise — one screen of instructions is ideal.
-->

## Ralph, Go!

Read this file for your full instructions.  Follow ALL sections.
MAXIMIZE PARALLELISM — spawn agents for ALL actionable issues simultaneously.

> ⚠️ **MERGE AUTHORITY RESTRICTION (non-negotiable)**
> Ralph MUST NOT call `gh pr merge`, enable auto-merge, or run `gh pr ready` autonomously.
> All issue-session PRs are opened as drafts.  A human must explicitly approve and mark
> the PR ready before any merge can proceed.  Ralph's job is to surface merge-ready PRs
> in status reports — the human operator performs the merge.
>
> **CI-hold rule:** Any PR whose checks are not explicitly green (including pending,
> in-progress, billing-blocked, failed, cancelled, or unavailable) is treated as NOT
> merge-ready.  A billing-blocked workflow that shows FAILURE is NOT a green signal.
> Ralph reports these as blocked and waits for human triage.

### Issue Selection

Work on every open, unblocked, unassigned issue labeled `squad` or `squad:{member}`.
Skip issues that are assigned to a human, blocked, or marked `status:on-hold`.

### PR Creation

When spawning an agent to work on an issue, instruct it to open its PR as a draft:

```bash
gh pr create --draft --title "{title}" \
  --body "Closes #{issue-number}\n\n{description}" \
  --head squad/{issue-number}-{slug} \
  --base main
```

Draft PRs cannot be merged until a human runs `gh pr ready {pr-number}`.  This is
the intended gate.  Never omit `--draft`.

### Post-Task Actions

<!-- Uncomment and customize to add post-task hooks, e.g. Teams notifications:

After completing work on each issue:
- Post a brief summary to the team channel via your Teams MCP tool.
- Update the issue with a progress comment if no PR has been opened yet.
-->

### Escalation

If you are blocked on an issue, comment on it explaining why, add a `status:blocked`
label, and move to the next actionable item.  Do not halt the loop.
