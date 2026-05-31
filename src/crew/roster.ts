import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse, stringify, type Pair } from "yaml";
import { RosterEntrySchema, RosterSchema, type Officer, type Roster, type RosterEntry } from "./schemas.ts";
import { requireKnownOfficerId, type OfficerDatabase } from "./database.ts";

const ROOT_KEY_ORDER: Record<string, number> = {
  account: 0,
  last_updated: 1,
  staleness_overrides: 2,
  officers: 3,
};

export class RosterFileError extends Error {
  override readonly name = "RosterFileError";
}

function rootMapSortEntries(a: Pair<unknown, unknown>, b: Pair<unknown, unknown>): number {
  const aKey = String(a.key);
  const bKey = String(b.key);
  const aOrder = ROOT_KEY_ORDER[aKey] ?? 100;
  const bOrder = ROOT_KEY_ORDER[bKey] ?? 100;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return aKey.localeCompare(bKey);
}

function withSortedOfficers(roster: Roster): Roster {
  return {
    ...roster,
    officers: [...roster.officers].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function toRosterYaml(roster: Roster): string {
  const normalized = withSortedOfficers(roster);
  const payload: Record<string, unknown> = {
    account: normalized.account,
    last_updated: normalized.last_updated,
  };

  if (normalized.staleness_overrides) {
    payload.staleness_overrides = normalized.staleness_overrides;
  }

  payload.officers = normalized.officers;

  const yaml = stringify(payload, {
    sortMapEntries: rootMapSortEntries,
    lineWidth: 100,
  });
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

export async function loadRoster(filePath: string): Promise<Roster> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new RosterFileError(`Could not read roster ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    throw new RosterFileError(`Malformed YAML in roster ${filePath}: ${(err as Error).message}`);
  }

  const validated = RosterSchema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const issuePath = issue?.path.length ? issue.path.join(".") : "(root)";
    throw new RosterFileError(
      `Roster schema mismatch in ${filePath} at ${issuePath}: ${issue?.message ?? validated.error.message}`,
    );
  }

  const roster = withSortedOfficers(validated.data);
  return roster;
}

export async function saveRoster(roster: Roster, filePath: string): Promise<void> {
  const validated = RosterSchema.safeParse(roster);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const issuePath = issue?.path.length ? issue.path.join(".") : "(root)";
    throw new RosterFileError(
      `Refusing to write invalid roster for ${filePath} at ${issuePath}: ${issue?.message ?? validated.error.message}`,
    );
  }

  const normalized = withSortedOfficers(validated.data);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, toRosterYaml(normalized), "utf8");
}

export function touchRoster(roster: Roster, now: Date = new Date()): Roster {
  return {
    ...withSortedOfficers(roster),
    last_updated: now.toISOString(),
  };
}

export function upsertRosterOfficer(
  roster: Roster,
  entry: RosterEntry,
  now: Date = new Date(),
): Roster {
  const validatedEntry = RosterEntrySchema.parse(entry);
  const officers = [...roster.officers.filter((current) => current.id !== validatedEntry.id), validatedEntry].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  return {
    ...roster,
    officers,
    last_updated: now.toISOString(),
  };
}

export function removeRosterOfficer(
  roster: Roster,
  officerId: string,
  now: Date = new Date(),
): Roster {
  const officers = roster.officers
    .filter((entry) => entry.id !== officerId)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    ...roster,
    officers,
    last_updated: now.toISOString(),
  };
}

export function validateRosterOfficerIds(roster: Roster, database: OfficerDatabase): Officer[] {
  return roster.officers.map((entry) => requireKnownOfficerId(database, entry.id));
}
