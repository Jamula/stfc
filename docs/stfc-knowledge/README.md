# STFC Knowledge Base

Reference material about *Star Trek Fleet Command* (STFC) that the project's
agents and human contributors use as context. Nothing in this directory is
consumed by `src/` at runtime — it's docs-time reference only.

## Third-party rights

Use links to original sources when redistribution permission is not
established. Public access, attribution, bot access, and read-only capture
do not establish that permission. Do not ingest or recreate mirrors without
verified reuse terms and the applicable authorization. The community sheet
is now link-only under [#402](https://github.com/Jamula/stfc/issues/402);
previous copies remain in history, and the issue's release gate remains open.

## Lineage convention — every ingested artifact MUST declare it

Per the standing directive (2026-05-31), **every ingested artifact in this
knowledge base carries a `## Lineage` block at the top** with six required
fields. This applies to source-link stubs and any separately authorized
snapshots or excerpts. Link-only records must say that no content was captured.

| Field | What it captures | Example |
| --- | --- | --- |
| **Source URL** | Deep-link to the specific resource, as narrow as the source supports (gid for a Sheet tab, message permalink for a Discord post, anchor for a blog section). | `https://docs.google.com/.../edit#gid=1243592063` |
| **Source name** | Human-readable identifier of the source AND the specific artifact within it. | `STFC Community Sheet — Athena tab` |
| **Author(s) / contributors** | Named individuals or communities responsible for the upstream content. | `JulesVern; Quasel; BlueMandalorian; STFC Discord #data-collection` |
| **Captured on** | ISO date (YYYY-MM-DD) for an authorized snapshot, or an explicit link-only status. | `Not applicable — source link only` |
| **License / attribution requirements** | Verified reuse terms and their evidence, or an explicit statement that permission is unestablished. Attribution is not permission. | `Redistribution permission not established; link only` |
| **Refresh strategy** | How to maintain links; capture instructions only when reuse is verified and authorized. | `Check the original source and update the link manually` |

Render the lineage as a markdown table directly under the H1 heading. Where
possible, **generate the block from constants in your ingest script** so a
refresh cannot accidentally drop attribution.

## What's here today

| Sub-directory | Source kind | Index |
| --- | --- | --- |
| [`community-reference-sheet/`](./community-reference-sheet/README.md) | Public Google Sheet (source links only) | 11 per-tab link stubs for *Starfleet Academy, Athena & Duo Waves — M90 & M91*; no local data |
| [`ops-progression/`](./ops-progression/README.md) | Community workbook and related sources (links only) | Ops progression and G4 gas source links; no local data |
| [`discord-channels/`](./discord-channels/README.md) | Discord channel snapshots (bot REST API) | STFC Officer Tool `#data-collection` — no content ingested; access not verified (see README) |

## Adding a new source

1. Pick a sub-directory name that names the **source**, not the topic. Good:
   `community-reference-sheet/`, `officer-tool-discord-codes-channel/`,
   `stfc-space-database-snapshot/`. Bad: `academy-data/`, `crews/`.
2. Record source overview, factual attribution, reuse evidence (or its
   absence), link-maintenance procedure, limitations, and tab/file index.
3. Prefer source-link stubs; each file **must** start with the six-field
   `## Lineage` block. Capture content only after reuse terms are verified
   and the applicable authorization is obtained.
4. For a separately authorized capture, put any ingest script under `scripts/fetch-<source>.ts`
   and have it generate the lineage block from constants. Re-running the
   script on unchanged upstream should be a content-only diff (no header
   churn except the **Captured on** date).
5. Update this README's "What's here today" table.
6. Cross-link from `docs/stfc-game-knowledge.md` (or another relevant
   first-party doc) so the new source is discoverable.

## What this knowledge base is NOT

- **Not runtime data.** Nothing here is read by `src/` at runtime. Runtime
  state lives under `data/` and is enumerated in the constitution's durable
  inputs list.
- **Not bidirectionally synced.** Source links and authorized captures never write back to any
  upstream. If you need to author or co-edit a source, that's a different
  pattern with different governance (OAuth, secret custody, etc.).
- **Not authoritative.** Sources can drift, contradict each other, or be
  outdated. The lineage block tells you who said it, when, and how to check.
  Cross-reference before treating any single source as ground truth.
