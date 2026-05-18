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
