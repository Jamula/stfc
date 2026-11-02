# STFC Knowledge Base

Reference material about *Star Trek Fleet Command* (STFC) that the project's
agents and human contributors use as context. Nothing in this directory is
consumed by `src/` at runtime — it's docs-time reference only.

## Lineage convention — every ingested artifact MUST declare it

Per the standing directive (2026-05-31), **every ingested artifact in this
knowledge base carries a `## Lineage` block at the top** with six required
fields. This applies to per-tab sheet mirrors, Discord channel snapshots,
forum/blog excerpts, and any future sources we ingest.

| Field | What it captures | Example |
| --- | --- | --- |
| **Source URL** | Deep-link to the specific resource, as narrow as the source supports (gid for a Sheet tab, message permalink for a Discord post, anchor for a blog section). | `https://docs.google.com/.../edit#gid=1243592063` |
| **Source name** | Human-readable identifier of the source AND the specific artifact within it. | `STFC Community Sheet — Athena tab` |
| **Author(s) / contributors** | Named individuals or communities responsible for the upstream content. | `JulesVern; Quasel; BlueMandalorian; STFC Discord #data-collection` |
| **Captured on** | ISO date (YYYY-MM-DD) the snapshot was taken. Refreshes update this. | `2026-05-31` |
| **License / attribution requirements** | Any restrictions on use, attribution requirements, and our handling commitment (e.g. "read-only mirror, never modify upstream"). | `Community-maintained; preserve author list; never modify upstream` |
| **Refresh strategy** | Concrete recipe for re-capturing this artifact, including any tooling and where to find changes (new tabs, new messages). | `node scripts/fetch-community-sheet.mjs` |

Render the lineage as a markdown table directly under the H1 heading. Where
possible, **generate the block from constants in your ingest script** so a
refresh cannot accidentally drop attribution.

## What's here today

| Sub-directory | Source kind | Index |
| --- | --- | --- |
| [`community-reference-sheet/`](./community-reference-sheet/README.md) | Public Google Sheet (read-only mirror) | 11 per-tab mirrors of *Starfleet Academy, Athena & Duo Waves — M90 & M91* |
| [`discord-channels/`](./discord-channels/README.md) | Discord channel snapshots (bot REST API) | STFC Officer Tool `#data-collection` — no content ingested; access not verified (see README) |

## Adding a new source

1. Pick a sub-directory name that names the **source**, not the topic. Good:
   `community-reference-sheet/`, `officer-tool-discord-codes-channel/`,
   `stfc-space-database-snapshot/`. Bad: `academy-data/`, `crews/`.
2. Add a sub-directory `README.md` with: source overview, attribution block,
   refresh procedure, limitations, tab/file index.
3. Write per-artifact files (one per tab / per channel / per snapshot). Each
   file **must** start with the six-field `## Lineage` block.
4. If you need an ingest script, put it under `scripts/fetch-<source>.mjs`
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
- **Not bidirectionally synced.** We only ingest; we never write back to any
  upstream. If you need to author or co-edit a source, that's a different
  pattern with different governance (OAuth, secret custody, etc.).
- **Not authoritative.** Sources can drift, contradict each other, or be
  outdated. The lineage block tells you who said it, when, and how to check.
  Cross-reference before treating any single source as ground truth.
