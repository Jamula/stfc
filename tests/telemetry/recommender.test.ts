// Recommender tests — cost-saving, quality-improving, insufficient data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRecommendations } from "../../src/telemetry/recommender.ts";
import type { TelemetryRecord, ModelTierMap } from "../../src/telemetry/schemas.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TIER_MAP: ModelTierMap = {
  version: 1,
  tiers: {
    "claude-opus-4.6": "high",
    "gpt-5.4-mini": "standard",
  },
  defaultTier: "unknown",
};

function makeRecord(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    sessionHash: "a1b2c3d4e5f67890",
    collectedAt: "2026-05-17T12:00:00Z",
    sessionStartedAt: "2026-05-17T10:00:00Z",
    sessionEndedAt: "2026-05-17T11:30:00Z",
    durationSeconds: 5400,
    inputTokens: 100000,
    outputTokens: 7000,
    cacheReadTokens: 40000,
    modelBreakdown: [
      { model: "claude-opus-4.6", tier: "high", inputTokens: 100000, outputTokens: 7000, callCount: 15 },
    ],
    agentName: "Copilot CLI",
    taskCategory: "implementation",
    outcome: "success",
    usageEventCount: 15,
    status: "complete",
    ...overrides,
  };
}

function makeRecords(
  model: string,
  count: number,
  outcome: "success" | "completed" | "partial",
  inputTokens: number = 100000,
): TelemetryRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord({
      sessionHash: `${model.slice(0, 4).padEnd(4, "0")}${i.toString(16).padStart(12, "0")}`,
      modelBreakdown: [
        {
          model,
          tier: TIER_MAP.tiers[model] ?? TIER_MAP.defaultTier,
          inputTokens,
          outputTokens: Math.round(inputTokens * 0.07),
          callCount: 10,
        },
      ],
      inputTokens,
      outputTokens: Math.round(inputTokens * 0.07),
      outcome,
    }),
  );
}

// ── US3-S1: Cost-saving recommendation ──────────────────────────────────────

describe("computeRecommendations — cost-saving (US3-S1)", () => {
  it("generates cost-saving recommendation when lower-tier has similar success rate", () => {
    const records = [
      ...makeRecords("claude-opus-4.6", 12, "success", 200000),
      ...makeRecords("gpt-5.4-mini", 12, "success", 80000),
    ];

    const result = computeRecommendations(records, TIER_MAP, 10);

    const costSaving = result.recommendations.filter((r) => r.type === "cost-saving");
    assert.ok(
      costSaving.length > 0,
      `expected at least one cost-saving recommendation, got ${JSON.stringify(result)}`,
    );

    const rec = costSaving[0]!;
    assert.equal(rec.currentModel, "claude-opus-4.6");
    assert.equal(rec.recommendedModel, "gpt-5.4-mini");
    assert.ok(rec.evidence.tokenSavingsPercent > 0);
    assert.equal(rec.minimumSessionsMet, true);
  });
});

// ── US3-S2: Quality-improving recommendation ────────────────────────────────

describe("computeRecommendations — quality-improving (US3-S2)", () => {
  it("generates quality-improving recommendation when failure rate >50%", () => {
    // Model A: 40% success (60% failure) — below 50%
    const modelARecords = [
      ...makeRecords("gpt-5.4-mini", 4, "success"),
      ...makeRecords("gpt-5.4-mini", 6, "partial").map((r, i) => ({
        ...r,
        sessionHash: `mini${(i + 100).toString(16).padStart(12, "0")}`,
      })),
    ];

    // Model B: 95% success
    const modelBRecords = [
      ...makeRecords("claude-opus-4.6", 10, "success"),
    ];

    // Patch session hashes to be unique
    let idx = 0;
    for (const r of [...modelARecords, ...modelBRecords]) {
      r.sessionHash = `uniq${idx.toString(16).padStart(12, "0")}`;
      idx++;
    }

    const records = [...modelARecords, ...modelBRecords];
    const result = computeRecommendations(records, TIER_MAP, 10);

    const qualityRecs = result.recommendations.filter((r) => r.type === "quality-improving");
    assert.ok(
      qualityRecs.length > 0,
      `expected quality-improving recommendation, got ${JSON.stringify(result.recommendations)}`,
    );

    const rec = qualityRecs[0]!;
    assert.equal(rec.currentModel, "gpt-5.4-mini");
    assert.equal(rec.recommendedModel, "claude-opus-4.6");
    assert.ok(rec.evidence.recommendedSuccessRate > rec.evidence.currentSuccessRate);
  });
});

// ── US3-S3: Insufficient data ───────────────────────────────────────────────

describe("computeRecommendations — insufficient data (US3-S3)", () => {
  it("excludes agents/models with fewer than minSessions", () => {
    // Only 3 sessions — below threshold of 10
    const records = makeRecords("claude-opus-4.6", 3, "success");

    const result = computeRecommendations(records, TIER_MAP, 10);

    assert.equal(result.recommendations.length, 0);
    assert.ok(
      result.insufficientData.length > 0,
      "expected insufficient-data entries",
    );
    assert.equal(result.insufficientData[0]!.sessionCount, 3);
  });

  it("sets confidence based on data volume", () => {
    const records = [
      ...makeRecords("claude-opus-4.6", 12, "success", 200000),
      ...makeRecords("gpt-5.4-mini", 12, "success", 80000),
    ];

    const result = computeRecommendations(records, TIER_MAP, 10);
    if (result.recommendations.length > 0) {
      const rec = result.recommendations[0]!;
      // 24 total sessions → medium confidence
      assert.equal(rec.confidence, "medium");
    }
  });
});
