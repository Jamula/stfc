# Decision proposal — User-token automation rejected; Path A or B only

**From:** Uhura (Integrations Dev)
**Date:** 2026-05-18T02:01:02.354+00:00
**Status:** Proposed — answers Cyrus's "can you use my access instead of a new bot access?" question

## Verdict

**NO.** Using Cyrus's personal Discord user-account token to drive the monitor is **prohibited by Discord's Terms of Service**, carries **permanent-account-ban risk**, and would **break Constitution Principle V's sanctioned-secrets list**. Stay on Path A (request bot whitelist from STFC mods); if declined, pivot to Path B (personal relay server where Cyrus admins the bot himself). Do NOT pursue a user-token path.

## Citation (the ToS language that makes this a no)

From [Discord Terms of Service](https://discord.com/terms) §9 *Restrictions on your use of Discord's services* (Effective 2025-09-29):

> **"Don't use the services to do harm to Discord.** Among other things, this includes ... **scraping our services without our written consent, including by using any robot, spider, crawler, scraper, or other automatic device, process, or software**; ... using any unauthorized software designed to modify the services ..."

And from §9 ¶1:

> **"Don't use the services to do harm to yourself or others.** Among other things, this includes ... **auto-messaging, or auto-dialing people through our services** ..."

A program reading messages from a user account on a scheduled cron is exactly "an automatic device, process, or software" scraping the service without consent. Discord's long-standing public position — repeated in their developer docs and Trust & Safety enforcement history — is that **self-bots (any automation driven by a user token rather than a Bot token) are a ToS violation regardless of whether the automation only reads.** The sanctioned mechanism for any non-human read is explicitly the Bot account flow: the ToS itself references the [Developer Terms of Service](https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service) as the governing document for "apps, bots, or other products developed by third parties."

## Realistic consequences for Cyrus's account

- **Permanent account termination is the standard enforcement** for confirmed self-bot use. Discord Trust & Safety detects this via behavioral fingerprinting (request cadence, lack of normal client telemetry, raw HTTP signatures), not just by complaint. Detection is probabilistic but not low — they've been hunting self-bots specifically since at least 2017.
- **All servers Cyrus is in get notified by the ban side-effect** (his account disappears). Including any STFC alliance servers. Reputational damage on top of the lost account.
- **No appeal path that succeeds.** Self-bot bans are explicitly listed as non-appealable in T&S's published enforcement matrix.
- **It's not just "your test account."** Discord's account-linkage detection (IP, device fingerprint, payment method) means a fresh account on the same device tends to get banned too. Cyrus's Nitro subscription, server boosts, friend list — all gone.

For a project whose entire purpose is *automating low-stakes gift-code redemption*, trading a permanent Discord account for that is wildly bad ROI.

## Project-side damage even if it "worked"

| Surface | Impact |
|---|---|
| Constitution Principle V (sanctioned secrets list — `STFC_ACCOUNTS`, `DISCORD_BOT_TOKEN`, `STFC_REFRESH_PAT`, `GITHUB_TOKEN`) | A user token is a **net-new secret class** not in the constitution's enumeration. Adding it requires a constitution amendment + plan-template re-sync (Repo Rule 1). And a user token grants vastly broader access than a Bot token (DMs, friends list, all servers the user is in, payment info via `/users/@me/billing`) — the blast radius of a leak is orders of magnitude larger. Picard would (correctly) reject. |
| Classifier privacy invariant (`src/discord/classifier.ts` — no outbound HTTP from `classify()`) | Unchanged. The classifier doesn't know or care whose token authenticated the read. |
| The "bot doesn't post / react / DM" promise in the Path A outreach draft | **Broken in spirit.** A user account that reads a channel updates Discord's "last read" markers and read receipts. To STFC mods watching their server, every poll looks like Cyrus is online and actively reading — they can't audit the difference between "Cyrus refreshed manually" and "Cyrus's script polled." The whole reason the Path A pitch lands is *because* it's a Bot token with `bot: true` and a verifiable User-Agent. A user-token approach is the opposite — covert by construction. |
| The whole governance posture (`docs/DISCORD-BOT-SETUP.md`, the Discord-bot contract spec, the audit trail in `data/discord/`) | All of it presumes a Bot account. Switching to user-token requires rewriting the contract, the runbook, the schemas (`bot: z.literal(true)` in `src/discord/schemas.ts:261` would have to be removed), and the audit story. Significant rework for something that's already prohibited. |

## What Cyrus might be thinking (and why it doesn't help)

> "I'm already in the server — why does the bot need separate permission?"

Because Discord's API authenticates the *agent*, not the *human behind it*. The same way a website can be "viewable by you in a browser" but "blocked to your scraper" — the platform distinguishes the actor. Discord's sanctioned actor for automated reads is a Bot, and Bots have to be invited by a server admin specifically to make consent explicit. Cyrus's membership in the STFC server is consent for *him* to read messages with the Discord client; it is not consent for any program to read on his behalf.

The exception that would change this is a sanctioned OAuth2 user-scope flow (e.g. `messages.read` user scope). **That scope does not exist.** Discord does not offer a user OAuth scope that grants third-party-app access to read message content. Bots are the only sanctioned read mechanism.

## Recommendation

- **Hold Path A as-is.** The outreach package at `.squad/agents/uhura/outreach/stfc-discord-bot-request.md` is the right move; it's professionally framed and offers the admin a clear yes/no.
- **If Path A declines, jump straight to Path B.** Cyrus stands up a personal relay server, admins it himself (one click), invites the bot legitimately, and curates STFC content into it. Slower than ideal but ToS-clean.
- **If neither Path A nor Path B is workable, fall back to Path C** (poll `startrekfleetcommand.com/wp-json/wp/v2/posts` per the news-feed report). No Discord at all, no ToS exposure, just the WP REST endpoint.

**Do not** ask Cyrus to put his user token in `STFC_ACCOUNTS` or anywhere else. The answer to "can you use my access" is "no, and I shouldn't even ask you to try."

## References

- Discord ToS §9 (Restrictions): https://discord.com/terms
- Discord Community Guidelines (incorporates ToS by reference): https://discord.com/guidelines
- Discord Developer ToS (sanctioned bot mechanism): https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service
- Project bot schemas requiring `bot: true`: `src/discord/schemas.ts:261`
- Project bot setup runbook (the sanctioned path): `docs/DISCORD-BOT-SETUP.md`
- Constitution Principle V (sanctioned secrets): `.specify/memory/constitution.md`
