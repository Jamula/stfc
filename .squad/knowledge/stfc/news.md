# STFC News & Promo Intelligence — Knowledge Base

**Source:** Picard (Lead)  
**Researched:** 2026-05-12  
**Basis:** Scopely STFC news feed / blog

---

## ⚠️ HIGH-PRIORITY ALERT: Scopely Passwordless Login Migration

**Date:** February 26, 2026  
**Source:** Official Scopely announcement  
**Impact:** CRITICAL for stfc-gift-redeemer

Scopely has announced the **phase-out of password-based login** across all Scopely-managed titles, including Star Trek Fleet Command. Players are being migrated to Scopely ID (Okta OAuth) as the sole authentication method.

**Implication for the redeemer:** Any auth flow built on username + password credentials is at risk of breaking as Scopely completes this migration. The redeemer must migrate to Scopely OAuth / refresh-token-based auth before password login is fully disabled.

**Recommendation:** File a `squad,squad:uhura,enhancement` issue to track the OAuth migration roadmap. Uhura owns the auth domain.

---

## Promo Code Intelligence

### Cadence
- Scopely posts ~2–3 blog/news items per week
- Promo codes are **not published on a predictable schedule** — they cluster around:
  - Seasonal campaigns (Halloween "Quark's Harvest", Winter holiday, etc.)
  - Game anniversary events
  - Major content releases (new faction ships, story arcs)

### Current GitHub Actions Schedule
- 4-hour cron is comfortable for the current promo cadence; no adjustment needed
- Codes typically have a multi-day to multi-week validity window

### Code Discovery
- Scopely does **not** maintain a public list of active promo codes
- Discovery channels: community Reddit (r/startrekfleetcommand), fan wikis, Discord servers, official STFC social media
- **Open question for Picard:** Is automated code discovery (scraping community channels) in scope for this project?

---

## Blog Signal Analysis

| Signal Type | Typical Frequency | Relevance to Redeemer |
|-------------|------------------|-----------------------|
| Promo code releases | Irregular; campaign-driven | 🔴 High — direct input |
| Auth/platform changes | Rare; major milestones | 🔴 High — breaking changes |
| Content releases (ships, arcs) | ~1–2/month | 🟡 Medium — may bundle promo codes |
| Balance/patch notes | ~1–2/month | 🟢 Low — no direct impact |
| Community events | Variable | 🟡 Medium — seasonal code clusters |

---

## Index

- `game-flow.md` — Uhura's auth backbone and resource vocabulary
- `database.md` — Bashir's entity/schema research (pending)
