import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Outcomes,
  classifyRedeemResult,
  classifyHttpError,
  classifyGiftSkip,
  isExpectedOutcome,
  type Outcome,
} from "../../src/lib/outcomes.ts";

describe("classifyRedeemResult", () => {
  const cases: Array<[Parameters<typeof classifyRedeemResult>[0], Outcome]> = [
    [{ code: 0 }, Outcomes.CODE_REDEEMED],
    [{ code: 1 }, Outcomes.CODE_INVALID_OR_EXPIRED],
    [{ code: 3 }, Outcomes.CODE_INVALID_OR_EXPIRED],
    [{ message: "redeem_error_code_used_before" }, Outcomes.CODE_ALREADY_USED],
    [{ message: "redeem_error_level_not_enough" }, Outcomes.LEVEL_TOO_LOW],
    [{ message: "redeem_success" }, Outcomes.CODE_REDEEMED],
    [{}, Outcomes.UNKNOWN_RESULT],
    [{ code: "foo" }, Outcomes.UNKNOWN_RESULT],
  ];

  for (const [input, expected] of cases) {
    it(`classifies ${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(classifyRedeemResult(input), expected);
    });
  }
});

describe("classifyHttpError", () => {
  class TokenExpiredError extends Error {
    override readonly name = "TokenExpiredError";
  }
  class TransientError extends Error {
    override readonly name = "TransientError";
  }

  it("TokenExpiredError-named → TOKEN_EXPIRED", () => {
    assert.equal(classifyHttpError(new TokenExpiredError("nope")), Outcomes.TOKEN_EXPIRED);
  });

  it("TransientError-named → TRANSIENT", () => {
    assert.equal(classifyHttpError(new TransientError("flaky")), Outcomes.TRANSIENT);
  });

  it("plain Error → UNKNOWN_RESULT", () => {
    assert.equal(classifyHttpError(new Error("boom")), Outcomes.UNKNOWN_RESULT);
  });

  it("null → UNKNOWN_RESULT", () => {
    assert.equal(classifyHttpError(null), Outcomes.UNKNOWN_RESULT);
  });

  it("string → UNKNOWN_RESULT", () => {
    assert.equal(classifyHttpError("oops"), Outcomes.UNKNOWN_RESULT);
  });
});

describe("classifyGiftSkip", () => {
  it("isClaimed → ALREADY_CLAIMED", () => {
    assert.equal(classifyGiftSkip({ isClaimed: true }), Outcomes.ALREADY_CLAIMED);
  });
  it("isSpecial → IS_SPECIAL", () => {
    assert.equal(classifyGiftSkip({ isSpecial: true }), Outcomes.IS_SPECIAL);
  });
  it("hasCost → HAS_COST", () => {
    assert.equal(classifyGiftSkip({ hasCost: true }), Outcomes.HAS_COST);
  });
  it("isAtMax → AT_MAX", () => {
    assert.equal(classifyGiftSkip({ isAtMax: true }), Outcomes.AT_MAX);
  });
  it("isClaimable=false → UNKNOWN_RESULT", () => {
    assert.equal(classifyGiftSkip({ isClaimable: false }), Outcomes.UNKNOWN_RESULT);
  });
  it("no flags → null (claimable)", () => {
    assert.equal(classifyGiftSkip({}), null);
  });
});

describe("isExpectedOutcome", () => {
  it("returns true for every defined Outcome", () => {
    for (const value of Object.values(Outcomes)) {
      assert.equal(isExpectedOutcome(value as Outcome), true, `expected ${value} to be expected`);
    }
  });

  it("returns false for an arbitrary unknown string", () => {
    assert.equal(isExpectedOutcome("NOPE" as Outcome), false);
  });
});
