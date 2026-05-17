// Reporter tests — aggregation, Markdown rendering, empty-data case.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRecords,
  renderReport,
} from "../../src/telemetry/reporter.ts";
import type { TelemetryRecord } from "../../src/telemetry/schemas.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── US2-S1: Per-model totals ────────────────────────────────────────────────

describe("aggregateRecords — per-model totals (US2-S1)", () => {
  it("shows per-model totals for input/output tokens and session count", () => {
    const records: TelemetryRecord[] = [
      makeRecord({
        sessionHash: "aaaa111122223333",
        modelBreakdown: [
          { model: "claude-opus-4.6", tier: "high", inputTokens: 100000, outputTokens: 7000, callCount: 10 },
        ],
      }),
      makeRecord({
        sessionHash: "bbbb444455556666",
        modelBreakdown: [
          { model: "gpt-5.4-mini", tier: "standard", inputTokens: 50000, outputTokens: 3000, callCount: 5 },
        ],
      }),
      makeRecord({
        sessionHash: "cccc777788889999",
        modelBreakdown: [
          { model: "claude-opus-4.6", tier: "high", inputTokens: 80000, outputTokens: 5000, callCount: 8 },
        ],
      }),
    ];

    const summary = aggregateRecords(records);

    assert.equal(summary.totalSessions, 3);
    assert.equal(summary.byModel.length, 2);

    const opus = summary.byModel.find((m) => m.model === "claude-opus-4.6");
    assert.ok(opus);
    assert.equal(opus.sessionCount, 2);
    assert.equal(opus.inputTokens, 180000);
    assert.equal(opus.outputTokens, 12000);

    const mini = summary.byModel.find((m) => m.model === "gpt-5.4-mini");
    assert.ok(mini);
    assert.equal(mini.sessionCount, 1);
    assert.equal(mini.inputTokens, 50000);
  });
});

// ── US2-S2: Per-agent breakdowns ────────────────────────────────────────────

describe("aggregateRecords — per-agent breakdowns (US2-S2)", () => {
  it("shows per-agent avg tokens/session and avg duration", () => {
    const records: TelemetryRecord[] = [
      makeRecord({
        sessionHash: "aaaa111122223333",
        agentName: "Copilot CLI",
        inputTokens: 100000,
        outputTokens: 10000,
        durationSeconds: 3600,
      }),
      makeRecord({
        sessionHash: "bbbb444455556666",
        agentName: "Copilot CLI",
        inputTokens: 80000,
        outputTokens: 8000,
        durationSeconds: 1800,
      }),
    ];

    const summary = aggregateRecords(records);
    const agent = summary.byAgent.find((a) => a.agentName === "Copilot CLI");
    assert.ok(agent);
    assert.equal(agent.sessionCount, 2);
    // avg tokens = (100000+10000+80000+8000) / 2 = 99000
    assert.equal(agent.avgTokensPerSession, 99000);
    // avg duration = (3600+1800) / 2 = 2700
    assert.equal(agent.avgDurationSeconds, 2700);
  });
});

// ── US2-S3: Success/failure rates ───────────────────────────────────────────

describe("aggregateRecords — success/failure rates (US2-S3)", () => {
  it("calculates success rate per model", () => {
    const records: TelemetryRecord[] = [
      makeRecord({ sessionHash: "aaaa111122223333", outcome: "success" }),
      makeRecord({ sessionHash: "bbbb444455556666", outcome: "completed" }),
      makeRecord({ sessionHash: "cccc777788889999", outcome: "success" }),
    ];

    const summary = aggregateRecords(records);
    const model = summary.byModel.find((m) => m.model === "claude-opus-4.6");
    assert.ok(model);
    // 2 success out of 3 sessions with this model
    assert.ok(model.successRate > 0.6);
  });

  it("shows outcome distribution", () => {
    const records: TelemetryRecord[] = [
      makeRecord({ sessionHash: "aaaa111122223333", outcome: "success" }),
      makeRecord({ sessionHash: "bbbb444455556666", outcome: "partial" }),
    ];

    const summary = aggregateRecords(records);
    assert.equal(summary.byOutcome.length, 2);
    const success = summary.byOutcome.find((o) => o.outcome === "success");
    const partial = summary.byOutcome.find((o) => o.outcome === "partial");
    assert.ok(success);
    assert.ok(partial);
    assert.equal(success.percentage, 0.5);
    assert.equal(partial.percentage, 0.5);
  });

  it("uses latest session end time for periodEnd", () => {
    const records: TelemetryRecord[] = [
      makeRecord({
        sessionHash: "aaaa111122223333",
        sessionStartedAt: "2026-05-17T10:00:00Z",
        sessionEndedAt: "2026-05-17T10:05:00Z",
      }),
      makeRecord({
        sessionHash: "bbbb444455556666",
        sessionStartedAt: "2026-05-17T11:00:00Z",
        sessionEndedAt: "2026-05-17T12:30:00Z",
      }),
    ];

    const summary = aggregateRecords(records);
    assert.equal(summary.periodEnd, "2026-05-17T12:30:00Z");
  });
});

// ── US2-S4: Empty data ──────────────────────────────────────────────────────

describe("renderReport — empty data (US2-S4)", () => {
  it("produces 'No data collected' message when no records", () => {
    const summary = aggregateRecords([]);
    const md = renderReport(summary);
    assert.ok(md.includes("No data collected"), `expected 'No data collected' in:\n${md}`);
    assert.ok(!md.includes("## Token Usage by Model"), "should not show model table");
  });
});

// ── Markdown validity ───────────────────────────────────────────────────────

describe("renderReport — valid Markdown (FR-011)", () => {
  it("produces valid Markdown with headers and tables", () => {
    const records: TelemetryRecord[] = [
      makeRecord({ sessionHash: "aaaa111122223333" }),
      makeRecord({ sessionHash: "bbbb444455556666", outcome: "partial" }),
    ];
    const summary = aggregateRecords(records);
    const md = renderReport(summary);

    assert.ok(md.startsWith("# Telemetry Report"));
    assert.ok(md.includes("## Token Usage by Model"));
    assert.ok(md.includes("## Token Usage by Agent"));
    assert.ok(md.includes("## Outcome Summary"));
    assert.ok(md.includes("|")); // has tables
  });
});
