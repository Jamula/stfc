import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../discord/crewCommandParser.ts";
import { loadOfficerDatabase } from "../database.ts";
import { optimizeCrew } from "../optimizer.ts";
import { loadRoster } from "../roster.ts";
import { loadTask } from "../tasks.ts";

const DEFAULT_OFFICERS_PATH = path.join("data", "crew", "officers.json");
const DEFAULT_ROSTER_DIR = path.join("data", "crew", "roster");
const DEFAULT_TASK_DIR = path.join("data", "crew", "tasks");
const MAX_DISCORD_CHARS = 1900;
const TRUNCATION_FOOTER = "\n\n_…output truncated to 1900 chars; narrow the query for full details._";

export async function handleBest(cmd: CrewCommand): Promise<string> {
  const account = await requireAccount(cmd);
  const taskClass = cmd.args._0?.trim();
  if (!taskClass) {
    throw new Error("Missing required <task-class>. Usage: `!crew best <task-class> --account <name> [--top N]`.");
  }

  const top = parseTop(cmd.args.top);
  const officersPath = process.env.STFC_OFFICERS_PATH ?? DEFAULT_OFFICERS_PATH;
  const rosterDir = process.env.STFC_ROSTER_DIR ?? DEFAULT_ROSTER_DIR;
  const taskDir = process.env.STFC_TASK_DIR ?? DEFAULT_TASK_DIR;

  const [database, task] = await Promise.all([
    loadOfficerDatabase(officersPath),
    loadTask(taskClass, taskDir),
  ]);
  const roster = await loadRoster(path.join(rosterDir, `${account}.yaml`));
  const result = optimizeCrew({ database, roster, task, top });

  const lines: string[] = [
    `**Crew best — ${task.name}**`,
    `- account: \`${account}\``,
    `- task: \`${task.id}\``,
    `- top: ${top}`,
    "",
  ];

  if (result.ranked_crews.length === 0) {
    lines.push("_No recommendations available._");
  }

  for (const recommendation of result.ranked_crews) {
    lines.push(`### #${recommendation.rank} — score ${recommendation.score.toFixed(2)}`);
    lines.push("```text");
    lines.push(`captain   ${recommendation.crew.captain ?? "-"}`);
    lines.push(`bridge    ${recommendation.crew.bridge.join(", ") || "-"}`);
    lines.push(`below     ${recommendation.crew.below_deck.join(", ") || "-"}`);
    lines.push("```");

    const matchedTags = recommendation.rationale.matched_tags
      .map((entry) => `${entry.tag}(+${entry.weight})←${entry.contributor}`)
      .join(", ");
    lines.push(`- matched tags: ${matchedTags || "none"}`);

    const synergies = recommendation.rationale.synergy_matches
      .map((entry) => `${entry.group} (+${entry.bonus})`)
      .join(", ");
    lines.push(`- synergies: ${synergies || "none"}`);

    lines.push(`- captain maneuver: ${recommendation.rationale.captain_maneuver ?? "n/a"}`);
    lines.push(`- officer abilities: ${recommendation.rationale.officer_abilities.join(" | ") || "none"}`);
    lines.push("");
  }

  return truncateForDiscord(lines.join("\n"));
}

function parseTop(rawTop: string | undefined): number {
  if (rawTop === undefined) return 1;
  if (rawTop === "true") {
    throw new Error("Flag `--top` requires a value. Usage: `--top 1` or `--top 3`.");
  }

  const top = Number.parseInt(rawTop, 10);
  if (!Number.isInteger(top) || top < 1 || top > 3) {
    throw new Error("Invalid `--top` value. Use an integer between 1 and 3.");
  }
  return top;
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
