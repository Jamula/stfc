import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_OFFICER_DATABASE_PATH,
  loadOfficerDatabase,
  type OfficerDatabase,
} from "../database.ts";
import { loadRoster } from "../roster.ts";
import { DEFAULT_TASK_DIRECTORY, loadTaskDefinitions } from "../tasks.ts";
import type { Roster, TaskDefinition, TagId } from "../schemas.ts";
import type { CrewCommand } from "../../discord/crewCommandParser.ts";

export const DEFAULT_ROSTER_DIRECTORY = "data/crew/roster";
export const DISCORD_SAFE_MESSAGE_LIMIT = 1_900;

export interface HandlerDeps {
  officerDatabasePath?: string;
  rosterDirectory?: string;
  taskDirectory?: string;
  discoverRosterAccounts?: (rosterDirectory: string) => Promise<string[]>;
  loadOfficerDatabase?: typeof loadOfficerDatabase;
  loadRoster?: typeof loadRoster;
  loadTaskDefinitions?: typeof loadTaskDefinitions;
}

export async function discoverRosterAccounts(rosterDirectory: string = DEFAULT_ROSTER_DIRECTORY): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(rosterDirectory);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  return entries
    .filter((entry) => entry.endsWith(".yaml"))
    .map((entry) => path.basename(entry, ".yaml"))
    .sort((a, b) => a.localeCompare(b));
}

export async function requireAccount(command: CrewCommand, deps: HandlerDeps = {}): Promise<string> {
  const rosterDirectory = deps.rosterDirectory ?? DEFAULT_ROSTER_DIRECTORY;
  const discover = deps.discoverRosterAccounts ?? discoverRosterAccounts;
  const accounts = await discover(rosterDirectory);
  const account = command.args.account?.trim();
  const available = formatAvailableAccounts(accounts, rosterDirectory);

  if (!account) {
    throw new Error(`--account required. ${available}`);
  }
  if (accounts.length > 0 && !accounts.includes(account)) {
    throw new Error(`Unknown account '${account}'. ${available}`);
  }
  return account;
}

export async function loadOfficerDatabaseForCommand(deps: HandlerDeps = {}): Promise<OfficerDatabase> {
  const load = deps.loadOfficerDatabase ?? loadOfficerDatabase;
  return load(deps.officerDatabasePath ?? DEFAULT_OFFICER_DATABASE_PATH);
}

export async function loadRosterForCommand(account: string, deps: HandlerDeps = {}): Promise<Roster> {
  const load = deps.loadRoster ?? loadRoster;
  const rosterDirectory = deps.rosterDirectory ?? DEFAULT_ROSTER_DIRECTORY;
  return load(path.join(rosterDirectory, `${account}.yaml`));
}

export async function loadTaskDefinitionsForCommand(deps: HandlerDeps = {}): Promise<TaskDefinition[]> {
  const load = deps.loadTaskDefinitions ?? loadTaskDefinitions;
  return load(deps.taskDirectory ?? DEFAULT_TASK_DIRECTORY);
}

export function formatTags(tags: readonly TagId[]): string {
  return tags.length > 0 ? tags.map((tag) => `\`${tag}\``).join(", ") : "none";
}

export function formatGroupList(groups: readonly string[]): string {
  return groups.length > 0 ? groups.map((group) => `\`${group}\``).join(", ") : "none";
}

export function isFlagEnabled(value: string | undefined): boolean {
  return value !== undefined && value.toLowerCase() !== "false" && value !== "0";
}

export function truncateLines(heading: string, lines: readonly string[]): string {
  let output = heading;
  let included = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const candidate = `${output}\n${line}`;
    const remainingIfOmitted = lines.length - index - 1;
    const possibleFooter =
      remainingIfOmitted > 0
        ? `\n… (${remainingIfOmitted} more — use --owned or --faction X to filter)`
        : "";
    if (candidate.length + possibleFooter.length > DISCORD_SAFE_MESSAGE_LIMIT) {
      break;
    }
    output = candidate;
    included++;
  }

  if (included < lines.length) {
    output += `\n… (${lines.length - included} more — use --owned or --faction X to filter)`;
  }
  return output;
}

export function formatHandlerError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatAvailableAccounts(accounts: readonly string[], rosterDirectory: string): string {
  if (accounts.length === 0) {
    return `No roster files found in ${rosterDirectory}.`;
  }
  return `Available: ${accounts.join(", ")}.`;
}
