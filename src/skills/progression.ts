import * as path from "node:path";
import { analyzeProgression } from "../crew/progression.js";
import { loadOfficerDatabase } from "../crew/database.js";
import { loadRoster } from "../crew/roster.js";
import { evaluateStaleness } from "../crew/staleness.js";
import {
  appendWorkflowSummary,
  computeCrewInputHash,
  determineExitCode,
  parseSelector,
  renderTextTable,
  resolveRosterFiles,
  type SkillOutput,
  type Writer,
  writeCrewDocIfChanged,
} from "./crewSkillSupport.js";

interface ProgressionOptions {
  argv?: string[];
  writer?: Writer;
  now?: () => Date;
  rosterDir?: string;
  taskDir?: string;
  officerDatabasePath?: string;
  docsDir?: string;
}

interface AccountProgressionResult {
  account: string;
  status: "ok" | "degraded";
  message?: string;
  report: Awaited<ReturnType<typeof analyzeProgression>> | null;
  stalenessDays: number;
  docWrite: "written" | "skipped" | "error";
  docPath: string;
}

export async function progression(options: ProgressionOptions = {}): Promise<SkillOutput> {
  const args = options.argv ?? process.argv.slice(3);
  const writer = options.writer ?? console;
  const now = options.now ?? (() => new Date());
  const rosterDir = options.rosterDir ?? path.join("data", "crew", "roster");
  const taskDir = options.taskDir ?? path.join("data", "crew", "tasks");
  const officerDatabasePath = options.officerDatabasePath ?? path.join("data", "crew", "officers.json");
  const docsDir = options.docsDir ?? path.join("docs", "crew");

  const selector = parseSelector(args);
  if (!selector.ok) {
    writer.error(`ERROR: ${selector.error}`);
    return { result: { ok: false, reason: "invalid-selector", error: selector.error }, exitCode: 2 };
  }

  const infraErrors: string[] = [];

  let database: Awaited<ReturnType<typeof loadOfficerDatabase>>;
  try {
    database = await loadOfficerDatabase(officerDatabasePath);
  } catch (err) {
    const message = `Could not load officer database (${officerDatabasePath}): ${(err as Error).message}`;
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

  const results: AccountProgressionResult[] = [];
  for (const accountFile of accounts) {
    const docPath = path.join(docsDir, `${accountFile.account}-progression.md`);
    try {
      const roster = await loadRoster(accountFile.filePath);
      const staleness = evaluateStaleness(roster, now());
      if (staleness.level !== "fresh") {
        writer.log(`⚠️ Roster for ${accountFile.account} is ${staleness.days} days old`);
      }

      if (roster.officers.length === 0 || roster.officers.every((officer) => !officer.owned)) {
        const degraded: AccountProgressionResult = {
          account: accountFile.account,
          status: "degraded",
          message: "Roster has no owned officers; progression report is limited.",
          report: null,
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
        });
        results.push(degraded);
        continue;
      }

      const report = analyzeProgression({ database, roster });
      const accountResult: AccountProgressionResult = {
        account: accountFile.account,
        status: report.suggested_promotion_order.length > 0 ? "ok" : "degraded",
        message: report.suggested_promotion_order.length > 0 ? undefined : "No progression recommendations available.",
        report,
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
      });
      results.push(accountResult);
    } catch (err) {
      const message = `Account ${accountFile.account}: ${(err as Error).message}`;
      writer.error(`ERROR: ${message}`);
      results.push({
        account: accountFile.account,
        status: "degraded",
        message,
        report: null,
        stalenessDays: 0,
        docWrite: "error",
        docPath,
      });
    }
  }

  const humanReadable = renderHumanReadable(results);
  writer.log(humanReadable);
  await appendWorkflowSummary(`${humanReadable}\n`);

  const summary = {
    skill: "progression",
    generatedAt: now().toISOString(),
    accounts: results.map((result) => ({
      account: result.account,
      status: result.status,
      stalenessDays: result.stalenessDays,
      docWrite: result.docWrite,
      docPath: result.docPath,
      message: result.message,
      nextActions:
        result.report?.suggested_promotion_order.map((action) => ({
          officerId: action.officer_id,
          priority: action.priority_score,
          reason: action.rationale,
          level: action.current.level,
          rank: action.current.rank,
          promotions: action.current.promotions,
        })) ?? [],
      qualitySignals: result.report?.task_class_gaps ?? [],
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
  accountResult: AccountProgressionResult;
  account: string;
  docsDir: string;
  officerDatabasePath: string;
  taskDir: string;
  rosterPath: string;
}): Promise<void> {
  const inputHash = await computeCrewInputHash(args.officerDatabasePath, args.taskDir, args.rosterPath);
  const markdownBody = renderAccountMarkdown(args.accountResult);
  args.accountResult.docWrite = await writeCrewDocIfChanged({
    docsDir: args.docsDir,
    account: `${args.account}-progression`,
    inputHash,
    markdownBody,
  });
}

function renderHumanReadable(results: AccountProgressionResult[]): string {
  const lines: string[] = [];
  lines.push("=== progression ===");
  for (const result of results) {
    lines.push("");
    lines.push(`Account: ${result.account}`);
    lines.push(`Status: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
    if (!result.report || result.report.suggested_promotion_order.length === 0) {
      lines.push("No progression actions.");
      continue;
    }
    const rows = result.report.suggested_promotion_order.slice(0, 10).map((action, index) => [
      String(index + 1),
      action.officer_id,
      action.priority_score.toFixed(2),
      `L${action.current.level} R${action.current.rank} P${action.current.promotions}`,
      action.rationale,
    ]);
    lines.push(renderTextTable(["Rank", "Officer", "Priority", "Current", "Reason"], rows));
  }
  return lines.join("\n");
}

function renderAccountMarkdown(result: AccountProgressionResult): string {
  const lines: string[] = [];
  lines.push(`# Crew Report — ${result.account}`);
  lines.push("");
  lines.push(`## progression`);
  lines.push("");
  lines.push(`Status: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
  lines.push("");

  if (!result.report || result.report.suggested_promotion_order.length === 0) {
    lines.push("_No progression actions available._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| Rank | Officer | Priority | Current | Reason |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const [index, action] of result.report.suggested_promotion_order.slice(0, 20).entries()) {
    lines.push(
      `| ${index + 1} | ${action.officer_id} | ${action.priority_score.toFixed(2)} | L${action.current.level} R${
        action.current.rank
      } P${action.current.promotions} | ${
        action.rationale
      } |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  progression().then((output) => {
    process.exitCode = output.exitCode;
  });
}
