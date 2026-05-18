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

### Discord bot outreach package — Path A drafted (2026-05-18T01:46:17.656+00:00)

**Context:** Cyrus chose Path A from `.squad/decisions/inbox/uhura-stfc-discord-discovery.md` — request bot whitelisting from the official STFC Discord admins.

**Deliverable:** `.squad/agents/uhura/outreach/stfc-discord-bot-request.md` — single self-contained outreach package. Sections: (1) admin-quotable ask, (2) precise technical scope with code citations, (3) minimum permissions (scopes/intents/channel-perms), (4) invite URL template with `{CLIENT_ID}` placeholder, (5) proposed channel target list with explicit "we don't know IDs until inside" caveat, (6) <300-word DM draft, (7) decline-plan.

**Path to send to admins:** `https://github.com/Jamula/stfc/blob/main/.squad/agents/uhura/outreach/stfc-discord-bot-request.md` (once committed to main). Until then: `.squad/agents/uhura/outreach/stfc-discord-bot-request.md` in repo working copy.

**Key reusable facts about our Discord integration (for future outreach / audit / governance work):**

1. **Exactly two Discord REST endpoints are used by the entire codebase**: `GET /users/@me` (`src/discord/client.ts:127`) and `GET /channels/{id}/messages` (`src/discord/client.ts:150-158`). No other Discord API surface is touched. Grep `src/discord/client.ts` for `method.*POST` returns zero matches — useful one-liner proof of read-only behavior.
2. **No gateway connection at all.** The codebase pulls via REST polling on a 15-minute cron. Anyone familiar with Discord bots will assume there's a WebSocket; we should pre-empt that assumption in any external communication.
3. **The permissions bitmask `66560` is canonical for this project** and is already documented in `docs/DISCORD-BOT-SETUP.md` §4 with a justification table. Cite that doc whenever asked "why these permissions and not more."
4. **Message Content Intent is a Developer-Portal toggle, not a server-admin grant.** Server admins should not be asked to do anything about intents — they only grant `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` at the channel level.
5. **The classifier's no-outbound-HTTP guarantee is a constitution-level invariant** documented at the top of `src/discord/classifier.ts` (lines 5-29). This is a credible privacy promise to surface to any third party — model inference is local; the only network in the file is a one-time HF download with SHA-256 verification, skip-able by placeholder hash.
6. **The User-Agent string already contains the repo URL** (`STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)`), so any admin auditing their logs can immediately find the source.

**Action queued for Cyrus:** review the outreach doc, commit it to main so the public URL works, identify Discord Application ID, substitute it for `{CLIENT_ID}` in the invite link, and DM a server mod. The DM draft in §6 is ready to send as-is.

**2026-05-18T01:47:36Z** — Path C DEFER per Picard review. Complementary to Path A but solves different problem (patch notes ≠ codes). Revisit if Path A stalled >14d, consumer named, or patch/event correlation needed. Auto-reject in ~30d if none fire. See decisions.md for full memo.
