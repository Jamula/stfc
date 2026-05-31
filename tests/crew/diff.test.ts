import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffRosters, type RosterDiffEntry } from "../../src/crew/diff.ts";
import type { Roster } from "../../src/crew/schemas.ts";

const before: Roster = {
  account: "tiny",
  last_updated: "2026-05-01T00:00:00Z",
  officers: [
    { id: "alpha", owned: true, level: 20, rank: 2, promotions: 1 },
    { id: "beta", owned: true, level: 30, rank: 3, promotions: 2 },
    { id: "delta", owned: false },
  ],
};

const after: Roster = {
  account: "tiny",
  last_updated: "2026-05-05T00:00:00Z",
  officers: [
    { id: "alpha", owned: true, level: 25, rank: 3, promotions: 2 },
    { id: "charlie", owned: true, level: 10, rank: 1, promotions: 0 },
    { id: "delta", owned: true, level: 15, rank: 1, promotions: 0 },
  ],
};

function invert(change: RosterDiffEntry): { officer_id: string; change: string; deltas?: unknown } {
  if (change.change === "added") {
    return { officer_id: change.officer_id, change: "removed" };
  }
  if (change.change === "removed") {
    return { officer_id: change.officer_id, change: "added" };
  }

  return {
    officer_id: change.officer_id,
    change: "changed",
    deltas: {
      level_delta: (change.deltas?.level_delta ?? 0) === 0 ? 0 : -(change.deltas?.level_delta ?? 0),
      rank_delta: (change.deltas?.rank_delta ?? 0) === 0 ? 0 : -(change.deltas?.rank_delta ?? 0),
      promotions_delta:
        (change.deltas?.promotions_delta ?? 0) === 0 ? 0 : -(change.deltas?.promotions_delta ?? 0),
    },
  };
}

describe("crew roster diff", () => {
  it("covers added/removed/changed entries and stable ordering", () => {
    const diff = diffRosters(before, after);
    assert.deepEqual(
      diff.changes.map((entry) => [entry.officer_id, entry.change]),
      [
        ["alpha", "changed"],
        ["beta", "removed"],
        ["charlie", "added"],
        ["delta", "changed"],
      ],
    );

    const alpha = diff.changes.find((entry) => entry.officer_id === "alpha");
    assert.deepEqual(alpha?.deltas, { level_delta: 5, rank_delta: 1, promotions_delta: 1 });

    const delta = diff.changes.find((entry) => entry.officer_id === "delta");
    assert.deepEqual(delta?.deltas, { level_delta: 0, rank_delta: 0, promotions_delta: 0 });
  });

  it("is symmetric under input reversal", () => {
    const forward = diffRosters(before, after);
    const reverse = diffRosters(after, before);

    assert.deepEqual(
      reverse.changes.map((entry) => invert(entry)),
      forward.changes.map((entry) =>
        entry.change === "changed"
          ? { officer_id: entry.officer_id, change: entry.change, deltas: entry.deltas }
          : { officer_id: entry.officer_id, change: entry.change },
      ),
    );
  });
});
