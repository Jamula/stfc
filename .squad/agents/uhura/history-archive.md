# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — Artifact Hygiene Enforcement (2026-05-08)

**Implementation completed:** Built cross-platform artifact hygiene scanner to enforce Principle VII (no real tokens/account data in committed artifacts).

**Components delivered:**
1. `scripts/check-artifact-hygiene.mjs` — Node.js scanner (Windows + Linux compatible); detects 6 token patterns (JWT, BEARER_TOKEN, GITHUB_TOKEN, AWS_ACCESS_KEY, API_KEY, STFC_ACCOUNT_DATA).
2. `.github/workflows/squad-artifact-hygiene.yml` — CI gate triggered on PR touching specs/plans/tasks/docs.
3. Test fixtures: `clean-spec.md` (PASS) and `contaminated-spec.md` (FAIL with 6 labeled patterns).
4. Coordination note for Scotty on `npm test` integration.

**Verification:** Each pattern cross-checked against live code. All patterns correctly redact matched content to `<REDACTED-TOKEN>`.

**Status:** Ready for ratification and pre-commit hook integration.

### Post-Ratification Commitment

High urgency: CI token-scanner must be deployed before first speckit spec merge (blocking prerequisite per Borg Queen's v1.2.0 audit). Secret-leakage risk is constitutional violation if unmitigated.

---

### Workflow cron edits — operating reminders (2026-05-17)

Captured while fixing Issue #14 (`refresh-token.yml` -> Saturday 00:00 UTC,
PR #20):

- **GitHub Actions cron DOW field:** `MIN HOUR DOM MONTH DOW`, where DOW
  uses `0=Sunday` and `6=Saturday`. So `0 0 * * 6` is every Saturday at
  00:00 UTC. Easy to flip these by mistake — always state the cadence
  in plain English in the PR body so reviewers don't have to look it up.
- **Same-commit pinning-test rule (repo Rule 3):** *Before* committing
  any `.github/workflows/*.yml` edit, run `grep -rn '<workflow-file>'
  tests/`. If anything pins a literal cron / group / permission, it
  MUST be updated in the same commit. For #14 the grep was empty, so
  the PR is a one-file diff — call that out explicitly in the PR body
  so reviewers know it wasn't an oversight.
- **PR-without-draft norm for small workflow tweaks:** Single-file
  workflow diffs with passing tests should ship as normal PRs (not
  drafts). Cyrus prefers the lower-friction path when the blast radius
  is one cron line.
- **Concurrency-group awareness:** `refresh-token.yml`, `redeem.yml`,
  and the incoming `discord-monitor.yml` all share
  `concurrency.group: stfc-gift-redeemer`. Any cron move needs to call
  out the queue/cancel interaction in a comment so future readers
  understand why a scheduled-redeem run might be skipped that hour.

---

### Codespace token-scope discovery + devcontainer permissions fix (2026-05-17)

**Context:** Issue #17 (Dependabot triage) blocked on `403 Resource not accessible by integration` from `/repos/Jamula/stfc/dependabot/alerts`. Root cause: Codespace-managed `GITHUB_TOKEN` does not include `security_events` scope by default.

**Key finding:** `gh auth refresh` cannot add scopes to Codespace-managed tokens. The token is issued at container-creation time and is immutable for the session. The only durable fix is declaring the permission in `.devcontainer/devcontainer.json` under `customizations.codespaces.repositories.{owner/repo}.permissions.security_events: read`. After Codespace rebuild, the token is re-issued with the declared scope.

**Pattern: expand existing issue rather than file a new one.** When a discovery during a session reveals a second acceptance criterion that belongs naturally with an existing issue (same file, same container-creation event), append the criterion to the existing issue via `gh issue comment` rather than opening a new issue. This keeps the scope coherent for reviewers and avoids a redundant PR. PR #33 covers both the original #16 idle-stop ask and the new security_events scope in a single-file diff.

**devcontainer.json permissions block structure:**
```json
"customizations": {
  "codespaces": {
    "repositories": {
      "Jamula/stfc": {
        "permissions": {
          "security_events": "read"
        }
      }
    }
  }
}
```

**Follow-up required:** Cyrus must rebuild the Codespace after PR #33 merges for the new token scope to take effect. #17 can then proceed in a fresh session.

---

### PR #37 review fix — classifiedTips variable shadowing (2026-05-17T17:53:01.345+00:00)

**Context:** Kirk reviewed Scotty's PR #37 (Discord monitor Phases 5–6) and found a variable shadowing bug. Scotty locked out per reviewer rejection protocol; Uhura picked up the revision.

**Bug:** `const classifiedTips: Tip[] = []` on line 231 of `src/skills/discordMonitor.ts` (inside the `if (token)` block) shadowed the outer `let classifiedTips` declared at line 183. This caused all classified tips to be silently discarded — they were pushed into the inner array, which went out of scope, so the digest and `tips-seen.jsonl` always received an empty tips array. Health counters were wired correctly because they read from the classifier output directly, not from `classifiedTips`.

**Fix:** Removed the `const` declaration, changing `const classifiedTips: Tip[] = []` to `classifiedTips = []` (plain reassignment to the outer variable).

**Test added:** `classified tips appear in digest output and tips-seen.jsonl (tip-flow integration)` — sends a message with "tip:" prefix through the full pipeline, asserts: (1) digest file contains tip content, (2) `tipsClassified.tip >= 1`, (3) `tips-seen.jsonl` has an entry, (4) entry parses with correct `category` and `contentHash` fields.

**Lesson:** Variable shadowing with `const`/`let` in nested blocks is silent in TypeScript — no compiler warning by default. In long pipeline functions, prefer initializing mutable accumulators at the top and resetting via assignment rather than re-declaring.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*

### Phase 3 Landing — Commit 39ad92f (2026-05-17T20:42:03Z)

**US3 Bot Token Validation MVP** successfully completed. All Phase 3 tests passing (445 total). Phase 3 commit landed; Phase 4 ready for dispatch.


2026-05-17T21:39Z: Feature 003-discord-oauth shipped to main (PR #59); issue #51 closed.
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.

### News-fetch request — discovered Discord allowlist empty (2026-05-18T01:35:13.728+00:00)

**Context:** User asked `@uhura please fetch the latest news`. Investigated all news sources I own.

**Sources surveyed:**
- `data/discord/` — only `.gitkeep`; no `candidates.jsonl`, no `suppression.json`, no `cooldowns.json`.
- `data/digests/` — only `.gitkeep`; no daily digest has ever been written to main.
- `config/discord-allowlist.json` — `{ "version": 1, "entries": [] }`. **Zero channels configured.**
- `Discord monitor` workflow run 26002780232 (2026-05-17T21:09Z) — succeeded with log line `INFO [discordMonitor] allowlist empty — graceful no-op (FR-001)`. Every scheduled run since the feature shipped has been a no-op for the same reason.
- `docs/redeem-history.md` — actively appended every cron tick; 16 rows in the last 24h, all from `main` account. Daily reset (2026-05-17 04:34) claimed a big bundle including a 24 Hr Bajoran Favor chest + UC Event Ticket.
- `promo-codes.txt` — last meaningful edit was 2026-05-08 (76e40d6) seeding 30 publicly-listed codes; nothing newly added since.

**Learnings about news sources in this project:**

1. **The Discord monitor is the canonical "news" surface but it is currently dark.** Without entries in `config/discord-allowlist.json`, the skill takes the FR-001 graceful-no-op path on every cron and writes nothing. Anyone asking for "latest news" before the allowlist is populated will hear silence — and the workflow `success` status hides this from a casual `gh run list` check. Always grep the run log for `allowlist empty` before claiming "no news" in a report.
2. **`docs/redeem-history.md` is the only live news stream right now.** It is the most reliable "what just happened" source because the redeem cron commits to main on every successful claim. New rows are inserted at the top — `head -20` after the header is the right read.
3. **`promo-codes.txt` is a seed list, not a feed.** It only changes when an operator commits new codes. It is not auto-populated by the Discord monitor (that path requires the allowlist to be live).
4. **Workflow `success` ≠ "did real work".** The Discord monitor returning 0 is identical whether it processed 1000 messages or short-circuited on an empty allowlist. The discriminator is the log line, not the exit code.
5. **Repo activity (commits, PRs, issues) is Ralph's domain, not mine.** Defer unless the user explicitly asks for "repo news" or "code news".

**Action items surfaced (not taken — out of scope for a news request):**
- Operator needs to populate `config/discord-allowlist.json` with at least one channel ID for the monitor to produce actual news. Worth filing as an issue if it stays empty for another week — but not unilaterally from a news-fetch task.

### STFC Discord discovery — official server identified (2026-05-18T01:39:34.656+00:00)

**Context:** Follow-up to news-fetch — Cyrus asked me to find Discord servers from the STFC site so we can populate the empty `config/discord-allowlist.json`.

**Pages surveyed (all via `curl -sL`, no auth, public surfaces):**
- `https://startrekfleetcommand.com/` (home, 200 OK)
- `https://home.startrekfleetcommand.com/` (store SPA, 200 — initial HTML has no Discord links; would require JS render, not productive)
- `https://startrekfleetcommand.com/community-spotlight/` (200)
- `https://startrekfleetcommand.com/creator-program/` (200)
- `https://startrekfleetcommand.com/fan-art/`, `/faq/`, `/new-user-guides/`, `/star-trek-fleet-command-database/`, `/news/` (all 200)
- `https://scopely.helpshift.com/hc/en/19-star-trek-fleet-command/` (no Discord refs in static HTML)
- `https://www.scopely.com/` (no Discord refs in static HTML)

**Finding:** Every public STFC page that links to Discord links to the **same single URL**: `https://discord.com/invite/stfc`. There is exactly one official Discord server advertised across the entire `startrekfleetcommand.com` property — no per-creator, per-region, or per-faction alternatives are surfaced on official channels.

**Verification via Discord API** (`GET https://discord.com/api/v10/invites/stfc?with_counts=true`, 200):
- `guild.id`: `509679626763632640`
- `guild.name`: `"Star Trek Fleet Command"`
- `guild.description`: `"Join your fellow commanders on the official Star Trek Fleet Command™ Discord server!"`
- `guild.features`: includes `"VERIFIED"`, `"PARTNERED"`, `"COMMUNITY"`, `"DISCOVERABLE"` — these are Discord-issued tags; `VERIFIED` requires Discord's manual review and is reserved for official brand servers
- `guild.vanity_url_code`: `"stfc"` (only verified/partnered/boosted servers get vanity URLs)
- `profile.member_count`: 129,276; `online_count`: 7,930
- Default landing channel: `👋-welcome-to-cadet-corner` (`channel.id`: `1301298382182285322`)

**Learnings about STFC's Discord ecosystem:**

1. **There is exactly one official Discord server.** `discord.com/invite/stfc` → guild `509679626763632640`. Discord's own `VERIFIED` + `PARTNERED` features confirm this is the brand-owned server, not a fan server pretending to be official. No need to entertain look-alikes.
2. **The same invite is duplicated across every Scopely-published STFC page** (home, news, FAQ, community spotlight, creator program, fan art, new-user guides, database). When verifying officialness in the future, finding the invite on **any** `startrekfleetcommand.com/*` page is sufficient — they all point to the same vanity URL.
3. **The store SPA (`home.startrekfleetcommand.com`) does NOT expose Discord links in initial HTML.** It's a React app; the footer renders client-side. Don't waste time `curl`-ing it for community links — go to the marketing site instead.
4. **Scopely-level support (helpshift) does not advertise Discord either.** Community is fully delegated to the per-game site, not centralized at the publisher level.
5. **No content-creator Discord servers are linked from official surfaces.** The Creator Program page links only to the official server and a Google Forms application. If we want creator-run servers in the allowlist, that intel has to come from elsewhere (YouTube channel descriptions, Reddit sticky, or operator capture) — never from `startrekfleetcommand.com` itself.
6. **Vanity-URL invites never expire** (`expires_at: null` confirmed). Safe to commit the invite URL to repo config; it won't rot.
7. **Adding a server to the allowlist is step 1 of N.** Subsequent steps: (a) invite the `DISCORD_BOT_TOKEN` bot to the server (requires server admin permission — Uhura can't do this unilaterally), (b) verify the bot has `View Channel` + `Read Message History` on each target channel, (c) capture channel IDs via Discord developer mode, (d) write each `{ id, name, enabled: true }` entry into `config/discord-allowlist.json`. Without step (a), step (d) is wasted work — the monitor will hit `Channel ID does not exist or is no longer visible` errors (per `src/discord/ingest.ts`).

### STFC website news feed — canonical endpoints discovered (2026-05-18T01:40:35.502+00:00)

**Context:** Cyrus asked for the last 7 days of website news. Investigated the news infrastructure as a permanent piece of integration knowledge.

**Canonical endpoints (all 200, all cacheable):**

| Endpoint | Purpose | Format |
|---|---|---|
| `https://startrekfleetcommand.com/news/` | Human-readable news index | HTML |
| `https://startrekfleetcommand.com/feed/` | RSS 2.0 feed (full content, all categories) | `application/rss+xml; charset=UTF-8` |
| `https://startrekfleetcommand.com/wp-json/wp/v2/posts` | WordPress REST API — query by `?after=`, `?before=`, `?categories=`, `?per_page=`, `?_fields=...` | JSON |
| `https://startrekfleetcommand.com/wp-json/wp/v2/categories/{id}` | Resolve numeric category IDs to slugs/names | JSON |

**Tested 404s** (don't bother probing these in future):
- `/blog/`, `/announcements/`, `/updates/`, `/patch-notes/` — all 404. The only URL slug for news is `/news/`.

**Important integration facts:**

1. **The site is WordPress 6.9.4** (per `<generator>` in RSS). The `/wp-json/wp/v2/posts` endpoint is the canonical machine-readable feed — RSS is a wrapper around the same data. For programmatic ingestion, prefer the JSON API: it supports `?after=ISO8601` filtering server-side, so we never have to fetch+drop posts older than the window.
2. **Field projection works.** Always pass `_fields=date_gmt,title,link,excerpt` (or whatever subset is needed) — the default response includes the full rendered HTML of every post, which can be 10s of KB per item. Field projection drops payload size by ~20×.
3. **Always use `date_gmt` / `modified_gmt`, NOT `date` / `modified`.** The non-GMT fields are in the WordPress site's local timezone (probably US Pacific) with no `Z` suffix — easy to misparse as UTC and end up 7–8 hours off. The `_gmt` variants are UTC.
4. **Category 4 = "News"** — the only category used by both posts in the 7-day window. There may be other categories (Events, Patch Notes, Dev Blog) but in practice everything funnels through "News". Resolve via `/wp-json/wp/v2/categories/{id}?_fields=name,slug` when needed.
5. **Pagination via `per_page=N` (max 100) + `page=N`.** Default is 10. For a 7-day window 30 is comfortable; for backfills, page through.
6. **`home.startrekfleetcommand.com` is a SPA that returns HTTP 200 for ANY path** (React Router catch-all → serves `index.html`). Do NOT probe `home/news`, `home/announcements`, etc. for news content — they all return the same SPA shell, not real endpoints. The store has no public-HTML news surface.
7. **Cron cadence observation:** Looking at the 5 most recent posts (2026-05-01 → 2026-05-16), posts arrive roughly every 3–11 days. Polling the JSON API once per day with `?after={now-25h}` would catch every post with comfortable redundancy and is essentially free (Cloudflare-cached).

**Implication for project:** If the Discord monitor path (FR-001 graceful-no-op due to empty allowlist) stays blocked on the bot-invite problem, an alternative `wpNewsMonitor` skill would be trivial to write — single GET per day, JSON parsing, append to `data/news/seen.jsonl` with the same content-hash dedupe pattern as Discord. Worth flagging if Picard picks path (C) from `.squad/decisions/inbox/uhura-stfc-discord-discovery.md`.
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

### Discord ToS prohibits user-token automation — verdict logged (2026-05-18T02:01:02.354+00:00)

**Context:** Cyrus asked whether his personal Discord account could read the official STFC server instead of pursuing Path A (bot whitelist). Investigated ToS + enforcement posture.

**Permanent fact for future sessions:** **Discord prohibits self-bots / user-token automation via Terms of Service §9 ("Restrictions on your use of Discord's services").** Verbatim language from https://discord.com/terms (Effective 2025-09-29):

> *"Don't use the services to do harm to Discord. Among other things, this includes ... scraping our services without our written consent, including by using any robot, spider, crawler, scraper, or other automatic device, process, or software ..."*

And §9 ¶1:

> *"Don't use the services to do harm to yourself or others. Among other things, this includes ... auto-messaging, or auto-dialing people through our services ..."*

**Enforcement is severe:** confirmed self-bot use → permanent, non-appealable account termination. Discord detects via behavioral fingerprinting (request cadence, missing client telemetry, raw HTTP signatures), not solely by user reports.

**Sanctioned mechanism for any automated read is the Bot account flow**, governed by the Discord Developer ToS (https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service). The ToS explicitly references this as the only sanctioned path for "apps, bots, or other products developed by third parties."

**No user-OAuth-scope alternative exists.** Discord does not publish a `messages.read` (or equivalent) user scope that would let a third-party app legitimately read message content on behalf of a user. Bots are the only sanctioned read mechanism. This is unlikely to change — it's been Discord's position since at least 2017.

**Project implication permanently established:** any future "can we just use a user account / personal token / cookie" question for Discord integration must be answered NO with the §9 citation above. The only sanctioned paths are: (a) Bot whitelist in a server we don't own, requiring admin consent, or (b) Bot in a server we DO own (relay pattern), no third-party consent required. Putting a user token in any project secret (incl. `STFC_ACCOUNTS`) would also require constitution Principle V amendment, which Picard should reject on first principles.

Verdict committed at `.squad/decisions/inbox/uhura-user-token-verdict.md`.

## 2026-05-31: Issue #76 — Discord Channel Ingest (Blocked on Guild Access)

**Status:** Blocked — bot not in guild `639255937869152267`
**PR:** `squad/76-ingest-discord-channel` (draft)

### What happened

Attempted to ingest STFC Officer Tool Discord `#data-collection` channel
(guild `639255937869152267`, channel `1115978499400933473`) per issue #76.

**Blocker:** `DISCORD_BOT_TOKEN` is a GitHub Actions encrypted secret only — not
available in the Codespace environment. Without the token the two required API
probes (`GET /guilds/{id}` and `GET /channels/{id}`) cannot be executed. Guild
membership is unknown; historically the bot has only been deployed against a
different guild, so membership is likely absent.

### What was delivered

- `docs/stfc-knowledge/discord-channels/README.md` — directory convention doc with
  full blocker report, unblock steps, and bot invite URL template.
- `docs/stfc-knowledge/discord-channels/officer-tool-data-collection/README.md` — channel
  stub with 6-field Lineage block (marked "stub only — no content ingested").
- `scripts/fetch-discord-channel.mjs` — production-ready ingest script: fetches pins
  first, then paginates history with knowledge filter (attachments, embeds, known
  contributors, reaction threshold). Errors clearly on 401/403 with actionable guidance.
  Token-safe: redacts any bot-token-shaped string from error output.
- Updated `docs/stfc-knowledge/README.md` to add `discord-channels/` row.
- Skill extracted: `.squad/skills/verify-discord-bot-access/SKILL.md`.

### Lineage pattern for Discord (codified)

Six-field block same as Sheets, with these Discord-specific mappings:
- **Source URL:** `https://discord.com/channels/{guild}/{channel}/{messageId}` (permalink)
- **Source name:** `{Guild name} Discord — #{channel-name} channel`
- **Author(s):** Discord username (stable handle, NOT display name)
- **Captured on:** ISO date of snapshot
- **License:** "Mirrored from {Guild} community Discord. Original authors retain credit."
- **Refresh strategy:** `node scripts/fetch-discord-channel.mjs` (requires token in env)

### Discord REST API notes for message archiving

- `GET /channels/{id}/pins` — returns up to 50 pinned messages, no pagination needed
- `GET /channels/{id}/messages?limit=100&before={id}` — paginate backwards through history
- Rate limiting: 429 with `retry-after` header; polite 500ms delay between pages is safe
- Attachments: link via `attachment.url` in-place; do NOT download (ToS + licensing)
- The bot's `DISCORD_BOT_TOKEN` must be set and the bot must be in the guild; 403 = not in guild

### To unblock

Cyrus or team contacts an STFC Officer Tool Discord admin via <https://discord.gg/BRhru6Vcnj>
using the DM draft at `.squad/agents/uhura/outreach/stfc-discord-bot-request.md`.
Once bot is in the guild, run `node scripts/fetch-discord-channel.mjs`.

---
> Older learnings archived to history-archive.md. See archive for context.

### Scribe note (2026-05-31T19:55Z): Session completion — Uhura dispatch BLOCKED

**Dispatch date:** 2026-05-31T19:55:00Z
**Status update:** BLOCKED on bot guild invite

**Scribe recording:** Uhura completed all scaffolding for Discord channel ingest (#76) but cannot verify bot access locally. Root cause: `DISCORD_BOT_TOKEN` is CI-only (GitHub Actions secret, not in Codespace .env). Bot guild membership (`639255937869152267`) unknown; historically deployed to a different guild, likely absent from the target.

**Key reality for future Codespace work:** 
- `DISCORD_BOT_TOKEN` cannot be used locally in Codespace for verification/testing.
- Two paths forward for future DISCORD_BOT_TOKEN-dependent tasks:
  1. Pull the secret into local .env (requires user manual intervention + .gitignore enforcement)
  2. Run verification via GitHub Actions (bot-token available in CI context, but requires pushing a PR first)
  
**Deliverables held in draft PR #96:**
- Production-ready `scripts/fetch-discord-channel.mjs` (ready to run once bot invited)
- New skill `.squad/skills/verify-discord-bot-access/SKILL.md` (reusable pattern for bot-access verification)
- Full Discord ingest scaffolding (docs structure + README with blocker report + Lineage block)
- DM template at `.squad/agents/uhura/outreach/stfc-discord-bot-request.md`

**Unblock path:** Cyrus or team contacts STFC Officer Tool Discord admin via https://discord.gg/BRhru6Vcnj using the ready-to-send DM template. Once bot invited with `66560` permissions, run `node scripts/fetch-discord-channel.mjs`.

**Decision memo:** Merged to `.squad/decisions.md` by Scribe.

## 2026-05-31 — Lockout-routed revision pattern (PR #98)

Executed the lockout-routed revision pattern: reviewer-lockout rule barred Scotty (initial author) from revising after Garak + Bashir CHANGES_REQUESTED; Coordinator routed the fix to Uhura instead.

**Findings addressed (5 total):**
- **Garak (3):** Roster contract invariant, byte-stable round-trip, real-data test scope.
- **Bashir (2):** Task YAML loader-path test, schema invariants one-per-assertion.

**Single-revision approach:**
- Renamed `data/crew/roster/example.yaml` → `demo.yaml` (Option A). Rationale: committed file already had `account: demo`; `demo` is clearer; preserves contract.
- Enforced `account === filename basename` in `loadRoster()`.
- Added real-data round-trip test for `demo.yaml`.
- Added 2 task YAML loader-path tests in `tasks.test.ts`.
- Expanded `schemas.test.ts` from 14 to 35 assertions.

Pushed revision 277f7023 (+53 tests, 650 total). Both Garak and Bashir re-approved same day. Merged as eb2fd9d.

**Pattern insight:** Lockout-routed revision actually accelerated the cycle because Uhura (integrations focus) could see that both Garak's contract violation and Bashir's coverage gaps stemmed from the same root issue: the roster file/account mismatch and lack of real-data validation. Scotty's perspective would have been test-then-revert; Uhura's was fix-the-contract-first. Single revision beat two revision rounds.

**2026-05-31:** Lockout-routed on PR #103 (doc timestamp redaction) — 5th lockout-routed revision on record (anti-fragility signal: ready for structural escalation on next cycle).
