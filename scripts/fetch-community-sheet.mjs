#!/usr/bin/env node
// DISABLED under issue #402: redistribution permission is unestablished.
// Use the source-link index in docs/stfc-knowledge/community-reference-sheet/.
// The original authored implementation below is retained, but main refuses
// to fetch or write. Public availability is not redistribution permission.
//
// Former purpose: re-fetch the community STFC reference sheet (Academy/Athena/Duo Waves)
// and rewrite each tab's mirror file under
// docs/stfc-knowledge/community-reference-sheet/.
//
// The upstream sheet is READ-ONLY for us; this script only fetches public CSV
// exports via the gviz endpoint, trims empty columns, and writes a markdown
// file per tab with a stable header (attribution + source URL + fetch date)
// followed by a fenced CSV block. Run from repo root:
//
//     node scripts/fetch-community-sheet.mjs
//
// If a tab is added/removed/renamed upstream, update the TABS array below
// (gids come from https://docs.google.com/spreadsheets/d/<SHEET>/htmlview).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SHEET = "19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit`;
const OUT_DIR = "docs/stfc-knowledge/community-reference-sheet";

const ATTRIBUTION_LINES = [
  "JulesVern",
  "Quasel",
  "BlueMandalorian",
  "STFC Officer Tool Discord `#data-collection` channel",
];
const DISCORD_INVITE = "https://discord.gg/BRhru6Vcnj";

const TABS = [
  { gid: "1563749702", name: "Intro",                       slug: "01-intro" },
  { gid: "556376347",  name: "SF Academy Building",         slug: "02-sf-academy-building" },
  { gid: "508132113",  name: "Refinery",                    slug: "03-refinery" },
  { gid: "1243592063", name: "Athena",                      slug: "04-athena" },
  { gid: "119341188",  name: "Duo Wave Defense",            slug: "05-duo-wave-defense" },
  { gid: "1549666316", name: "System Map",                  slug: "06-system-map" },
  { gid: "744753634",  name: "Credit Calculator",           slug: "07-credit-calculator" },
  { gid: "1770071728", name: "Crews - Academy Drones",      slug: "08-crews-academy-drones" },
  { gid: "1778790882", name: "Independent Archives (m91)",  slug: "09-independent-archives-m91" },
  { gid: "1369248894", name: "G5 Scrapping Guide",          slug: "10-g5-scrapping-guide" },
  { gid: "1179953085", name: "Critical Damage Mitigation",  slug: "11-critical-damage-mitigation" },
];

// Minimal RFC 4180 CSV parser sufficient for the gviz output, which always
// quotes every field. Returns an array of rows (each row an array of cells).
function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* ignore */ }
      else { field += ch; }
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function trimEmptyColumns(rows) {
  if (!rows.length) return rows;
  const width = Math.max(...rows.map((r) => r.length));
  const keep = [];
  for (let c = 0; c < width; c++) {
    let hasContent = false;
    for (const r of rows) {
      if ((r[c] ?? "").trim() !== "") { hasContent = true; break; }
    }
    if (hasContent) keep.push(c);
  }
  return rows.map((r) => keep.map((c) => r[c] ?? ""));
}

function trimEmptyTrailingRows(rows) {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => (c ?? "").trim() === "")) end--;
  return rows.slice(0, end);
}

function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (s.includes('"') || s.includes(",") || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(","),
    )
    .join("\n");
}

function header(tab, fetchedDate) {
  const tabUrl = `${SHEET_URL}#gid=${tab.gid}`;
  const sourceName =
    `STFC Community Sheet — *Starfleet Academy, Athena & Duo Waves — M90 & M91* — ${tab.name} tab`;
  return [
    `# ${tab.name}`,
    "",
    "## Lineage",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| **Source URL** | <${tabUrl}> (gid \`${tab.gid}\`) |`,
    `| **Source name** | ${sourceName} |`,
    `| **Author(s) / contributors** | ${ATTRIBUTION_LINES.join("; ")} |`,
    `| **Captured on** | ${fetchedDate} |`,
    `| **License / attribution requirements** | Community-maintained reference. Upstream says **"MAKE A COPY"** for any use of the calculators; we mirror read-only. Preserve the author list above on every quote or excerpt; link back to the source URL. We do **not** modify the upstream sheet — contributions go through the authors via the Discord channel: ${DISCORD_INVITE} |`,
    `| **Refresh strategy** | Re-fetch via the public gviz CSV endpoint per tab: \`node scripts/fetch-community-sheet.mjs\` from the repo root rewrites every per-tab mirror and updates **Captured on**. If the upstream adds/renames/removes tabs, update the \`TABS\` array in that script first (gids come from the published \`/htmlview\` URL). |`,
    "",
    "> Read-only mirror — **do not modify this file by hand**; your edits will be",
    "> overwritten on the next refresh. The upstream tab contains visual /",
    "> screenshot content (charts, embedded images) that does **not** survive",
    "> CSV export. The block below is the machine-readable subset; consult the",
    "> source URL for full visual context.",
    "",
    "## Data (CSV mirror, empty columns trimmed)",
    "",
    "```csv",
  ].join("\n");
}

function footer() {
  return ["```", ""].join("\n");
}

async function main() {
  throw new Error(
    "Community sheet mirroring is disabled (#402): redistribution permission has not been established. " +
    `Open the original source: ${SHEET_URL}. ` +
    "See docs/stfc-knowledge/community-reference-sheet/README.md; no data was fetched or written.",
  );

  await mkdir(OUT_DIR, { recursive: true });
  const fetchedDate = new Date().toISOString().slice(0, 10);
  const summary = [];

  for (const tab of TABS) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&gid=${tab.gid}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${tab.name} (gid=${tab.gid}): HTTP ${res.status}`);
    const raw = await res.text();
    const rows = trimEmptyTrailingRows(trimEmptyColumns(parseCsv(raw)));
    const body = header(tab, fetchedDate) + "\n" + toCsv(rows) + "\n" + footer();
    const outPath = join(OUT_DIR, `${tab.slug}.md`);
    await writeFile(outPath, body);
    summary.push({ name: tab.name, rows: rows.length, cols: rows[0]?.length ?? 0, path: outPath });
    console.error(`wrote ${outPath} (${rows.length} rows × ${rows[0]?.length ?? 0} cols)`);
  }

  console.error("\nDone. Tabs written:");
  for (const s of summary) console.error(`  ${s.name}: ${s.rows}×${s.cols} → ${s.path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
