# STFC Game Flow — Knowledge Base

**Source:** Uhura (Integrations Dev)  
**Researched:** 2026-05-12  
**Basis:** STFC Academy guides (new-user-guides)

---

## Authentication Backbone

- **Provider:** Scopely Okta (OAuth 2.0)
- **Flow:** Standard PKCE-based authorization code flow
- **Scopes:** Includes `offline_access` → refresh tokens exist and are issued
- **Implication:** The redeemer does NOT need to re-authenticate on every run; refresh tokens can be persisted and reused

### ⚠️ Critical Signal (from Picard's news research)

Scopely announced **February 26, 2026** that password-based login is being phased out. Auth flows built on username + password are at HIGH risk of breaking. The OAuth/Okta path is the durable approach.

---

## Resource Vocabulary (for response parser)

Canonical STFC resource types returned in gift/redemption responses:

| Resource Key | Display Name |
|--------------|-------------|
| `parsteel` | Parsteel |
| `tritanium` | Tritanium |
| `dilithium` | Dilithium |
| `ship_xp` | Ship XP |
| `officer_xp` | Officer XP |
| `alliance_credits` | Alliance Credits |
| `recruit_tokens` | Recruit Tokens |
| `premium_recruit_tokens` | Premium Recruit Tokens |
| `shields` | Shields |
| `speed_ups` | Speed Ups |

> Note: The response model uses an open `ItemGrant[]` type — resource types may expand. Parser should use an `unknown` fallback for unrecognized keys rather than failing hard.

---

## Ship & Faction Names

**Factions:**
- Federation, Klingon, Romulan, Neutral (independent ships)

**Common Ship Classes (relevant for promo code rewards):**
- Jellyfish, Vahklas, Phindra, Turas, Kumari, D3 Class, Kehra, Bortas, Gladius, Centurion, Envoy, Antares

---

## Redemption Flow (Academy Guide Summary)

1. Player visits the STFC web store (store.startrekfleetcommand.com)
2. Player authenticates via Scopely OAuth
3. Gift items appear in the "Free Gifts" section — claimed via one-click
4. Promo codes are entered in the "Redeem Code" field
5. Rewards are delivered to the in-game mailbox

**5 Academy Guides Catalogued:**
1. Getting Started with STFC Web Store
2. Understanding Gift Redemption
3. Promo Codes: How They Work
4. Account Linking (Scopely ID)
5. Troubleshooting Redemption Failures

> Note: The Academy FAQ page was skipped — JavaScript-rendered content not accessible via static fetch.

---

## Index

- `news.md` — Picard's news beat and promo campaign analysis
- `database.md` — Bashir's entity/schema research (pending)
