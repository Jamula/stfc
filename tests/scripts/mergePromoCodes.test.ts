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

  it("keeps main ordering and representation while retaining automation-only codes", () => {
    const main = [
      "# Human seed",
      "Alpha # preferred human comment",
      "BRAVO",
      "",
    ].join("\n");
    const state = [
      "alpha # stale automation representation",
      "bravo",
      "charlie # discovered",
      "DELTA",
      "",
    ].join("\n");

    assert.equal(
      mergePromoCodeText(main, state),
      [
        "# Human seed",
        "Alpha # preferred human comment",
        "BRAVO",
        "",
        GENERATED_MARKER,
        "charlie # discovered",
        "DELTA",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic and additive when main adds, edits, or removes a code", () => {
    const first = mergePromoCodeText("ALPHA\nbravo # main\n", "CHARLIE\n");
    const second = mergePromoCodeText(
      "alpha # edited by human\nDELTA\n",
      first,
    );
    const expected = [
      "alpha # edited by human",
      "DELTA",
      "",
      GENERATED_MARKER,
      "bravo # main",
      "CHARLIE",
      "",
    ].join("\n");
    assert.equal(second, expected);
    assert.equal(mergePromoCodeText("alpha # edited by human\nDELTA\n", second), expected);
  });

  it("deduplicates automation entries by normalized code", () => {
    const merged = mergePromoCodeText("ALPHA\n", "beta # first\nBETA # duplicate\ngamma\n");
    assert.equal((merged.match(/beta/gi) ?? []).length, 1);
    assert.equal((merged.match(/gamma/gi) ?? []).length, 1);
  });
});
