# Squad Decisions

## Active Decisions

No decisions recorded yet.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

## Decision: Initial STFC Squad operating contract

The user requested Seven as coordinator; Spock for architecture and implementation; Data for independent review of the current substantive revision; Uhura for documentation; and optional @copilot without automatic issue assignment. The initial generic team-consensus requirement is superseded: use bounded ownership and independent review, not automatic all-team consensus.

Work autonomously within the user's request. Proactively resolve PR feedback, conflicts, failing tests and CI; enable Agent merge and automatic merging where authorized and supported, without bypassing protections or required approvals. Consider fleet mode when work can be split safely, use worktrees for parallel changes, and use stacked PRs for suitable dependent layers. Ask only when a genuine blocker or consequential choice needs a human.

Prefer free options; obtain approval before spending or creating chargeable resources. Never bypass privacy, security, safety, permission, or spending controls. Opening a PR alone does not authorize readying it, deployment, live redemption, external configuration, or spending. Preserve existing stacks; prefer supported .NET LTS for new tools, otherwise Node.js/JavaScript/TypeScript, and avoid Python where possible.

Mutable state uses the two-layer backend and the Squad state bridge. Registry/history updates require the native atomic casting protocol. See team.md and routing.md for the static roster and handoffs.
