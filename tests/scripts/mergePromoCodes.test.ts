import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GENERATED_MARKER,
  mergePromoCodeText,
  normalizePromoCodeLine,
} from "../../scripts/merge-promo-codes.mjs";

describe("merge-promo-codes", () => {
  it("normalizes the code token after stripping comments", () => {
    assert.equal(normalizePromoCodeLine("  fleetCmd # discovered  "), "FLEETCMD");
    assert.equal(normalizePromoCodeLine("# comment"), "");
  });

  it("keeps automation-state ordering and representation while appending main-only seed codes", () => {
    const main = [
      "# Human seed edits do not override operational lines",
      "alpha # stale seed representation",
      "BRAVO # stale seed comment",
      "ECHO # seeded only on main",
      "",
    ].join("\n");
    const state = [
      "Alpha # operational comment wins",
      "bravo # operational representation wins",
      "charlie # discovered",
      "DELTA",
      "",
    ].join("\n");

    assert.equal(
      mergePromoCodeText(main, state, "a1d97c3"),
      [
      "Alpha # operational comment wins",
      "bravo # operational representation wins",
      "charlie # discovered",
      "DELTA",
      "",
      `${GENERATED_MARKER}a1d97c3 ---`,
      "ECHO # seeded only on main",
      "",
      ].join("\n"),
    );
  });

  it("is deterministic and additive when main adds, edits, or removes a code", () => {
    const first = mergePromoCodeText("ALPHA\nbravo # main\n", "CHARLIE\n", "main-1");
    const second = mergePromoCodeText(
      "alpha # edited by human\nDELTA\n",
      first,
      "main-2",
    );
    const expected = [
      "CHARLIE",
      "",
      `${GENERATED_MARKER}main-1 ---`,
      "ALPHA",
      "bravo # main",
      "",
      `${GENERATED_MARKER}main-2 ---`,
      "DELTA",
      "",
    ].join("\n");
    assert.equal(second, expected);
    assert.equal(
      mergePromoCodeText("alpha # edited by human\nDELTA\n", second, "main-3"),
      expected,
    );
  });

  it("deduplicates duplicate normalized lines within each input", () => {
    const merged = mergePromoCodeText(
      "ALPHA\nalpha # duplicate main\nBETA # first main line\n",
      "beta # operational wins\nBETA # duplicate state\ngamma\ngamma # duplicate state\n",
      "seed-sha",
    );
    assert.equal((merged.match(/ALPHA/gi) ?? []).length, 1);
    assert.equal((merged.match(/beta/gi) ?? []).length, 1);
    assert.equal((merged.match(/gamma/gi) ?? []).length, 1);
    assert.match(merged, /beta # operational wins/);
  });
});
