// T022 [US1] — candidate dedup against the four sources defined by the
// redeemer-integration contract. Priority (highest first):
//
//   (a) promo-codes.txt           → status: already-known       (NOT fresh)
//   (b) candidates.jsonl prior    → status: duplicate            (NOT fresh)
//   (c) suppression deny rule     → status: suppressed-operator-deny
//   (d) suppression allow rule    → OVERRIDES cooldown → pending (fresh)
//   (e) cooldown.isInCooldown     → status: suppressed-cooldown  (NOT fresh)
//   (f) else                       → status: pending             (fresh)
//
// Returns BOTH lists so the orchestrator can:
//   - submit `fresh` to the redeemer via `redeemCodes({ extraCandidates })`
//   - persist `annotated` (all statuses) to candidates.jsonl for the digest
//
// No I/O — callers fetch the four sources via state.ts.

import { isInCooldown } from "./cooldown.ts";
import type {
  CandidateCode,
  CandidateStatus,
  CooldownMap,
  OperatorSuppressionMap,
} from "./schemas.ts";

export interface DedupContext {
  promoCodesTxt: Set<string>;
  priorCandidates: Map<string, CandidateCode>;
  suppression: OperatorSuppressionMap;
  cooldowns: CooldownMap;
  now: Date;
}

export interface DedupOutput {
  /** Candidates routed to the redeemer (status: pending). */
  fresh: CandidateCode[];
  /** Every input candidate with its status field updated per the priority order. */
  annotated: CandidateCode[];
}

export function dedup(candidates: CandidateCode[], ctx: DedupContext): DedupOutput {
  const fresh: CandidateCode[] = [];
  const annotated: CandidateCode[] = [];

  for (const candidate of candidates) {
    const status = classify(candidate.value, ctx);
    const next: CandidateCode = { ...candidate, status };
    annotated.push(next);
    if (status === "pending") fresh.push(next);
  }

  return { fresh, annotated };
}

function classify(value: string, ctx: DedupContext): CandidateStatus {
  // (a) Already in promo-codes.txt → already-known.
  if (ctx.promoCodesTxt.has(value)) return "already-known";

  // (b) Seen on a prior run → duplicate, except retryable transient failures.
  const prior = ctx.priorCandidates.get(value);
  if (prior !== undefined) {
    if (prior.status === "transient-failure") {
      return isInCooldown(ctx.cooldowns, value, ctx.now)
        ? "suppressed-cooldown"
        : "pending";
    }
    return "duplicate";
  }

  // (c)/(d) Operator rules.
  const rule = ctx.suppression[value];
  if (rule !== undefined) {
    if (rule.action === "deny") return "suppressed-operator-deny";
    // allow → fall through to pending, bypassing the cooldown check.
    return "pending";
  }

  // (e) Cooldown still active.
  if (isInCooldown(ctx.cooldowns, value, ctx.now)) return "suppressed-cooldown";

  // (f) Nothing blocks it.
  return "pending";
}
