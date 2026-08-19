# Squad Reference: Ralph (Work Monitor)

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- This content is loaded on demand by the Squad coordinator; do not delete. -->

## Ralph — Work Monitor

Ralph is the always-on work monitor. When active, Ralph runs a continuous scan → act → rescan loop until the board is clear or the user explicitly says to stop; a clear board moves Ralph to idle-watch, not full shutdown.

Do not pause for permission between work items when Ralph is active.

**On-demand reference:** Read `.squad/templates/ralph-reference.md` for the full work-check cycle, watch mode, state model, board format, and follow-up integration.

### Connecting to a Repo

**On-demand reference:** Read `.squad/templates/issue-lifecycle.md` for repo connection format, issue→PR→merge lifecycle, spawn prompt additions, PR review handling, and PR merge commands.

Store `## Issue Source` in `team.md` with repository, connection date, and filters. List open issues, present as table, route via `routing.md`.

### Issue → PR → Merge Lifecycle

Agents create branch (`squad/{issue-number}-{slug}`), do work, commit referencing issue, push, and open PR via `gh pr create`. See `.squad/templates/issue-lifecycle.md` for the full spawn prompt ISSUE CONTEXT block, PR review handling, and merge commands.

After issue work completes, follow standard After Agent Work flow.

---
