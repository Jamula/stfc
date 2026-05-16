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
| Borg Queen | Critic | `.squad/agents/borg-queen/charter.md` | ✅ Active |
| Tuvok | Process Auditor / Editorial Specialist | `.squad/agents/tuvok/charter.md` | ✅ Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | — | 🔄 Monitor |

### Role hierarchy

- **Picard (M2/EM)** — manages the squad. Owns scope, priorities, triage, blocker removal, governance.
- **Kirk (Lead)** — reports to Picard. Owns architecture, technical direction, code review on correctness.
- **Scotty / Uhura / Bashir** — contributors; technical reporting line is Kirk, scope/priority line is Picard.
- **Borg Queen / Tuvok / Scribe / Ralph** — specialists with direct relationships to both Picard (governance) and Kirk (technical).

## Coding Agent

<!-- copilot-auto-assign: false -->

<!-- @copilot is not on the roster yet. Ask cyrusj to add it if you want autonomous issue pickup. -->

## Issue Source

- **Repository:** Jamula/stfc
- **Connected:** 2026-05-12
- **Default branch:** main
- **Labels:** `squad` (inbox/triage), `squad:picard`, `squad:kirk`, `squad:scotty`, `squad:uhura`, `squad:bashir`, `squad:borg-queen`, `squad:tuvok`
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
