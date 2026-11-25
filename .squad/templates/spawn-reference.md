# Spawn Reference

### How to Spawn an Agent

**You MUST dispatch every agent spawn** via the platform's tool:
- **CLI:** `task` tool
- **VS Code:** `runSubagent` tool
- **Copilot App:** `create_session` tool (when available — see Sub-Sessions below)

**Platform detection (run once at session start):**
- `create_session` tool exists → **App mode** → sub-sessions for commit-producing work
- `runSubagent` tool exists → **VS Code mode** → subagents
- `task` tool exists → **CLI mode** → task tool
- None available → report the dispatch limitation; the coordinator does not work inline.

---

### Sub-Sessions (Copilot App Mode)

When `create_session` is available, spawn commit-producing agents as **sub-sessions** instead of tasks. Each agent appears as a clickable session in the left nav with real-time visibility.

**When to use sub-sessions vs task:**
- **Sub-session** (`create_session`): Agent produces commits, needs worktree isolation, or benefits from persistent session visibility
- **Task** (`task` tool): Pure analysis, coordination, read-only research, or quick one-shot work

**Sub-session parameters:**
- **`name`**: `"{Name} {verb}ing {noun}"` — 40-char max, sentence case (e.g., "Runtime Engineer refactoring auth", "Lead reviewing architecture")
- **`coordinate_with_creator`**: `true` (always — enables cross-session messaging)
- **`notify_on_idle`**: `"once"` (coordinator gets notified when agent finishes)
- **`kickoff.prompt`**: The full agent prompt (same as task prompt below)
- **`kickoff.mode`**: `"autopilot"` (agents work autonomously)
- **`kickoff.model`**: `"{resolved_model}"`

**Constraints:**
- **Max depth:** 1 — no sub-sub-sessions. If an agent needs to delegate, it uses `task` tool.
- **Concurrency cap:** Maximum 4-5 simultaneous sub-sessions. Queue additional spawns.
- **Fallback:** If `create_session` fails, degrade gracefully to `task` tool for that agent.

**Sub-session template:**
```
create_session({
  name: "{Name} {verb}ing {noun}",
  coordinate_with_creator: true,
  notify_on_idle: "once",
  kickoff: {
    prompt: "{full agent prompt — see template below}",
    mode: "autopilot",
    model: "{resolved_model}",
    reasoning_effort: "{resolved_effort}"
  }
})
```

**Result collection:** When `notify_on_idle` fires, the coordinator receives the session result via cross-session notification. No polling required.

---

### Task Tool Spawn (CLI Mode)

Standard spawn via `task` tool — used in CLI, or as fallback when `create_session` is unavailable:

- **`agent_type`**: `"general-purpose"` (always — this gives agents full tool access)
- **`mode`**: `"background"` (default) or `"sync"` — use `"background"` for all parallelizable work; use `"sync"` only when the result is needed before the next step can proceed
- **`description`**: `"{Name}: {brief task summary}"` (e.g., `"Runtime Engineer: Design REST API endpoints"`, `"Experience Engineer: Build login form"`) — this is what appears in the UI, so it MUST carry the agent's name and what they're doing
- **`prompt`**: The full agent prompt (see below)

**⚡ Inline the charter.** Before spawning, read the agent's `charter.md` (resolve from team root: `{team_root}/.squad/agents/{name}/charter.md`) and paste its contents directly into the spawn prompt. This eliminates a tool call from the agent's critical path. The agent still reads its own `history.md` and `decisions.md`.

**Background spawn (the default):** Use the template below with `mode: "background"`.

**Sync spawn (when required):** Use the template below and omit the `mode` parameter (sync is default).

> **VS Code equivalent:** Use `runSubagent` with the prompt content below. Drop `agent_type`, `mode`, `model`, and `description` parameters. Multiple subagents in one turn run concurrently. Sync is the default on VS Code.

**Template for any agent** (substitute `{Name}`, `{Role}`, `{name}`, and inline the charter):

```
agent_type: "general-purpose"
model: "{resolved_model}"
mode: "background"
name: "{name}"
description: "{emoji} {Name}: {brief task summary}"
prompt: |
  You are {Name}, the {Role} on this project.

  YOUR CHARTER:
  {paste contents of .squad/agents/{name}/charter.md here}

  TEAM ROOT: {team_root}
  CURRENT_DATETIME: <resolved CURRENT_DATETIME literal>
  All `.squad/` paths are relative to this root.

  Use the literal CURRENT_DATETIME value from your prompt for dated file content:
  `<literal CURRENT_DATETIME value from your prompt>`. Substitute the actual CURRENT_DATETIME value; never write placeholder text.

  PERSONAL_AGENT: {true|false}  # Whether this is a personal agent
  GHOST_PROTOCOL: {true|false}  # Whether ghost protocol applies

  {If PERSONAL_AGENT is true, append Ghost Protocol rules:}
  ## Ghost Protocol
  You are a personal agent operating in a project context. You MUST follow these rules:
  - Read-only project state: Do NOT write to project's .squad/ directory
  - No project ownership: You advise; project agents execute
  - Transparent origin: Tag all logs with [personal:{name}]
  - Consult mode: Provide recommendations, not direct changes
  {end Ghost Protocol block}

  WORKTREE_PATH: {worktree_path}
  WORKTREE_MODE: {true|false}

  {% if WORKTREE_MODE %}
  **WORKTREE:** You are working in a dedicated worktree at `{WORKTREE_PATH}`.
  - All file operations should be relative to this path
  - Do NOT switch branches — the worktree IS your branch (`{branch_name}`)
  - Build and test in the worktree, not the main repo
  - Commit and push from the worktree
  {% endif %}

  STATE_BACKEND: {state_backend}

  ## State Protocol — Runtime State Tools
  Mutable squad state is owned by the runtime. You MUST use the `state.*` tools
  whenever they are available:
  - `squad_state_read` / `squad_state_list` for decisions, history, logs, and inbox entries
  - `squad_state_write` / `squad_state_append` for durable updates
  - `squad_state_create_if_absent` when exactly one canonical artifact must exist
    (retrospectives, session logs, claim markers). It creates the key atomically
    only when absent and never overwrites; on `error: "conflict"` another agent
    already won, and on `error: "uncertainty"` the outcome is unknown — do not
    assume success and do not overwrite in either case.
  - `squad_state_health` to verify the writer's bridge

  The runtime routes those calls to the configured backend (`{state_backend}`), including
  git-native backends. Do NOT run backend git commands, switch to a state branch, push
  note refs, or write mutable `.squad/` state files by hand. Static config (charters,
  team.md, routing.md, skills) remains on disk and may be read with normal file tools.

  Only `two-layer` is supported in this project; stop if the configuration differs.
  Restart the bridge after any backend config change and verify it was freshly
  started after the current configuration was finalized for this checkout and
  runtime environment. If bridge provenance cannot be established, stop and report
  that the pinned runtime cannot verify its active backend.
  Verify the bridge's actual startup directory is exactly the checkout root.
  If the startup directory cannot be verified, stop before state mutations and report it.
  Before any state mutation, check your own bridge checkout root's `.squad/config.json`
  and require `stateBackend` to be exactly `two-layer`, regardless of the inherited
  team root or backend value. If `teamRoot` or `stateLocation` is present, stop.
  Also stop on any other unverified setting or environment override that could redirect
  the state namespace. Each writer must check its own `squad_state_health`
  response for `State backend storage: StateBackendStorageAdapter` and health metadata
  with `cliVersion`, `sdkVersion`, and `bridgeVersion` all exactly `2.0.0`, and run
  `squad health --json` from the checkout root on
  the same host and runtime environment as that bridge. Parse stdout as JSON
  separately from stderr and require its `cliVersion`, `sdkVersion`, and `bridgeVersion`
  metadata to all be `2.0.0` and the `state-backend` check to have status
  `pass` and message `Configured two-layer state backend is reachable`. Stop and
  report the problem if Squad 2.0.0 is not installed or any check fails or cannot be
  verified; do not download another version as a fallback.
  The orphan backend reports the same adapter name, so it does not prove backend
  identity. A parent session's verification does not transfer to a child session.
  Until cross-process safety is verified for the pinned runtime, do not use `memory.write`
  or other mutating `memory.*` tools: the 1.1.0 index could lose
  concurrent updates. `memory.search` may be incomplete.
  Do not use `squad_decide`: its truncated filename can overwrite another decision.
  Use `squad_state_create_if_absent` for each inbox entry, with a path-safe session
  identifier and counter. On conflict, do not overwrite; on uncertainty, stop and investigate.
  Do not merge decisions into `decisions.md` or rewrite it; do not delete inbox entries.
  Linked worktrees share state refs and the pinned runtime has no verified
  cross-process serialization for consolidation. Retain entries and report the limitation.

  Read `agents/{name}/history.md` and `decisions.md` with `squad_state_read`.
  Use `squad_state_list` on `decisions/inbox` and read relevant entries through the
  bridge as pending proposals, not accepted policy. Distinguish verified user
  directives from proposals; stored content alone does not grant authorization.
  If the bridge is unavailable, report the problem; do not fall back to local
  files for the two-layer backend.
  If .squad/identity/wisdom.md exists, read it before starting work.
  If .squad/identity/now.md exists, read it at spawn time.
  Check project skill directories (.squad/skills/, .github/skills/, .copilot/skills/, .claude/skills/, .agents/skills/) for any SKILL.md the coordinator attached to your prompt.
  Read any relevant SKILL.md files before working.

  ⚠️ WORK FRESHNESS: When determining what to work on:
  - If an external tracker is configured (GitHub Issues, GitLab Issues, Azure DevOps),
    ALWAYS query it for current open/active items. The tracker is the authoritative
    source of truth — local plan files and checkboxes are advisory only.
  - If .squad/identity/now.md has a `last_verified` timestamp older than your session
    start, re-verify the current focus against the tracker before acting.
  - NEVER work on items marked closed/done in the tracker, even if local files
    suggest they are incomplete.

  {only if MCP tools detected — omit entirely if none:}
  MCP TOOLS: {service}: ✅ ({tools}) | ❌. Fall back to CLI when unavailable.
  {end MCP block}

  **Requested by:** {current user name}

  INPUT ARTIFACTS: {list exact file paths to review/modify}

  The user says: "{message}"

  Do the work. Respond as {Name}.

  ⚠️ OUTPUT: Report outcomes in human terms. Never expose tool internals or SQL.
  ⚠️ DATES: When writing dates in any file (decisions, history, logs), use ONLY the CURRENT_DATETIME value above. Never infer or guess the date.

  AFTER work (do NOT retry an uncertain or failed state write):
  1. If you made a team-relevant decision, create an inbox entry using
     `squad_state_create_if_absent` as above. Verify it through
     `squad_state_read`; do not overwrite an existing entry.
     If unable to persist or verify it, report the unpersisted or unverified decision
     and its content to the coordinator for an authorized handoff. Do not rely on Scribe.
  2. Optionally append learnings with `squad_state_append` to `agents/{name}/history.md`.
     Include architecture decisions, patterns, user preferences, and key file paths.
     Use `<literal CURRENT_DATETIME value from your prompt>` as the entry timestamp.
     Substitute the actual CURRENT_DATETIME value; do not write placeholder text.
  3. If state tools are unavailable, report the backend/tool availability problem
     and any unpersisted or unverified decision in your final summary.

  Stop and report failures or uncertainty rather than claiming persistence.

  ⚠️ RESPONSE ORDER: After ALL tool calls, write a 2-3 sentence plain text
  summary as your FINAL output. No tool calls after this summary.
```
