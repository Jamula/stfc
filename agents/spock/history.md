# Spock — History

## Core Context

- **Role:** Lead / Architect
- **Joined:** 2026-11-01

## Learnings

<!-- Append new learnings below -->

## Repository orientation

Jamula/stfc is a TypeScript CLI for multi-account STFC gift and promo-code redemption, with Discord and crew skills (src/cli.ts). The scheduled redemption workflow runs every 10 minutes and persists runtime data on automation-state (.github/workflows/redeem.yml). The Discord monitor runs separately; crew optimization uses owned officers and task data (src/skills/discordMonitor.ts, src/crew/optimizer.ts).

Preserve degraded outcomes, exit-code semantics, bounded retries, and non-replayable gift claims (src/lib/outcomes.ts, src/api/client.ts, src/skills/runAll.ts). Root tests and typecheck are separate gates, and new suites require an import in tests/index.test.ts.
