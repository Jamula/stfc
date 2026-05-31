import * as path from "node:path";
import { loadOfficerDatabase } from "../crew/database.js";
import { optimizeCrew as optimizeCrewForTask } from "../crew/optimizer.js";
import { loadRoster } from "../crew/roster.js";
import { evaluateStaleness } from "../crew/staleness.js";
import { loadTask } from "../crew/tasks.js";
import {
  appendWorkflowSummary,
  computeCrewInputHash,
  determineExitCode,
  parseFlags,
  parseSelector,
  renderTextTable,
  resolveRosterFiles,
  type SkillOutput,
  type Writer,
  writeCrewDocIfChanged,
} from "./crewSkillSupport.js";

interface OptimizeCrewOptions {
  argv?: string[];
  writer?: Writer;
  now?: () => Date;
  rosterDir?: string;
  taskDir?: string;
  officerDatabasePath?: string;
  docsDir?: string;
}

type RankedCrew = ReturnType<typeof optimizeCrewForTask>["ranked_crews"][number];

interface AccountResult {
  account: string;
  status: "ok" | "degraded";
  message?: string;
  topCrews: RankedCrew[];
  stalenessDays: number;
  docWrite: "written" | "skipped" | "error";
  docPath: string;
}

export async function optimizeCrew(options: OptimizeCrewOptions = {}): Promise<SkillOutput> {
  const args = options.argv ?? process.argv.slice(3);
  const writer = options.writer ?? console;
  const now = options.now ?? (() => new Date());
  const rosterDir = options.rosterDir ?? path.join("data", "crew", "roster");
  const taskDir = options.taskDir ?? path.join("data", "crew", "tasks");
  const officerDatabasePath = options.officerDatabasePath ?? path.join("data", "crew", "officers.json");
  const docsDir = options.docsDir ?? path.join("docs", "crew");

  const parsedFlags = parseFlags(args);
  const taskId = parsedFlags.values.task?.trim();
  const top = Number.parseInt(parsedFlags.values.top ?? "3", 10);
  const selector = parseSelector(args);

  if (!taskId) {
    writer.error("ERROR: Missing required --task <id>.");
    writer.log("Usage: optimize-crew --task <id> [--account X | --all] [--top N]");
    return { result: { ok: false, reason: "missing-task" }, exitCode: 2 };
  }
  if (!Number.isFinite(top) || top < 1) {
    writer.error("ERROR: --top must be a positive integer.");
    return { result: { ok: false, reason: "invalid-top" }, exitCode: 2 };
  }
  if (!selector.ok) {
    writer.error(`ERROR: ${selector.error}`);
    return { result: { ok: false, reason: "invalid-selector", error: selector.error }, exitCode: 2 };
  }

  const infraErrors: string[] = [];
  let database: Awaited<ReturnType<typeof loadOfficerDatabase>>;
  let task: Awaited<ReturnType<typeof loadTask>>;

  try {
    database = await loadOfficerDatabase(officerDatabasePath);
  } catch (err) {
    const message = `Could not load officer database (${officerDatabasePath}): ${(err as Error).message}`;
    infraErrors.push(message);
    writer.error(`ERROR: ${message}`);
    return { result: { ok: false, infraErrors }, exitCode: 1 };
  }

  try {
    task = await loadTask(taskId, taskDir);
  } catch (err) {
    const message = `Could not load task "${taskId}" (${taskDir}): ${(err as Error).message}`;
    infraErrors.push(message);
    writer.error(`ERROR: ${message}`);
    return { result: { ok: false, infraErrors }, exitCode: 1 };
  }

  let accounts;
  try {
    accounts = await resolveRosterFiles(rosterDir, selector.account);
  } catch (err) {
    const message = (err as Error).message;
    infraErrors.push(message);
    writer.error(`ERROR: ${message}`);
    return { result: { ok: false, infraErrors }, exitCode: 1 };
  }

  if (accounts.length === 0) {
    writer.error(`ERROR: No roster files found in ${rosterDir}.`);
    return { result: { ok: false, reason: "no-accounts" }, exitCode: 2 };
  }

  const results: AccountResult[] = [];

  for (const accountFile of accounts) {
    const docPath = path.join(docsDir, `${accountFile.account}-optimize.md`);
    try {
      const roster = await loadRoster(accountFile.filePath);
      const staleness = evaluateStaleness(roster, now());
      if (staleness.level !== "fresh") {
        writer.log(`⚠️ Roster for ${accountFile.account} is ${staleness.days} days old`);
      }

      if (roster.officers.length === 0 || roster.officers.every((officer) => !officer.owned)) {
        const degraded: AccountResult = {
          account: accountFile.account,
          status: "degraded",
          message: "Roster has no owned officers; optimization skipped.",
          topCrews: [],
          stalenessDays: staleness.days,
          docWrite: "skipped",
          docPath,
        };
        await maybeWriteDoc({
          accountResult: degraded,
          account: accountFile.account,
          docsDir,
          officerDatabasePath,
          taskDir,
          rosterPath: accountFile.filePath,
          taskId,
          top,
        });
        results.push(degraded);
        continue;
      }

      const optimized = await optimizeCrewForTask({
        database,
        roster,
        task,
        top,
      });
      const topCrews = optimized.ranked_crews;

      const accountResult: AccountResult = {
        account: accountFile.account,
        status: topCrews.length > 0 ? "ok" : "degraded",
        message: topCrews.length > 0 ? undefined : "No valid crew combinations found.",
        topCrews,
        stalenessDays: staleness.days,
        docWrite: "skipped",
        docPath,
      };

      await maybeWriteDoc({
        accountResult,
        account: accountFile.account,
        docsDir,
        officerDatabasePath,
        taskDir,
        rosterPath: accountFile.filePath,
        taskId,
        top,
      });
      results.push(accountResult);
    } catch (err) {
      const message = `Account ${accountFile.account}: ${(err as Error).message}`;
      writer.error(`ERROR: ${message}`);
      results.push({
        account: accountFile.account,
        status: "degraded",
        message,
        topCrews: [],
        stalenessDays: 0,
        docWrite: "error",
        docPath,
      });
    }
  }

  const humanReadable = renderHumanReadable(task.id, top, results);
  writer.log(humanReadable);
  await appendWorkflowSummary(`${humanReadable}\n`);

  const summary = {
    skill: "optimize-crew",
    task: task.id,
    topN: top,
    generatedAt: now().toISOString(),
    accounts: results.map((result) => ({
      account: result.account,
      status: result.status,
      stalenessDays: result.stalenessDays,
      docWrite: result.docWrite,
      docPath: result.docPath,
      topCrews: result.topCrews.map((crew) => ({
        score: Number(crew.score.toFixed(2)),
        captain: crew.crew.captain,
        bridge: crew.crew.bridge,
        belowDeck: crew.crew.below_deck,
        rationale: {
          tags: crew.rationale.matched_tags.map((entry) => entry.tag),
          factionBonus: crew.rationale.faction_bonus,
          synergyBonuses: crew.rationale.synergy_matches.map((entry) => entry.group),
        },
      })),
      message: result.message,
    })),
  };
  writer.log(JSON.stringify(summary));

  const exitCode = determineExitCode({
    infraErrors,
    accountStatuses: results.map((result) => result.status),
  });
  return { result: summary, exitCode };
}

async function maybeWriteDoc(args: {
  accountResult: AccountResult;
  account: string;
  docsDir: string;
  officerDatabasePath: string;
  taskDir: string;
  rosterPath: string;
  taskId: string;
  top: number;
}): Promise<void> {
  const inputHash = await computeCrewInputHash(args.officerDatabasePath, args.taskDir, args.rosterPath);
  const markdownBody = renderAccountMarkdown(args.taskId, args.top, args.accountResult);
  args.accountResult.docWrite = await writeCrewDocIfChanged({
    docsDir: args.docsDir,
    account: `${args.account}-optimize`,
    inputHash,
    markdownBody,
  });
}

function renderHumanReadable(taskId: string, top: number, results: AccountResult[]): string {
  const lines: string[] = [];
  lines.push(`=== optimize-crew (task: ${taskId}, top ${top}) ===`);
  for (const result of results) {
    lines.push("");
    lines.push(`Account: ${result.account}`);
    lines.push(`Status: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
    const rows = result.topCrews.map((crew, index) => [
      String(index + 1),
      crew.score.toFixed(2),
      crew.crew.captain ?? "-",
      crew.crew.bridge.join(", "),
      crew.crew.below_deck.join(", "),
      summarizeRationale(crew),
    ]);
    if (rows.length === 0) {
      lines.push("No ranked crews.");
      continue;
    }
    lines.push(
      renderTextTable(["Rank", "Score", "Captain", "Bridge", "Below Deck", "Rationale"], rows),
    );
  }
  return lines.join("\n");
}

function renderAccountMarkdown(taskId: string, top: number, result: AccountResult): string {
  const lines: string[] = [];
  lines.push(`# Crew Report — ${result.account}`);
  lines.push("");
  lines.push(`## optimize-crew`);
  lines.push("");
  lines.push(`Task: \`${taskId}\``);
  lines.push(`Top N: ${top}`);
  lines.push(`Status: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
  lines.push("");

  if (result.topCrews.length === 0) {
    lines.push("_No ranked crews available._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| Rank | Score | Captain | Bridge | Below Deck | Rationale |");
  lines.push("| --- | ---: | --- | --- | --- | --- |");
  for (const [index, crew] of result.topCrews.entries()) {
    lines.push(
      `| ${index + 1} | ${crew.score.toFixed(2)} | ${crew.crew.captain ?? "-"} | ${crew.crew.bridge.join(", ")} | ${
        crew.crew.below_deck.join(", ")
      } | ${summarizeRationale(crew)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function summarizeRationale(crew: AccountResult["topCrews"][number]): string {
  const parts: string[] = [];
  const tags = [...new Set(crew.rationale.matched_tags.map((entry) => entry.tag))];
  if (tags.length > 0) {
    parts.push(`tags:${tags.join("/")}`);
  }
  if (crew.rationale.synergy_matches.length > 0) {
    parts.push(`synergy:${crew.rationale.synergy_matches.map((entry) => entry.group).join("/")}`);
  }
  if (crew.rationale.faction_bonus > 0) {
    parts.push(`faction:+${crew.rationale.faction_bonus}`);
  }
  return parts.join("; ");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  optimizeCrew().then((output) => {
    process.exitCode = output.exitCode;
  });
}
