# Skill: scope-override-fanout

## Pattern

When a user (operator) overrides an Engagement Manager (EM) scope-decline verdict, dispatch the pre-scoped delegation chain in parallel from the override directive — **do NOT re-engage the EM for re-approval first.**

## Trigger

User message: *"I override your (c) Decline on [scope]. Accept option (a): [detailed scope statement]"* or similar directive capturing an explicit override of a published Engagement Manager verdict.

## Invocation

1. **Capture the override directive** — write it with `squad_state_write` to the logical key `decisions/inbox/copilot-directive-override-{em-name}-{scope}-(a).md` for audit trail. For local/worktree backends this resolves to `.squad/decisions/inbox/copilot-directive-override-{em-name}-{scope}-(a).md`. For orphan, two-layer, or git-notes backends, write only through the configured backend's governing state tools — never write the physical checkout file directly. If the state bridge is unavailable for a governed backend, fail closed and report the missing bridge instead of writing to the checkout file.
2. **Validate the override scope is pre-scoped** — the override message MUST enumerate the exact agents, deliverables, and success criteria (e.g., "Constitution amendment + script + tests + workflow" is pre-scoped; "automate this somehow" is not).
3. **Dispatch Phase 1 fan-out (background, parallel):**
   - One agent per major deliverable (e.g., constitution → Tuvok, script → Scotty, tests → Bashir, workflow → O'Brien).
   - All run simultaneously; no blocking dependencies between them.
   - Each writes a decision memo drop with `squad_state_write` to the logical key `decisions/inbox/{agent}-{deliverable}.md` capturing tradeoffs. For local/worktree backends this resolves to `.squad/decisions/inbox/{agent}-{deliverable}.md`. For orphan, two-layer, or git-notes backends, write only through the configured backend's governing state tools; if the state bridge is unavailable, fail closed and report the missing bridge instead of writing to the checkout file.
4. **Merge all decision drops into the logical `decisions/decisions.md` state key (Scribe task)** — chronological order, with EM's original verdict preserved adjacent to the override for audit trail visibility. Scribe reads/writes this key via `squad_state_read`/`squad_state_append` when state tools are available. For local/worktree backends this resolves to `.squad/decisions/decisions.md`. For orphan, two-layer, or git-notes backends, resolve only through the configured backend's governing state tools — never write the physical checkout file directly, since the runtime can overwrite it and create phantom state. If the state bridge is unavailable for a governed backend, fail closed and report the missing bridge instead of merging into the checkout file.
5. **Schedule Phase 2 (reviews)** — Hostile fact-check (Garak), architecture (Kirk), governance (Picard), in whatever order suits the scope.
6. **Do NOT loop back to the EM** for re-approval between Phase 1 and Phase 2. The override is the operative decision; Phase 2 is a final sanity-check, not a re-arbitration.

## When NOT to use this

- EM has NOT issued a verdict yet (use normal routing instead).
- Override is vague or lacks pre-scoping (ask user for clarification first; do not dispatch).
- Override contradicts an explicitly-documented safety principle (e.g., "I want to store plaintext passwords in STFC_ACCOUNTS"). Refuse and explain.

## Real-world example: discord-ops automation (2026-05-18)

**EM verdict:** Picard (c) Decline — manual Discord Portal upload is the right tool; automation cost is not justified for a one-time icon set.

**User override:** Cyrus accepts full automation (icon + description + username, script + workflow, constitution carve-out, tests, hardened against token leaks). Operator uses Actions UI from Codespace; token stays off his laptop.

**Dispatch:**
- **Tuvok** → Constitution v1.4.0 → v1.5.0 (Principle V carve-out, plan-template re-sync per Rule 1)
- **Scotty** → `scripts/discord-ops/set-discord-app-metadata.mjs` (546 LOC, no deps, Node 24 built-ins)
- **Bashir** → 10 pinning + behavior tests (sentinel token guard, constitution pinning, workflow Rule 3 enforcement)
- **O'Brien** → `.github/workflows/discord-ops.yml` (workflow_dispatch operator-only, shell-injection hardening via env-var routing)

All parallel, background. Decision memos merged by Scribe. Phase 2: Garak fact-check, Kirk arch, Picard sign-off.

**Outcome:** PR #71 open, awaiting Phase 2 reviewers. Once green, merge + deploy.

## Rationale

- **Bypass EM re-approval:** The override is explicit and pre-scoped; re-asking the EM is redundant friction.
- **Parallel Phase 1:** No dependencies between agents allow full parallelism; wall-clock time shrinks.
- **Preserve EM verdict in `decisions/decisions.md`:** Historical record helps future readers understand the trade (why was the EM skeptical? what changed?).
- **Phase 2 is a final check, not a veto:** Hostile fact-check (Garak), architecture (Kirk), and governance (Picard) validate the override is sound, but they do not have veto power over the user's explicit decision.

## Prerequisites

- User has already received the EM's verdict (not a snap decision).
- User's override is detailed enough to create assignment tickets directly (not vague aspirations).
- The scope is within the repo's governance framework (constitution, security, compliance).
