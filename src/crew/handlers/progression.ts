import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import { loadOfficerDatabase } from "../database.ts";
import { analyzeProgression } from "../progression.ts";
import { loadRoster } from "../roster.ts";
import { evaluateStaleness } from "../staleness.ts";

const DEFAULT_OFFICERS_PATH = path.join("data", "crew", "officers.json");
const DEFAULT_ROSTER_DIR = path.join("data", "crew", "roster");
const MAX_DISCORD_CHARS = 1900;
const TRUNCATION_FOOTER = "\n\n_…output truncated to 1900 chars; narrow the query for full details._";

export async function handleProgression(cmd: CrewCommand): Promise<string> {
  if (cmd.args._0) {
    throw new Error("Usage: `!crew progression --account <name>`.");
  }

  const account = await requireAccount(cmd);
  const officersPath = process.env.STFC_OFFICERS_PATH ?? DEFAULT_OFFICERS_PATH;
  const rosterDir = process.env.STFC_ROSTER_DIR ?? DEFAULT_ROSTER_DIR;

  const [database, roster] = await Promise.all([
    loadOfficerDatabase(officersPath),
    loadRoster(path.join(rosterDir, `${account}.yaml`)),
  ]);

  const staleness = evaluateStaleness(roster);
  const report = analyzeProgression({ database, roster });

  const lines: string[] = [
    `**Crew progression — ${account}**`,
    `- staleness: **${staleness.level}** (${staleness.days}d)`,
    `- owned officers needing work: ${report.under_leveled_owned.length}`,
    `- high-value missing officers: ${report.missing_high_value.length}`,
    "",
    "### Promotion order",
  ];

  if (report.suggested_promotion_order.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of report.suggested_promotion_order) {
      lines.push(
        `- **${entry.officer_id}** — priority ${entry.priority_score.toFixed(2)}; L${entry.current.level} R${entry.current.rank} P${entry.current.promotions}; ${entry.rationale}`,
      );
    }
  }

  lines.push("", "### Missing high-value officers");
  if (report.missing_high_value.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of report.missing_high_value) {
      lines.push(
        `- **${entry.officer_id}** — priority ${entry.priority_score.toFixed(2)}; classes: ${entry.top_task_classes.join(", ") || "none"}; synergy: ${entry.synergy_with_owned.join(", ") || "none"}`,
      );
    }
  }

  lines.push("", "### Task-class gaps");
  for (const gap of report.task_class_gaps) {
    lines.push(
      `- **${gap.task_class}** — owned coverage ${gap.covered_by_owned}; missing high-value ${gap.missing_high_value}; top missing: ${gap.top_missing_officers.join(", ") || "none"}`,
    );
  }

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
