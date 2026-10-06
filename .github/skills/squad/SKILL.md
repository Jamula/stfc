---
name: squad
description: >-
  Squad's command catalog and interactive menu. Invoke via /squad (slash command) or natural language ("squad commands", "what can squad do", "show me squad options"). Presents categorized operations (Install & Upgrade, Team Management, Issues & PRs, Plugins & Skills, Model & Cost, Sessions & State) as an interactive picker. Routes to the right squad CLI command or the Squad coordinator agent.
user-invocable: true
allowedTools: []
---

## Menu Presentation Rules

When the user triggers this skill (via `/squad` slash command, "squad commands", "help", "what can squad do", etc.):

1. **Category-level menu first.** Present category names as an `ask_user` choice list:
   ```
   📋 Squad Commands — pick a category:
   1. Install & Upgrade
   2. Team Management
   3. Issues & PRs
   4. Plugins & Skills
   5. Model & Cost
   6. Sessions & State
   ```
2. **Drill-down.** After selection, show operation titles in that category as a second `ask_user` list.
3. **Direct match skips the menu.** If the user says "how do I upgrade with state backend," match to the specific entry and go straight to argument collection.
4. **Compact fallback.** If `ask_user` is unavailable, render as a markdown table instead.
5. **Back / Cancel.** Include "← Back to categories" in sub-menus. Include "Cancel" in confirmation prompts. Respect "never mind" / "cancel" at any point.

**Argument collection:** For entries with `args`, iterate the list sequentially. Use `ask_user` with choices when `choices` is provided; free-text prompt otherwise. If the user says "just do it" or "defaults are fine," skip remaining args and use their defaults.

**Confirmation template:**
```
⚠️ This will {action-description}.
{what will change}
Proceed? (yes / no)
```

---

## Install & Upgrade

### Upgrade Squad CLI

- **intent:** upgrade squad, update squad, install latest version, get new version
- **summary:** Upgrade Squad CLI to the latest version for your channel
- **action:** shell
- **command:** squad upgrade
- **args:**
  - `state-backend`: Which state backend? | choices: {worktree, git-notes, orphan, two-layer} | default: (keep current)
- **confirm:** false
- **platform_caveats:** Requires terminal. In VS Code, open the integrated terminal and run the command directly.

### Initialize Squad

- **intent:** set up squad, initialize squad, create team, start squad in this project
- **summary:** Scaffold Squad in the current directory (idempotent)
- **action:** shell
- **command:** squad init
- **args:** (none)
- **confirm:** false
- **platform_caveats:** Requires terminal. Recommend a standalone terminal for best results.

### Switch State Backend

- **intent:** switch state backend, change state storage, use git-notes, use orphan branch
- **summary:** Change where Squad stores mutable state (config.json)
- **action:** file-edit
- **command:** .squad/config.json → stateBackend
- **args:**
  - `stateBackend`: Which state backend? | choices: {worktree, git-notes, orphan, two-layer} | default: (keep current)
- **confirm:** true
- **platform_caveats:** May require migration if switching away from worktree. Show current value and new value before confirming.

---

## Team Management

### Add Team Member

- **intent:** add team member, hire agent, add agent, add developer, recruit
- **summary:** Add a new agent to the team roster
- **action:** coordinator
- **command:** Add Team Member flow (Init Mode / Team Mode)
- **args:**
  - `role`: What role should this agent fill? (e.g., Frontend Dev, Backend Dev, QA Engineer)
  - `name`: Preferred name or casting universe? | default: (auto-cast from active universe)
- **confirm:** false

### Remove Team Member

- **intent:** remove team member, fire agent, delete agent, remove developer
- **summary:** Remove an agent and delete their charter and history files
- **action:** coordinator
- **command:** Remove Team Member flow
- **args:**
  - `member`: Which team member to remove? (name or role)
- **confirm:** true

### Reassign Roles

- **intent:** reassign role, change role, swap roles, update team member role
- **summary:** Update a team member's role in team.md and their charter
- **action:** coordinator
- **command:** Update team.md roster + charter.md
- **args:**
  - `member`: Which team member?
  - `newRole`: New role?
- **confirm:** false

### Show Roster

- **intent:** show roster, who is on the team, list team members, show team, capability profile
- **summary:** Display the current team roster and capability profile
- **action:** coordinator
- **command:** Direct Mode — read team.md, answer
- **args:** (none)
- **confirm:** false

---

## Issues & PRs

### Connect GitHub Repo

- **intent:** connect github, enable issues, set up issues, link repository, github issues mode
- **summary:** Connect this project to GitHub Issues via gh auth
- **action:** coordinator
- **command:** GitHub Issues Mode (connection flow)
- **args:** (none)
- **confirm:** false
- **platform_caveats:** Requires `gh auth login` to have been run in the terminal.

### Triage Issues

- **intent:** triage issues, review issues, assign issues, label issues
- **summary:** Run the Lead triage flow on open GitHub issues
- **action:** coordinator
- **command:** GitHub Issues Mode → Lead triage
- **args:** (none)
- **confirm:** false

### Activate Ralph

- **intent:** activate ralph, start ralph, ralph go, start work monitor, start auto-work
- **summary:** Activate Ralph — Work Monitor — to pick up and run queued issues
- **action:** coordinator
- **command:** Ralph — Work Monitor triggers
- **args:** (none)
- **confirm:** false

### Set Ralph Polling Interval

- **intent:** set ralph interval, change ralph timing, how often does ralph check, ralph every N minutes
- **summary:** Tell Ralph how frequently to poll for new work
- **action:** coordinator
- **command:** Ralph trigger: "Ralph, check every N minutes"
- **args:**
  - `interval`: How often should Ralph poll? (in minutes) | default: 10
- **confirm:** false

### Start Squad Watch

- **intent:** start watch, squad watch, monitor issues, watch for issues, auto-triage
- **summary:** Start squad watch to continuously poll and triage issues
- **action:** shell
- **command:** squad watch
- **args:**
  - `interval`: Poll interval in minutes | default: 10
- **confirm:** false
- **platform_caveats:** CLI-only — long-running foreground process. Not viable in VS Code without an integrated terminal. Run: `squad watch --interval {n}` in your terminal.

---

## Plugins & Skills

### Browse Plugin Marketplace

- **intent:** browse plugins, explore plugins, what plugins are available, plugin marketplace
- **summary:** Browse available plugins in the Squad marketplace
- **action:** shell
- **command:** squad plugin marketplace browse
- **args:**
  - `name`: Plugin name to search for | default: (browse all)
- **confirm:** false

### Add Marketplace Plugin

- **intent:** add plugin, install plugin, get plugin from marketplace
- **summary:** Add a plugin from the marketplace to this Squad
- **action:** shell
- **command:** squad plugin marketplace add
- **args:**
  - `plugin`: Plugin owner/repo (e.g., owner/plugin-name)
- **confirm:** false

### Remove Marketplace Plugin

- **intent:** remove plugin, uninstall plugin, delete plugin
- **summary:** Remove an installed marketplace plugin
- **action:** shell
- **command:** squad plugin marketplace remove
- **args:**
  - `name`: Plugin name to remove
- **confirm:** true

### List Marketplace Plugins

- **intent:** list plugins, show installed plugins, what plugins do I have
- **summary:** List all plugins registered in this Squad
- **action:** shell
- **command:** squad plugin marketplace list
- **args:** (none)
- **confirm:** false

### List Installed Skills

- **intent:** list skills, show skills, what skills are installed, skill catalog
- **summary:** List all skills installed in .squad/skills/ and .github/skills/
- **action:** coordinator
- **command:** Direct Mode — list .squad/skills/ and .github/skills/ directories
- **args:** (none)
- **confirm:** false

---

## Model & Cost

### Set Default Model

- **intent:** set default model, change model, use gpt, use claude, switch model
- **summary:** Set the default model for all agents in config.json
- **action:** file-edit
- **command:** .squad/config.json → defaultModel
- **args:**
  - `model`: Model name (e.g., gpt-5.6-luna, claude-sonnet-4.5, gpt-5.3-codex)
- **confirm:** false

### Override Per-Agent Model

- **intent:** set model for agent, agent model override, use different model for one agent
- **summary:** Set a model override for a specific agent in config.json
- **action:** file-edit
- **command:** .squad/config.json → agentModelOverrides.{agentName}
- **args:**
  - `agent`: Agent name (must match name in team.md)
  - `model`: Model name (e.g., gpt-5.6-luna, claude-sonnet-4.5)
- **confirm:** false

### Clear Model Preference

- **intent:** clear model, reset model, remove model preference, use default model
- **summary:** Remove a model override from config.json (reverts to system default)
- **action:** file-edit
- **command:** .squad/config.json → remove defaultModel or agentModelOverrides.{agentName}
- **args:**
  - `scope`: Clear default or a specific agent? | choices: {default model, specific agent} | default: default model
  - `agent`: Agent name (only if scope = specific agent)
- **confirm:** false

---

## Sessions & State

### Catch-Up Summary

- **intent:** catch me up, what happened, status, what did the team do, session summary
- **summary:** Summarize recent agent activity and key decisions
- **action:** coordinator
- **command:** Session catch-up flow (lazy scan)
- **args:** (none)
- **confirm:** false

### Show Recent Decisions

- **intent:** show decisions, recent decisions, what decisions were made, decision log
- **summary:** Display recent entries from the logical `decisions/decisions.md` state key
- **action:** coordinator
- **command:** Treat `decisions/decisions.md` as the logical source key; `.squad/decisions/decisions.md` is only its local/worktree file path. Read it with `squad_state_read` for key `decisions/decisions.md` when state tools are available, and answer from that result. Fall back to reading `.squad/decisions/decisions.md` directly only for local/worktree. For orphan, two-layer, or git-notes backends, never read the checkout file — if the state bridge is unavailable, fail closed and report the missing bridge instead of showing stale or empty results.
- **args:** (none)
- **confirm:** false

### Archive Old Decisions

- **intent:** archive decisions, clean up decisions, move old decisions, compact decisions
- **summary:** Review semantic eligibility, verify the archive append, then trim the active decisions source
- **action:** coordinator
- **command:** Treat `decisions/decisions.md` as the logical source key; `.squad/decisions/decisions.md` is only its local/worktree file path. Size and age thresholds trigger eligibility review only, never archival by themselves. If the ledger is at least 20,480 bytes, review entries older than 30 days; if it is at least 51,200 bytes, review entries older than 7 days. Retention taxonomy: `constitutional` = hot forever; `standing-rule` = hot forever; `active-blocker` = hot until closed; `unresolved-followup` = hot until closed; `canonical-pattern` = hot forever; `current-epic` = hot until the epic closes; `operational-learning` = hot until a similar pattern recurs at least 3 times or 90 days pass without recurrence; `archive-eligible` = verified completion or resolution only, with 7 days hot before archive. Keep open, unresolved, or unverifiable entries active. At archive-decision time, verify linked GitHub issue/PR status for `current-epic` and `archive-eligible` entries; if status cannot be confirmed, retain the entry. Before bulk-tagging, dry-run classification against the live ledger and write one review artifact to logical state key `log/{timestamp}-decisions-classification-sample.md` with `squad_state_write` (UTC timestamp; replace `:` with `-`). Re-read that key with `squad_state_read` and verify the artifact. Require user review of the artifact before bulk-tagging. Use physical `.squad/log/{timestamp}-decisions-classification-sample.md` only as a local/worktree fallback when state tools are unavailable. On orphan, two-layer, or git-notes backends, do not create or use a checkout path; if the bridge is unavailable, stop and report it. If the write or read-back fails, preserve the source ledger, do not bulk-tag, and report failure. The artifact must define the durable tagging convention, sample-classify 10–15 entries, and specify future-inbox behavior. Until then, leave untagged entries unchanged and active and never infer archive eligibility from age alone. For local/worktree, use state tools for active-ledger reads and writes when available; if unavailable, the physical active ledger is a permitted fallback. For orphan, two-layer, or git-notes, read the active ledger with `squad_state_read` for `decisions/decisions.md`; if the bridge is unavailable or the read fails, fail closed, and never consult a stale checkout copy. For every backend, append eligible entries to the already tracked `.squad/decisions-archive.md` with normal repository file operations, not mutable-state tools. Before appending, verify the destination with `git ls-files --error-unmatch .squad/decisions-archive.md`. Re-read the archive and confirm every moved heading is literally present and its entry count grew by exactly the number moved. Only after those checks pass may the active source be trimmed. For orphan, two-layer, or git-notes, write the trimmed ledger to logical key `decisions/decisions.md` with `squad_state_write`, then read it back with `squad_state_read` to verify the trim. If archive tracking, append/readback, or entry-count verification fails, leave the active source intact and report the failure; if a non-local state-tool write or readback fails, fail closed.
- **args:**
  - `olderThan`: Review decisions older than how many days for semantic eligibility? | default: 30
- **confirm:** true

### Summarize Agent History

- **intent:** summarize history, what did agent do, agent history, compress history
- **summary:** Spawn an agent to summarize and compress a team member's history file
- **action:** coordinator
- **command:** Spawn agent with history.md summarization task
- **args:**
  - `member`: Which team member's history to summarize?
- **confirm:** false
