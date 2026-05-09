// Outcome enum + classifiers. Every per-account / per-item operation in the
// orchestrator resolves to exactly one of these. The orchestrator decides
// the workflow exit code purely from the aggregate of these outcomes.

export const Outcomes = {
  // Gifts
  CLAIMED: "CLAIMED",
  ALREADY_CLAIMED: "ALREADY_CLAIMED",
  AT_MAX: "AT_MAX",
  IS_SPECIAL: "IS_SPECIAL",
  HAS_COST: "HAS_COST",
  NO_GIFTS_AVAILABLE: "NO_GIFTS_AVAILABLE",
  // Promo codes
  CODE_REDEEMED: "CODE_REDEEMED",
  CODE_ALREADY_USED: "CODE_ALREADY_USED",
  CODE_INVALID_OR_EXPIRED: "CODE_INVALID_OR_EXPIRED",
  LEVEL_TOO_LOW: "LEVEL_TOO_LOW",
  // Cross-cutting
  TOKEN_VALID: "TOKEN_VALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TRANSIENT: "TRANSIENT",
  UNKNOWN_RESULT: "UNKNOWN_RESULT",
} as const;

export type Outcome = (typeof Outcomes)[keyof typeof Outcomes];

// All known outcomes are "expected" and DO NOT fail the workflow. The only
// things that fail the workflow are infrastructure errors raised as thrown
// exceptions (malformed STFC_ACCOUNTS, schema mismatch, uncaught crashes).
const EXPECTED: ReadonlySet<Outcome> = new Set<Outcome>(Object.values(Outcomes));

export function isExpectedOutcome(o: Outcome): boolean {
  return EXPECTED.has(o);
}

// Map the documented redeem-code result codes (from the JS bundle's
// RedeemCode-CJbuCL-q.js) to outcomes:
//   0       -> redeem_success
//   1       -> redeem_error_code_expired
//   2..5    -> redeem_error_code_is_invalid
//   (str)   -> redeem_error_level_not_enough
//   (str)   -> redeem_error_code_used_before
export function classifyRedeemResult(input: { code?: number | string; message?: string }): Outcome {
  const { code, message } = input;
  const msg = (message ?? "").toLowerCase();

  if (msg.includes("used_before") || msg.includes("already")) return Outcomes.CODE_ALREADY_USED;
  if (msg.includes("level_not_enough") || msg.includes("level")) return Outcomes.LEVEL_TOO_LOW;
  if (msg.includes("expired")) return Outcomes.CODE_INVALID_OR_EXPIRED;
  if (msg.includes("invalid")) return Outcomes.CODE_INVALID_OR_EXPIRED;
  if (msg.includes("success")) return Outcomes.CODE_REDEEMED;

  if (typeof code === "number") {
    if (code === 0) return Outcomes.CODE_REDEEMED;
    if (code === 1) return Outcomes.CODE_INVALID_OR_EXPIRED;
    if (code >= 2 && code <= 5) return Outcomes.CODE_INVALID_OR_EXPIRED;
  }

  return Outcomes.UNKNOWN_RESULT;
}

// Map a fetch/HTTP failure to an outcome. The fetch client raises typed
// errors (TokenExpiredError, TransientError); this is for the orchestrator
// to translate them to per-account outcomes without losing precision.
export function classifyHttpError(err: unknown): Outcome {
  if (err == null) return Outcomes.UNKNOWN_RESULT;
  const name = (err as { name?: string }).name ?? "";
  if (name === "TokenExpiredError") return Outcomes.TOKEN_EXPIRED;
  if (name === "TransientError") return Outcomes.TRANSIENT;
  return Outcomes.UNKNOWN_RESULT;
}

// Per-gift classification. The live API uses snake_case 0/1 numbers for
// flags and includes "Cannot Collect More …" titles for at-max gifts.
// We accept either booleans or numbers and treat 0/false the same.
export interface GiftLike {
  isClaimable?: boolean | number | undefined;
  isClaimed?: boolean | number | undefined;
  isSpecial?: boolean | number | undefined;
  hasCost?: boolean | number | undefined;
  isAtMax?: boolean | number | undefined;
  is_special?: boolean | number | undefined;
  has_cost?: boolean | number | undefined;
  is_at_max?: boolean | number | undefined;
  is_claimable?: boolean | number | undefined;
  is_claimed?: boolean | number | undefined;
  title?: string | undefined;
  name?: string | undefined;
}

const truthy = (v: unknown): boolean => (typeof v === "number" ? v !== 0 : v === true);

export function classifyGiftSkip(gift: GiftLike): Outcome | null {
  if (truthy(gift.isClaimed) || truthy(gift.is_claimed)) return Outcomes.ALREADY_CLAIMED;
  if (truthy(gift.isSpecial) || truthy(gift.is_special)) return Outcomes.IS_SPECIAL;
  if (truthy(gift.hasCost) || truthy(gift.has_cost)) return Outcomes.HAS_COST;
  if (truthy(gift.isAtMax) || truthy(gift.is_at_max)) return Outcomes.AT_MAX;
  const title = gift.title ?? gift.name ?? "";
  if (/^\s*cannot collect more\b/i.test(title)) return Outcomes.AT_MAX;
  if (gift.isClaimable === false || gift.is_claimable === false) return Outcomes.UNKNOWN_RESULT;
  return null; // null = the gift is claimable; orchestrator should attempt claim
}
