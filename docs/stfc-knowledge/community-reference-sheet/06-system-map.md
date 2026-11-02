# System Map

## Lineage

| Field | Value |
| --- | --- |
| **Source URL** | <https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1549666316> (gid `1549666316`) |
| **Source name** | STFC Community Sheet — *Starfleet Academy, Athena & Duo Waves — M90 & M91* — System Map tab |
| **Author(s) / contributors** | JulesVern; Quasel; BlueMandalorian; STFC Officer Tool Discord `#data-collection` channel |
| **Captured on** | 2026-11-02 |
| **License / attribution requirements** | Community-maintained reference. Upstream says **"MAKE A COPY"** for any use of the calculators; we mirror read-only. Preserve the author list above on every quote or excerpt; link back to the source URL. We do **not** modify the upstream sheet — contributions go through the authors via the Discord channel: https://discord.gg/BRhru6Vcnj |
| **Refresh strategy** | Re-fetch via the public gviz CSV endpoint per tab: `node scripts/fetch-community-sheet.mjs` from the repo root rewrites every per-tab mirror and updates **Captured on**. If the upstream adds/renames/removes tabs, update the `TABS` array in that script first (gids come from the published `/htmlview` URL). |

> Read-only mirror — **do not modify this file by hand**; your edits will be
> overwritten on the next refresh. The upstream tab contains visual /
> screenshot content (charts, embedded images) that does **not** survive
> CSV export. The block below is the machine-readable subset; consult the
> source URL for full visual context.

## Data (CSV mirror, empty columns trimmed)

```csv
"Academy Drone 
System Map",,,Token Systems,,,,,,,,,,,,,,,,,,,,
,,,Training Merits (Loot),,,All Hostiles,,,,,"# of Hostiles for 1 chest
Using lower ops within bracket",,,,,,,,,,,200%,
System Name,,,Grade,,,,,Crit Damage,Crit Floor,,Ops Range,,,,,,,,,,,,
Itraneia,900,61,6★,5,10,,"1,000%","5,000%","5,000%","1,000%",61 - 61,6★,100,,,,,,,,,,
Tegawa,"1,000",62,6★,20,40,,,,,,62 - 63,6★,400,,,80,20,120,,,27,7,40
Nupuqep,"1,100",63,6★,40,80,,,,,,64 - 65,6★,"1,600",320,80,40,20,120,107,27,13,7,40
Zhroix,"1,200",64,6★,80,160,,,,,,66 - 67,6★,"6,000",150,75,38,20,120,50,25,13,7,40
Thalamph,"1,250",65,6★,160,320,,,,,,68 - 69,6★,"24,000",150,80,40,20,120,50,27,13,7,40
Dreitr,"1,300",66,6★,300,600,,,,,,70 - 70,6★,"95,000",158,79,40,20,119,53,26,13,7,40
Aewia,"1,400",67,6★,600,"1,200",,,,,,71 - 72,7★,400,180,90,45,20,120,60,30,15,7,40
Heratcha,"1,500",68,6★,"1,200","2,400",,,,,,73 - 74,7★,"1,500",169,75,38,19,113,56,25,13,6,38
Sonum,"1,550",69,6★,"2,400","4,800",,,Interceptor,Battleship,,?? - ??,7★,"6,000",,,,,,,,,,
Caphonus,"1,550",70,6★,"4,800","9,600",,,Apex Shred,Apex Barrier,,?? - ??,7★,,,,,,,,,,,
Phemeon,"1,550",71,7★,20,40,,,50%,"10,000",,?? - ??,7★,,,,,,,,,,,
Miyoad,"1,600",72,7★,40,80,,,,,,*Red indicates using the 6★ > 7★ conversion chest,,,,,,,,,,,,
Byrii,"2,100",73,7★,80,160,,,,,,,,,,,,,,,,,,
Rignala,"3,000",74,7★,160,320,,,,,,,,,,,,,,,,,,
Diyeoie,"3,500",75,7★,320,640,,,,,,,,,,,,,,,,,,
N'Dvoh,"4,000",76,7★,640,"1,280",,,,,,,,,,,,,,,,,,
Xeaij,"4,500",77,7★,"1,280","2,560",,,,,,,,,,,,,,,,,,
Fazox,"5,000",78,7★,"2,560","5,120",,,,,,,,,,,,,,,,,,
Ekokaron,"5,500",79,7★,"5,120","10,240",,,,,,,,,,,,,,,,,,
Yirohef,"6,000",80,7★,"10,240","20,480",,,,,,,,,,,,,,,,,,
"By: JulesVern, Quasel, BlueMandalorian and the STFC community",,,,,,,,,,,,,,,,,,,,,,,
"Venari Ral
System Map",,,Token Systems,,,,,,,,,,,,,,,,,,,,
,,,Pledges of the Venari (Loot),,,,,,Venari Ral Abilities,,"# of Hostiles for 1 chest
Hitting 'Expected level'*",,,,,,,,,,,,
System Name,,,Low,,,,,,Crit Chance,,Tier,Ops Lock,,,,,,,,,,,
Zehux,900,61,4,5,5,,17,,"1,000%","5,000%",1,61,150,350,61,,,,,,,,
Patovef,"1,000",62,7,10,9,,32,,,,2,,150,350,62,,,,,,,,
Ngeugwa,"1,100",63,13,17,15,,43,All Hostiles,Crit Floor,,3,,810,"1,890",64,,,,,,,,
Xesotuf,"1,200",64,23,29,26,,73,,"5,000%","1,000%",4,66,810,"1,890",65,,,,,,,,
Bieatep,"1,250",65,40,59,50,,169,,,,5,,"4,200","9,800",67,,,,,,,,
Hozog,"1,300",66,65,94,80,,224,,Programmable Matter,,6,,"4,200","9,800",68,,,,,,,,
Kriya'Oh,"1,400",67,112,165,139,,385,,"On round start, this hostile reduces the final damage done by player weapons by 99%, and completely drains your shields for 1 round.

On Combat start it also applies 10% Hyperthermic Decay to the players hull on the first round.

Athena deactivates this ability.",,7,,23.1K,53.9K,70,,,,,,,,
Galup-Ta,"1,500",68,226,298,262,,850,,,,8,71,23.1K,53.9K,71,,,,,,,,
Vuvicag,"1,550",69,369,517,443,,"1,205",,,,9,,78K,182K,72,,,,,,,,
Meeoden,"1,550",70,616,918,767,,"2,369",,,,10,,78K,182K,73,,,,,,,,
Vaxaqus,"1,550",71,"1,214","1,792","1,503",,"5,056",,,,11,,240K,560K,74,,,,,,,,
Koitera,"1,600",72,"2,082","2,974","2,528",,"7,753",,,,12,,240K,560K,75,,,,,,,,
Gehad,"2,100",73,"4,185","5,161","4,673",,"13,830",,,,13,76,,,76,,,,,,,,
Resuhel,"3,000",74,"6,687","9,598","8,143",,"28,710",,,,14,,,,78,,,,,,,,
Yagnatis,"3,500",75,"11,280","16,920","14,100",,"42,300",,,,15,,,,80,,,,,,,,
Fihox,"4,000",76,"19,680","29,520","24,600",,"73,800",,,,*Jules made this up. Not game design.,,,,,,,,,,,,
Rannudis,"4,500",77,"34,480","51,720","43,100",,"129,300",,,,,,,,,,,,,,,,
Caooup,"5,500",78,"60,320","90,480","75,400",,"226,200",,,,,,,,,,,,,,,,
Dellatarda,"5,500",79,"105,520","158,280","131,900",,"395,700",,,,,,,,,,,,,,,,
Xiavis,"6,000",80,"184,720","277,080","230,900",,"692,700",,,,,,,,,,,,,,,,
```
