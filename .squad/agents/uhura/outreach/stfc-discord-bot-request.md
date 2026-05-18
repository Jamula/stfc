# Outreach package — Read-only monitoring bot whitelist request

> **For:** Cyrus Jamula, to send to a moderator/admin of the official Star
> Trek Fleet Command Discord (`discord.gg/stfc`, guild_id `509679626763632640`).
> **Prepared by:** Uhura (Integrations Dev) on 2026-05-18T01:46:17.656+00:00
> **Path A** of the Discord-discovery decision proposal (see
> `.squad/decisions/inbox/uhura-stfc-discord-discovery.md`).

This is one document. Sections 1–5 are the technical brief the admin's
team will want to read. Section 6 is the short DM Cyrus actually sends.
Section 7 is the fallback if the answer is no.

---

## 1. The ask (one paragraph — admin-quotable)

I'm Cyrus Jamula, a long-time Fleet Commander, and I maintain
[`Jamula/stfc`](https://github.com/Jamula/stfc), an open-source automation
that auto-redeems publicly-posted STFC gift codes on my own accounts so
they don't expire before I can type them in by hand. To pull fresh codes,
I'd like to whitelist a small **read-only** Discord bot in your server.
The bot subscribes to **no gateway events**, sends **no messages**, adds
**no reactions**, joins **no voice channels**, and **cannot DM**. All it
does is `GET /channels/{id}/messages` on a short allowlist of public
channels I configure on my side (announcements, patch notes, anywhere
codes get dropped). It runs on a 15-minute cron from GitHub Actions and
its only output is a JSON file in my repo that drives my own redeem
workflow. It is not a Scopely product, not affiliated with the official
team, and serves no other users — just my accounts. Whitelisting it costs
the server nothing and harms nothing; it's functionally equivalent to me
opening the channel in a browser tab once every 15 minutes.

---

## 2. Technical scope (precise — cite the code)

All citations are file paths in [`Jamula/stfc`](https://github.com/Jamula/stfc)
at the current `main`. Anyone can verify these claims by reading the
source.

| Property | Value | Citation |
|---|---|---|
| Auth | Bot account, `Authorization: Bot <token>` header | `src/discord/client.ts:248` |
| API base | `https://discord.com/api/v10` (REST only — **no gateway / no WebSocket**) | `src/discord/client.ts:25` |
| User-Agent | `STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)` | `src/discord/client.ts:26` |
| Endpoints called | Exactly two: `GET /users/@me` (startup identity check) and `GET /channels/{channelId}/messages?limit=100&after=<snowflake>` (per-channel poll) | `src/discord/client.ts:127`, `src/discord/client.ts:150-158` |
| Channels read | **Only** those in `config/discord-allowlist.json` (operator-curated, currently empty) | `src/discord/state.ts:39`, `src/discord/ingest.ts` |
| Write surface (Discord) | **None.** No POST / PATCH / DELETE endpoints exist in the client. No message-send, no reaction, no DM, no role mutation. | grep `src/discord/client.ts` for `method.*POST` — zero matches |
| Persistence (local repo) | Appends one JSON line per fresh message to `data/discord/candidates.jsonl`; daily roll-up at `data/digests/YYYY-MM-DD.md` | `src/discord/state.ts:39-40`, `src/digest/index.ts` |
| Classifier | Runs **locally**. Model is loaded from disk; first-run model download is to `huggingface.co` with SHA-256 integrity verification and is skipped entirely when running with a placeholder hash. **Constitution-level invariant: `classify()` MUST NEVER issue an outbound HTTP call.** Verified in code review (PR #37). | `src/discord/classifier.ts:5-29` |
| Token custody | `DISCORD_BOT_TOKEN` is env-only. Never persisted, never logged, never embedded in thrown error messages — every error path routes through `redactForLog` as a second pass. | `src/discord/client.ts:11-14`, `src/lib/redact.ts` |
| Rate-limit etiquette | Honors `Retry-After` on 429; capped retry count; one-shot retry on 5xx with jitter | `src/discord/client.ts:189-218` |
| Schedule | Once every 15 minutes via `.github/workflows/discord-monitor.yml`; serialized with redeem cron via `concurrency.group: stfc-gift-redeemer` | `.github/workflows/discord-monitor.yml` |
| Code visibility | Public repo, MIT-licensed, full review history in PRs | https://github.com/Jamula/stfc |
| Scale | One bot, one operator, one set of personal accounts. Not a SaaS, not multi-tenant, no user data collected from anyone but the operator. | n/a |

### What it does NOT do (worth saying explicitly)

- Does not connect to Discord's gateway / WebSocket. No real-time event
  stream. Cannot receive `MESSAGE_CREATE`, `MEMBER_JOIN`, presence
  updates, or anything else.
- Does not call any Members API (`/guilds/{id}/members`) — does not
  enumerate users, does not see member roles, does not know who's online.
- Does not access voice channels, threads outside the configured channel
  list, DM channels, or any other guild that isn't on its allowlist.
- Does not have `Administrator` permission. Does not have
  `Manage Channels`, `Manage Roles`, `Send Messages`, `Add Reactions`,
  `Mention Everyone`, or any other write permission.
- Does not republish, mirror, or redistribute message content. The
  `candidates.jsonl` file is local to a private GitHub Actions runner
  and the operator's repo; content-hashes are committed for dedupe but
  raw message bodies are gitignored.

---

## 3. Minimum permissions required

This is the **complete** permission footprint. If the bot is granted
anything beyond this, the extra grants are unused.

### OAuth2 scopes (install dialog)

| Scope | Required? | Why |
|---|---|---|
| `bot` | **Yes** | Required for the install dialog to add the bot as a server member at all. |
| `applications.commands` | No — do not grant | The bot registers no slash commands. |
| `identify`, `email`, `guilds`, `guilds.join`, anything else | No — do not grant | Not used. |

### Gateway intents

| Intent | Required? | Why |
|---|---|---|
| *(any gateway intent)* | **No — none requested** | The bot does not connect to the gateway. All reads are REST. |

### Privileged application intents (Developer-Portal toggle)

| Intent | Required? | Why |
|---|---|---|
| **Message Content Intent** | **Yes** (toggled in the bot's own Developer Portal — does **not** require server-admin action) | Without this, `GET /channels/{id}/messages` returns `content: ""` for any message the bot did not author. Already enabled on the application side. |
| Server Members Intent | No | The bot does not enumerate members. |
| Presence Intent | No | The bot does not read presence. |

### Channel permissions (the only thing the server admin actually grants)

| Bit | Permission | Why |
|---|---|---|
| `1024` | `VIEW_CHANNEL` | Required to see the channel exists. |
| `65536` | `READ_MESSAGE_HISTORY` | Required for `GET /channels/{id}/messages`. |
| **Total** | **`66560`** | The exact permissions integer in the invite URL below. |

**Anything else is not requested.** No `SEND_MESSAGES` (2048), no
`ADD_REACTIONS` (64), no `MENTION_EVERYONE` (131072), no
`MANAGE_*`, no `ADMINISTRATOR` (8). The runbook at
[`docs/DISCORD-BOT-SETUP.md` §4](https://github.com/Jamula/stfc/blob/main/docs/DISCORD-BOT-SETUP.md#4-why-permission-bitmask-66560-least-privilege)
documents why we picked exactly these two bits.

---

## 4. Invite link template

```text
https://discord.com/api/oauth2/authorize?client_id={CLIENT_ID}&scope=bot&permissions=66560
```

Substitute `{CLIENT_ID}` with the Discord Application ID from the
[Developer Portal → General Information] page (Cyrus has this; it is
not a secret but is not in this repo). The URL encodes the exact
minimum from §3: `scope=bot`, `permissions=66560`.

To restrict the bot to **only specific channels** in your server
(recommended), the admin can use the install dialog's "Restrict bot to
selected channels" option, OR — preferred — add the bot to a role that
has `View Channel` + `Read Message History` overrides on just the target
channels and `View Channel: deny` everywhere else.

---

## 5. Channel target list (proposed)

`config/discord-allowlist.json` is currently `{ "version": 1, "entries": [] }`
— I cannot list channel IDs without first being a member of the server.
Channel snowflakes are not on the public website.

Based on what's visible from the server's public invite landing page
(channel `👋-welcome-to-cadet-corner`, id `1301298382182285322`) and
the standard layout of game-publisher Discord servers, the channels I
would propose to monitor — *subject to your guidance on which actually
exist and what they're called* — are:

| Likely channel role | Why it's relevant | Priority |
|---|---|---|
| `#announcements` / `#news` / `#patch-notes` | Where Scopely posts patch notes and update headers — same content that appears at `startrekfleetcommand.com/news/` but often earlier. | **P0** |
| `#events` / `#weekly-events` / `#event-calendar` | Pairings, Infinite Incursions schedules, event start times. | P0 |
| `#gift-codes` / `#promo-codes` / `#giveaways` (if such a channel exists) | The actual purpose of the bot — auto-redeem freshly-dropped codes before they expire. If there is no such channel, this whole project is much less interesting and we may not need to pursue. | **P0 (deal-breaker)** |
| `#community-spotlight` / `#dev-notes` | Lower priority; useful for context but not for code redemption. | P2 |

**Action for first-join:** when Cyrus joins the server, his first task
is to capture the actual channel names + IDs (Settings → Advanced →
Developer Mode → right-click → Copy ID) and pin them in a new
`.squad/decisions/inbox/uhura-allowlist-channels.md`. The proposed names
above are educated guesses — they may be called something else, or
there may be no public gift-codes channel at all (in which case Path A
is moot regardless of whitelist approval).

---

## 6. Outreach DM draft (copy-paste ready, ~250 words)

> **Subject:** Request to whitelist a small read-only bot (gift-code redeem automation)
>
> Hi — I'm Cyrus Jamula, long-time Fleet Commander. I maintain an open-source
> automation called `stfc-gift-redeemer`
> ([github.com/Jamula/stfc](https://github.com/Jamula/stfc), MIT) that
> auto-redeems publicly-posted STFC promo codes on my own accounts before
> they expire. It works great against codes I find by hand; I'd love to
> feed it codes from the announcement-style channels in your server
> instead of refreshing tabs all day.
>
> I'd like to ask the team to consider whitelisting a small Discord bot
> in the server. The full technical scope is here:
> [github.com/Jamula/stfc/blob/main/.squad/agents/uhura/outreach/stfc-discord-bot-request.md](https://github.com/Jamula/stfc/blob/main/.squad/agents/uhura/outreach/stfc-discord-bot-request.md).
> The 30-second version:
>
> - **Read-only.** It calls exactly two Discord REST endpoints:
>   `GET /users/@me` once at startup, and
>   `GET /channels/{id}/messages` on a short allowlist of channels I
>   configure on my side.
> - **No write permissions.** Doesn't send, react, DM, edit, delete,
>   join voice, or moderate. Permissions integer is `66560` =
>   `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` only. No `Administrator`,
>   no `Send Messages`, nothing else.
> - **No gateway connection.** It polls on a 15-minute cron from GitHub
>   Actions. Functionally equivalent to me hitting refresh once every 15
>   min.
> - **Just my accounts.** Not a SaaS, not multi-tenant, no user data
>   collected from anyone but me.
>
> Install URL with the minimum scopes pre-filled is in the doc above
> (drop in your guidance on which channels are OK — happy to restrict
> the bot to a single channel via role overrides if that's preferred).
>
> If the answer is no, totally understood — would you mind a quick line
> so I know to stop pinging? Either way, thanks for the time.
>
> — Cyrus

---

## 7. Decline-plan

If they say no, we pivot to **Path B (personal relay server)**.
Recommended fallback: Path B because it keeps the same monitor code path
working (just a different `config/discord-allowlist.json`), avoids any
third-party trust dependency, and Cyrus can manually relay
patch-notes/event/code drops from STFC-official into his relay server in
under a minute per drop — which is still strictly faster than the
current "zero codes ingested" baseline. Path C (drop Discord, poll
`startrekfleetcommand.com/news/` instead) becomes the secondary fallback
only if Cyrus decides he doesn't want to maintain a relay server long
term; the WP REST endpoint discovered in the news-feed report is the
clean fallback for that.

---

## Appendix: References (for the admin's due diligence)

- Repo: https://github.com/Jamula/stfc
- This document: https://github.com/Jamula/stfc/blob/main/.squad/agents/uhura/outreach/stfc-discord-bot-request.md
- Bot setup runbook (operator-facing): https://github.com/Jamula/stfc/blob/main/docs/DISCORD-BOT-SETUP.md
- Discord REST client (the only Discord-touching code): https://github.com/Jamula/stfc/blob/main/src/discord/client.ts
- Allowlist config (currently empty): https://github.com/Jamula/stfc/blob/main/config/discord-allowlist.json
- Workflow definition: https://github.com/Jamula/stfc/blob/main/.github/workflows/discord-monitor.yml
- Classifier privacy invariant (no outbound HTTP from `classify()`): https://github.com/Jamula/stfc/blob/main/src/discord/classifier.ts (top-of-file contract)
