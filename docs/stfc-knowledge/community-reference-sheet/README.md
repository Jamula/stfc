# Community STFC Reference Sheet — Source Links

This directory links to the community-maintained Google Sheet
[*Starfleet Academy, Athena & Duo Waves — M90 & M91*][upstream].
It contains **no sheet data, excerpts, screenshots, or calculators**.
Existing per-tab paths remain as link-only stubs so older local references
still lead readers to the original source.

[upstream]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit

## Lineage

| Field | Value |
| --- | --- |
| **Source URL** | <https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit> |
| **Source name** | STFC Community Sheet — *Starfleet Academy, Athena & Duo Waves — M90 & M91* (whole workbook) |
| **Author(s) / contributors** | Previously recorded attribution: JulesVern; Quasel; BlueMandalorian; STFC Officer Tool Discord `#data-collection` community ([invite](https://discord.gg/BRhru6Vcnj)). This is attribution metadata, not confirmation of ownership or permission. |
| **Captured on** | Not applicable — source links only. Previous snapshots were recorded as captured on 2026-11-02 (UTC) and removed from the current tree on 2026-11-14 (UTC). |
| **License / attribution requirements** | Redistribution permission has not been established. Public availability, attribution, read-only access, and an instruction to make a copy of a calculator do not establish permission to redistribute the workbook. Consult the original source and its contributors for applicable terms. |
| **Refresh strategy** | Check the original workbook for current tabs and content; manually update source links only. The former `node scripts/fetch-community-sheet.mjs` command is disabled and exits with an error before fetching or writing. |

## Original tabs

These names and gids come from the previous repository provenance, not a
new capture. Upstream tabs may have changed; use the workbook if a deep-link
is no longer available.

| # | Tab | Original source | Local link stub |
| -: | --- | --- | --- |
| 01 | Intro | [Open tab][tab01] | [01-intro.md](./01-intro.md) |
| 02 | SF Academy Building | [Open tab][tab02] | [02-sf-academy-building.md](./02-sf-academy-building.md) |
| 03 | Refinery | [Open tab][tab03] | [03-refinery.md](./03-refinery.md) |
| 04 | Athena | [Open tab][tab04] | [04-athena.md](./04-athena.md) |
| 05 | Duo Wave Defense | [Open tab][tab05] | [05-duo-wave-defense.md](./05-duo-wave-defense.md) |
| 06 | System Map | [Open tab][tab06] | [06-system-map.md](./06-system-map.md) |
| 07 | Credit Calculator | [Open tab][tab07] | [07-credit-calculator.md](./07-credit-calculator.md) |
| 08 | Crews — Academy Drones | [Open tab][tab08] | [08-crews-academy-drones.md](./08-crews-academy-drones.md) |
| 09 | Independent Archives (M91) | [Open tab][tab09] | [09-independent-archives-m91.md](./09-independent-archives-m91.md) |
| 10 | G5 Scrapping Guide | [Open tab][tab10] | [10-g5-scrapping-guide.md](./10-g5-scrapping-guide.md) |
| 11 | Critical Damage Mitigation | [Open tab][tab11] | [11-critical-damage-mitigation.md](./11-critical-damage-mitigation.md) |

[tab01]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1563749702
[tab02]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=556376347
[tab03]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=508132113
[tab04]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1243592063
[tab05]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=119341188
[tab06]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1549666316
[tab07]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=744753634
[tab08]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1770071728
[tab09]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1778790882
[tab10]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1369248894
[tab11]: https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1179953085

## Effect on readers and tooling

There is no local CSV dataset to parse. Open the source links for progression
numbers, crewing advice, charts, and calculator use under the upstream terms.
Do not treat a link stub as an empty dataset or recreate the mirrors.
The gift-redeemer runtime does not read this directory.

The authored [game knowledge reference](../../stfc-game-knowledge.md) remains;
its community-sheet section now points here for links instead of local data.
The dependent crew retrieval cache is rebuilt to remove obsolete mirroring
and refresh instructions; it does not ingest this directory.

## Rights and history remain unresolved

This replacement implements the user's selected path for
[issue #402](https://github.com/Jamula/stfc/issues/402). It does not establish
code ownership, change `LICENSE`, certify other third-party material, or
authorize publication. Previous mirrors remain in Git history; history
acceptance and any separately authorized remediation require a rights-holder
decision. No history was rewritten. Issue #402 remains open as a release gate.
