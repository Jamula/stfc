# Community STFC Reference Sheet — Mirror

This directory mirrors the community-maintained Google Sheet
**[*Starfleet Academy, Athena & Duo Waves — M90 & M91*][upstream]** into
agent-readable markdown, one file per tab.

[upstream]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit

## Lineage

Per [the knowledge-base lineage convention](../README.md#lineage-convention--every-ingested-artifact-must-declare-it),
this whole sub-directory carries the following lineage. **Every per-tab file
also carries its own per-tab lineage block** (with the tab-specific URL and gid).

| Field | Value |
| --- | --- |
| **Source URL** | <https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit> |
| **Source name** | STFC Community Sheet — *Starfleet Academy, Athena & Duo Waves — M90 & M91* (whole workbook) |
| **Author(s) / contributors** | JulesVern; Quasel; BlueMandalorian; STFC Officer Tool Discord `#data-collection` channel (invite: <https://discord.gg/BRhru6Vcnj>) |
| **Captured on** | 2026-05-31 |
| **License / attribution requirements** | Community-maintained reference. Upstream says **"MAKE A COPY"** for any use of the calculators; we mirror read-only. Preserve the author list above on every quote or excerpt; link back to the source URL. We do **not** modify the upstream sheet — contributions go through the authors via the Discord channel. |
| **Refresh strategy** | Re-fetch all tabs via `node scripts/fetch-community-sheet.mjs` from the repo root. The script reads each tab's CSV via the public gviz endpoint, trims empty columns, and rewrites the per-tab files with an updated **Captured on** date. To check for upstream tab additions/removals, fetch `https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/htmlview` — its source contains the canonical tab list. |

## Why it's mirrored here

This project (`stfc-gift-redeemer`) is a CLI that redeems STFC web-store gifts
and promo codes; it does **not** consume game-strategy data at runtime. The
mirror exists to give:

1. **AI agents** (notably Uhura, our STFC-domain integrator) machine-readable
   context for game terminology, building/refinery progression, and crewing
   suggestions when reasoning about features.
2. **Human contributors** a stable, greppable snapshot of community knowledge
   that's tracked alongside our docs, so links don't rot mid-feature.

## Read-only mirror — we never modify upstream

The upstream sheet says **"MAKE A COPY if you want to use any calculators"**.
We honour that:

- We **only** fetch the public CSV exports via the gviz endpoint.
- We **never** write back to the upstream sheet.
- Suggestions for the sheet itself go through the authors via the Discord
  channel above, not via this repo.

## Tabs ingested (M91, captured 2026-05-31)

| # | Tab | gid | File |
| -: | --- | --- | --- |
| 01 | Intro                          | 1563749702 | [01-intro.md](./01-intro.md) |
| 02 | SF Academy Building            | 556376347  | [02-sf-academy-building.md](./02-sf-academy-building.md) |
| 03 | Refinery (M91 additions)       | 508132113  | [03-refinery.md](./03-refinery.md) |
| 04 | Athena                         | 1243592063 | [04-athena.md](./04-athena.md) |
| 05 | Duo Wave Defense               | 119341188  | [05-duo-wave-defense.md](./05-duo-wave-defense.md) |
| 06 | System Map                     | 1549666316 | [06-system-map.md](./06-system-map.md) |
| 07 | Credit Calculator              | 744753634  | [07-credit-calculator.md](./07-credit-calculator.md) |
| 08 | Crews — Academy Drones (Blue's Crews) | 1770071728 | [08-crews-academy-drones.md](./08-crews-academy-drones.md) |
| 09 | Independent Archives (M91)     | 1778790882 | [09-independent-archives-m91.md](./09-independent-archives-m91.md) |
| 10 | G5 Scrapping Guide             | 1369248894 | [10-g5-scrapping-guide.md](./10-g5-scrapping-guide.md) |
| 11 | Critical Damage Mitigation     | 1179953085 | [11-critical-damage-mitigation.md](./11-critical-damage-mitigation.md) |

### Tabs noted in the original issue but not currently present upstream

The issue (#74) referenced *Facade Expansion* and *Emerald Chain Expansion* as
"Other" tabs. As of 2026-05-31, the upstream sheet no longer exposes those
tabs (they were either renamed, merged into another tab, or removed). If they
reappear, add the new gid to the `TABS` array in
[`scripts/fetch-community-sheet.mjs`](../../../scripts/fetch-community-sheet.mjs)
and re-run the refresh.

## What you'll find in each file

Each per-tab file contains:

1. A **`## Lineage` block** with the six required fields (per the
   [knowledge-base lineage convention](../README.md#lineage-convention--every-ingested-artifact-must-declare-it)):
   tab-specific Source URL (with `#gid=`), Source name, Author(s), Captured
   on date, License / attribution requirements, Refresh strategy.
2. A "read-only mirror" notice (your edits will be overwritten on the next
   refresh).
3. A note that **visual/screenshot content** in the upstream tab does not
   survive CSV export — for charts, embedded images, or formatted layouts,
   follow the Source URL.
4. A fenced ` ```csv ` block with the tab's data, with **empty columns
   trimmed** for readability. Cells preserve original formatting (e.g.
   percentages, commas in numbers) so downstream parsing can choose its own
   normalisation.

The CSV block is intentionally machine-readable (gviz output is RFC 4180
quoted), so agents can stream it through any standard CSV parser.

## Limitations

- **Visual layouts lost.** The upstream sheet uses heavy cell merging,
  conditional formatting, and embedded screenshots. CSV export flattens
  everything; columns occasionally drift. When a mirror is hard to read,
  open the upstream link from the file's header.
- **Some cells contain inline prose / multi-line notes.** These survive CSV
  export but render as long quoted strings.
- **Numbers stay as strings.** We preserve thousands-separators (`"1,100"`)
  and unit suffixes (`%`, `K`, `M`) exactly as the authors wrote them.

## Refresh procedure

When the upstream sheet is updated:

```bash
node scripts/fetch-community-sheet.mjs
```

This re-fetches every tab listed in the script's `TABS` array, trims empty
columns, and rewrites the per-tab markdown files (the header block updates
the **Last fetched** date automatically). Commit the resulting diff as a
`docs(stfc-knowledge): refresh community sheet mirror` change.

If a tab has been added, renamed, or removed upstream, edit the `TABS` array
first (gids come from the published htmlview at
<https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/htmlview>).

## Related project knowledge

- [`docs/stfc-game-knowledge.md`](../../stfc-game-knowledge.md) — first-party
  STFC reference compiled from official Scopely sources. Use it for canonical
  game terminology; use this directory for community-derived progression and
  crewing data.
