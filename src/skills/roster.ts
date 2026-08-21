import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadOfficerDatabase } from "../crew/database.ts";
import { evaluateStaleness } from "../crew/staleness.ts";
import {
  loadRoster,
  RosterFileError,
  saveRoster,
  upsertRosterOfficer,
} from "../crew/roster.ts";
import type { Roster, RosterEntry } from "../crew/schemas.ts";

const DEFAULT_ROSTER_DIR = "data/crew/roster";
const DEFAULT_OFFICERS_PATH = "data/crew/officers.json";
type SkillOutput = { result: unknown; exitCode: number };
type Writer = {
  log: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
};

interface StatusRow {
  account: string;
  officers: number;
  ageDays: number;
  freshness: string;
}

interface StalenessEval {
  ageDays: number;
  freshness: string;
}

interface RosterSkillOptions {
  argv?: string[];
  rosterDir?: string;
  officerDatabasePath?: string;
  now?: () => Date;
  writer?: Writer;
}

export async function roster(opts: RosterSkillOptions = {}): Promise<SkillOutput> {
  const argv = opts.argv ?? process.argv.slice(3);
  const writer = opts.writer ?? console;
  const rosterDir = opts.rosterDir ?? process.env.STFC_ROSTER_DIR ?? DEFAULT_ROSTER_DIR;
  const officerDatabasePath =
    opts.officerDatabasePath ?? process.env.STFC_OFFICERS_PATH ?? DEFAULT_OFFICERS_PATH;
  const now = opts.now ?? (() => new Date());

  const [subcommand = "", ...rest] = argv;
  try {
    switch (subcommand) {
      case "status":
        return await statusCommand(rest, rosterDir, officerDatabasePath, now, writer);
      case "validate":
        return await validateCommand(rest, rosterDir, officerDatabasePath, writer);
      case "add":
        return await addCommand(rest, rosterDir, officerDatabasePath, now, writer);
      case "promote":
        return await promoteCommand(rest, rosterDir, now, writer);
      case "rankup":
        return await rankupCommand(rest, rosterDir, now, writer);
      default:
        writer.error(
          "Usage: roster <status|add|promote|rankup|validate> [flags]\n" +
            "  status [--account X | --all]\n" +
            "  add --account X --officer Y [--level N --rank R --promotions P] [--force]\n" +
            "  promote --account X --officer Y --level +N|N\n" +
            "  rankup --account X --officer Y [--rank +1|N]\n" +
            "  validate [--account X | --all]",
        );
        return { result: { error: "invalid-subcommand" }, exitCode: 2 };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    writer.error(`ERROR: ${detail}`);
    return { result: { error: "operation-failed", detail }, exitCode: 1 };
  }
}

async function statusCommand(
  args: string[],
  rosterDir: string,
  officerDatabasePath: string,
  now: () => Date,
  writer: Writer,
): Promise<SkillOutput> {
  const target = parseSelector(args);
  if (!target.ok) {
    writer.error(target.error);
    return { result: { error: target.error }, exitCode: 2 };
  }

  const evaluator = await resolveStalenessEvaluator(now);
  const files = await resolveRosterFiles(rosterDir, target.account);
  const db = await loadOfficerDatabase(officerDatabasePath);
  const rows: StatusRow[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const filePath of files) {
    try {
      const rosterData = await loadRoster(filePath);
      const staleness = evaluator(rosterData);
      rows.push({
        account: rosterData.account,
        officers: rosterData.officers.length,
        ageDays: staleness.ageDays,
        freshness: staleness.freshness,
      });
      const unknown = findUnknownOfficerIds(rosterData, db.byId);
      if (unknown.length > 0) {
        warnings.push(`WARNING ${rosterData.account}: unknown officer(s): ${unknown.join(", ")}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      errors.push(detail);
    }
  }

  if (rows.length > 0) {
    writer.log(renderTextTable(["account", "officers", "age(days)", "freshness"], rows.map((row) => [
      row.account,
      String(row.officers),
      String(row.ageDays),
      row.freshness,
    ])));
  } else {
    writer.log("No roster files found.");
  }

  for (const warning of warnings) writer.log(warning);
  for (const error of errors) writer.error(`ERROR: ${error}`);

  const exitCode = errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0;
  return { result: { rows, warnings, errors }, exitCode };
}

async function validateCommand(
  args: string[],
  rosterDir: string,
  officerDatabasePath: string,
  writer: Writer,
): Promise<SkillOutput> {
  const target = parseSelector(args);
  if (!target.ok) {
    writer.error(target.error);
    return { result: { error: target.error }, exitCode: 2 };
  }

  const files = await resolveRosterFiles(rosterDir, target.account);
  const db = await loadOfficerDatabase(officerDatabasePath);
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const filePath of files) {
    try {
      const rosterData = await loadRoster(filePath);
      const unknown = findUnknownOfficerIds(rosterData, db.byId);
      if (unknown.length > 0) {
        warnings.push(`WARNING ${rosterData.account}: unknown officer(s): ${unknown.join(", ")}`);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  for (const warning of warnings) writer.log(warning);
  for (const error of errors) writer.error(`ERROR: ${error}`);
  if (warnings.length === 0 && errors.length === 0) {
    writer.log("Roster validation passed.");
  }

  const exitCode = errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0;
  return { result: { warnings, errors }, exitCode };
}

async function addCommand(
  args: string[],
  rosterDir: string,
  officerDatabasePath: string,
  now: () => Date,
  writer: Writer,
): Promise<SkillOutput> {
  const parsed = parseFlags(args);
  const account = parsed.values.account;
  const officer = parsed.values.officer;
  if (!account || !officer) {
    writer.error("add requires --account and --officer");
    return { result: { error: "missing-required-flags" }, exitCode: 2 };
  }
  const force = parsed.bools.force ?? false;

  const levelRaw = parsed.values.level ?? "1";
  const rankRaw = parsed.values.rank ?? "1";
  const promotionsRaw = parsed.values.promotions ?? "0";
  const level = Number(levelRaw);
  const rank = Number(rankRaw);
  const promotions = Number(promotionsRaw);
  if (!Number.isInteger(level) || !Number.isInteger(rank) || !Number.isInteger(promotions)) {
    writer.error("level, rank, and promotions must be integers");
    return { result: { error: "invalid-number" }, exitCode: 2 };
  }
  if (level < 1 || level > 100) {
    writer.error("level must be in range 1..100");
    return { result: { error: "invalid-level" }, exitCode: 2 };
  }
  if (rank < 1 || rank > 5) {
    writer.error("rank must be in range 1..5");
    return { result: { error: "invalid-rank" }, exitCode: 2 };
  }
  if (promotions < 0) {
    writer.error("promotions must be >= 0");
    return { result: { error: "invalid-promotions" }, exitCode: 2 };
  }

  const db = await loadOfficerDatabase(officerDatabasePath);
  if (!db.byId.has(officer)) {
    writer.error(`Unknown officer '${officer}'. Add it to data/crew/officers.json first.`);
    return { result: { error: "unknown-officer" }, exitCode: 1 };
  }

  const rosterPath = path.join(rosterDir, `${account}.yaml`);
  const entry: RosterEntry = {
    id: officer,
    owned: true,
    level,
    rank,
    promotions,
  };

  let rosterData: Roster;
  try {
    rosterData = await loadRoster(rosterPath);
  } catch (err) {
    if (!isMissingRosterFileError(err)) throw err;

    const created: Roster = {
      account,
      last_updated: now().toISOString(),
      officers: [entry],
    };
    await saveRoster(created, rosterPath);
    writer.log(`Created ${rosterPath} with 1 officer.`);
    return { result: { account, officer, created: true }, exitCode: 0 };
  }

  const existing = rosterData.officers.find((current) => current.id === officer);
  if (existing && !force) {
    writer.error(`Officer '${officer}' already exists in account '${account}'. Use --force to overwrite.`);
    return { result: { error: "officer-exists" }, exitCode: 1 };
  }

  const next = upsertRosterOfficer(rosterData, entry, now());
  await saveRoster(next, rosterPath);
  writer.log(`Added officer '${officer}' to '${account}'.`);
  return { result: { account, officer }, exitCode: 0 };
}

async function promoteCommand(
  args: string[],
  rosterDir: string,
  now: () => Date,
  writer: Writer,
): Promise<SkillOutput> {
  const parsed = parseFlags(args);
  const account = parsed.values.account;
  const officer = parsed.values.officer;
  const levelArg = parsed.values.level;
  if (!account || !officer || !levelArg) {
    writer.error("promote requires --account, --officer, and --level (+N or N)");
    return { result: { error: "missing-required-flags" }, exitCode: 2 };
  }

  const rosterPath = path.join(rosterDir, `${account}.yaml`);
  const rosterData = await loadRoster(rosterPath);
  const current = rosterData.officers.find((entry) => entry.id === officer);
  if (!current) {
    writer.error(`Officer '${officer}' is not in '${account}'. Try 'roster add --account ${account} --officer ${officer}'.`);
    return { result: { error: "officer-missing" }, exitCode: 1 };
  }
  if (!current.owned) {
    writer.error(`Officer '${officer}' is unowned in '${account}' and cannot be promoted.`);
    return { result: { error: "officer-unowned" }, exitCode: 1 };
  }

  const nextLevel = parseRelativeOrAbsolute(levelArg, current.level);
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > 100) {
    writer.error("Promoted level must be an integer in range 1..100");
    return { result: { error: "invalid-level" }, exitCode: 2 };
  }

  const next = upsertRosterOfficer(
    rosterData,
    {
      ...current,
      level: nextLevel,
    },
    now(),
  );
  await saveRoster(next, rosterPath);
  writer.log(`Updated '${officer}' level to ${nextLevel} in '${account}'.`);
  return { result: { account, officer, level: nextLevel }, exitCode: 0 };
}

async function rankupCommand(
  args: string[],
  rosterDir: string,
  now: () => Date,
  writer: Writer,
): Promise<SkillOutput> {
  const parsed = parseFlags(args);
  const account = parsed.values.account;
  const officer = parsed.values.officer;
  const rankArg = parsed.values.rank ?? "+1";
  if (!account || !officer) {
    writer.error("rankup requires --account and --officer");
    return { result: { error: "missing-required-flags" }, exitCode: 2 };
  }

  const rosterPath = path.join(rosterDir, `${account}.yaml`);
  const rosterData = await loadRoster(rosterPath);
  const current = rosterData.officers.find((entry) => entry.id === officer);
  if (!current) {
    writer.error(`Officer '${officer}' is not in '${account}'. Try 'roster add --account ${account} --officer ${officer}'.`);
    return { result: { error: "officer-missing" }, exitCode: 1 };
  }
  if (!current.owned) {
    writer.error(`Officer '${officer}' is unowned in '${account}' and cannot rank up.`);
    return { result: { error: "officer-unowned" }, exitCode: 1 };
  }

  const nextRank = parseRelativeOrAbsolute(rankArg, current.rank);
  if (!Number.isInteger(nextRank) || nextRank < 1 || nextRank > 5) {
    writer.error("Rank must be an integer in range 1..5");
    return { result: { error: "invalid-rank" }, exitCode: 2 };
  }

  const next = upsertRosterOfficer(
    rosterData,
    {
      ...current,
      rank: nextRank,
    },
    now(),
  );
  await saveRoster(next, rosterPath);
  writer.log(`Updated '${officer}' rank to ${nextRank} in '${account}'.`);
  return { result: { account, officer, rank: nextRank }, exitCode: 0 };
}

async function resolveRosterFiles(rosterDir: string, account?: string): Promise<string[]> {
  if (account) {
    return [path.join(rosterDir, `${account}.yaml`)];
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(rosterDir);
  } catch (err) {
    throw new RosterFileError(`Could not read roster directory ${rosterDir}: ${(err as Error).message}`);
  }

  return entries
    .filter((name) => name.endsWith(".yaml"))
    .filter((name) => name !== "example.yaml" && name !== "demo.yaml")
    .sort()
    .map((name) => path.join(rosterDir, name));
}

function parseFlags(args: string[]): { values: Record<string, string>; bools: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "force" || key === "all") {
      bools[key] = true;
      continue;
    }
    const directEq = key.indexOf("=");
    if (directEq >= 0) {
      values[key.slice(0, directEq)] = key.slice(directEq + 1);
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
      continue;
    }
    values[key] = "";
  }
  return { values, bools };
}

function parseSelector(args: string[]): { ok: true; account?: string } | { ok: false; error: string } {
  const parsed = parseFlags(args);
  const account = parsed.values.account?.trim();
  const all = parsed.bools.all ?? false;
  if (account && all) {
    return { ok: false, error: "Use either --account X or --all, not both." };
  }
  return { ok: true, account: account || undefined };
}

function parseRelativeOrAbsolute(raw: string, current: number): number {
  if (raw.startsWith("+")) {
    const delta = Number(raw.slice(1));
    return current + delta;
  }
  return Number(raw);
}

function findUnknownOfficerIds(rosterData: Roster, byId: ReadonlyMap<string, unknown>): string[] {
  return rosterData.officers.map((entry) => entry.id).filter((id) => !byId.has(id));
}

function isMissingRosterFileError(err: unknown): boolean {
  return err instanceof RosterFileError && /\bENOENT\b/.test(err.message);
}

function renderTextTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  return [format(headers), divider, ...rows.map((row) => format(row))].join("\n");
}

async function resolveStalenessEvaluator(
  now: () => Date,
): Promise<(rosterData: Roster) => StalenessEval> {
  return (rosterData: Roster) => {
    const result = evaluateStaleness(rosterData, now());
    return { ageDays: result.days, freshness: result.level };
  };
}
