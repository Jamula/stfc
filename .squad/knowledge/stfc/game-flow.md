# STFC Game Flow — Captured 2026-05-12

## Source
https://startrekfleetcommand.com/new-user-guides/

## Guides catalogued
- Game Overview — https://startrekfleetcommand.com/academy/academy-game-overview/ — High-level intro: navigation (Station Interior/Exterior, Galaxy, System views), the five core pillars (mining, missions/events, ships/combat, officers, base upgrades).
- Resources & Mining — https://startrekfleetcommand.com/academy/academy-resources/ — Canonical list of in-game currencies and how each is obtained / what each upgrades.
- Station Guide — https://startrekfleetcommand.com/academy/academy-station-guide/ — Buildings (Operations, Academy, R&D, Warehouses, Generators, Vaults, Drydocks, Defense Platforms), Ops level 15 unlock for station combat, Peace Shield mechanics.
- Ships & Combat — https://startrekfleetcommand.com/academy/academy-ships-combat/ — Ship classes (Interceptor / Explorer / Battleship / Survey) rock-paper-scissors, Blueprints as the gating currency for ship builds, tier-up flow, Orion Corvette as canonical second ship.
- Officer Guide — https://startrekfleetcommand.com/academy/academy-officer-guide/ — Recruit Tokens, Officer XP, Shards (for Promote), Captain's Maneuver vs Officer Ability, synergy groups.
- FAQ — https://startrekfleetcommand.com/faq/ — JS-rendered, no static content captured. Skipped.

## Progression arc
- **Early game (Ops 1–14):** Player works the five pillars on rails — build resource generators (Parsteel/Tritanium/Dilithium), grind missions, unlock 2nd ship (Orion Corvette via combat research tree, ~Ops 4–6). Gift codes here are mostly *speedups, small resource bundles, recruit tokens* — appreciated but not gating.
- **Mid game (Ops 15+):** Station combat unlocks, raw → refined materials (Crystal/Gas/Ore) become the bottleneck via the Refinery, blueprint hunting and faction grinding (Federation / Klingon / Romulan store implied) dominates. **This is where gift codes start mattering** — refined materials, ship blueprints (Saladin / D4 / Augur tier), officer shards.
- **Late game (Ops 30+, implied — not in guides):** Epic ships (Discovery, Enterprise, Vi'dar, etc.), G3/G4 materials, Latinum sinks. Gift codes here are mostly cosmetic-value unless they drop high-tier blueprints or large Latinum bundles.
- **Gift-code relevance inflection point:** roughly Ops 15. Below that, an automated redeemer is "nice to have"; above that, it's a real progression accelerator.

## Store & gift mechanics (player POV)
- The web store at https://home.startrekfleetcommand.com/store is a **separate surface from the in-app shop** — it's behind Scopely SSO (the same `id.scopely.com` OAuth flow advertised on the new-user-guides index page).
- Player-visible flow: log in via Scopely → land on the home/store → claim "Daily Gift" / "Free Pack" / enter promo code → items drop into the in-game inbox on next app login.
- Promo codes typically come from: official Discord, content creators ("creator codes"), Twitter/X reveals, livestream events, and recovery/apology drops after server incidents. They are short alphanumeric strings, generally one-time-per-account.
- **What our automation does:** captures the Scopely-issued JWT (via the bookmarklet), then POSTs promo-code redemptions on cron. The "claim daily gift" surface is adjacent and likely uses the same auth — worth reconnaissance.
- **What stays manual:** in-app store purchases (those go through the mobile platform's billing — App Store / Play Store / Xsolla on desktop), faction-store spends, and anything that requires tapping a target in-world.

## Currency / resource cheatsheet
| Resource | What it does | How obtained |
|---|---|---|
| **Latinum** | Premium currency. Buys other resources, instant-completes timers. | Rare drops, events, real-money packs, **gift codes**. |
| **Parsteel** | Tier-1 base/ship upgrades, research. | Generators, mining nodes, mission rewards, gift bundles. |
| **Tritanium** | Tier-1 base/ship upgrades, research. | Generators, mining nodes, mission rewards, gift bundles. |
| **Dilithium** | Tier-1 base/ship upgrades, research. | Generators, mining nodes, mission rewards, gift bundles. |
| **Raw Crystal / Gas / Ore** | Mined inputs to the Refinery. | Mining in space (system-specific nodes). |
| **Refined Crystal / Gas / Ore** | Mid-to-late ship/building/research upgrades. | Refinery conversion, **gift codes**, events. |
| **Ship XP** | Levels individual ships. | Combat, missions, gift bundles. |
| **Officer XP** | Levels officers. | Daily goals, gift packs. |
| **Officer Shards** | Required to *Promote* (rank up) an officer. | Recruit tokens, faction stores, **shard packs in gifts**. |
| **Recruit Tokens** | Pull new officers (gacha-ish). | Daily goals, events, **gift codes** (very common payload). |
| **Blueprints** | Required to construct a specific ship. | Hostile drops, missions, faction store, events, **rare gift codes**. |
| **Speedups** (build / research / repair / tier-up) | Skip timers without spending Latinum. | Daily/event rewards, **very common gift-code payload**. |

## Account mechanics relevant to integration
- **Auth backbone is Scopely SSO** (Okta-hosted: `id.scopely.com/oauth2/default/v1/authorize`), client_id `0oa1496nmx8OcY8eI5d7`, OAuth2 authorization-code flow with `openid email profile offline_access` scopes — meaning **refresh tokens exist** and our captured JWT is downstream of that exchange.
- The redirect target is `https://home.startrekfleetcommand.com/` — same origin our bookmarklet runs against, which is why JWT capture works there.
- **Account binding:** Scopely account ↔ in-game commander. The new-user-guides explicitly nudge "Sign up through the Star Trek Fleet Command app to connect your account, save your game progress" — implying the *default* is unbound device-local, and Scopely binding is opt-in but required for the web store to know who you are.
- **Multi-account:** Not addressed in the guides, but the STFC_ACCOUNTS secret format we maintain implies one Scopely identity per entry. Each account = one OAuth session = one JWT. There is no "switch profile" surface in the web store; you log out and back in.
- **Session lifetime:** Not stated by the guides, but `offline_access` scope + standard Okta defaults mean access tokens are typically short-lived (~1h) and refresh tokens long-lived (days–weeks). This matches the operational reality that captured JWTs go stale.

## Faction / ship quick-ref
Names worth recognizing in store inventory / gift bundles:
- **Factions:** Federation, Klingon, Romulan (the original three, each with own faction store and reputation track), plus later additions implied by the broader meta — Augments, Section 31, Borg, Dominion, Terran Empire (Mirror).
- **Ship classes:** Interceptor, Explorer, Battleship, Survey (the four base archetypes, RPS triangle + Survey for mining).
- **Iconic early ships:** ECS Fortunate (starter survey), Orion Corvette (canonical 2nd ship — combat tree research), Envoy.
- **Faction starter ships:** Mayflower (Fed), K't'inga (Kli), Centurion (Rom).
- **Mid-tier marquee:** Saladin (Fed interceptor), D4 (Kli battleship), Augur (Rom explorer), Realta, Phindra.
- **Epics / late game:** Enterprise (NCC-1701), Discovery, Vi'dar, Stella, Franklin, Mantis, Cerritos.
- **Resource pulls:** Names like "Discovery Pack", "Saladin Blueprint Bundle", "Augur Crew Pack" are typical store-inventory shapes — store payloads will reference ship slugs.

## Integration-relevant signals
- **Likely store-payload shape:** a gift / promo redemption response almost certainly returns a list of `{ resource_id | item_id, type, quantity }` entries — because the game economy is itemized into the discrete resource list above. Our parser should expect:
  - resource grants (Parsteel/Tritanium/Dilithium/Latinum/Refined-*)
  - speedup grants (build/research/repair/tier-up, time-denominated)
  - token grants (recruit tokens, officer shards keyed by officer id/name)
  - blueprint grants (keyed by ship id/name)
  - cosmetic / chest grants (loot-box style — may nest a sub-list)
- **Idempotency:** promo codes are one-time-per-account, so re-submitting the same code should yield a deterministic "already redeemed" error — our retry/backoff should treat that as a *terminal success-equivalent*, not a failure.
- **Rate limits:** not documented, but the store is a low-QPS player surface; treat anything over a few req/sec per account as risky. Cron at 4h cadence is well within safe bounds.
- **Auth surface:** because everything routes through Scopely Okta, a 401 on our endpoint is almost certainly an expired access token, *not* a revoked grant — refresh-flow capability is the right long-term fix vs. re-running the bookmarklet.
- **i18n:** Guides are English-only on the public site, but Scopely operates globally; gift payloads may carry localized item names. Key on IDs, not display strings.

## Open questions for the team
1. Does the web store expose a separate "claim daily gift" endpoint adjacent to promo redemption? If so, the same JWT should unlock it — easy automation win.
2. Do promo codes ever grant *bound* items that require an in-game accept step, or do they all auto-credit the inbox?
3. Is there a documented (or observed) per-account rate limit on redemption attempts? Useful for tuning the cron.
4. When a code is region-restricted (creator codes often are), what's the error shape? Need to distinguish from "expired" / "already redeemed" / "invalid".
5. Does the captured JWT include a refresh token, or only an access token? Determines whether we can build a refresh loop or must keep relying on the bookmarklet.
6. Are there known "high-value" code distribution channels we should be polling (official Discord, specific creator feeds) so the redeemer has fresh codes to try?
