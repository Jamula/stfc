# Squad Reference: Worktrees & Orchestration Logging

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- This content is loaded on demand by the Squad coordinator; do not delete. -->

### Worktree Awareness

Resolve `TEAM_ROOT` before routing work. All `.squad/` paths are relative to that root, and every spawned agent must receive the resolved `TEAM_ROOT` value rather than discovering it independently.

Use worktree-local state by default for concurrent work; allow explicit overrides when the user wants main-checkout or externalized state.

**On-demand reference:** Read `.squad/templates/worktree-reference.md` for team-root resolution, worktree strategies, lifecycle rules, and pre-spawn setup.

### Worktree Lifecycle Management

When worktree mode is enabled, issue-based work should get a dedicated worktree and branch without disrupting the main checkout. Reuse existing issue worktrees when present and clean them up after merge.

**On-demand reference:** Read `.squad/templates/worktree-reference.md` for activation, creation, dependency linking, reuse, and cleanup rules.

### Orchestration Logging

Orchestration log entries are written by **Scribe**, not the coordinator. This keeps the coordinator's post-work turn lean and avoids context window pressure after collecting multi-agent results.

The coordinator passes a **spawn manifest** (who ran, why, what mode, outcome) to Scribe via the spawn prompt. Scribe writes one entry per agent at `.squad/orchestration-log/{timestamp}-{agent-name}.md`.

Each entry records: agent routed, why chosen, mode (background/sync), files authorized to read, files produced, and outcome. See `.squad/templates/orchestration-log.md` for the field format.

### Pre-Spawn: Worktree Setup

Before issue-based spawns, check whether worktree mode is active. If it is, resolve or create the issue worktree, prepare dependencies, and pass `WORKTREE_PATH` / `WORKTREE_MODE` into the spawn prompt.

**On-demand reference:** Read `.squad/templates/worktree-reference.md` for the full pre-spawn worktree checklist and commands.


**Session catch-up (lazy — not on every start):** Do NOT scan logs on every session start. Only provide a catch-up summary when:
- The user explicitly asks ("what happened?", "catch me up", "status", "what did the team do?")
- The coordinator detects a different user than the one in the most recent session log

When triggered:
1. Scan `.squad/orchestration-log/` for entries newer than the last session log in `.squad/log/`.
2. Present a brief summary: who worked, what they did, key decisions made.
3. Keep it to 2-3 sentences. The user can dig into logs and decisions if they want the full picture.

**decisions.md** — Agents do NOT write directly to `decisions.md`. Instead:
- Agents record decisions with `squad_decide` or `squad_state_write` to `decisions/inbox/{agent-name}-{brief-slug}.md`.
- The runtime routes that write to the configured state backend. Agents must not run `git notes`, switch to `squad-state`, or hand-roll backend commits.
- Scribe merges into the logical `decisions/decisions.md` key through the configured state backend and clears the inbox; only local/worktree uses `.squad/decisions/decisions.md`
- All agents READ the logical `decisions/decisions.md` state key at spawn time; local/worktree resolves to `.squad/decisions/decisions.md` (last-merged snapshot)

**orchestration-log/** — Scribe writes one entry per agent after each batch:
- `.squad/orchestration-log/{timestamp}-{agent-name}.md`
- The coordinator passes a spawn manifest to Scribe; Scribe creates the files
- Format matches the existing orchestration log entry template
- Append-only, never edited after write

**history.md** — No change. Each agent writes only to its own `history.md` (already conflict-free).

**log/** — No change. Already per-session files.
