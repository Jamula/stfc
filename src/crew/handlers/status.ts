import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import { loadOfficerDatabase } from "../database.ts";
import { loadRoster } from "../roster.ts";
import { evaluateStaleness } from "../staleness.ts";

const DEFAULT_OFFICERS_PATH = path.join("data", "crew", "officers.json");
const DEFAULT_ROSTER_DIR = path.join("data", "crew", "roster");
const MAX_DISCORD_CHARS = 1900;
const TRUNCATION_FOOTER = "\n\n_…output truncated to 1900 chars; narrow the query for full details._";

export async function handleStatus(cmd: CrewCommand): Promise<string> {
  if (cmd.args._0) {
    throw new Error("Usage: `!crew status --account <name>`.");
  }

  const account = await requireAccount(cmd);
  const officersPath = process.env.STFC_OFFICERS_PATH ?? DEFAULT_OFFICERS_PATH;
  const rosterDir = process.env.STFC_ROSTER_DIR ?? DEFAULT_ROSTER_DIR;

  const [database, roster] = await Promise.all([
    loadOfficerDatabase(officersPath),
    loadRoster(path.join(rosterDir, `${account}.yaml`)),
  ]);

  const staleness = evaluateStaleness(roster);
  const ownedCount = roster.officers.filter((entry) => entry.owned).length;
  const unownedCount = roster.officers.length - ownedCount;
  const unknownOfficerIds = roster.officers
    .map((entry) => entry.id)
    .filter((id) => !database.byId.has(id))
    .sort();

  const lines: string[] = [
    `**Crew status — ${account}**`,
    `- last updated: \`${roster.last_updated}\``,
    `- staleness: **${staleness.level}** (${staleness.days}d)`,
    `- staleness note: ${staleness.message}`,
    `- officers: total ${roster.officers.length} (owned ${ownedCount}, unowned ${unownedCount})`,
    `- unknown officer ids: ${unknownOfficerIds.length > 0 ? unknownOfficerIds.join(", ") : "none"}`,
    "",
    "```text",
    "id                 owned  level  rank  promotions",
    "-----------------  -----  -----  ----  ----------",
    ...roster.officers.map((entry) =>
      entry.owned
        ? `${entry.id.padEnd(17)}  yes    ${String(entry.level).padStart(5)}  ${String(entry.rank).padStart(4)}  ${String(entry.promotions).padStart(10)}`
        : `${entry.id.padEnd(17)}  no     ${"-".padStart(5)}  ${"-".padStart(4)}  ${"-".padStart(10)}`,
    ),
    "```",
  ];

  return truncateForDiscord(lines.join("\n"));
}

async function requireAccount(cmd: CrewCommand): Promise<string> {
  const raw = cmd.args.account?.trim();
  if (raw && raw !== "true") return raw;

  if (raw === "true") {
    throw new Error("Flag `--account` requires a value. Example: `--account main`.");
  }

  const rosterDir = process.env.STFC_ROSTER_DIR ?? DEFAULT_ROSTER_DIR;
  const discovered = await discoverRosterFiles(rosterDir);
  const list = discovered.length > 0 ? discovered.join(", ") : `(none in ${rosterDir})`;
  throw new Error(`Missing required --account <name>. Discovered roster files: ${list}.`);
}

async function discoverRosterFiles(rosterDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rosterDir);
    return entries.filter((name) => name.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
}

function truncateForDiscord(markdown: string): string {
  if (markdown.length <= MAX_DISCORD_CHARS) return markdown;
  const keep = Math.max(0, MAX_DISCORD_CHARS - TRUNCATION_FOOTER.length);
  return `${markdown.slice(0, keep)}${TRUNCATION_FOOTER}`;
}
