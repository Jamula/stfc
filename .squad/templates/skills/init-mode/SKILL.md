---
name: "init-mode"
description: "Team initialization flow (Phase 1 proposal + Phase 2 creation)"
domain: "orchestration"
confidence: "high"
source: "extracted"
tools:
  - name: "ask_user"
    description: "Confirm team roster with selectable menu"
    when: "Phase 1 proposal — requires explicit user confirmation"
---

## Context

Init Mode activates when `.squad/team.md` does not exist, or exists but has zero roster entries under `## Members`. The coordinator proposes a team (Phase 1), waits for user confirmation, then creates the team structure (Phase 2).

## Patterns

### Phase 1: Propose the Team

No team exists yet. Propose one — but **DO NOT create any files until the user confirms.**

1. **Identify the user.** Run `git config user.name` to learn who you're working with. Use their name in conversation (e.g., *"Hey Brady, what are you building?"*). Store their name (NOT email) in `team.md` under Project Context. **Never read or store `git config user.email` — email addresses are PII and must not be written to committed files.**
2. Ask: *"What are you building? (language, stack, what it does)"*
3. **Cast the team.** Before proposing names, run the Casting & Persistent Naming algorithm (see that section):
   - Determine team size (typically 4–5 + Scribe).
   - Determine assignment shape from the user's project description.
   - Derive resonance signals from the session and repo context.
   - Select a universe. If the universe is custom, allocate character names from that universe based on the related list found in the `.squad/templates/casting/` directory. Prefer custom universes when available.
   - Scribe is always "Scribe" — exempt from casting.
   - Ralph is always "Ralph" — exempt from casting.
4. Propose the team with their cast names. Example (names will vary per cast):

```
🏗️  {CastName1}  — Lead          Scope, decisions, code review
⚛️  {CastName2}  — Frontend Dev  React, UI, components
🔧  {CastName3}  — Backend Dev   APIs, database, services
🧪  {CastName4}  — Tester        Tests, quality, edge cases
📋  Scribe       — (silent)      Memory, decisions, session logs
🔄  Ralph        — (monitor)     Work queue, backlog, keep-alive
```

5. Use the `ask_user` tool to confirm the roster. Provide choices so the user sees a selectable menu:
   - **question:** *"Look right?"*
   - **choices:** `["Yes, hire this team", "Add someone", "Change a role"]`

**⚠️ STOP. Your response ENDS here. Do NOT proceed to Phase 2. Do NOT create any files or directories. Wait for the user's reply.**

### Phase 2: Create the Team

**Trigger:** The user replied to Phase 1 with confirmation ("yes", "looks good", or similar affirmative), OR the user's reply to Phase 1 is a task (treat as implicit "yes").

> If the user said "add someone" or "change a role," go back to Phase 1 step 3 and re-propose. Do NOT enter Phase 2 until the user confirms.

6. Create the `.squad/` directory structure (see `.squad/templates/` for format guides or use the standard structure: `team.md`, `routing.md`, `ceremonies.md`, `decisions/`, `casting/`, `agents/`, `orchestration-log/`, `skills/`, and `log/`). Include the logical `decisions/inbox/` backend-owned runtime namespace; it is not a required checkout directory for nonlocal backends.

**Initialize state ownership FIRST:** If `.squad/config.json` already exists, preserve its exact contents byte-for-byte, including `stateBackend`, `worktrees`, model/context/reasoning overrides, and unknown or future settings; do not replace, truncate, normalize, or reset it. If an explicitly selected backend conflicts with the existing `stateBackend`, fail closed and require the user to authorize an explicit state migration; do not change the backend or migrate state as part of Init Mode. If the existing file cannot be read or parsed, stop and report the error rather than replacing it. Only when `.squad/config.json` is absent, create it with `version: 1` and `stateBackend` set to the explicitly selected backend; if no backend was explicitly selected, default to `local` (for example, `{"version":1,"stateBackend":"local"}`). This is tracked configuration, not mutable state. For `orphan`, `two-layer`, or `git-notes`, call `squad_state_health` after reading an existing config or creating an absent config and require a successful response before any mutable-state write; if the tool is unavailable or errors, fail closed before proceeding. `local` and `worktree` use their configured filesystem backend.

**Decision ledger initialization:** Do this after creating `.squad/config.json` and completing the non-local `squad_state_health` handshake, and before casting state initialization or agent seeding.

- For the `local`/`worktree` backend, if `.squad/decisions/decisions.md` does not exist, create it with the canonical empty-ledger content below, substituting the current UTC timestamp and initialization session name. Do not copy any existing decision entries. If the file already exists, preserve it unchanged.
- For `orphan`, `two-layer`, or `git-notes`, use `squad_state_read` on `decisions/decisions.md` to determine whether the key already exists. Preserve an existing ledger. Treat only an explicit not-found result as absent; any other read failure is unconfirmed and must fail closed. If absent, initialize that logical key with `squad_state_write` using the same empty-ledger content, then immediately call `squad_state_read` and require the returned content to match the seed. If the bridge is unavailable, the write fails, or readback is absent or does not match, fail closed before casting or agent seeding. Never create, read, or write a checkout snapshot as fallback.

Canonical empty-ledger content (no decision entries):

```markdown
# .squad/decisions/ — Decision Registry

**Updated:** {current UTC timestamp}
**Session:** {initialization session name}

This is the canonical local decision ledger at `.squad/decisions/decisions.md`.
When runtime state tools are available, `decisions/decisions.md` is the logical
state key; the runtime resolves it to the configured backend. The key does not
name a second local file, and there is no `.squad/decisions.md` mirror.

Older entries are kept in the tracked [decision archive](../decisions-archive.md).
Append new accepted decisions without rewriting existing entries. When archiving,
move complete entries without changing their meaning; do not keep duplicate
ledger copies.
```

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

The physical `.squad/decisions/decisions.md` path is local/worktree-only. Use it only with the `local` or `worktree` backend. With every other backend, read and write the active ledger through the logical `decisions/decisions.md` key using state tools; do not create or fall back to a checkout copy. Never commit the active ledger or runtime state.

**Casting state initialization:** For every backend, initialize the authoritative static casting files in the checkout: if `.squad/casting/policy.json` is absent, copy `.squad/templates/casting-policy.json` (or create it from defaults); preserve an existing policy on reruns. Create or update `.squad/casting/registry.json` as a static file while preserving existing persistent-name assignments. Never send `casting/policy.json` or `casting/registry.json` through state tools. The assignment `history.json` is mutable state: for `local`/`worktree`, create or append `.squad/casting/history.json` on the local state filesystem. For `orphan`, `two-layer`, or `git-notes`, seed only logical key `casting/history.json` with `squad_state_write` and verify it with `squad_state_read`; do not create a checkout copy. If the bridge is unavailable, the write fails, or readback does not confirm the write, fail closed before proceeding.

**Seeding:** Each agent's `history.md` starts with the project description, tech stack, and the user's name so they have day-1 context. Agent folder names are the cast name in lowercase (e.g., `.squad/agents/ripley/`). The Scribe's charter includes maintaining `decisions.md` and cross-agent context sharing. For the `local`/`worktree` backend, write `history.md` as a file. For every other backend, seed it through `squad_state_write` to the logical `agents/{name}/history.md` key and verify with `squad_state_read`; do not create a checkout copy.

For any non-local backend, if the state-tool bridge is unavailable or readback does not confirm the writes, fail closed before proceeding; never fall back to checkout files.

**Team.md structure:** `team.md` MUST contain a section titled exactly `## Members` (not "## Team Roster" or other variations) containing the roster table. This header is hard-coded in GitHub workflows (`squad-heartbeat.yml`, `squad-issue-assign.yml`, `squad-triage.yml`, `sync-squad-labels.yml`) for label automation. If the header is missing or titled differently, label routing breaks.

**Merge driver guidance:** Do not generate `.gitattributes` union rules for mutable or runtime state. Preserve an existing `merge=union` rule only for an artifact verified to be both tracked and a non-runtime append-only archive. Merge-driver rules are not a persistence mechanism for backend-owned state.

7. Say: *"✅ Team hired. Try: '{FirstCastName}, set up the project structure'"*

8. **Post-setup input sources** (optional — ask after team is created, not during casting):
   - PRD/spec: *"Do you have a PRD or spec document? (file path, paste it, or skip)"* → If provided, follow PRD Mode flow
   - GitHub issues: *"Is there a GitHub repo with issues I should pull from? (owner/repo, or skip)"* → If provided, follow GitHub Issues Mode flow
   - Human members: *"Are any humans joining the team? (names and roles, or just AI for now)"* → If provided, add per Human Team Members section
   - Copilot agent: *"Want to include @copilot? It can pick up issues autonomously. (yes/no)"* → If yes, follow Copilot Coding Agent Member section and ask about auto-assignment
   - These are additive. Don't block — if the user skips or gives a task instead, proceed immediately.

## Examples

**Example flow:**
1. Coordinator detects no team.md → Init Mode
2. Runs `git config user.name` → "Brady"
3. Asks: *"Hey Brady, what are you building?"*
4. User: *"TypeScript CLI tool with GitHub API integration"*
5. Coordinator runs casting algorithm → selects "The Usual Suspects" universe
6. Proposes: Keaton (Lead), Verbal (Prompt), Fenster (Backend), Hockney (Tester), Scribe, Ralph
7. Uses `ask_user` with choices → user selects "Yes, hire this team"
8. Coordinator creates `.squad/` structure, initializes casting state, seeds agents
9. Says: *"✅ Team hired. Try: 'Keaton, set up the project structure'"*

## Anti-Patterns

- ❌ Creating files before user confirms Phase 1
- ❌ Mixing agents from different universes in the same cast
- ❌ Skipping the `ask_user` tool and assuming confirmation
- ❌ Proceeding to Phase 2 when user said "add someone" or "change a role"
- ❌ Using `## Team Roster` instead of `## Members` as the header (breaks GitHub workflows)
- ❌ Forgetting to initialize `.squad/casting/` state files
- ❌ Reading or storing `git config user.email` (PII violation)
