# Squad Team

> stfc-gift-redeemer — a headless TypeScript CLI that auto-redeems Star Trek Fleet Command web-store gifts on a GitHub Actions schedule.

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. Does not generate domain artifacts. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Picard | M2 / Engineering Manager (boss) | `.squad/agents/picard/charter.md` | ✅ Active |
| Kirk | Lead (technical) | `.squad/agents/kirk/charter.md` | ✅ Active |
| Scotty | Core Dev | `.squad/agents/scotty/charter.md` | ✅ Active |
| Uhura | Integrations Dev | `.squad/agents/uhura/charter.md` | ✅ Active |
| Bashir | Tester | `.squad/agents/bashir/charter.md` | ✅ Active |
| Borg Queen | Critic | `.squad/agents/garak/charter.md` (history archive only) | 🗄️ Retired (2026-05-16 — seat transferred to Garak) |
| Garak | Critic | `.squad/agents/garak/charter.md` | ✅ Active |
| Tuvok | Process Auditor / Editorial Specialist | `.squad/agents/tuvok/charter.md` | ✅ Active |
| O'Brien | DevOps / Platform Engineer | `.squad/agents/obrien/charter.md` | ✅ Active |
| @copilot | 🤖 Coding Agent — Autonomous Coding Agent (model: —) — see capability profile below | (GitHub Copilot coding agent — assigned via `gh issue edit --add-assignee Copilot`) | ✅ Active |
| Scribe | Decision Merger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Monitor |

### @copilot capability profile

🟢 **Small** (single-file edits, typo fixes, dependency bumps, simple test additions)
🟡 **Medium** (multi-file refactors with clear scope, scaffolding, documented patterns)
🔴 **Architecture** (anything cross-cutting, novel design decisions, security-sensitive)

@copilot is activated on the full tier profile (🟢🟡🔴) per user decision 2026-05-18
(audit issue #61). Picard triages which issues route to @copilot; @copilot is
auto-assignable via `gh issue edit --add-assignee Copilot` and picks up work
asynchronously.

### Role hierarchy

- **Picard (M2/EM)** — manages the squad. Owns scope, priorities, triage, blocker removal, governance.
- **Kirk (Lead)** — reports to Picard. Owns architecture, technical direction, code review on correctness.
- **Scotty / Uhura / Bashir** — contributors; technical reporting line is Kirk, scope/priority line is Picard.
- **Garak / Tuvok / Scribe / Ralph** — specialists with direct relationships to both Picard (governance) and Kirk (technical).

> **Note on the Critic seat:** Borg Queen previously held this seat through the
> v1.1.0 / v1.2.0 constitution cycles and the 001-discord-monitor plan reviews.
> She retired on 2026-05-16 and the seat transferred to **Garak**, who inherits
> the hostile-fact-check methodology and historical learnings (preserved under
> `.squad/agents/garak/`). The previous occupant's name appears in shipped
> specs, decisions ledger, and other agents' history files as historical record;
> no rewrite of those artifacts.

## Coding Agent

<!-- copilot-auto-assign: true -->

## Issue Source

- **Repository:** Jamula/stfc
- **Connected:** 2026-05-12
- **Default branch:** main
- **Labels:** `squad` (inbox/triage), `squad:picard`, `squad:kirk`, `squad:scotty`, `squad:uhura`, `squad:bashir`, `squad:garak`, `squad:tuvok`
- **Worktrees:** enabled — each agent branch gets its own worktree
- **Workflow:** New issues tagged `squad` → Picard triages → assigns `squad:{member}` → member picks up (Picard may route technical-direction issues to Kirk for sub-triage)

## Project Context

- **Owner:** cyrusj
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Description:** Headless CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store, scheduled via GitHub Actions every 4 hours.
- **Universe:** Star Trek (user-requested at casting)
- **Created:** 2026-05-08

## Issue Source

- **Repository:** Jamula/stfc
- **Connected:** 2026-05-12
- **Default branch:** main
- **Filters:** open issues with `squad` label
- **Triage:** untriaged `squad` issues → Picard (M2/EM) assigns `squad:{member}` label
- **Lifecycle:** issue → branch (`squad/{issue-number}-{slug}`) → draft PR → review → merge
- **Worktrees:** enabled (per `.squad/config.json` — issue work happens in `/workspaces/stfc-{issue-number}`)
