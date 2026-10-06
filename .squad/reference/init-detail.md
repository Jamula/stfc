# Squad Reference: Init Phase 2 Detail

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- Loaded on demand by the Squad coordinator; do not delete. -->

**Initialize state ownership:** Create `.squad/config.json` with `version: 1` and `stateBackend` set to the explicitly selected backend; if there is no explicit backend choice, default `stateBackend` to `local` (for example, `{"version":1,"stateBackend":"local"}`). This is tracked configuration, not mutable state.

Ensure the repository-root `.gitignore` excludes the local active ledger and runtime state:
```
.squad/decisions/decisions.md
.squad/decisions/inbox/
.squad/decisions.md
.squad/agents/*/history.md
.squad/agents/*/history-archive*
.squad/casting/history.json
.squad/identity/
.squad/log/
.squad/orchestration-log/
.squad/memory/*
!.squad/memory/config.json
.squad/sessions/
.squad/.scratch/
.squad/.cache/
.squad/.watch-pids
.squad/ralph-circuit-breaker.json
.squad/*/audit-trail.md
.squad-workstream
```
Use the wildcard-plus-negation pair (`.squad/memory/*` then `!.squad/memory/config.json`) rather than ignoring the whole `memory/` directory: `.squad/memory/config.json` is a static, constitution-tracked policy file and must stay tracked, while the rest of `.squad/memory/` is backend-owned runtime state.

Treat `decisions/inbox/` as a backend-independent logical runtime namespace. Ignore the physical `.squad/decisions/inbox/` fallback in `.gitignore`; use that checkout path only with local/worktree backends. For nonlocal backends, access the logical namespace through state tools and do not create, read, or write a checkout snapshot. Never Git-merge or commit the inbox state.

The physical `.squad/decisions/decisions.md` path is local/worktree-only. Use it only with the `local` or `worktree` backend. With every other backend, read and write the active ledger through the logical `decisions/decisions.md` key using the state tools; do not create or fall back to a checkout copy. Never commit the active ledger or runtime state.

**Casting state initialization:** For the `local`/`worktree` backend, copy `.squad/templates/casting-policy.json` to `.squad/casting/policy.json` (or create from defaults) and create `registry.json` and `history.json` (entries: persistent_name, universe, created_at, legacy_named: false, status: "active"; first assignment snapshot with unique assignment_id) as files. For every other backend, seed this same data through `squad_state_write` to the equivalent logical keys instead of writing checkout files directly, then read it back with `squad_state_read` to verify the write before proceeding.

**Seeding:** Each agent's `history.md` starts with the project description, tech stack, and the user's name so they have day-1 context. Agent folder names are the cast name in lowercase (e.g., `.squad/agents/ripley/`). The Scribe's charter includes maintaining `decisions.md` and cross-agent context sharing. For the `local`/`worktree` backend, write `history.md` as a file. For every other backend, seed it through `squad_state_write` to the logical `agents/{name}/history.md` key and verify with `squad_state_read`; do not create a checkout copy. Rai's charter is seeded from the `Rai-charter.md` template, and `.squad/rai/policy.md` is seeded from `rai-policy.md`.

**Team.md structure:** `team.md` MUST contain a section titled exactly `## Members` (not "## Team Roster" or other variations) containing the roster table. This header is hard-coded in GitHub workflows (`squad-heartbeat.yml`, `squad-issue-assign.yml`, `squad-triage.yml`, `sync-squad-labels.yml`) for label automation. If the header is missing or titled differently, label routing breaks.

**Merge driver guidance:** Do not generate `.gitattributes` union rules for mutable or runtime state. Preserve an existing `merge=union` rule only for an artifact verified to be both tracked and a non-runtime append-only archive. Merge-driver rules are not a persistence mechanism for backend-owned state.
