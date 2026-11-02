# G5 Scrapping Guide

## Lineage

| Field | Value |
| --- | --- |
| **Source URL** | <https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit#gid=1369248894> (gid `1369248894`) |
| **Source name** | STFC Community Sheet — *Starfleet Academy, Athena & Duo Waves — M90 & M91* — G5 Scrapping Guide tab |
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
G5 SCRAPPING EXPLAINED The Scrap Reward Link Scrapping Unlocked At ,Scrappable FKR G5 Ship ,,Scrap Rewards (If you a scrap a T12 G5 ship) ,,,The Time List of Scrapping Speed Buffs Research Name,Max Buff,Tree,G5 Ship ,,Base Scrap Time ,W/ Max Efficiency ,After Helps ,with exo & helps ,MATH ,Example Payout per day (T12 G6 Epic) with maxxed scrapping eff&helps  see below Type,Needed,Payout,/day
Shipyard L61,,Nova,"= 20% of T12 cost 
of the G5 ship being scrapped","+ 2.5% of T12 cost
of the linked G6 Ship ->",SELKIE,Orbital Scrapping,120%,STATION,,Nova,459,18.7,14.9,8.2,,Σ-Tritanium,33.6M,841.2K,"56,354"
Shipyard L63,,VOR'CHA,,,NEGH'VAR,Prime Junking Speed,200%,GALAXY,,VOR'CHA,585,23.8,19.0,10.5,,Σ-Dilithium,282.0K,7.1K,371
Shipyard L63,,CORVUS,,,MINERVA,Prime Agile Scrapping,100%,GALAXY,,CORVUS,585,23.8,19.0,10.5,MATH,6★ Common Refined Gas,245.8K,6.1K,323
Shipyard L63,,U.S.S. NORTHCUTT,,,U.S.S. AKIRA,Apex Chop Shop,50%,OUTLAW,,U.S.S. NORTHCUTT,585,23.8,19.0,10.5,,6★ Common Refined Crystal,1.1M,27.1K,"1,425"
Shipyard L66,,QUV'SOMPEK,,,KOS'KARII,Dismantle Tinkering,80%,STARSHIPS,,QUV'SOMPEK,846,34.4,27.5,15.1,,6★ Common Interceptor Parts,2.2M,55.2K,"2,006"
Shipyard L66,,SANCTUS,,,VELOX,Efficient Recycling,150%,EX-BORG FAVORS,,SANCTUS,846,34.4,27.5,15.1,,6★ Uncommon Refined Gas,60.4K,1.5K,55
Shipyard L66,,U.S.S. CROZIER,,,U.S.S. TITAN,Ω Rapid Scrapping,180%,MIRROR,,U.S.S. CROZIER,846,34.4,27.5,15.1,,6★ Uncommon Refined Crystal,305.1K,7.6K,277
Shipyard L68,,MOW'GA,,,GRISHNAR,Phoenix Thruster,250%,ARTIFACT,,MOW'GA,963,39.1,31.3,17.2,,6★ Uncommon Interceptor Parts,613.1K,15.3K,489
Shipyard L68,,VRAX,,,DIVITAE,Transogen Forge (L70),300%,BUILDING,,VRAX,963,39.1,31.3,17.2,MATH,6★ Rare Refined Gas,13.5K,0.3K,11
Shipyard L68,,U.S.S. BEATTY,,,U.S.S. NEWGRANGE,Scrapyard (L70),330%,BUILDING,,U.S.S. BEATTY,963,39.1,31.3,17.2,,6★ Rare Refined Crystal,71.6K,1.8K,57
Shipyard L70,,ROTARRAN,,,KRENCHA,Syndicate (L63+),450%,SYNDICATE,,ROTARRAN,1080,43.9,35.1,19.3,,6★ Rare Interceptor Parts,33.4K,0.8K,24
Shipyard L70,,D'DERIDEX,,,SCIMITAR,Emerald Chain (L8+),150%,EMER. CHAIN,,D'DERIDEX,1080,43.9,35.1,19.3,,,,,
Shipyard L70,,U.S.S. ENTERPRISE-D,,,U.S.S. ENTERPRISE-E,TOTAL Scrap Speed Bonus,"2,360%",4.07%,,U.S.S. ENTERPRISE-D,1080,43.9,35.1,19.3,,Example eff used,,,
Tips to increase payout,,,,,,Tool to help you understand YOUR efficiencies,,,,,,,,,MATH,Resource,,,
,,,,,,,,,,,,,,,,Σ-TritaniumΣ-Tritanium,,,5245%
"Buffs that can be unselected, unseated or disabled",,,,,,So you can estimate your payout when increasing/decreasing specific buffs,,,,,,,,,,Σ-DilithiumΣ-Dilithium,,,4790%
,,,,,,,,,,,,,,,,6★ Common Refined Gas6★ Common Refined Gas,,,4070%
,,,,,,,,,,,,,,,,6★ Common Refined Crystal6★ Common Refined Crystal,,,4130%
,,,,,,,,,,,,,,,,6★ Common Interceptor Parts6★ Common Interceptor Parts,,,4270%
,,,,,,,,,,,,,,,MATH,6★ Uncommon Refined Gas6★ Uncommon Refined Gas,,,4070%
FC Lorca,,,FC Seven of Nine,FC Kirk,TC: Saldetti or Thosz,,,,,,,,,,,6★ Uncommon Refined Crystal6★ Uncommon Refined Crystal,,,4130%
,,,,,,,,,,,,,,,,6★ Uncommon Interceptor Parts6★ Uncommon Interceptor Parts,,,4270%
,,,,,,,,,,,,,,,,6★ Rare Refined Gas6★ Rare Refined Gas,,,4070%
,,,,,,,,,,,,,,,,6★ Rare Refined Crystal6★ Rare Refined Crystal,,,4130%
,,,,,,,,,,,,,,,,6★ Rare Interceptor Parts6★ Rare Interceptor Parts,,,4270%
,,,,,,,,,,,,,,,MATH,,,,
,,,,,,https://next.spocks.club/,,,,,,,,,,U.S.S. NORTHCUTT,,,
,,,,,,,,,,,,,,,,Σ-Tritanium,19.9M,498.3K,"26,190"
,,,,,,,,,,,,,,,,Σ-Dilithium,169.0K,4.2K,222
,,,,,,,,,,,,,,,,6★ Common Refined Gas,158.3K,4.0K,208
,,,,,,,,,,,,,,,,6★ Common Refined Crystal,686.8K,17.2K,903
,,,,,,,,,,,,,,,MATH,6★ Common Interceptor Parts,1.5M,37.2K,"1,955"
,,,,,,,,,,,,,,,,6★ Uncommon Refined Gas,38.9K,1.0K,51
,,,,,,,,,,,,,,,,6★ Uncommon Refined Crystal,193.2K,4.8K,254
,,,,,,,,,,,,,,,,6★ Uncommon Interceptor Parts,413.6K,10.3K,544
,,,,,,,,,,,,,,,,6★ Rare Refined Gas,8.7K,0.2K,11
,,,,,,,,,,,,,,,,6★ Rare Refined Crystal,45.4K,1.1K,60
,,,,,,,,,,,,,,,MATH,6★ Rare Interceptor Parts,22.6K,0.6K,30
,,,,,,,,,,,,,,,,Σ-Tritanium,,,4595%
,,,,,,,,,,,,,,,,Σ-Dilithium,,,4140%
,,,,,,,,,,,,,,,,6★ Common Refined Gas,,,3420%
,,,,,,,,,,,,,,,,6★ Common Refined Crystal,,,3440%
,,,,,,,,,,,,,,,MATH,6★ Common Interceptor Parts,,,3470%
,,,,,,,,,,,,,,,,6★ Uncommon Refined Gas,,,3420%
,,,,,,,,,,,,,,,,6★ Uncommon Refined Crystal,,,3440%
,,,,,,,,,,,,,,,,6★ Uncommon Interceptor Parts,,,3470%
,,,,,,,,,,,,,,,,6★ Rare Refined Gas,,,3420%
,,,,,,,,,,,,,,,,6★ Rare Refined Crystal,,,3440%
,,,,,,,,,,,,,,,,6★ Rare Interceptor Parts,,,3470%
```
