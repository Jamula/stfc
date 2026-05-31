# Skill: Mirror a public Google Sheet into agent-readable docs

**Owner:** Picard (M2/EM) — codified from PR #75 (issue #74)
**First used:** 2026-05-31
**Status:** Active

## When to use

When a request asks us to ingest / mirror / archive a community-maintained Google Sheet (or any public Sheet) into the repo as agent-readable reference material. Use when:

- The upstream is explicitly read-only ("MAKE A COPY" notices, community-curated reference data, official rate sheets, etc.).
- Data is reference-only — not consumed by runtime code in `src/`.
- The sheet has multiple tabs and you want each tab discoverable independently.

Do **not** use this skill for sheets you intend to author or sync bidirectionally — that's a different pattern (Google Sheets API + OAuth) and a different governance conversation.

## Where it lives in the repo

```
docs/<topic>-knowledge/<sheet-name>/
  README.md            # index: tab table, attribution, refresh procedure, limitations
  NN-<tab-slug>.md     # one file per tab (zero-padded number, kebab-case slug)
scripts/
  fetch-<topic>-sheet.mjs   # re-fetch helper (rewrites all per-tab files)
```

Mirrors are docs-time artifacts. **Never** put them under `data/` (that's runtime state). **Never** make them inputs to `src/` modules — that crosses the constitution's durable-inputs enumeration.

## How to fetch all tabs

The `/edit` URL of a Google Sheet does **not** expose its tab list to a `curl` GET. The trick:

1. **`curl` the `/htmlview` URL** instead of `/edit`. The htmlview page embeds a JavaScript `items.push({name, gid})` array in its source that maps every tab name to its gid.

   ```bash
   curl -sL "https://docs.google.com/spreadsheets/d/<SHEET_ID>/htmlview" \
     | grep -oE 'name: "[^"]+", pageUrl: "[^"]+", gid: "[0-9]+"'
   ```

2. **For each gid, fetch CSV via gviz:**

   ```
   https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&gid=<GID>
   ```

   The gviz endpoint always quotes every field, so a minimal RFC 4180 parser suffices (see `scripts/fetch-community-sheet.mjs` for a 30-line implementation).

3. **Trim empty columns whole-column-wise** before writing. Heavily-formatted upstream sheets use merged cells and visual padding; raw CSVs often have ~50% empty columns. Trimming makes the mirror human-scannable while preserving all real data.

4. **Preserve cell formatting** (don't strip `%`, thousand separators, currency symbols). Downstream consumers normalize as they prefer.

## Attribution header pattern → required Lineage block

Per the project's [knowledge-base lineage convention](../../../docs/stfc-knowledge/README.md#lineage-convention--every-ingested-artifact-must-declare-it),
every ingested artifact MUST start with a `## Lineage` markdown table carrying
six fields: **Source URL**, **Source name**, **Author(s) / contributors**,
**Captured on**, **License / attribution requirements**, **Refresh strategy**.

**Generate the block from constants in the fetch script**, never hand-write
it — that guarantees a refresh cannot accidentally drop attribution.

Required structure:

```markdown
# <Tab Name>

## Lineage

| Field | Value |
| --- | --- |
| **Source URL** | <https://docs.google.com/spreadsheets/d/<SHEET>/edit#gid=<GID>> (gid `<GID>`) |
| **Source name** | <SourceWorkbookName> — <Tab Name> tab |
| **Author(s) / contributors** | <semicolon-separated authors> |
| **Captured on** | YYYY-MM-DD |
| **License / attribution requirements** | <human-readable terms + our handling commitment, e.g. "read-only mirror"> |
| **Refresh strategy** | <exact command + how to detect upstream changes> |

> Read-only mirror — **do not modify this file by hand**; your edits will be
> overwritten on the next refresh. The upstream tab contains visual /
> screenshot content (charts, embedded images) that does **not** survive
> CSV export. The block below is the machine-readable subset; consult the
> source URL for full visual context.

## Data (CSV mirror, empty columns trimmed)

```csv
<trimmed CSV>
```
```

This same six-field block applies to **every** ingest source, not just
Sheets. For Discord channels: Source URL = message permalink, Author = handle,
Refresh = re-run Discord ingest script. For blog posts: Source URL = page
anchor, Author = byline, Refresh = re-scrape with the blog's RSS or sitemap.

## Index README requirements

The directory's `README.md` MUST contain:

1. **Its own `## Lineage` block** for the whole source (the workbook as a
   whole, the Discord channel as a whole, etc.) — every per-artifact file
   also carries one for the narrower artifact.
2. **Why mirrored** — explain that the data is reference-only, not runtime,
   so readers don't try to wire it into `src/`.
3. **Tab/artifact table** — markdown table with columns `#`, `Tab/Artifact`,
   `Identifier` (gid, message ID, etc.), `File`. Use the same numbering as
   the file slugs.
4. **Missing-content note** — if the original spec referenced
   tabs/messages/sections not present upstream, document them here with
   instructions for re-adding (which file to edit, where the identifier
   comes from).
5. **Limitations** — call out lost visual content, prose-in-cells, unparsed
   numbers.
6. **Refresh procedure** — the exact command to run.
7. **Related project knowledge** — cross-links to other reference docs and
   to the parent `docs/<topic>-knowledge/README.md` lineage convention.

## Cross-links to add

After writing the mirror:

- Update `README.md` project-layout block to mention the new docs path and the refresh script.
- Update any topic-specific reference doc (e.g. `docs/<topic>-game-knowledge.md`) with a new section pointing to the mirror, distinguishing "first-party / canonical" sources from "community-derived" ones.

## Refresh discipline

- Re-running the fetcher on a green main MUST be a no-op-or-content-only diff (no header churn unless the date changes). Verify by running twice in a row; the second run should produce zero diff if the upstream hasn't changed.
- Commit refreshes as `docs(<topic>-knowledge): refresh community sheet mirror`.
- If a tab is added/removed/renamed upstream, edit the `TABS` array in the fetcher in the **same commit** as the refreshed content.

## What this skill does NOT cover

- **Bidirectional sync** (writing back to the sheet). Out of scope; needs OAuth, secret custody, and a constitution conversation.
- **Schema validation** of the mirrored data. Mirrors are reference-only; consumers parse on demand.
- **CI-scheduled refresh.** Optional follow-up; needs Cyrus's say on CI-minute cost vs. staleness tolerance.
- **OCR of screenshot-heavy tabs.** Visual content gets a "link to upstream" pointer in the header; we don't OCR.

## Example

See `scripts/fetch-community-sheet.mjs` and `docs/stfc-knowledge/community-reference-sheet/` (PR #75) for the canonical implementation.

