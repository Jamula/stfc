---
name: "coordinator-init-mode"
description: "The complete two-phase Init Mode protocol the Squad coordinator runs when no team exists yet in the current repo. Phase 1 = propose the team (no files created, wait for user confirm). Phase 2 = create .squad/ scaffolding, backend configuration and ignores, tracked append-only merge guidance, and the always-on built-ins (Scribe, Ralph, Rai, Fact Checker). Loaded on demand when the coordinator detects no .squad/team.md exists."
allowedTools: []
confidence: high
domain: squad-internals
source: "Extracted from squad.agent.md as part of the slimming effort (bradygaster/squad#1308). Behaviour unchanged — coordinator loads this satellite skill when init mode is detected (no .squad/team.md present)."
---

> **Load this skill when:** you detect that no `.squad/team.md` exists in the resolved team root — that means this is a fresh repo or a repo that has never been squadified, and Init Mode is the right path. The short stub in `squad.agent.md` tells you to load this skill; the full two-phase protocol lives here.
>
> **⚠️ Eager-execution exception:** Init Mode is the ONE exception to the eager-execution / parallel-fan-out doctrine. Phase 1 MUST end with a user confirmation before any file is created. Do not bypass.

## Phase 1: Propose the Team

No team exists yet. **Propose one — but DO NOT create any files until the user confirms.**

1. **Identify the user.** Run `git config user.name` to learn who you're working with. Use their name in conversation (e.g., *"Hey {user}, what are you building?"*). Store their name (NOT email) in `team.md` under Project Context. **Never read or store `git config user.email`** — email addresses are PII and must not be written to committed files.
2. Ask: *"What are you building? (language, stack, what it does)"*
3. **Cast the team.** Before proposing names, run the Casting & Persistent Naming algorithm (see the canonical Casting reference at `.squad/templates/casting-reference.md`):
   - Determine team size: pick **4–5 cast (user-domain) agents**, then add the **4 always-on built-ins** (Scribe + Ralph + Rai + Fact Checker — see their dedicated sections in `squad.agent.md`). A typical fresh squad has **8–9 total roster entries**, not 4–5.
   - Determine assignment shape from the user's project description.
   - Derive resonance signals from the session and repo context.
   - Select a universe. Allocate character names from that universe.
   - Scribe is always "Scribe" — exempt from casting.
   - Ralph is always "Ralph" — exempt from casting.
   - Rai is always "Rai" — exempt from casting.
   - Fact Checker is always "Fact Checker" — exempt from casting (same pattern as Scribe / Ralph / Rai).
4. Propose the team with their cast names. Example (names will vary per cast):

```
🏗️  {CastName1}  — Lead          Scope, decisions, code review
⚛️  {CastName2}  — Frontend Dev  React, UI, components
🔧  {CastName3}  — Backend Dev   APIs, database, services
🧪  {CastName4}  — Tester        Tests, quality, edge cases
📋  Scribe       — (silent)      Memory, decisions, session logs
🔄  Ralph        — (monitor)     Work queue, backlog, keep-alive
🛡️  Rai         — (background)  RAI awareness, content safety
🔍  Fact Checker — (verifier)    Verification + Devil's Advocate
```

5. Use the `ask_user` tool to confirm the roster. Provide choices so the user sees a selectable menu.

   The `question` must be **self-contained** because the client may render the blocking input request without the assistant text that preceded it.

   The `question` must reuse every roster line from the exact proposal emitted in step 4, in the same order. Do not regenerate, summarize, truncate, omit, or replace any roster row with an ellipsis. Every proposed member must appear with their emoji, cast name, role, and concise responsibility/scope — including all four always-on built-ins (Scribe, Ralph, Rai, Fact Checker).

   Shape:

   ```
   Confirm this team (universe: {ActualUniverse}):

   {Every roster line from step 4, copied in full and in order}

   Look right?
   ```

   Never use a bare "Look right?" question and never rely on preceding assistant output to identify the team being confirmed.

   - **choices:** `["Yes, hire this team", "Add someone", "Change a role"]`

**⚠️ STOP. Your response ENDS here. Do NOT proceed to Phase 2. Do NOT create any files or directories. Wait for the user's reply.**

---

## Phase 2: Create the Team

**Trigger:** The user replied to Phase 1 with confirmation ("yes", "looks good", or similar affirmative), OR the user's reply to Phase 1 is a task (treat as implicit "yes").

> If the user said "add someone" or "change a role," go back to Phase 1 step 3 and re-propose. **Do NOT enter Phase 2 until the user confirms.**

6. Create the `.squad/` directory structure (see `.squad/templates/` for format guides or use the standard structure: `team.md`, `routing.md`, `ceremonies.md`, `decisions/`, `casting/`, `agents/`, `orchestration-log/`, `skills/`, `log/`, `rai/`). Include the logical `decisions/inbox/` backend-owned runtime namespace; it is not a required checkout directory for nonlocal backends.

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

**Seeding:** Each agent's `history.md` starts with the project description, tech stack, and the user's name so they have day-1 context. Agent folder names are the cast name in lowercase (e.g., `.squad/agents/ripley/`). The Scribe's charter includes maintaining `decisions.md` and cross-agent context sharing. For the `local`/`worktree` backend, write `history.md` as a file. For every other backend, seed it through `squad_state_write` to the logical `agents/{name}/history.md` key and verify with `squad_state_read`; do not create a checkout copy. Rai's charter is seeded from the `Rai-charter.md` template, and `.squad/rai/policy.md` is seeded from `rai-policy.md`. Fact Checker's charter is seeded from `fact-checker-charter.md` and `.squad/fact-checker/policy.md` is seeded from `fact-checker-policy.md`.

For any non-local backend, if the state-tool bridge is unavailable or readback does not confirm the writes, fail closed before proceeding; never fall back to checkout files.

**Team.md structure:** `team.md` MUST contain a section titled exactly `## Members` (not "## Team Roster" or other variations) containing the roster table. This header is hard-coded in GitHub workflows (`squad-heartbeat.yml`, `squad-issue-assign.yml`, `squad-triage.yml`, `sync-squad-labels.yml`) for label automation. If the header is missing or titled differently, label routing breaks.

**Merge driver guidance:** Do not generate `.gitattributes` union rules for mutable or runtime state. Preserve an existing `merge=union` rule only for an artifact verified to be both tracked and a non-runtime append-only archive. Merge-driver rules are not a persistence mechanism for backend-owned state.

7. Say: *"✅ Team hired. Try: '{FirstCastName}, set up the project structure'"*

8. **Post-setup input sources** (optional — ask after team is created, not during casting):
   - **PRD/spec:** *"Do you have a PRD or spec document? (file path, paste it, or skip)"* → If provided, follow PRD Mode flow.
   - **GitHub issues:** *"Is there a GitHub repo with issues I should pull from? (owner/repo, or skip)"* → If provided, follow GitHub Issues Mode flow.
   - **Human members:** *"Are any humans joining the team? (names and roles, or just AI for now)"* → If provided, add per Human Team Members section.
   - **Copilot agent:** *"Want to include @copilot? It can pick up issues autonomously. (yes/no)"* → If yes, follow Copilot Coding Agent Member section and ask about auto-assignment.
   - These are additive. **Don't block** — if the user skips or gives a task instead, proceed immediately.
