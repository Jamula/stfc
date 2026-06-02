# Uhura — Integrations Dev (Session Summary)

## Role Summary

**Integrations, external APIs, Discord, news feeds, token management**
- Owns: `DISCORD_BOT_TOKEN` custody, Discord monitor workflow, news pipeline architecture
- Does NOT own: Source code delivery (Kirk), governance (Picard), DevOps (O'Brien)

## Active Status (as of 2026-06-01)

### Current Blocking Issue
- **#76 Discord channel ingest:** Blocked on bot guild invite (`639255937869152267`)
- **Reason:** `DISCORD_BOT_TOKEN` is CI-only secret (GitHub Actions), not available in Codespace
- **Unblock path:** Contact STFC Officer Tool Discord admin using prepared DM template, then run `node scripts/fetch-discord-channel.mjs`

### Deliverables Held in Draft
- PR #96: `scripts/fetch-discord-channel.mjs` (production-ready, token-safe)
- Skill: `.squad/skills/verify-discord-bot-access/SKILL.md` (reusable bot-access verification)
- Docs: Discord channel ingest scaffolding + Lineage blocks (6-field pattern)

## Key Constitutional Facts

1. **Discord ToS § 9:** User-token automation prohibited; permanent account termination if detected. Only sanctioned path is Bot account via Discord Developer ToS.
2. **Project scope immutable:** Can only integrate Discord via (a) bot whitelist in external server (consent required) or (b) bot in owned relay server (no consent needed). User tokens permanently off-table.
3. **Codespace secret isolation:** `DISCORD_BOT_TOKEN` unavailable in local env. Future DISCORD_BOT_TOKEN-dependent tasks must either (a) pull secret into .env locally (manual + .gitignore enforcement) or (b) run verification via GitHub Actions (push PR first).
4. **Discord API contract:** Two endpoints used: `GET /users/@me` + `GET /channels/{id}/messages`. No gateway, no outbound HTTP beyond polling. Permissions bitmask `66560` canonical.

## Recent Session Work

### News Pipeline Decisions (2026-05-18)
- Path A (bot whitelist) chosen by Cyrus; outreach package drafted and ready
- Path C (news patches) deferred; auto-reject in ~30 days if unblocking signal fires
- WordPress feed verified: once/day polling with `?after={now-25h}` catches all posts; use `date_gmt` never `date`

### Lockout-Routed Revisions (PRs #98, #103)
- PR #98 (roster contract): Routed to Uhura (not Scotty) under lockout rule; single revision beat two rounds by fixing root contract issue
- PR #103 (doc timestamp): 5th lockout-routed revision on record; anti-fragility signal for structural escalation

---

**Full history archived to history-archive.md. See archive for detailed learnings.**

---

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01 — Session wrap-up (crew v2 + devcontainer + discoveries)

**Session:** crew-v2-chain-wrapup
**Role:** Devcontainer + workflow + test strategy
**Outcome:** Devcontainer scope clarified (#135 merged); 2 follow-up issues filed (#137, #138)

Participated in:
- PR #135 (devcontainer scope): SWA-aware devcontainer for 005-web-control-panel Phase 0
- PR #123 (crew command parser): gate + test verification
- Issue #137 (rule-reference CI workflow): scoped discovery for custom rule tags
- Issue #138 (trigger-string smoke tests): scoped discovery for rule-driven trigger coverage

**Follow-ups from Kirk's PR #124 review:**
- MEDIUM: grep gate enforcement (presence vs first-statement). Route: Uhura (clarify docstring or tighten AST check)
- LOW: EXCLUDE_SEGMENTS recursion footgun. Route: Uhura

**Next:** #137 and #138 scoped discovery; grep-gate contract clarification.
### Reviewer-Own-Fix Dispatch: PR #130 (Garak CR, 2026-06-01)

**Pattern:** Co-owner dispatched to fix locked-out author's (Scotty) PR under Reviewer Rejection Lockout.

**Fixes applied (commit ef15f87):**
1. `chunkTask` off-by-one: `content.trimEnd().split("\n").length` — trailing `\n` on POSIX files inflated line count by 1. Verified: armada-25.yaml now cites L1-L23 (was L1-L24).
2. Removed `generatedAt` from `KnowledgeCache` interface and `buildCache` return. `--force` rebuilds now byte-deterministic (SHA-verified). `now` param retained in `BuildOptions` to avoid breaking call sites.
3. Regression test added — two 23-line fixtures (with/without trailing `\n`) both assert `endLine=23`.
4. Three `cacheNeedsRebuild` test fixtures had `generatedAt: ""` excess property — removed.

**Learnings:**
- When taking reviewer-own-fix ownership: check grep output carefully — `generatedAt` appears in ~15 locations across the codebase; scope the fix ONLY to the affected module (`src/crew/knowledge.ts`).
- Pre-commit hook runs full test suite; the off-by-one fix breaks an existing test assertion (`endLine: 3` → `endLine: 2` for a 2-line YAML with trailing `\n`). Always audit existing test fixtures when fixing line-number math.
- Byte-determinism claim: removing a timestamp field is the cleanest approach; git commit metadata is a sufficient audit trail.

## 2026-06-01 — PR #129 shipped: crew[v2] read-only command handlers (issue #92)

**Co-author:** Scotty-2 (phase-2 handlers: best, status, progression, rosterShow)
**Phase 1:** Uhura seeded dispatcher scaffolding + HandlerDeps interface
**Phase 3:** Uhura implemented explain, synergy, tasks, officers handlers (4 handlers with light fixtures)
**Phase 4:** Uhura wired dispatcher table + integration test + tests/index.test.ts imports
**CR loop:** Garak raised hostility check on output determinism (guarantee output exactly cites engine returns). Uhura fixed. Garak re-verified and approved.
**Reviewers:** Kirk ✅+📝 (embedded pipeline-review skill), Bashir ✅, Picard ✅, Garak ✅ (re-verified).
**Outcome:** PR merged 05:43Z. Next: #93 dispatch (knowledge embedding pipeline + handler) — Uhura + Scotty pair on squad/93-crew-v2-knowledge when user confirms.


## 2026-06-02 — Q&A: How to communicate with a Discord server from a Discord app

**Requested by:** Cyrus Jamula
**Type:** Explainer (no code changes)

### What was asked
"How do I communicate with the Discord server from my Discord app?"

### What was answered (summary)
Walked Cyrus through his actual repo setup:
- `src/discord/client.ts` — thin REST client wrapping `https://discord.com/api/v10` with `Authorization: Bot ${token}`. Implements `getMe()`, `getChannelMessages()`, and `postMessage()` (lines 129, 152, 172). Uses typed error classes (401→DiscordAuthError, 403→DiscordChannelAccessError with Discord error code extraction, 429→DiscordRateLimitError with retry, 5xx→DiscordTransientError).
- `src/discord/ingest.ts` — pagination layer over `getChannelMessages`, up to 5 pages × 100 msgs per channel. Cursor-based (snowflake IDs), skip-dedup.
- `scripts/discord-ops/set-discord-app-metadata.mjs` — operator-only one-shot PATCH to `/users/@me` and `/applications/@me`.
- `scripts/fetch-discord-channel.mjs` — NOT yet merged (PR #96); production ingest script.

Explained the three communication modes (REST, Gateway WebSocket, Interactions endpoint) and which applies when. Confirmed this repo uses REST-only, which is correct for the GitHub Actions scheduled-CLI model.

Key blocker: bot not yet a member of guild `639255937869152267` → all guild-scoped calls return 403 (Discord error code 50001). Invite URL pattern from `docs/DISCORD-BOT-SETUP.md` + `permissions=66560`.

`postMessage()` already exists in `src/discord/client.ts` at line 172 — Cyrus doesn't need to write a new HTTP call to send a message.

### Reusable patterns
- **Permissions bitmask `66560`** = `VIEW_CHANNEL` (1024) + `READ_MESSAGE_HISTORY` (65536). Add `2048` for `SEND_MESSAGES` → bitmask `68608`.
- **Message Content Intent** must be ON in Developer Portal for `content` field to be non-empty, even on REST (not just Gateway). Documented in `docs/DISCORD-BOT-SETUP.md §2`.
- **`DISCORD_BOT_TOKEN` is CI-only** — any call from Codespace will 401. Workaround: set a `.env` locally (never commit) or run via GitHub Actions.
- For "send a message": `POST /channels/{channel_id}/messages` with body `{"content": "..."}`. The repo's `DiscordClient.postMessage()` already wraps this — no curl needed if using TypeScript.
- GitHub Actions can't hold a Gateway WebSocket. Real-time listening requires a separate always-on host.

## 2026-06-02 — Q&A: Slash commands — how to invoke bot commands from Discord chat

**Requested by:** Cyrus Jamula
**Type:** Explainer + architectural advisory (no code changes)
**Context:** Cyrus successfully invited the bot to his Discord server (guild invite completed; permissions integer `1700157368876145`, code-grant toggle used). He is now in "what next" mode — asking how users can invoke bot commands from the chat box.

### Learnings

- **Bot is now in guild — the invite blocker from session history is resolved.** App ID `1505752454388514916` is now a guild member. Guild-scoped API calls (e.g. `GET /guilds/{id}/channels`) should now return data instead of 403/50001.
- **Slash command registration is feasible right now.** `PUT /applications/{app_id}/guilds/{guild_id}/commands` works with `DISCORD_BOT_TOKEN` and can be run as a one-off GitHub Actions `workflow_dispatch`. Registration is fire-and-forget; no always-on infra required.
- **Slash command INVOCATION HANDLING is the architectural mismatch.** Discord POSTs `INTERACTION_CREATE` events to a registered HTTPS endpoint. GitHub Actions can't hold a persistent HTTP listener. This is a hard constraint — can't be worked around without adding infra.
- **Architectural decision point (flag for Kirk if Cyrus commits):** If Cyrus wants live `/slash` commands, the right path is a Cloudflare Workers bridge (free tier) that:
  1. Verifies Ed25519 signature (`tweetnacl`)
  2. Responds `type: 5` (deferred) within 3s
  3. Calls GitHub `POST /repos/{owner}/{repo}/dispatches` with `repository_dispatch`
  4. GHA does the work; Cloudflare Worker POSTs follow-up via `PATCH /webhooks/{app_id}/{token}/messages/@original`
  This is the correct architecture for this repo. The Worker is thin (signature verify + dispatch); all logic stays in GHA.
- **Permissions bitmask update:** Previous sessions used `66560` (VIEW + READ_HISTORY). With the bot now in the server and potentially sending messages, the relevant bitmask for a command-responding bot is `2147485696` (`SEND_MESSAGES` + `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` + `USE_APPLICATION_COMMANDS`). The invite Cyrus completed used `1700157368876145` (much broader — likely includes slash command permissions already).
- **Suggested GH issue title (do not file until Cyrus commits):** "Add Cloudflare Worker as Discord interactions endpoint for slash command handling"
- **No `.squad/decisions/inbox/` entry written** — Cyrus did not explicitly commit to Option B (Cloudflare Worker). Will write inbox entry only on explicit buy-in.

---

## 2026-06-02T03:38Z — Discord slash command epic #143 filed; 4 issues routed to Uhura

Per Kirk's Option B architecture (Cloudflare Workers bridge), epic #143 decomposed into 6 children. Uhura owns #144 (commands.json contract), #145 (registration workflow), #146 (Worker), and #149 (operator runbook). Start with #144 (blocks #145 and #147). Implementation order: #144 → #145 → #146 (parallel with #147) → #149. Worker is ~100 LoC thin bridge (signature-verify, defer, dispatch). No business logic. Three design decisions flagged in Kirk's architecture notes for user confirmation before implementation.
