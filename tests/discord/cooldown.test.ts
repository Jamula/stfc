// T015 [US1] — cooldown unit tests. Asserts the FR-009 30-day window math,
// idempotent re-failure semantics, eviction at the 7-day grace boundary,
// and (critically) that cooldown writes NEVER touch suppression.json.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  COOLDOWN_DEFAULT_DAYS,
  evictExpired,
  isInCooldown,
  recordFailure,
} from "../../src/discord/cooldown.ts";
import {
  appendCandidate,
  loadCooldowns,
  loadSuppression,
  saveCooldowns,
} from "../../src/discord/state.ts";
import * as stateModule from "../../src/discord/state.ts";
import type {
  CandidateCode,
  CooldownMap,
} from "../../src/discord/schemas.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("COOLDOWN_DEFAULT_DAYS", () => {
  it("is the FR-009 30-day default, exposed by name", () => {
    assert.equal(COOLDOWN_DEFAULT_DAYS, 30);
  });
});

describe("recordFailure (new entry)", () => {
  it("writes firstFailedAt=now, lastFailedAt=now, suppressedUntil=now+30d", () => {
    const now = new Date("2026-05-16T00:00:00Z");
    const out = recordFailure({}, "NEWCODE", "CODE_INVALID_OR_EXPIRED", now);
    const entry = out["NEWCODE"]!;
    assert.equal(entry.firstFailedAt, now.toISOString());
    assert.equal(entry.lastFailedAt, now.toISOString());
    assert.equal(
      entry.suppressedUntil,
      new Date(now.getTime() + COOLDOWN_DEFAULT_DAYS * DAY_MS).toISOString(),
    );
    assert.deepEqual(entry.failureOutcomes, ["CODE_INVALID_OR_EXPIRED"]);
  });

  it("does NOT mutate the input map", () => {
    const now = new Date("2026-05-16T00:00:00Z");
    const original: CooldownMap = {};
    const out = recordFailure(original, "X", "TRANSIENT", now);
    assert.equal(Object.keys(original).length, 0);
    assert.equal(Object.keys(out).length, 1);
  });
});

describe("recordFailure (existing entry)", () => {
  it("updates lastFailedAt and appends outcome, does NOT extend suppressedUntil or reset firstFailedAt", () => {
    const first = new Date("2026-05-01T00:00:00Z");
    const later = new Date("2026-05-10T00:00:00Z");
    const seed: CooldownMap = {
      FAIL: {
        firstFailedAt: first.toISOString(),
        lastFailedAt: first.toISOString(),
        suppressedUntil: new Date(first.getTime() + 30 * DAY_MS).toISOString(),
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      },
    };
    const out = recordFailure(seed, "FAIL", "TRANSIENT", later);
    const entry = out["FAIL"]!;
    assert.equal(entry.firstFailedAt, first.toISOString(), "firstFailedAt preserved");
    assert.equal(entry.lastFailedAt, later.toISOString(), "lastFailedAt advanced");
    assert.equal(
      entry.suppressedUntil,
      new Date(first.getTime() + 30 * DAY_MS).toISOString(),
      "suppressedUntil NOT extended on re-failure within window",
    );
    assert.deepEqual(
      entry.failureOutcomes,
      ["CODE_INVALID_OR_EXPIRED", "TRANSIENT"],
    );
  });

  it("caps failureOutcomes at the most recent 5", () => {
    const first = new Date("2026-05-01T00:00:00Z");
    const later = new Date("2026-05-10T00:00:00Z");
    const seed: CooldownMap = {
      FAIL: {
        firstFailedAt: first.toISOString(),
        lastFailedAt: first.toISOString(),
        suppressedUntil: new Date(first.getTime() + 30 * DAY_MS).toISOString(),
        failureOutcomes: ["A", "B", "C", "D", "E"],
      },
    };
    const out = recordFailure(seed, "FAIL", "F", later);
    assert.deepEqual(out["FAIL"]!.failureOutcomes, ["B", "C", "D", "E", "F"]);
  });
});

describe("isInCooldown", () => {
  const ref = new Date("2026-05-16T00:00:00Z");

  it("true when suppressedUntil > now", () => {
    const map: CooldownMap = {
      X: entry("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z"),
    };
    assert.equal(isInCooldown(map, "X", ref), true);
  });

  it("false when suppressedUntil <= now", () => {
    const map: CooldownMap = {
      X: entry("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"),
    };
    assert.equal(isInCooldown(map, "X", ref), false);
  });

  it("false when the code is absent", () => {
    assert.equal(isInCooldown({}, "MISSING", ref), false);
  });
});

describe("evictExpired", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("drops entries with suppressedUntil < now-7d, keeps within grace", () => {
    const map: CooldownMap = {
      // 7d+ stale → evicted
      STALE: entry("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"),
      // exactly 7d ago → kept (cutoff is strict `<`)
      EDGE: entry("2026-04-25T00:00:00Z", "2026-05-25T00:00:00Z"),
      // future suppression → kept
      ACTIVE: entry("2026-05-30T00:00:00Z", "2026-06-29T00:00:00Z"),
    };
    const out = evictExpired(map, now);
    assert.deepEqual(Object.keys(out).sort(), ["ACTIVE", "EDGE"]);
  });

  it("does NOT mutate the input map", () => {
    const map: CooldownMap = {
      STALE: entry("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"),
    };
    evictExpired(map, now);
    assert.deepEqual(Object.keys(map), ["STALE"]);
  });
});

describe("cooldown → state writer integration", () => {
  it("cross-file invariant #3: every cooldown value has a non-success candidate", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-cooldown-"));
    try {
      const cooldownFile = path.join(dir, "cooldowns.json");
      const candidatesFile = path.join(dir, "candidates.jsonl");
      const now = new Date("2026-05-16T00:00:00Z");

      // Failing candidate first → satisfies invariant #3.
      const failed: CandidateCode = {
        value: "BADCODE",
        firstSeen: "2026-05-15T00:00:00Z",
        lastAttempted: "2026-05-16T00:00:00Z",
        suppressedUntil: null,
        extractionConfidence: 0.6,
        status: "invalid-or-expired",
        source: {
          messageId: "111111111111111111",
          channelId: "222222222222222222",
          channelLabel: "promos",
          timestamp: "2026-05-15T00:00:00Z",
          jumpLink:
            "https://discord.com/channels/509679626763632640/222222222222222222/111111111111111111",
        },
        perAccountOutcome: [],
      };
      await appendCandidate(failed, candidatesFile);

      const map = recordFailure({}, "BADCODE", "CODE_INVALID_OR_EXPIRED", now);
      await saveCooldowns(map, now, cooldownFile);

      const loaded = await loadCooldowns(cooldownFile);
      assert.ok(Object.prototype.hasOwnProperty.call(loaded, "BADCODE"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cooldown writes NEVER touch suppression.json — operator file invariant", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-cooldown-"));
    try {
      const cooldownFile = path.join(dir, "cooldowns.json");
      const suppressionFile = path.join(dir, "suppression.json");

      const operator = {
        OPERATORWORD: {
          action: "deny" as const,
          reason: "false positive",
          addedAt: "2026-05-15T00:00:00Z",
          addedBy: "octocat",
        },
      };
      fs.writeFileSync(suppressionFile, JSON.stringify(operator, null, 2) + "\n", "utf8");
      const suppressionBefore = fs.readFileSync(suppressionFile, "utf8");

      const now = new Date("2026-05-16T00:00:00Z");
      const map = recordFailure({}, "FAILEDCODE", "TRANSIENT", now);
      await saveCooldowns(map, now, cooldownFile);

      const suppressionAfter = fs.readFileSync(suppressionFile, "utf8");
      assert.equal(suppressionAfter, suppressionBefore, "suppression.json untouched");

      const loaded = await loadSuppression(suppressionFile);
      assert.deepEqual(loaded, operator);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("state.ts spy: no save*/write* function exists for suppression", () => {
    const names = Object.keys(stateModule);
    const forbidden = names.filter(
      (n) =>
        /suppression/i.test(n) && (n.startsWith("save") || n.startsWith("write")),
    );
    assert.deepEqual(forbidden, []);
  });
});

function entry(firstFailedAt: string, suppressedUntil: string): CooldownMap[string] {
  return {
    firstFailedAt,
    lastFailedAt: firstFailedAt,
    suppressedUntil,
    failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
  };
}
