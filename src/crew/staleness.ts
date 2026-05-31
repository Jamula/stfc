import type { Roster } from "./schemas.ts";

export interface StalenessEvaluation {
  level: "fresh" | "warn" | "error";
  days: number;
  message: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateStaleness(roster: Roster, now: Date = new Date()): StalenessEvaluation {
  const warnThreshold = roster.staleness_overrides?.warn ?? 7;
  const errorThreshold = roster.staleness_overrides?.error ?? 14;

  const updatedAt = new Date(roster.last_updated);
  const deltaMs = now.getTime() - updatedAt.getTime();
  const safeDelta = Math.max(0, deltaMs);
  const days = Math.floor(safeDelta / DAY_MS);

  if (deltaMs < 0) {
    return {
      level: "fresh",
      days: 0,
      message: `Roster timestamp is in the future; treating as fresh (warn ${warnThreshold}d / error ${errorThreshold}d).`,
    };
  }

  if (days >= errorThreshold) {
    return {
      level: "error",
      days,
      message: `Roster is stale (${days}d old, error threshold ${errorThreshold}d).`,
    };
  }

  if (days >= warnThreshold) {
    return {
      level: "warn",
      days,
      message: `Roster is aging (${days}d old, warn threshold ${warnThreshold}d).`,
    };
  }

  return {
    level: "fresh",
    days,
    message: `Roster is fresh (${days}d old; warn ${warnThreshold}d / error ${errorThreshold}d).`,
  };
}
