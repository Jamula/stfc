// T013 [US1] — extractor tests. Validates the precision-first code extractor
// against (a) every entry in promo-codes.txt and (b) the spec § Edge Cases
// (spoiler tags, zero-width chars, Markdown decoration, fenced code blocks,
// hyphenated "format example" strings, stoplist rejection, confidence floor).

import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CORE_CODE_REGEX,
  extractCodesFromMessage,
} from "../../src/discord/extractor.ts";
import { STOPLIST, isOnStoplist } from "../../src/discord/stoplist.ts";

const PROMO_CODES_TXT = path.resolve(import.meta.dirname, "..", "..", "promo-codes.txt");

function readPromoCodesTxtEntries(): string[] {
  const raw = fs.readFileSync(PROMO_CODES_TXT, "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => {
      const hash = l.indexOf("#");
      return (hash === -1 ? l : l.slice(0, hash)).trim();
    })
    .filter((l) => l.length > 0);
}

describe("extractor regex constant", () => {
  it("CORE_CODE_REGEX is anchored ^[A-Z][A-Z0-9]{2,19}$", () => {
    assert.equal(CORE_CODE_REGEX.source, "^[A-Z][A-Z0-9]{2,19}$");
  });
});

describe("extractor / promo-codes.txt coverage", () => {
  const entries = readPromoCodesTxtEntries();

  it("loads exactly 39 non-comment entries from promo-codes.txt", () => {
    assert.equal(entries.length, 39, `entries:\n${entries.join("\n")}`);
    for (const code of [
      "SPOCK", "CADET", "KIRK", "WARPSPEED", "COMMANDER",
      "CANDE2", "CANDE3", "BLASTAARLEGEND", "OOPS", "HONOR26",
    ]) {
      assert.equal(entries.filter((entry) => entry === code).length, 1, `${code} must appear exactly once`);
    }
  });

  // All entries — including 3-char codes TNG, GQ5, GQ7 — are now
  // extractable after relaxing the regex floor from 4 to 3 chars (#18).

  describe("each promo-codes.txt entry is extractable", () => {
    for (const entry of entries) {
      test(`promo-codes.txt entry: ${entry}`,
        () => {
          const got = extractCodesFromMessage(`Use code ${entry} for a bonus`, {
            channelLabel: "promos",
          });
          const values = got.map((c) => c.value);
          assert.ok(
            values.includes(entry),
            `expected ${entry} to be extracted; got [${values.join(", ")}]`,
          );
        },
      );
    }
  });
});

describe("extractor / spec § Edge Cases", () => {
  it("rejects hyphenated XXXXX-YYYYY format example", () => {
    // Spec quote: "the code format is `XXXXX-YYYYY`". The hyphen breaks the
    // contiguous regex and the two halves XXXXX / YYYYY are stoplist entries
    // anyway. Other surrounding chatter words may or may not pass — the only
    // contract here is that the literal example placeholders never escape.
    const got = extractCodesFromMessage(
      "the code format is XXXXX-YYYYY (template only)",
      { channelLabel: "general" },
    );
    const values = got.map((c) => c.value);
    assert.ok(!values.includes("XXXXX"));
    assert.ok(!values.includes("YYYYY"));
    assert.ok(!values.includes("XXXXXYYYYY"));
  });

  it("strips ||SPOILER|| decoration before matching", () => {
    const got = extractCodesFromMessage("New drop: ||HIDDENDROP||", {
      channelLabel: "promos",
    });
    assert.ok(got.some((c) => c.value === "HIDDENDROP"));
  });

  it("strips zero-width Unicode characters before matching", () => {
    // Insert U+200B between every character of ALPHACODE.
    const tainted = "ALPHACODE".split("").join("\u200B");
    const got = extractCodesFromMessage(`code: ${tainted}`, {
      channelLabel: "promos",
    });
    assert.ok(got.some((c) => c.value === "ALPHACODE"));
  });

  it("strips Markdown bold/italic wrapping (** __ * _)", () => {
    for (const wrapped of [
      "**BONUSPACK**",
      "__BONUSPACK__",
      "*BONUSPACK*",
      "_BONUSPACK_",
    ]) {
      const got = extractCodesFromMessage(`Redeem ${wrapped} now`, {
        channelLabel: "promos",
      });
      assert.ok(
        got.some((c) => c.value === "BONUSPACK"),
        `expected BONUSPACK from ${wrapped}`,
      );
    }
  });

  it("does NOT extract codes inside triple-backtick fenced blocks", () => {
    // Documentation pattern: code-shaped tokens inside fences are examples,
    // not live codes (spec § Edge Cases).
    const message = [
      "Here is the format we use:",
      "```",
      "Example: SAMPLEFENCE is the placeholder",
      "```",
      "Real codes live outside the fence: REALCODE.",
    ].join("\n");
    const got = extractCodesFromMessage(message, { channelLabel: "promos" });
    const values = got.map((c) => c.value);
    assert.ok(!values.includes("SAMPLEFENCE"), "fenced tokens MUST NOT extract");
    assert.ok(values.includes("REALCODE"), "non-fenced tokens MUST extract");
  });

  it("applies a confidence floor of 0.6 (base score is at the floor)", () => {
    // Base extraction confidence is 0.6 (the floor). All extracted candidates
    // MUST satisfy confidence >= 0.6.
    const got = extractCodesFromMessage("Redeem REDEEM2026 today", {
      channelLabel: "general",
    });
    assert.ok(got.length > 0);
    for (const c of got) {
      assert.ok(
        c.extractionConfidence >= 0.6,
        `confidence ${c.extractionConfidence} below floor 0.6`,
      );
    }
  });

  it("adds a context bonus when channelLabel contains 'code' or 'promo'", () => {
    const baseline = extractCodesFromMessage("Use REDEEM2026 now", {
      channelLabel: "general",
    });
    const promo = extractCodesFromMessage("Use REDEEM2026 now", {
      channelLabel: "promo-codes",
    });
    assert.equal(baseline.length, 1);
    assert.equal(promo.length, 1);
    assert.ok(
      promo[0]!.extractionConfidence > baseline[0]!.extractionConfidence,
      "context bonus should raise confidence above the floor",
    );
  });
});

describe("extractor / stoplist integration", () => {
  it("rejects stoplist entries even though their shape matches the regex", () => {
    // HTTPS / JSON / HTML / API are all code-shaped (4–5 chars uppercase)
    // and on the stoplist. AND is also on the stoplist.
    const got = extractCodesFromMessage(
      "We use HTTPS and JSON; HTML and API.",
      { channelLabel: "general" },
    );
    assert.deepEqual(got.map((c) => c.value), []);
  });

  it("STOPLIST is exported as a Set and isOnStoplist agrees", () => {
    assert.ok(STOPLIST instanceof Set);
    assert.ok(STOPLIST.has("HTTPS"));
    assert.ok(isOnStoplist("HTTPS"));
    assert.ok(!isOnStoplist("REDEEM2026"));
  });

  it("XXXXX and YYYYY (format placeholders) are on the stoplist", () => {
    assert.ok(isOnStoplist("XXXXX"));
    assert.ok(isOnStoplist("YYYYY"));
  });
});

describe("extractor / message tokenisation", () => {
  it("handles surrounding punctuation (.,!?;:)", () => {
    const got = extractCodesFromMessage(
      "Try (REDEEM2026)! Or REDEEMTWO; not REDEEMTHREE.",
      { channelLabel: "promos" },
    );
    const values = new Set(got.map((c) => c.value));
    assert.ok(values.has("REDEEM2026"));
    assert.ok(values.has("REDEEMTWO"));
    assert.ok(values.has("REDEEMTHREE"));
  });

  it("normalizes lowercase tokens to uppercase before matching", () => {
    // Codes should still extract when posted in lowercase (case-insensitive
    // upstream per FR-007). We normalize to uppercase.
    const got = extractCodesFromMessage("redeem2026", {
      channelLabel: "promos",
    });
    assert.ok(got.some((c) => c.value === "REDEEM2026"));
  });

  it("emits exactly one candidate per distinct value within a message", () => {
    const got = extractCodesFromMessage(
      "REDEEM2026 again REDEEM2026 again REDEEM2026",
      { channelLabel: "promos" },
    );
    assert.equal(got.filter((c) => c.value === "REDEEM2026").length, 1);
  });
});
