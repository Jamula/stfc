# Project Context

- **Project:** stfc-gift-redeemer
- **Created:** 2026-05-09

## Core Context

Agent Ralph initialized and ready for work.

## Recent Updates

📌 Team initialized on 2026-05-09

## Learnings

Initial setup complete.
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

### Role-Specific Patterns (2026-05-18T01:12Z)

**Three Ralph Layers — Activation & Lifecycle:**

1. **In-session continuous loop** (`"Ralph, go"` → scan → dispatch → monitor → repeat). Runs in conversation; polls GitHub every cycle; spawns agents in parallel; merges on reviewer-approved + CI-green (Rule 7). Scope: current session only.

2. **Local watchdog daemon** (`npx @bradygaster/squad-cli watch --interval N`). Standalone process; user starts manually; polls every N minutes; surfaces stalled PRs/issues to stdout; does not auto-dispatch. Scope: running workstation; persists until user kills process.

3. **Cloud heartbeat** (`.github/workflows/squad-heartbeat.yml`). Scheduled, fully unattended; runs on GitHub Actions (configurable frequency); self-contained reporting; no local session context. Scope: entire repository; persistent across user sessions.

**Observed Round Patterns (1, 2, 3):**

- **Round 1** (audit discovery): Ralph spawned 4 parallel audit-resolution agents; categorized 9 open issues by "user-input-needed" (routing decisions pending) vs. "auto-dispatchable" (code work, tests, edits).
- **Round 2** (rules + charter extensions): Ralph dispatched Tuvok on Rules 10–13 shipping; Tuvok on charter edits (Uhura ML, Garak hard-gate, Kirk carve-out); monitored PR merge and decision drop.
- **Round 3** (hygiene batch closeout): Ralph dispatching Tuvok again on #62 sub-items (Ralph history seeding, Garak doc); cross-referencing against audit verdict file.

**Cross-Reference — Audit Closure:**

The audit verdict at `session-state/.../research/are-all-squad-members-needed-are-they-adding-value.md` flagged Ralph as "underused post-rules-codification." Issue #62 (audit hygiene batch) captured the seeding task: transform Ralph's history from boilerplate into role-specific institutional memory. This section addresses that mandate.

**New Operating Reality — Ralph + @copilot Coexistence:**

Ralph (in-session loop) now coexists with `@copilot` (autonomous issue pickup via `squad:copilot` labels). Ralph dispatches squad members for routable work; @copilot picks up independent `squad:copilot` tasks autonomously. Clear boundary: Ralph = coordinator-level dispatch; @copilot = contributor-level autonomous work. No overlap.
