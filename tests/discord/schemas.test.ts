// Schema validation tests — happy path + missing-required-field rejection
// for every zod schema in src/discord/schemas.ts (T009).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CandidateCodeSchema,
  CandidateStatusSchema,
  ClassifierModelSchema,
  CooldownEntrySchema,
  CooldownMapSchema,
  DiscordAllowlistSchema,
  IngestionCursorMapSchema,
  IngestionCursorSchema,
  OperatorSuppressionMapSchema,
  OperatorSuppressionRuleSchema,
  TipsSeenLineSchema,
} from "../../src/discord/schemas.ts";

describe("DiscordAllowlistSchema", () => {
  const ok = {
    version: 1 as const,
    entries: [
      {
        serverId: "509679626763632640",
        serverLabel: "Test Server",
        channelId: "509685530108362773",
        channelLabel: "general",
        addedAt: "2026-05-13T00:00:00Z",
        addedBy: "octocat",
        enabled: true,
      },
    ],
  };

  it("accepts the launch-default empty entries", () => {
    const parsed = DiscordAllowlistSchema.parse({ version: 1, entries: [] });
    assert.equal(parsed.version, 1);
    assert.equal(parsed.entries.length, 0);
  });

  it("accepts a populated allowlist", () => {
    assert.doesNotThrow(() => DiscordAllowlistSchema.parse(ok));
  });

  it("rejects when version is not the literal 1", () => {
    const bad = { ...ok, version: 2 };
    assert.equal(DiscordAllowlistSchema.safeParse(bad).success, false);
  });

  it("rejects when an entry is missing serverId", () => {
    const entry = { ...ok.entries[0] } as Record<string, unknown>;
    delete entry.serverId;
    const bad = { version: 1, entries: [entry] };
    assert.equal(DiscordAllowlistSchema.safeParse(bad).success, false);
  });

  it("rejects when an entry has a malformed channelId", () => {
    const entry = { ...ok.entries[0]!, channelId: "not-a-snowflake" };
    const bad = { version: 1, entries: [entry] };
    assert.equal(DiscordAllowlistSchema.safeParse(bad).success, false);
  });
});

describe("IngestionCursorMapSchema", () => {
  const okCursor = {
    channelLabel: "general",
    lastMessageId: "411111111111111150",
    lastTimestamp: "2026-05-13T13:49:00Z",
    lastRunId: "run-2026-05-13T13-49Z",
    lastRunAt: "2026-05-13T13:49:30Z",
  };

  it("accepts an empty map", () => {
    assert.deepEqual(IngestionCursorMapSchema.parse({}), {});
  });

  it("accepts a populated map keyed by snowflake", () => {
    const parsed = IngestionCursorMapSchema.parse({
      "222222222222222222": okCursor,
    });
    assert.equal(parsed["222222222222222222"]?.channelLabel, "general");
  });

  it("rejects when a cursor entry is missing lastMessageId", () => {
    const entry = { ...okCursor } as Record<string, unknown>;
    delete entry.lastMessageId;
    assert.equal(IngestionCursorSchema.safeParse(entry).success, false);
  });
});

describe("CandidateCodeSchema", () => {
  const okCandidate = {
    value: "REDEEM2026",
    firstSeen: "2026-05-13T10:00:00Z",
    lastAttempted: null,
    suppressedUntil: null,
    extractionConfidence: 0.9,
    status: "pending" as const,
    source: {
      messageId: "111111111111111111",
      channelId: "222222222222222222",
      channelLabel: "promos",
      timestamp: "2026-05-13T10:00:00Z",
      jumpLink:
        "https://discord.com/channels/509679626763632640/222222222222222222/111111111111111111",
    },
    perAccountOutcome: [],
  };

  it("accepts a well-formed candidate", () => {
    assert.doesNotThrow(() => CandidateCodeSchema.parse(okCandidate));
  });

  it("accepts all 9 status literals", () => {
    const statuses = [
      "pending",
      "redeemed",
      "already-known",
      "code-already-used",
      "invalid-or-expired",
      "transient-failure",
      "duplicate",
      "deferred-cap",
      "suppressed-cooldown",
    ] as const;
    assert.equal(statuses.length, 9);
    for (const s of statuses) {
      assert.equal(CandidateStatusSchema.safeParse(s).success, true);
    }
  });

  it("rejects a 10th status literal", () => {
    assert.equal(CandidateStatusSchema.safeParse("brand-new").success, false);
  });

  it("rejects when value is missing", () => {
    const bad = { ...okCandidate } as Record<string, unknown>;
    delete bad.value;
    assert.equal(CandidateCodeSchema.safeParse(bad).success, false);
  });

  it("rejects when value does not match ^[A-Z][A-Z0-9]{3,19}$", () => {
    const bad = { ...okCandidate, value: "lowercase" };
    assert.equal(CandidateCodeSchema.safeParse(bad).success, false);
  });

  it("rejects when source.messageId is missing", () => {
    const source = { ...okCandidate.source } as Record<string, unknown>;
    delete source.messageId;
    assert.equal(
      CandidateCodeSchema.safeParse({ ...okCandidate, source }).success,
      false,
    );
  });
});

describe("TipsSeenLineSchema", () => {
  const ok = {
    contentHash: "abcdef0123456789",
    firstSeenAt: "2026-05-13T11:00:00Z",
    category: "tip" as const,
  };

  it("accepts a well-formed tips-seen line", () => {
    assert.doesNotThrow(() => TipsSeenLineSchema.parse(ok));
  });

  it("rejects category 'chatter' (never persisted)", () => {
    assert.equal(
      TipsSeenLineSchema.safeParse({ ...ok, category: "chatter" }).success,
      false,
    );
  });

  it("rejects when contentHash is wrong length", () => {
    const bad = { ...ok, contentHash: "tooshort" };
    assert.equal(TipsSeenLineSchema.safeParse(bad).success, false);
  });

  it("rejects when firstSeenAt is missing", () => {
    const bad = { ...ok } as Record<string, unknown>;
    delete bad.firstSeenAt;
    assert.equal(TipsSeenLineSchema.safeParse(bad).success, false);
  });
});

describe("OperatorSuppressionMapSchema", () => {
  const okRule = {
    action: "deny" as const,
    reason: "false-positive: marketing copy that looks like a code",
    addedAt: "2026-05-13T00:00:00Z",
    addedBy: "octocat",
  };

  it("accepts an empty map (no operator rules yet)", () => {
    assert.deepEqual(OperatorSuppressionMapSchema.parse({}), {});
  });

  it("accepts a populated map", () => {
    const parsed = OperatorSuppressionMapSchema.parse({ FOOBAR: okRule });
    assert.equal(parsed["FOOBAR"]?.action, "deny");
  });

  it("rejects an unknown action literal", () => {
    const bad = { ...okRule, action: "maybe" };
    assert.equal(OperatorSuppressionRuleSchema.safeParse(bad).success, false);
  });

  it("rejects when reason is missing", () => {
    const bad = { ...okRule } as Record<string, unknown>;
    delete bad.reason;
    assert.equal(OperatorSuppressionRuleSchema.safeParse(bad).success, false);
  });
});

describe("CooldownMapSchema", () => {
  const okEntry = {
    firstFailedAt: "2026-05-13T10:00:00Z",
    lastFailedAt: "2026-05-13T10:00:00Z",
    suppressedUntil: "2026-06-12T10:00:00Z",
    failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
  };

  it("accepts a populated cooldown map", () => {
    const parsed = CooldownMapSchema.parse({ BROKEN: okEntry });
    assert.equal(parsed["BROKEN"]?.failureOutcomes.length, 1);
  });

  it("rejects when failureOutcomes exceeds cap of 5", () => {
    const bad = { ...okEntry, failureOutcomes: Array(6).fill("X") };
    assert.equal(CooldownEntrySchema.safeParse(bad).success, false);
  });

  it("rejects when suppressedUntil is missing", () => {
    const bad = { ...okEntry } as Record<string, unknown>;
    delete bad.suppressedUntil;
    assert.equal(CooldownEntrySchema.safeParse(bad).success, false);
  });
});

describe("ClassifierModelSchema", () => {
  const ok = {
    id: "Xenova/nli-deberta-v3-xsmall",
    revision: "abcdef0123456789abcdef0123456789abcdef01",
    weightSha256: "f".repeat(64),
    task: "zero-shot-classification" as const,
    labels: ["tip", "trick", "hack", "event-info", "patch-note", "chatter"],
    confidenceFloor: 0.55,
  };

  it("accepts a well-formed model descriptor", () => {
    assert.doesNotThrow(() => ClassifierModelSchema.parse(ok));
  });

  it("rejects when weightSha256 is not 64 hex chars", () => {
    const bad = { ...ok, weightSha256: "deadbeef" };
    assert.equal(ClassifierModelSchema.safeParse(bad).success, false);
  });

  it("rejects when task is the wrong literal", () => {
    const bad = { ...ok, task: "translation" };
    assert.equal(ClassifierModelSchema.safeParse(bad).success, false);
  });

  it("rejects when labels is missing", () => {
    const bad = { ...ok } as Record<string, unknown>;
    delete bad.labels;
    assert.equal(ClassifierModelSchema.safeParse(bad).success, false);
  });
});
