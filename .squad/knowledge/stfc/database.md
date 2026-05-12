# STFC Entity Database — Captured 2026-05-12

> Tester's recon. Mapping the SHAPE of the data, not the contents.
> Source pulled with `web_fetch` + `curl` (no auth, no game account, no PII).

## Source

- **Primary (portal):** https://startrekfleetcommand.com/star-trek-fleet-command-database/
  The "official" database page is a thin landing page — 10 category cards,
  each linking out to the community database at **stfc.space**. Note the
  subtitle on the page itself: _"STFC.Space also lives here now"_.
- **Actual data host:** https://stfc.space (Vue/Vite SPA, PWA, no SSR — page
  body is just `If you are stuck here, press the Reload Button` until JS hydrates).
- **Underlying data API:** `https://data.stfc.space/<type>/...` (CloudFront
  → S3 bucket `data/live/...`). Cache-busted by `https://data.stfc.space/version.txt`
  (current value at capture: `8586d801-fed6-4571-9cf4-18b2d93c23c3`).
- **Asset host:** `https://assets.stfc.space/thumbs/<bucket>/i/<id>.png` for
  entity icons.

The portal page links each card to a **deep-link URL on stfc.space** that
already encodes the default filter state — these URL query strings are the
single best document we have for "what filters does this entity support".

## Categories

The 10 portal cards (in display order). All link to `stfc.space`. The
"filters in deep-link" column is what the URL fragment encodes — it is the
de facto field list a fixture has to support to be filterable.

| Category | URL | Filters in deep-link |
|---|---|---|
| Ships | `/ships` | name, faction, igrade (build grade), irarity (rarity) |
| Systems | `/systems` | name, warp, mining, housing, missions, minLevel, maxLevel, minWarp, maxWarp, resources[], hostiles[], he (hostile easy?), me (mining easy?), faction, scout, ns |
| Buildings | `/buildings` | name, s (starbase tier?) |
| Research | `/researches` | name, af (faction), itree (tree id) |
| Officers | `/officers` | name, sg (synergy group), af (faction), rarity |
| Hostiles | `/hostiles` | name, level, types[], uself (use fleet?), minWarp, maxWarp, faction |
| Missions | `/missions` | name, res (reward type), minw, maxw (warp), mincw, maxcw (cargo warp), faction |
| Syndicate | `/syndicate` | (no filters; single-page view) |
| Forbidden & Chaos Tech | `/forbidden_and_chaos_tech` | (no filters) |
| Events | `/events` | (no filters) |

Approx entry counts (from the live translation files — these are name/text
counts, the canonical entity counts will be similar):

| Type | Total i18n rows | Distinct named entries |
|---|---:|---:|
| ships (`/translations/en/ships.json`) | 1,173 | **563 ship_name rows** |
| officers (`/translations/en/officers.json`) | 1,513 | ~315–843 (multiple description keys per officer) |
| factions (`/translations/en/factions.json`) | 632 | **52 faction_name rows** |
| research (`/translations/en/research.json`) | 4,824 | 2,505 research_project_name + 50 research_tree_name |
| missions (`/translations/en/missions.json`) | **172,875** (≈21 MB) | 28,938 `title` rows |
| systems (`/translations/en/systems.json`) | 14,928 `title` + 3,809 narrative + 3,596 flavour | thousands |
| consumables | 362 KB | TBD |
| forbidden_tech | 200 KB | TBD |
| loyalty | 153 KB | TBD |
| resources | 1.6 KB (tiny) | 9 resource_name rows |

Note: API entity slugs are **inconsistent** — see "Naming & ID conventions" below.

## Schema per category

The richest, most reliable shape we can pull WITHOUT login is the
**translation files**. Every translation row is uniformly:

```json
{ "id": <int | null>, "key": "<field_kind>", "text": "<display string>" }
```

- `id` is the **stable numeric entity key** when non-null. `null` = pure UI
  string with no entity attached.
- `key` distinguishes "what kind of string this is" (entity_name vs.
  entity_description vs. ui_label vs. faction_character_name etc.).
- The same `id` can appear with multiple `key` values (e.g., name +
  description + short_description for the same officer).

The summary/details endpoints (`/<type>/summary.json`, `/<type>/<id>.json`,
schema with stats: rarity, tier, faction_id, attack/shield/health, ability
descriptions, etc.) **return 404 from anonymous CDN paths** — they appear
to be served only after the SPA bootstraps with the version token via a
mechanism we couldn't reproduce from CLI. For fixture work this is fine:
translation files give us the strings; stat shapes can be inferred from the
deep-link filter list above and the asset icon names below.

### Ships

- **Name key:** `ship_name` (563 entries)
- **Description key:** `ship_description` (563 entries — pairs 1:1 with names)
- **Type buckets** (`ship_type_title`, `ship_type_description`, x7 each — 7
  ship classes): `ship_type_battleship_caps`, `ship_type_destroyer_caps`,
  `ship_type_explorer_caps`, plus 4 more (interceptor / survey / armada /
  station-defence likely).
- **Rarity:** `ship_rarity` × 6 entries (suggests 6 rarity tiers).
- **Identifier pattern:** small dense integer IDs in the 0–1000 range for
  legacy ships, then **5-digit IDs grouped by faction/event** (35xxx Klingon
  variants, 47xxx Jem'Hadar, 51xxx Vi'dar, 60xxx event variants, 69xxx
  Imperial Starfleet / Romulan Republic Ω, 82xxx Aggregation, 86xxx V'ger,
  87xxx Species 8472, 90xxx Academy/Venari Ral). **IDs are not contiguous**
  and are NOT slugs — they're opaque integers.
- **Faction encoding (multi-faction):** the JS bundle has the literal
  template strings `${G.Federation}${G.Klingon}` and
  `${G.Romulan}${G.Federation}${G.Klingon}` and these correspond to PNG
  assets `federation_klingon.png` and
  `federation_klingon_romulan.png` — i.e., **a single ship can belong to up
  to 3 factions, encoded as a concatenation of icons.**
- **Sample (verbatim):**
  ```json
  {"id": 0,     "key": "ship_name", "text": "REALTA"}
  {"id": 1,     "key": "ship_name", "text": "ENVOY"}
  {"id": 10,    "key": "ship_name", "text": "U.S.S. ENTERPRISE"}
  {"id": 11,    "key": "ship_name", "text": "B'REL"}
  {"id": 1001,  "key": "ship_name", "text": "FEDERATION SHIP"}
  {"id": 47046, "key": "ship_name", "text": "Jem'Hadar Cruiser"}
  {"id": 60034, "key": "ship_name",
                "text": "Frontier Raider <color=#FFEF40>HAZ</color>"}
  {"id": 69108, "key": "ship_name", "text": "Imperial Starfleet Ω-Annihilator"}
  {"id": 705,   "key": "ship_name", "text": "★ FEDERATION SCOUT"}
  ```
- **Stat icons used by ships** (from the assets bundle — these are the stats
  fixtures will have to model): `Armor`, `ArmorRare`, `Cargo`, `CargoCommon`,
  `Impulse`, `ImpulseRare`, `Shield`, `ShieldRare`, `Special`, `Warp`,
  `WarpRare`, `Warp_Spore`, `Weapon_Energy`, `WeaponRare_Energy`,
  `Weapon_Kinetic`, `WeaponRare_Kinetic`. Implication: weapon damage type
  (energy vs kinetic) is a first-class field, and "rare" / non-rare is a
  display-tier flag.

### Officers

- **Name key:** `officer_name` (only 18 entries — these are NPC/hostile
  officers; player-recruitable officers are named via `officer_tooltip`
  and surfaced in the UI through synergy-group + rarity, not by a flat name
  list in this i18n file).
- **Description keys:** `officer_tooltip_description` (843), `officer_tooltip_description_short` (315), and **the typo'd** `officer_tootltip_description_short` (87). ⚠️ See edge cases.
- **Synergy groups** (`fleet_officer_synergy_group`): **54 groups** — these
  are the canonical "team buff" groupings:
  ENTERPRISE CREW, KLINGON PATRIOTS, NERO'S CREW, BLOOD & HONOR,
  ROMULAN PATRIOTS, SECTION 31, SHAKEDOWN CRUISE, SURVEYORS & MINERS,
  AUXILIARY CONTROLS, KHAN'S CREW, MUDD'S COMPANY, STARFLEET ACADEMY,
  GLORY IN THE KILL, ANOTHER TIME, **`????`** (literally "????" — placeholder
  not yet released), UNIMATRIX TWELVE, DISCOVERY ORIGINS, DISCOVERY CREW,
  TERRAN EMPIRE, TOS ENTERPRISE CREW, JAYLAH, NEXT GEN, TNG CREW,
  KHITOMER'S REVENGE, PRIDE OF ROMULUS, Syndicate (lowercase!),
  FERENGI CONGLOMERATE, LOWER DECKS CREW, STRANGE NEW WORLDS, HOLODECK,
  BATTLESHIP STRIKE TEAM, DEEP SPACE NINE, INTERCEPTOR STRIKE TEAM,
  EXPLORER STRIKE TEAM, PICARD, FLEET COMMANDER, VOYAGER, ENTERPRISE-E,
  ENTERPRISE NX-01, EX-BORG, MIRROR UNIVERSE, Galaxy Quest (mixed case),
  EMERALD CHAIN, SYMBIOSIS, ⇦ RETALIATION SQUAD, ⇧ RETALIATION SQUAD,
  ⇥ RETALIATION SQUAD (three Unicode-arrow variants distinguishing
  squads), VOYAGER 30TH ANNIVERSARY, WRATH OF KHAN, VILLAINS,
  Status Control Team, THE MOTION PICTURES, FIRST CONTACT MOVIE,
  GALAXY QUEST (a SECOND duplicate-name synergy group at id 54 vs the
  mixed-case "Galaxy Quest" at id 42).
- **Rarity:** `officers_rarity_common`, `_uncommon`, `_rare`, `_epic`,
  `_legendary` — **5 rarity tiers** (one more than ships' 6).
- **Stations:** `officer_cmd_station`, `officer_eng_station`, `officer_sci_station`
  — officers slot into Command / Engineering / Science.
- **Faction-character names**: 12 entries of `faction_character_name` —
  these are Unity-rich-text wrapped: `"<color=#{0}>Harry Mudd</color>"`. Note
  the `{0}` is a runtime format placeholder for the faction's color hex.
- **Sample (verbatim):**
  ```json
  {"id": 18013, "key": "officer_name", "text": "Cardassian Militia"}
  {"id": 8101,  "key": "officer_name", "text": "Borg Tactical Cube"}
  {"id": 80104, "key": "officer_name", "text": "Hurak Warrior"}
  {"id": 88052, "key": "officer_name", "text": "Rare FCM Solo Armada Captain"}
  {"id": 124,   "key": "faction_character_name",
                "text": "<color=#{0}>Harry Mudd</color>"}
  {"id": 922,   "key": "faction_character_name",
                "text": "<color=#{0}>Kira Nerys</color>"}
  ```

### Factions

- **Name keys:** `faction_name` (52), `faction_name_upper` (54),
  `faction_name_upper_plural` (44), `faction_long_name` (variant counts).
- **⚠️ Typo'd key in production data:** `factian_name_upper_plural`
  (should be `faction_*`) is used for at least one row (id=17, "THE ACTIAN").
  Translation lookup code MUST not assume a single canonical key.
- **Identifier pattern:** small numeric ID space (1–37) for the original
  factions, then sparse 5-digit IDs assigned per content drop:
  71001, 72000, 74001/2, 77001, 78000, 80001/2/3/4, 82001, 84001/2/3,
  86001, 88001/5, 90000/1.
- **Duplicate names with different IDs** (intentional or not):
  - `Borg` appears as id=13 AND id=84003 (the latter likely the Aggregation/Card-Node mini-faction).
  - `Flashpoint` appears as id=80002 AND id=80003.
  - `Maverick` appears as id=88001 AND id=88005.
  Fixtures and tests **must not** use faction-name as a unique key.
- **Full faction roster** (all 52 `faction_name` rows captured 2026-05-12):
  ```
  1   Federation         15  Rogue              31  Xindi-Reptilian    80003 Flashpoint
  2   Klingon            16  Eclipse            32  Xindi-Aquatic      80004 Breen
  3   Romulan            17  Actian             33  Gorn Hunting Pack  82001 Aggregation
  4   Andorian           18  Alliance           34  Mirror Universe    84001 Card
  5   Vulcan             19  Cardassian         35  Fatu-Krey          84002 Node
  6   Gorn               20  Bajoran            36  Hologram Mirror Picard  84003 Borg
  7   Arkonian           21  Dominion           37  House Gorthal      86001 Vger Clone
  8   Suliban            24  Ex-Borg            71001 Terran           88001 Maverick
  9   Corvallen          27  Texas-class        72000 Q-Continuum      88005 Maverick
  10  Orion Syndicate    28  Torvath            74001 DTI              90000 Academy
  11  Augment            29  Section 31         74002 Krenim Imperium  90001 Venari Ral
  12  Swarm              30  Xindi              77001 Apex Raiders
  13  Borg                                      78000 Exiles
  14  Assimilated                               80001 Transogen
  ```
  Gaps in the small-id range (22, 23, 25, 26, 38–70999) are real — likely
  deprecated or never-released factions.
- **Note "augment" vs "Augment"** — JS template strings use
  `${G.Augmented}` (past-participle), but `faction_name` says `Augment`
  (noun). Don't normalize one to the other in fixtures; mirror both.

### Systems

- Translation file uses keys `title`, `narrative`, `flavour` — note
  British spelling **"flavour"** (not "flavor") — production typo or
  intentional UK-spelling, either way fixtures must mirror exactly.
- **Identifier pattern:** systems have **two ID spaces** — small ints
  (e.g., id=10 = "Nausicaans") for canonical/named systems, and 9–10-digit
  ints (e.g., id=1000162982, id=100125359) for procedurally-generated
  systems. Many procedural systems' titles are literally `"."` (a single
  period) — placeholder strings. Tests must handle period-only titles.
- **Sample names:** `Nausicaans`, `Iojuoab`, `Lewumex`, `Lazenuro`,
  `Wingsabre`. Procedurally-generated names tend to be unpronounceable
  CVCVCVC patterns mixed with real Trek lore names.

### Hostiles

- No `/translations/en/hostile.json` or `/hostiles.json` — hostile names
  come from `marauder_name_only` rows (8 entries) inside ships.json:
  ```json
  {"id": 35019, "key": "marauder_name_only", "text": "Verin Gang Marauder"}
  {"id": 45031, "key": "marauder_name_only", "text": "Actian Chrysalis"}
  {"id": 45045, "key": "marauder_name_only", "text": "Actian Chrysalis ⇂"}
  {"id": 45046, "key": "marauder_name_only", "text": "Actian Chrysalis ⇁"}
  {"id": 45047, "key": "marauder_name_only", "text": "Actian Chrysalis ⇀"}
  ```
  Note the **3 variants of the same ship distinguished only by Unicode
  arrow direction** (U+21C0 ⇀, U+21C1 ⇁, U+21C2 ⇂). Fixtures need to
  preserve these exactly — strip-non-ASCII normalisation will collapse
  three distinct hostiles into duplicates.

### Missions

- **172,875** translation rows (the largest file, ~21 MB). Keys: `dialogue`
  (105k), `title` (29k), `narrative` (25k), `dilemma_description` (13k).
- IDs are 10-digit integers (`1000162982`, `1000248612`, …) — same shape as
  procedurally-generated systems.
- **Sample titles (verbatim):**
  ```
  "Deliver Kayshon, T'Ana, and Tendi to Sigma Tama IV."
  "Set a course for Jonauer."
  "Defense Platform A Level 41"
  "Disable the assassin's weapons."
  "Tal Shiar Assassin"
  ```
- Mission strings contain **periods, commas, apostrophes, and embedded
  numbers** (level numbers, part numbers). Fixtures used for parser/render
  tests must include at least one mission with apostrophe AND one with
  embedded numerals.

### Research

- **Tree names** (`research_tree_name`, 50 entries):
  STATION, GALAXY, COMBAT, AWAY TEAMS, **Ship Cloaking** (mixed case!),
  STARSHIPS, STARBASE, BAJORAN, **Ship Abilities** (mixed case!), EX-BORG,
  ARTIFACT, EX-BORG FAVORS, MIRROR, STAR PATH, AGGREGATION, …
  Casing is inconsistent — most are SHOUT_CAPS but a handful are
  Title Case. Fixtures should not assume uniform casing.
- **Project names:** 2,505 entries — `research_project_name`. Sample:
  `'Building Construction Speed I'`, `'Hull Density'`, `'Prime Damage'`,
  `'Dilithium Safeguard'`, `'D3 CLOAKING'`, `"B'REL CLOAKING"`,
  `'BORTAS CLOAKING'`. Mix of Title Case and SHOUT CAPS.
- **⚠️ Typo'd key:** `reserach_project_description` (3 rows) — production
  typo that ships in real data. Code paths reading research descriptions
  must accept BOTH `research_project_description` AND
  `reserach_project_description`.

### Resources

Tiny file (1.6 KB, ~24 rows). Includes the canonical resource short-names
referenced by every other file:
```
DILITHIUM, PARSTEEL, LATINUM, TRITANIUM, EPIC REFINED GAS, Prime Matrices,
Doomsday Transwarp Cell, Elite Doomsday Transwarp Cell, Faction Pod, …
```
**Quirk:** the `resource_duranium` key has display text `"PARSTEEL"` — so
the **internal codename and display name don't match** ("duranium" is the
old/dev name for what players see as "parsteel"). Same likely for some
other resources. Fixtures must keep both the dev codename and the player
display name available.

Five entries (ids 9056-9060) have `text: "."` — single period placeholders
for unreleased/deprecated resources. Tests must handle period-only display
strings.

### Other categories worth knowing

- **Consumables** (`/translations/en/consumables.json`, 362 KB) — exists,
  not deeply sampled. Likely uses `consumable_name` / `consumable_description`.
- **Forbidden Tech** (`/translations/en/forbidden_tech.json`, 200 KB).
- **Chaos Tech** — referenced in JS bundle but no anonymous endpoint found.
  Likely served via the same `/forbidden_and_chaos_tech` UI route.
- **Loyalty** (`/translations/en/loyalty.json`, 153 KB) — Discovery-era
  loyalty mechanic; mostly UI strings.
- **Buildings, Hostiles, Starbase** — page bundle references these as
  entity types but anonymous translation paths return 404. Names are
  embedded in adjacent files (e.g. hostile names are in ships.json under
  `marauder_name_only`). Tests must not assume one entity type → one file.

## Naming & ID conventions

**Entity slug inconsistency** — fixtures and any router/dispatch code
MUST NOT assume "entity name" pluralisation rules. Concrete observed:

| API uses singular | API uses plural / weird |
|---|---|
| `building` | `ships` |
| `hostile` | `officers` |
| `research` | `missions` |
| `resource` | `systems` |
| | `consumables` |
| | `factions` |
| | `forbidden_tech` (with underscore) |
| | `chaos_tech` |
| | `loyalty` (uncountable) |
| | `starbase` (singular as noun) |

**ID conventions:**

- **Always opaque integers**, NEVER slugs/strings.
- Three observed integer-ID size classes:
  1. Small dense (0–1000): legacy/canonical entities.
  2. 5-digit grouped (10001, 35xxx, 47xxx, 80xxx, 88xxx, 90xxx): grouped by
     content drop / faction / event.
  3. 9–10-digit (1000162982): procedurally-generated systems & missions.
- IDs are NOT contiguous; gaps reflect deprecated or unreleased content.
- Multiple entities can share a `text` value — name is NOT a unique key.
  See faction "Borg" (id 13 vs 84003), "Maverick" (88001 vs 88005),
  "Galaxy Quest" (42 vs 54), "U.S.S. ENTERPRISE" (10 vs 29 — yes, two
  different IDs both named USS Enterprise — likely original-cast vs
  Kelvin-timeline variants).

**Cross-references:** entities reference each other by ID. The JS bundle
shows the URL templates `/buildings/${e.requirement_id}`,
`/hostiles/${e.item?.id}`, `/missions/${t.node.id}`,
`/researches/${e.requirement_id}` — so a research project can require a
building level, a mission can target a hostile, etc. Fixtures for
prerequisites/requirements must use real entity IDs from the same fixture
set, not invented integers.

## Edge cases for fixtures

These are the failure-mode triggers a tester should bake into the fixture
set from day one:

| # | Edge case | Concrete fixture row to include |
|---|---|---|
| 1 | **Single-quote in name** (Klingon/Vulcan apostrophes) | `B'REL`, `K'T'INGA`, `T'PLANA'HATH`, `D'DERIDEX`, `Jem'Hadar Cruiser`, `KHAN'S CREW` |
| 2 | **Periods inside names** (US Navy ship prefix) | `U.S.S. ENTERPRISE`, `I.K.S. AK'VOH`, `I.K.S. GRE'THOR` |
| 3 | **Hyphens** | `Xindi-Reptilian`, `Ex-Borg`, `Texas-class`, `Fatu-Krey`, `ENTERPRISE-E`, `ENTERPRISE NX-01`, `Bird-of-Prey` |
| 4 | **Ampersand** | `BLOOD & HONOR`, `SURVEYORS & MINERS`, `Forbidden & Chaos Tech` |
| 5 | **Greek letter Ω** | `Imperial Starfleet Ω-Annihilator`, `Romulan Republic Ω-Cruiser`, `Alliance Ω-Bird-of-Prey` |
| 6 | **Star ★ as prefix or suffix** | `★ FEDERATION SCOUT`, `Aggregation Extractor ★` |
| 7 | **Embedded Unity rich-text** | `Frontier Raider <color=#FFEF40>HAZ</color>`, `<color=#{0}>Harry Mudd</color>` (also tests for `{0}` format placeholder) |
| 8 | **Unicode arrows as variant discriminator** | `Actian Chrysalis ⇀` / `⇁` / `⇂`, `⇦ RETALIATION SQUAD`, `Academy Combat Drone  ⇆ ↿↿`, `The Core's Courier <color=#FCF3B9>⇵</color>` |
| 9 | **Period-only or whitespace-only `text`** | resource ids 9056–9060 (`"."`), procedural systems with `"."` titles |
| 10 | **Empty-string `text`** | observed in ships.json `id=823` |
| 11 | **Sentinel placeholders** | `MISSING DESCRIPTION`, `[PH] Maverick faction description.`, `DO NOT USE`, `????` (literal) |
| 12 | **Multi-faction entity** | Use a ship/officer with combined faction icons — e.g. anything with the `federation_klingon_romulan.png` asset (Discovery / Vi'dar / cross-faction officers). Picking one is mandatory: fixtures with only single-faction entities will hide multi-faction bugs. |
| 13 | **Duplicate display names, distinct IDs** | factions `Borg` (13 / 84003), `Maverick` (88001 / 88005), `Flashpoint` (80002 / 80003); ships `U.S.S. ENTERPRISE` (10 / 29), `D'DERIDEX` (47 / 35013), `VOR'CHA` (35005 / 50), `NEGH'VAR` (54 / 60007), `Jem'Hadar Flagship` (47049 / 47050) |
| 14 | **Non-contiguous integer IDs** | Don't use `range(1, N)` to populate ID columns — loaders that assume contiguous IDs will silently lose entries. Mix small (0–100), 5-digit (35019, 88052), and 10-digit (1000162982) IDs. |
| 15 | **Casing inconsistency within one entity type** | Research trees: `STATION` / `Ship Cloaking` / `Ship Abilities` (most SHOUT, a few Title Case). Synergy groups: `Syndicate` (Title) vs. `FERENGI CONGLOMERATE` (SHOUT) vs. `Galaxy Quest` (Title) vs. `GALAXY QUEST` (SHOUT — different group, same name). |
| 16 | **Production typo'd keys** | `officer_tootltip_description_short` (extra "t"), `factian_name_upper_plural`, `reserach_project_description`. Tests must accept the typo'd form OR fail loudly when it's encountered, not silently drop it. |
| 17 | **British "flavour" spelling** in systems file | `flavour` not `flavor`. Don't normalize. |
| 18 | **Codename ≠ display name** | resource key `resource_duranium` has display text `"PARSTEEL"`. |
| 19 | **Inconsistent API entity slugs** | singular `building`/`hostile`/`research`/`resource` vs plural `ships`/`officers`/`missions`. Tests for any URL builder must cover both. |
| 20 | **Long names** | `"Voyager 30th Anniversary"` synergy group, `"Frontier Raider <color=#FFEF40>HAZ</color>"` (44 chars after rich-text strip). Plan column widths / truncation tests for ≥60 chars. |
| 21 | **Whitespace quirks** | `Academy Training Drone  ⇔` (DOUBLE space before arrow), `Academy Combat Drone  ⇆ ↿↿` (mixed double-spaces). Trim-on-load is dangerous. |
| 22 | **Identical id, multiple keys** | Officer id=124 has both `officer_name` and `faction_character_name`; expect to look up the same id with different `key` filters. |

## Fixture recommendations

For `tests/fixtures/stfc/`:

1. **`factions.json`** — copy at least 6 rows from real
   `https://data.stfc.space/translations/en/factions.json`, ensuring:
   - one base faction (id ≤ 10),
   - one duplicate-name faction (id 13 _Borg_ AND id 84003 _Borg_),
   - one with apostrophe (`Khan's Crew` synergy or similar),
   - one large-id faction (88001 _Maverick_),
   - one typo'd-key row (`factian_name_upper_plural`),
   - one rich-text wrapped name.

2. **`ships.json`** — at minimum:
   - `id=10  U.S.S. ENTERPRISE` (canonical single-faction federation),
   - `id=11  B'REL` (apostrophe + klingon),
   - `id=29  U.S.S. ENTERPRISE` (duplicate-name discriminator test),
   - `id=47046 Jem'Hadar Cruiser` (Title Case + apostrophe),
   - `id=60034 Frontier Raider <color=#FFEF40>HAZ</color>` (rich-text),
   - `id=69108 Imperial Starfleet Ω-Annihilator` (Greek + hyphen),
   - `id=82055 The Core's Courier <color=#FCF3B9>⇵</color>` (rich-text + Unicode),
   - one **multi-faction** ship (any using federation_klingon icon),
   - one with a **trailing period** or empty description.

3. **`officers.json`** — pull 4 rows of `officer_tooltip_description`, the
   typo'd `officer_tootltip_description_short` row, and 2-3
   `fleet_officer_synergy_group` rows including the literal `????`
   placeholder and one of the arrow-discriminated `RETALIATION SQUAD`
   variants.

4. **`hostiles.json`** — the three `Actian Chrysalis ⇀ / ⇁ / ⇂` variants
   are the single best smoke-test for Unicode-preserving normalisation.

5. **`systems.json`** — pull `id=10 Nausicaans` (named) AND one
   procedural system (10-digit id) with `text: "."`.

6. **`missions.json`** — pick 5 mission titles total, ensuring one with
   apostrophe, one with embedded numerals, one named after a TV-episode
   reference, and one starting with `"Defeat N hostiles…"` (procedural
   template — these tend to be the highest-volume mission shape).

7. **A `version.txt` mock** — the data API includes a UUID-shaped version
   string. Cache-control / staleness tests should mock a version mismatch.

8. **An `i18n-row.schema.json`** — every translation entry is
   `{id: int|null, key: str, text: str}`. Lock the shape.

## Open questions for the team

1. **Do we actually need to source live STFC entity strings into our
   fixtures, or is the gift-redeemer codebase too narrow to care?** The
   redeemer's API surface is `redeem-code` flow — it likely never
   touches ship/officer/faction names. If so, this knowledge file is
   forward-looking only and we should keep fixture work minimal until a
   feature actually needs entity names. Cyrusj/Brady to confirm scope.

2. **Are the `data.stfc.space/<type>/summary.json` and per-entity detail
   endpoints actually fetchable** with the right headers/cookies, or only
   from inside the SPA's service-worker context? Worth a follow-up if we
   ever want full stat-shape fixtures (rarity tier, attack/shield/health,
   ability descriptions). Today we only have the i18n strings.

3. **What's the licensing posture for embedding stfc.space data in our
   tests?** stfc.space is a community/fan database. Scopely's "Fan Content
   Policy" is linked from the official portal. We probably want to either
   (a) copy only minimal *shape* samples (≤20 rows per entity type), not
   bulk dumps, or (b) generate synthetic fixtures that mirror the shapes
   documented above without using real names. Picard / cyrusj decision.

4. **Do we need a realistic `marauder_name_only` (hostile) fixture even
   though the gift-redeemer doesn't fight hostiles?** If the answer is no
   today, we still want item #4 above (the Actian Chrysalis arrow trio)
   somewhere as a Unicode-preserving smoke test even if it's not in the
   "STFC fixtures" folder.

5. **Should we add a CI lint that flags any fixture row whose `text`
   contains `<color=` or `{0}` and asserts the test using that fixture
   has explicit handling for Unity rich-text?** Production data ships
   these in display strings; silently rendering them as literal HTML is
   a real bug class.
