# Uhura — Integrations Dev

## Identity & Scope

- **Role:** Integrations, external APIs, Discord, news feeds, token management
- **Owns:** `DISCORD_BOT_TOKEN` custody, Discord monitor workflow, news pipeline architecture
- **Does NOT own:** Source code delivery (Kirk), governance (Picard), DevOps (O'Brien)

## Key Learnings (Condensed)

### Constitution v1.2.0 Token Scanning (2026-05-08)

Built artifact hygiene scanner (`scripts/check-artifact-hygiene.mjs`) enforcing Principle VII. 6 token patterns detected + cross-checked against live code. Pre-commit integration ready.

### Workflow Cron Patterns (2026-05-17)

- GitHub Actions cron: `MIN HOUR DOM MONTH DOW` (0=Sunday, 6=Saturday)
- Rule 3: Pinning-test updates must land in same commit as workflow edits (`grep -rn '<workflow-file>' tests/`)
- `refresh-token.yml`, `redeem.yml`, `discord-monitor.yml` all share `concurrency.group: stfc-gift-redeemer`

### Codespace Token Scope Discovery (2026-05-17)

Codespace-managed `GITHUB_TOKEN` lacks `security_events` scope by default. Fix: declare in `.devcontainer/devcontainer.json` under `customizations.codespaces.repositories.Jamula/stfc.permissions.security_events: read`. Requires Codespace rebuild post-merge.

### PR #37 Variable Shadowing Fix (2026-05-17T17:53)

`const classifiedTips: Tip[] = []` shadowed outer variable, discarding tips. Fixed via reassignment. Added tip-flow integration test. Lesson: prefer top-level mutable accumulators + reassignment over re-declarations in nested blocks.

### News Pipeline Status (2026-05-18T01:35)

- Discord monitor: active but taking FR-001 no-op path (empty allowlist = zero channels configured)
- No candidates/suppression/cooldown files written yet
- Only live feed: `docs/redeem-history.md` (16 rows/24h from redeem cron)
- `promo-codes.txt`: seed list only, not auto-populated

### STFC Discord Discovery (2026-05-18T01:39)

- **Official server:** `https://discord.com/invite/stfc` (guild 509679626763632640, 129K members, VERIFIED+PARTNERED)
- **Verification:** Discord API confirms brand-owned via features tags
- **Blocker:** Bot invite requires server admin permission; can't be done unilaterally
- **Decision proposal:** 3-path decision awaits Picard ratification (admin approval / relay server / alt source)

### STFC Website News Feed (2026-05-18T01:40)

- Canonical endpoints: `/news/` (HTML), `/feed/` (RSS), `/wp-json/wp/v2/posts` (JSON API)
- WordPress 6.9.4, Category 4 = "News"
- **Always use `date_gmt`, never `date`** (timezone gotcha)
- Polling once/day with `?after={now-25h}` catches all posts
- Alternative `wpNewsMonitor` skill trivial if Discord path (C) chosen
- Store SPA (`home.startrekfleetcommand.com`) is React catch-all, not a news source

## Current Session (2026-05-18T01:39–01:40)

**Turn 1 (Discord):** Surveyed all official STFC pages, confirmed single Discord server via Discord API verification, documented bot-invite blocker, wrote 3-path decision proposal.

**Turn 2 (Website):** Analyzed WordPress feed infrastructure, 7-day window shows 2 posts, confirmed JSON API feasibility for alternative news path.

**Deliverables:** Decision proposal (merged to decisions.md), 2 orchestration logs, cross-agent pointer to Picard.

**Next:** Awaits Picard's path ratification (A/B/C) to proceed with allowlist population or wpNewsMonitor architecture.
