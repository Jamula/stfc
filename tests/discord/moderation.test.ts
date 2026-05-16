// T029 [US2] — Moderation pre-filter tests (write FIRST per Principle IX).
//
// `isExcludedByModeration` is the pre-classifier guard rail that drops
// messages flagged as raids, harassment, doxxing, or NSFW before they reach
// the classifier (FR-020). Excluded messages are counted in
// `RunHealth.dropped.moderation` and NEVER persisted to tips-seen.jsonl.
//
// The harassment-keyword list is intentionally short and uses placeholder
// tokens in tests so this file itself stays free of real slurs. Operators
// extend the curated list via PR (see `src/discord/moderation.ts`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARASSMENT_KEYWORD_PLACEHOLDERS,
  isExcludedByModeration,
} from "../../src/discord/moderation.ts";

describe("moderation / @everyone & @here mass-mentions (FR-020)", () => {
  it("@everyone → excluded", () => {
    assert.equal(
      isExcludedByModeration("@everyone free latinum here — click this sketchy link"),
      true,
    );
  });

  it("@here → excluded", () => {
    assert.equal(
      isExcludedByModeration("@here drama incoming, all hands"),
      true,
    );
  });

  it("legitimate mention of the word 'everyone' without the @ → NOT excluded", () => {
    assert.equal(
      isExcludedByModeration("Trick: armada loot scales with the lowest contributor — make sure everyone's ship power is within 10%."),
      false,
    );
  });
});

describe("moderation / harassment keyword patterns (FR-020)", () => {
  it("test placeholder keyword → excluded", () => {
    // The keyword list is curated; tests use synthetic placeholder tokens so
    // this file never contains real slurs. Operators extend the list via PR.
    assert.ok(HARASSMENT_KEYWORD_PLACEHOLDERS.length > 0,
      "moderation module must export at least one placeholder keyword for tests to assert on");
    for (const token of HARASSMENT_KEYWORD_PLACEHOLDERS) {
      assert.equal(
        isExcludedByModeration(`some message containing ${token} as a substring`),
        true,
        `placeholder token ${token} must trigger exclusion`,
      );
    }
  });

  it("self-harm encouragement pattern → excluded", () => {
    assert.equal(isExcludedByModeration("kys"), true);
    assert.equal(isExcludedByModeration("just kill yourself already"), true);
  });
});

describe("moderation / doxxing patterns (FR-020)", () => {
  it("street-address regex → excluded", () => {
    assert.equal(
      isExcludedByModeration("ping me at 1234 Marina Ave for the meetup"),
      true,
    );
    assert.equal(
      isExcludedByModeration("doxx target: 42 Federation Blvd"),
      true,
    );
  });

  it("phone-number regex → excluded", () => {
    assert.equal(isExcludedByModeration("call 555-867-5309 to chat"), true);
    assert.equal(isExcludedByModeration("text me at 555.123.4567 anytime"), true);
    assert.equal(isExcludedByModeration("dm 555 123 4567"), true);
  });
});

describe("moderation / NSFW channel & marker conventions (FR-020)", () => {
  it("channel name ending in -nsfw → excluded regardless of content", () => {
    assert.equal(
      isExcludedByModeration("nothing offensive here, just a meme", {
        channelLabel: "memes-nsfw",
      }),
      true,
    );
  });

  it("channel name not nsfw → NOT excluded by channel hint alone", () => {
    assert.equal(
      isExcludedByModeration("nothing offensive here, just a meme", {
        channelLabel: "memes",
      }),
      false,
    );
  });
});

describe("moderation / clean STFC content passes through", () => {
  it("classic tip → NOT excluded", () => {
    assert.equal(
      isExcludedByModeration(
        "Use ISS Jellyfish for armada damage in solar systems — its 35% crit bonus stacks.",
      ),
      false,
    );
  });

  it("event info → NOT excluded", () => {
    assert.equal(
      isExcludedByModeration("Event info: Borg Cube weekend goes live in 36 hours."),
      false,
    );
  });

  it("patch note → NOT excluded", () => {
    assert.equal(
      isExcludedByModeration(
        "Patch note: 1.732.13 — territory bonus cap raised from 8% to 10% per alliance.",
      ),
      false,
    );
  });
});
