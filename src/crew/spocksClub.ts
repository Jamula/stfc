import { z } from "zod";
import type { OfficerDatabase } from "./database.ts";
import { RosterSchema, type Officer, type Roster, type RosterEntry } from "./schemas.ts";

/**
 * Permissive `spocks.club`-compatible officer entry shape.
 *
 * Community exports commonly supply either a canonical kebab-case `id` or a
 * display `name`, plus `tier` (1..5, where tier 1 corresponds to 0 promotions)
 * or explicit `promotions`, `rank` (1..5), `level` (1..100), and optional
 * `owned` / `unlocked` flags.
 */
const SpocksClubOfficerInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    officerId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    owned: z.boolean().optional(),
    unlocked: z.boolean().optional(),
    level: z.number().int().min(0).max(100).optional(),
    rank: z.number().int().min(0).max(5).optional(),
    tier: z.number().int().min(0).optional(),
    promotions: z.number().int().min(0).optional(),
  })
  .passthrough();

const SpocksClubPayloadSchema = z.union([
  z.array(SpocksClubOfficerInputSchema),
  z
    .object({
      officers: z.array(SpocksClubOfficerInputSchema),
    })
    .passthrough(),
]);

export interface SpocksClubExportOfficer {
  id: string;
  name: string;
  owned: boolean;
  level?: number;
  rank?: number;
  tier?: number;
  promotions?: number;
}

export interface SpocksClubExportPayload {
  format: "spocks.club-compatible/v1";
  account: string;
  exportedAt: string;
  officers: SpocksClubExportOfficer[];
}

export interface SpocksClubImportResult {
  roster: Roster;
  importedCount: number;
  unmatchedOfficers: string[];
}

function normalizeLookupKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildOfficerLookup(database: OfficerDatabase): Map<string, Officer> {
  const map = new Map<string, Officer>();
  for (const officer of database.officers) {
    map.set(officer.id, officer);
    map.set(normalizeLookupKey(officer.name), officer);
  }
  return map;
}

/**
 * Convert a `spocks.club`-style JSON officer array or `{ officers: [...] }`
 * object into a validated STFC `Roster` while reporting unmatched officers
 * instead of silently corrupting or crashing on newer game additions.
 */
export function importSpocksClubRoster(args: {
  rawJson: string;
  account: string;
  database: OfficerDatabase;
  now?: Date;
}): SpocksClubImportResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(args.rawJson);
  } catch (err) {
    throw new Error(`Malformed spocks.club JSON: ${(err as Error).message}`);
  }

  const parsed = SpocksClubPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? first.path.join(".") : "(root)";
    throw new Error(`Invalid spocks.club JSON at ${where}: ${first?.message ?? parsed.error.message}`);
  }

  const rawOfficers = Array.isArray(parsed.data) ? parsed.data : parsed.data.officers;
  const lookup = buildOfficerLookup(args.database);
  const entriesById = new Map<string, RosterEntry>();
  const unmatchedOfficers: string[] = [];

  for (const item of rawOfficers) {
    const rawKey = item.id ?? item.officerId ?? item.name;
    if (!rawKey) {
      unmatchedOfficers.push("(unnamed-entry)");
      continue;
    }
    const matched = lookup.get(rawKey.trim()) ?? lookup.get(normalizeLookupKey(rawKey));
    if (!matched) {
      unmatchedOfficers.push(rawKey.trim());
      continue;
    }

    const isOwned =
      item.owned !== undefined
        ? item.owned
        : item.unlocked !== undefined
          ? item.unlocked
          : (item.level ?? 0) >= 1 ||
            (item.rank ?? 0) >= 1 ||
            (item.tier ?? 0) >= 1 ||
            (item.promotions ?? 0) >= 1;

    if (!isOwned) {
      entriesById.set(matched.id, { id: matched.id, owned: false });
      continue;
    }

    const level = Math.max(1, item.level ?? 1);
    const rank = Math.max(1, item.rank ?? 1);
    const promotions =
      item.promotions !== undefined
        ? item.promotions
        : item.tier !== undefined
          ? Math.max(0, item.tier - 1)
          : Math.max(0, rank - 1);

    entriesById.set(matched.id, {
      id: matched.id,
      owned: true,
      level,
      rank,
      promotions,
    });
  }

  const now = args.now ?? new Date();
  const roster = RosterSchema.parse({
    account: args.account,
    last_updated: now.toISOString(),
    officers: [...entriesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  });

  return {
    roster,
    importedCount: roster.officers.length,
    unmatchedOfficers,
  };
}

/**
 * Export a validated `Roster` to a deterministic `spocks.club`-compatible JSON
 * payload enriched with canonical officer display names from `OfficerDatabase`.
 */
export function exportSpocksClubRoster(args: {
  roster: Roster;
  database: OfficerDatabase;
  now?: Date;
}): SpocksClubExportPayload {
  const now = args.now ?? new Date();
  const sorted = [...args.roster.officers].sort((a, b) => a.id.localeCompare(b.id));
  const officers: SpocksClubExportOfficer[] = sorted.map((entry) => {
    const meta = args.database.byId.get(entry.id);
    const name = meta?.name ?? entry.id;
    if (!entry.owned) {
      return {
        id: entry.id,
        name,
        owned: false,
      };
    }
    return {
      id: entry.id,
      name,
      owned: true,
      level: entry.level,
      rank: entry.rank,
      tier: entry.promotions + 1,
      promotions: entry.promotions,
    };
  });

  return {
    format: "spocks.club-compatible/v1",
    account: args.roster.account,
    exportedAt: now.toISOString(),
    officers,
  };
}
