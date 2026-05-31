import type { Roster, RosterEntry } from "./schemas.ts";

export type RosterChangeType = "added" | "removed" | "changed";

export interface RosterDiffEntry {
  officer_id: string;
  change: RosterChangeType;
  before?: RosterEntry;
  after?: RosterEntry;
  deltas?: {
    level_delta: number;
    rank_delta: number;
    promotions_delta: number;
  };
}

export interface RosterDiff {
  changes: RosterDiffEntry[];
}

function compareEntries(a: RosterEntry, b: RosterEntry): boolean {
  if (a.owned !== b.owned) return false;
  if (!a.owned && !b.owned) return true;
  if (a.owned && b.owned) {
    return a.level === b.level && a.rank === b.rank && a.promotions === b.promotions;
  }
  return false;
}

export function diffRosters(before: Roster, after: Roster): RosterDiff {
  const beforeById = new Map(before.officers.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.officers.map((entry) => [entry.id, entry]));
  const allIds = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  const changes: RosterDiffEntry[] = [];

  for (const officerId of allIds) {
    const prev = beforeById.get(officerId);
    const next = afterById.get(officerId);

    if (!prev && next) {
      changes.push({
        officer_id: officerId,
        change: "added",
        after: next,
      });
      continue;
    }

    if (prev && !next) {
      changes.push({
        officer_id: officerId,
        change: "removed",
        before: prev,
      });
      continue;
    }

    if (prev && next && !compareEntries(prev, next)) {
      const deltas =
        prev.owned && next.owned
          ? {
              level_delta: next.level - prev.level,
              rank_delta: next.rank - prev.rank,
              promotions_delta: next.promotions - prev.promotions,
            }
          : {
              level_delta: 0,
              rank_delta: 0,
              promotions_delta: 0,
            };

      changes.push({
        officer_id: officerId,
        change: "changed",
        before: prev,
        after: next,
        deltas,
      });
    }
  }

  return { changes };
}
