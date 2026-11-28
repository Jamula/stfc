// T014 [US1] — dedup unit tests. Asserts the priority order (a→f):
//   (a) promo-codes.txt        → already-known
//   (b) candidates.jsonl prior → duplicate, except retryable transient failures
//   (c) suppression deny       → suppressed-operator-deny
//   (d) suppression allow      → overrides cooldown, routes to fresh
//   (e) cooldown.isInCooldown  → suppressed-cooldown
//   (f) else                   → pending (added to fresh)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedup } from "../../src/discord/dedup.ts";
import type {
  CandidateCode,
  CooldownMap,
  OperatorSuppressionMap,
} from "../../src/discord/schemas.ts";

function makeCandidate(value: string): CandidateCode {
  return {
    value,
    firstSeen: "2026-05-16T00:00:00Z",
    lastAttempted: null,
    suppressedUntil: null,
    extractionConfidence: 0.7,
    status: "pending",
    source: {
      messageId: "111111111111111111",
      channelId: "222222222222222222",
      channelLabel: "promos",
      timestamp: "2026-05-16T00:00:00Z",
      jumpLink:
        "https://discord.com/channels/509679626763632640/222222222222222222/111111111111111111",
    },
    perAccountOutcome: [],
  };
}

const NOW = new Date("2026-05-16T00:00:00Z");
const ONE_DAY = 24 * 60 * 60 * 1000;

describe("dedup priority order", () => {
  it("(a) code in promo-codes.txt → already-known, NOT in fresh", () => {
    const { fresh, annotated } = dedup([makeCandidate("KNOWN")], {
      promoCodesTxt: new Set(["KNOWN"]),
      priorCandidates: new Map(),
      suppression: {},
      cooldowns: {},
      now: NOW,
    });
    assert.deepEqual(fresh, []);
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0]!.status, "already-known");
  });

  it("(b) code in candidates.jsonl prior → duplicate", () => {
    const prior = new Map<string, CandidateCode>([
      ["SEEN", { ...makeCandidate("SEEN"), status: "pending" }],
    ]);
    const { fresh, annotated } = dedup([makeCandidate("SEEN")], {
      promoCodesTxt: new Set(),
      priorCandidates: prior,
      suppression: {},
      cooldowns: {},
      now: NOW,
    });
    assert.deepEqual(fresh, []);
    assert.equal(annotated[0]!.status, "duplicate");
  });

  it("suppresses dead codes even when an operator rule allows them, and permits retry after cache reset", () => {
    const candidate = makeCandidate("DEADCODE");
    const prior = new Map<string, CandidateCode>([
      ["DEADCODE", { ...candidate, status: "suppressed-dead-code" }],
    ]);
    const context = {
      promoCodesTxt: new Set<string>(),
      priorCandidates: prior,
      suppression: {
        DEADCODE: { action: "allow" as const, reason: "review", addedAt: "2026-05-15T00:00:00Z", addedBy: "operator" },
      },
      cooldowns: {},
      now: NOW,
    };

    const blocked = dedup([candidate], { ...context, deadCodes: new Set(["DEADCODE"]) });
    assert.deepEqual(blocked.fresh, []);
    assert.equal(blocked.annotated[0]!.status, "suppressed-dead-code");

    const reset = dedup([candidate], { ...context, deadCodes: new Set() });
    assert.equal(reset.fresh[0]!.value, "DEADCODE");
    assert.equal(reset.annotated[0]!.status, "pending");
  });

  it("keeps a prior transient failure suppressed while its cooldown is active", () => {
    const prior = new Map<string, CandidateCode>([
      ["RETRYME", { ...makeCandidate("RETRYME"), status: "transient-failure" }],
    ]);
    const cooldowns: CooldownMap = {
      RETRYME: {
        firstFailedAt: "2026-05-15T00:00:00Z",
        lastFailedAt: "2026-05-15T00:00:00Z",
        suppressedUntil: new Date(NOW.getTime() + ONE_DAY).toISOString(),
        failureOutcomes: ["TRANSIENT"],
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("RETRYME")], {
      promoCodesTxt: new Set(),
      priorCandidates: prior,
      suppression: {},
      cooldowns,
      now: NOW,
    });
    assert.deepEqual(fresh, []);
    assert.equal(annotated[0]!.status, "suppressed-cooldown");
  });

  it("retries a prior transient failure after its cooldown expires", () => {
    const prior = new Map<string, CandidateCode>([
      ["RETRYME", { ...makeCandidate("RETRYME"), status: "transient-failure" }],
    ]);
    const cooldowns: CooldownMap = {
      RETRYME: {
        firstFailedAt: "2026-05-14T00:00:00Z",
        lastFailedAt: "2026-05-14T00:00:00Z",
        suppressedUntil: new Date(NOW.getTime() - ONE_DAY).toISOString(),
        failureOutcomes: ["TRANSIENT"],
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("RETRYME")], {
      promoCodesTxt: new Set(),
      priorCandidates: prior,
      suppression: {},
      cooldowns,
      now: NOW,
    });
    assert.equal(fresh.length, 1);
    assert.equal(annotated[0]!.status, "pending");
  });

  it("(c) suppression deny → suppressed-operator-deny", () => {
    const suppression: OperatorSuppressionMap = {
      DENYME: {
        action: "deny",
        reason: "false positive — marketing copy",
        addedAt: "2026-05-15T00:00:00Z",
        addedBy: "octocat",
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("DENYME")], {
      promoCodesTxt: new Set(),
      priorCandidates: new Map(),
      suppression,
      cooldowns: {},
      now: NOW,
    });
    assert.deepEqual(fresh, []);
    assert.equal(annotated[0]!.status, "suppressed-operator-deny");
  });

  it("(d) suppression allow OVERRIDES cooldown → routed to fresh as pending", () => {
    const suppression: OperatorSuppressionMap = {
      ALLOWME: {
        action: "allow",
        reason: "manually verified live",
        addedAt: "2026-05-15T00:00:00Z",
        addedBy: "octocat",
      },
    };
    const cooldowns: CooldownMap = {
      ALLOWME: {
        firstFailedAt: "2026-05-01T00:00:00Z",
        lastFailedAt: "2026-05-01T00:00:00Z",
        suppressedUntil: "2026-06-01T00:00:00Z",
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("ALLOWME")], {
      promoCodesTxt: new Set(),
      priorCandidates: new Map(),
      suppression,
      cooldowns,
      now: NOW,
    });
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0]!.value, "ALLOWME");
    assert.equal(annotated[0]!.status, "pending");
  });

  it("(e) cooldown with suppressedUntil > now → suppressed-cooldown", () => {
    const cooldowns: CooldownMap = {
      COOLED: {
        firstFailedAt: "2026-05-01T00:00:00Z",
        lastFailedAt: "2026-05-01T00:00:00Z",
        suppressedUntil: new Date(NOW.getTime() + ONE_DAY).toISOString(),
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("COOLED")], {
      promoCodesTxt: new Set(),
      priorCandidates: new Map(),
      suppression: {},
      cooldowns,
      now: NOW,
    });
    assert.deepEqual(fresh, []);
    assert.equal(annotated[0]!.status, "suppressed-cooldown");
  });

  it("cooldown expiry transitions code back to evaluable (pending, fresh)", () => {
    const cooldowns: CooldownMap = {
      EXPIRED: {
        firstFailedAt: "2026-04-01T00:00:00Z",
        lastFailedAt: "2026-04-01T00:00:00Z",
        // Already in the past → no longer in cooldown.
        suppressedUntil: new Date(NOW.getTime() - ONE_DAY).toISOString(),
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
    };
    const { fresh, annotated } = dedup([makeCandidate("EXPIRED")], {
      promoCodesTxt: new Set(),
      priorCandidates: new Map(),
      suppression: {},
      cooldowns,
      now: NOW,
    });
    assert.equal(fresh.length, 1);
    assert.equal(annotated[0]!.status, "pending");
  });

  it("(f) absent everywhere → pending, added to fresh", () => {
    const { fresh, annotated } = dedup([makeCandidate("NEWONE")], {
      promoCodesTxt: new Set(),
      priorCandidates: new Map(),
      suppression: {},
      cooldowns: {},
      now: NOW,
    });
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0]!.value, "NEWONE");
    assert.equal(annotated[0]!.status, "pending");
  });
});

describe("dedup multi-candidate mixing", () => {
  it("preserves order and routes each candidate independently", () => {
    const candidates = [
      makeCandidate("KNOWN"),
      makeCandidate("NEWONE"),
      makeCandidate("COOLED"),
      makeCandidate("ALLOWED"),
    ];
    const cooldowns: CooldownMap = {
      COOLED: {
        firstFailedAt: "2026-05-01T00:00:00Z",
        lastFailedAt: "2026-05-01T00:00:00Z",
        suppressedUntil: new Date(NOW.getTime() + ONE_DAY).toISOString(),
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
      ALLOWED: {
        firstFailedAt: "2026-05-01T00:00:00Z",
        lastFailedAt: "2026-05-01T00:00:00Z",
        suppressedUntil: new Date(NOW.getTime() + ONE_DAY).toISOString(),
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
    };
    const suppression: OperatorSuppressionMap = {
      ALLOWED: {
        action: "allow",
        reason: "operator confirmed",
        addedAt: "2026-05-15T00:00:00Z",
        addedBy: "octocat",
      },
    };

    const { fresh, annotated } = dedup(candidates, {
      promoCodesTxt: new Set(["KNOWN"]),
      priorCandidates: new Map(),
      suppression,
      cooldowns,
      now: NOW,
    });

    assert.deepEqual(fresh.map((c) => c.value), ["NEWONE", "ALLOWED"]);
    assert.deepEqual(
      annotated.map((c) => c.status),
      ["already-known", "pending", "suppressed-cooldown", "pending"],
    );
  });
});
