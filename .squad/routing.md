# Work Routing

How to decide who handles what.

## Work Type → Agent

| Work Type | Primary | Secondary |
|-----------|---------|----------|
| Architecture and design | Spock | — |
| Implementation, tests, and remediation | Spock | — |
| Independent review | Data | — |
| Documentation and operational guidance | Uhura | — |

## Rules

1. Seven coordinates and assigns one accountable specialist for each task. Consider fleet mode when work can be split safely; avoid speculative or duplicative fan-out.
2. Spock implements and tests changes. Data independently reviews the current substantive revision, including changes by `@copilot`; the author addresses findings before a fresh review.
3. Uhura handles documentation and operator guidance when needed. Seven may answer simple status or factual questions from available context without delegating.
4. `@copilot` is optional and its automatic issue assignment is disabled. Use an authorized, bounded assignment only; do not create labels or automation merely to route work.
5. Scribe, Ralph, Rai, and Fact Checker are installed support identities, not automatic participants. Do not start support agents, general monitoring, or ceremonies unless explicitly requested.
6. Make routine decisions autonomously and ask the user only about genuine blockers or consequential choices. Never bypass security, safety, privacy, permissions, or spending controls.
7. Proactively resolve authorized PR feedback, conflicts, failing tests, and CI. Enable Agent merge and automatic merging when permitted and authorized; preserve required approvals and repository protections.
8. Opening a PR alone does not authorize marking it ready, deployment, live redemption, external configuration, or spending.
9. Use separate worktrees for parallel changes. When the user requests PRs and dependent layers make a stack useful, use app-native stacked PRs in dependency order; do not force a stack for one small change.
