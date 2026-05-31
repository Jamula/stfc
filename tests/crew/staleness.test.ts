import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateStaleness } from "../../src/crew/staleness.ts";
import type { Roster } from "../../src/crew/schemas.ts";

const baseRoster: Roster = {
  account: "tiny",
  last_updated: "2026-05-01T00:00:00Z",
  officers: [{ id: "kirk", owned: false }],
};

describe("crew staleness", () => {
  it("uses 7d/14d default thresholds", () => {
    const warn = evaluateStaleness(baseRoster, new Date("2026-05-08T00:00:00Z"));
    const error = evaluateStaleness(baseRoster, new Date("2026-05-15T00:00:00Z"));

    assert.equal(warn.level, "warn");
    assert.equal(warn.days, 7);
    assert.equal(error.level, "error");
    assert.equal(error.days, 14);
  });

  it("respects per-account overrides", () => {
    const roster: Roster = {
      ...baseRoster,
      staleness_overrides: { warn: 2, error: 5 },
    };

    const warn = evaluateStaleness(roster, new Date("2026-05-03T00:00:00Z"));
    const error = evaluateStaleness(roster, new Date("2026-05-06T00:00:00Z"));

    assert.equal(warn.level, "warn");
    assert.equal(error.level, "error");
  });

  it("handles future timestamps safely", () => {
    const roster: Roster = {
      ...baseRoster,
      last_updated: "2026-06-01T00:00:00Z",
    };

    const result = evaluateStaleness(roster, new Date("2026-05-31T00:00:00Z"));
    assert.equal(result.level, "fresh");
    assert.equal(result.days, 0);
    assert.match(result.message, /future/i);
  });
});
