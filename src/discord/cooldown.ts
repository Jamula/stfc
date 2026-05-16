// T021 [US1] — pure-function cooldown telemetry for FR-009.
//
// Owns the math:
//   - New entry: firstFailedAt = now, lastFailedAt = now,
//     suppressedUntil = now + 30 days, failureOutcomes = [outcome].
//   - Existing entry: lastFailedAt advances, outcome appended (cap last 5);
//     firstFailedAt is NEVER reset and suppressedUntil is NEVER extended
//     within the original window (idempotent re-failure).
//   - Eviction: drop entries whose suppressedUntil < now - 7d (state-files
//     contract eviction window).
//
// This module performs NO I/O — callers (src/skills/discordMonitor.ts) pass
// the result to src/discord/state.ts's saveCooldowns().

import type { CooldownMap } from "./schemas.ts";

export const COOLDOWN_DEFAULT_DAYS = 30;
const FAILURE_OUTCOMES_CAP = 5;
const EVICTION_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns a NEW map (input is not mutated). */
export function recordFailure(
  map: CooldownMap,
  code: string,
  outcome: string,
  now: Date,
): CooldownMap {
  const out: CooldownMap = { ...map };
  const existing = out[code];
  if (existing === undefined) {
    out[code] = {
      firstFailedAt: now.toISOString(),
      lastFailedAt: now.toISOString(),
      suppressedUntil: new Date(now.getTime() + COOLDOWN_DEFAULT_DAYS * DAY_MS).toISOString(),
      failureOutcomes: [outcome],
    };
    return out;
  }
  // Append outcome (cap most recent 5); advance lastFailedAt only.
  const nextOutcomes = [...existing.failureOutcomes, outcome].slice(-FAILURE_OUTCOMES_CAP);
  out[code] = {
    ...existing,
    lastFailedAt: now.toISOString(),
    failureOutcomes: nextOutcomes,
  };
  return out;
}

export function isInCooldown(map: CooldownMap, code: string, now: Date): boolean {
  const entry = map[code];
  if (entry === undefined) return false;
  const until = Date.parse(entry.suppressedUntil);
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

/** Returns a NEW map without entries whose suppressedUntil is `< now - 7d`. */
export function evictExpired(map: CooldownMap, now: Date): CooldownMap {
  const cutoff = now.getTime() - EVICTION_GRACE_DAYS * DAY_MS;
  const out: CooldownMap = {};
  for (const [code, entry] of Object.entries(map)) {
    const until = Date.parse(entry.suppressedUntil);
    if (!Number.isNaN(until) && until < cutoff) continue;
    out[code] = entry;
  }
  return out;
}
