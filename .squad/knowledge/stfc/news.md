# STFC News Beat — Captured 2026-05-12

## Source
https://startrekfleetcommand.com/news/
(WordPress REST: `https://startrekfleetcommand.com/wp-json/wp/v2/posts` — useful for automated polling.)

## Cadence
- ~2–3 posts/week. **9 posts in the last 24 days** (Apr 18 – May 5, 2026).
- Rhythm tracks the monthly update train: major patch notes on the ~1st of the month, mid-month patch ~3 weeks later, plus interim event schedules, feature highlight blogs, and ad-hoc maintenance/compensation notices.
- Most recent post: 2026-05-05. Captured page modified date: 2025-03-12 (page-level template, not relevant to post freshness).

## Recent posts (top 10, most recent first)
- **2026-05-05** — *Update 90.1 Starfleet Academy Part 1 (Mid-Month) Patch Notes* — Bug fixes + QoL: G3/G4 station timer cuts, Sigma Refinery, Duo Wave Defense fixes, Simulation Codes mission reward corrected. — https://startrekfleetcommand.com/news/update-90-1-starfleet-academy-part-1-mid-month-patch-notes/
- **2026-05-04** — *Starfleet Academy: Remote Campus & Critical Mitigation* — Deep-dive on the new Remote Campus station building (Ops 61+) and the Academy loop. — https://startrekfleetcommand.com/news/starfleet-academy-remote-campus-critical-mitigation/
- **2026-05-01** — *Battle Pass Update, Leslie Adjustment, and Compensation* — Emergency maintenance: Battle Pass relaunch + Leslie Captain's Maneuver nerf (capped at hostile L51); **in-game compensation bundle promised** for short-notice maint and the prior month's pain. — https://startrekfleetcommand.com/news/battle-pass-update-leslie-adjustment-and-compensation/
- **2026-04-28** — *Patch Notes: Update 90 – Starfleet Academy Part 1* — Major release: USS Athena arc, Starfleet Academy story drop. — https://startrekfleetcommand.com/news/patch-notes-update-90-starfleet-academy-part-1/
- **2026-04-27** — *G5 Scrapping* — Scrapyard now accepts G5 ships; long-term progression alignment. — https://startrekfleetcommand.com/news/news-g5-scrapping/
- **2026-04-25** — *Update 90 Feature Highlight: Duo Wave Defense and Battle Pass Updates* — New 2-player co-op Wave Defense (Ops 61+); Arc + Mid-Ops Battle Pass refresh. — https://startrekfleetcommand.com/news/update-90-feature-highlight-duo-wave-defense-and-battle-pass-updates/
- **2026-04-23** — *Alliance Tournament Updates* — Emerald Chain +30 milestones, new Legendary/Heroic tasks, Tournament Store refresh. — https://startrekfleetcommand.com/news/alliance-tournament-updates/
- **2026-04-21** — *Update 89.3 TNG: First Contact Part 2 Patch Notes* — Mid-month QoL on the prior arc. — https://startrekfleetcommand.com/news/update-89-3-tng-first-contact-part-2-patch-notes/
- **2026-04-19** — *April 2026 Interim Event Schedule* — Special Operations Event Series (Ops 20+) starting Apr 20. — https://startrekfleetcommand.com/news/april-2026-interim-event-schedule/
- **2026-04-18** — *Infinite Incursions: April 25th, 2026 Pairings* — Server-vs-server PvP pairings + scoring update. — https://startrekfleetcommand.com/news/infinite-incursions-april-25th-2026-pairings/

## Promo / Gift Code Signal
**This is the core signal for our redeemer.** Findings:

- **Confirmed redemption surface:** "Promo Code Redemption page on the official Star Trek Fleet Command Website." Codes are **case-insensitive** and **share-friendly by design** (community-distributed). Source: *Quark's Trek or Treat — Halloween Riddle Event* (2025-10-29).
- **Promo-code campaign pattern observed:** Multi-day "scavenger hunt" — daily hints embedded in in-game SMS messages; players assemble letters into a single global promo code redeemed on the website. One code per campaign, server-wide audience.
- **Seasonal cadence (inferred from post history):** Halloween riddle (Oct 2025), Anniversary events (Nov–Dec 2025, multi-week), interim event schedules monthly. Expect at least one shared-code promo per major holiday/anniversary window.
- **Compensation ≠ promo code.** The May 1 "Compensation" post delivers an in-game bundle pushed to inbox — not redeemed via the web store. Our redeemer is irrelevant to that channel.
- **No partner / cross-promo drops** spotted in the recent feed (no Amazon Prime Gaming, Twitch Drops, influencer codes mentioned in last ~30 days).
- **No standing always-valid codes** are advertised on the news beat — codes appear tied to time-bound campaigns.

## Active game systems
Currently spotlighted (as of Update 90, "Starfleet Academy Part 1"):
- **Starfleet Academy** — Remote Campus building (Ops 61+), Academy Space, Academy Refinery, Simulation Codes, Cadets/Athena story arc.
- **Duo Wave Defense** — new co-op mode, Ops 61+.
- **G5 Scrapping** — Scrapyard now consumes G5 ships.
- **Sigma Resources** — Refinery exchange, Sigma Parsteel/Tritanium/Dilithium economy.
- **Battle Pass** — Arc + Mid-Ops tracks, recently relaunched.
- **Leslie / Captain's Maneuvers** — buff system refactor in flight; officer balance volatile.
- **Alliance Tournaments / Emerald Chain** — 30 new milestones, store refresh.
- **Infinite Incursions** — recurring server-vs-server event, regional scheduling.
- **Carryover arcs:** TNG: First Contact (Update 89), V'ger Rebirth (Update 87), Maverick Faction (Update 88), Borg Conqueror Solo Armadas.

## Web-store / API anti-signals
**One material anti-signal detected:**

- **2026-02-26 — *Update: Stability Fixes & Login Security Improvements*** — Scopely is **removing passwords as a login method for Scopely Accounts** and transitioning to **passwordless email-verification-code login**. Quote: *"You can still log in using your existing password, but we'll be phasing out passwords soon."*
  - **Impact:** If our redeemer authenticates against the web store using `username + password`, that flow is on a deprecation timer. We need to either (a) confirm whether the web store uses Scopely SSO (likely yes), (b) capture a long-lived token/cookie out-of-band and refresh it, or (c) plan a session-bootstrap UX where the human handles the email-code step periodically.
  - **No timeline given** for full password sunset — they said "in the following weeks" back in Feb 2026, so we may already be on borrowed time.

No other anti-signals: no announced changes to the Promo Code Redemption page itself, no notice of API throttling, no terms-of-service changes flagged in the news feed.

## Open questions for the team
1. **Auth surface:** Does our current redeemer use Scopely password login, or does it ride an existing browser session/cookie? If password-based, this is now a P0 risk to validate against the live login flow.
2. **Cron cadence vs promo cadence:** Promo codes appear in clusters (5-day Halloween riddle, anniversary weeks). A 4-hour cron is more than sufficient for time-to-redeem, but we should confirm we're not missing a "first-N-redeemers" race condition — does Scopely cap any codes by redemption count?
3. **Code discovery:** Where do we *get* the codes? Scopely doesn't publish a code list; codes circulate via Discord/community. Do we have an upstream feed (community Discord scrape, Reddit, dedicated tracker site)? That's the missing input to our pipeline — without it we have nothing to redeem.
4. **WP REST as monitoring channel:** `https://startrekfleetcommand.com/wp-json/wp/v2/posts?per_page=5` is open and clean. Worth a lightweight polling job to flag new posts whose excerpts mention "promo code", "redemption", or "passwordless"?
5. **Compensation handling:** Compensation bundles (May 1) are in-game inbox, not web-store. Confirm our redeemer scope explicitly excludes inbox claims so we don't expand beyond charter.
