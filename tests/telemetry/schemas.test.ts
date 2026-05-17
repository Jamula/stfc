// Schema validation tests for telemetry entities.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TelemetryRecordSchema,
  ModelUsageSchema,
  CollectionLogSchema,
  type TelemetryRecord,
} from "../../src/telemetry/schemas.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function validModelUsage() {
  return {
    model: "claude-opus-4.6",
    tier: "high",
    inputTokens: 100000,
    outputTokens: 7000,
    callCount: 15,
  };
}

function validRecord(): TelemetryRecord {
  return {
    sessionHash: "a1b2c3d4e5f67890",
    collectedAt: "2026-05-17T12:00:00Z",
    sessionStartedAt: "2026-05-17T10:00:00Z",
    sessionEndedAt: "2026-05-17T11:30:00Z",
    durationSeconds: 5400,
    inputTokens: 125000,
    outputTokens: 8500,
    cacheReadTokens: 45000,
    modelBreakdown: [validModelUsage()],
    agentName: "Copilot CLI",
    taskCategory: "implementation",
    outcome: "success",
    usageEventCount: 20,
    status: "complete",
  };
}

// ── TelemetryRecord ─────────────────────────────────────────────────────────

describe("TelemetryRecordSchema", () => {
  it("accepts a valid record", () => {
    const result = TelemetryRecordSchema.safeParse(validRecord());
    assert.ok(result.success, `expected success: ${JSON.stringify(result)}`);
  });

  it("rejects sessionHash that is not 16 hex chars", () => {
    const r = { ...validRecord(), sessionHash: "ZZZZ" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects uppercase hex in sessionHash", () => {
    const r = { ...validRecord(), sessionHash: "A1B2C3D4E5F67890" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects invalid timestamp format", () => {
    const r = { ...validRecord(), collectedAt: "2026-05-17 12:00:00" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects negative inputTokens", () => {
    const r = { ...validRecord(), inputTokens: -1 };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects negative outputTokens", () => {
    const r = { ...validRecord(), outputTokens: -5 };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects negative cacheReadTokens", () => {
    const r = { ...validRecord(), cacheReadTokens: -1 };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects empty modelBreakdown", () => {
    const r = { ...validRecord(), modelBreakdown: [] };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects invalid outcome value", () => {
    const r = { ...validRecord(), outcome: "failed" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects invalid status value", () => {
    const r = { ...validRecord(), status: "unknown" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });

  it("rejects extra unknown keys (strict mode)", () => {
    const r = { ...validRecord(), extraField: "nope" };
    assert.ok(!TelemetryRecordSchema.safeParse(r).success);
  });
});

// ── ModelUsage ──────────────────────────────────────────────────────────────

describe("ModelUsageSchema", () => {
  it("accepts valid model usage", () => {
    assert.ok(ModelUsageSchema.safeParse(validModelUsage()).success);
  });

  it("rejects negative callCount", () => {
    const m = { ...validModelUsage(), callCount: -1 };
    assert.ok(!ModelUsageSchema.safeParse(m).success);
  });

  it("rejects empty model name", () => {
    const m = { ...validModelUsage(), model: "" };
    assert.ok(!ModelUsageSchema.safeParse(m).success);
  });
});

// ── CollectionLog ───────────────────────────────────────────────────────────

describe("CollectionLogSchema", () => {
  it("accepts a valid collection log entry", () => {
    const log = {
      runAt: "2026-05-17T12:00:00Z",
      sessionsProcessed: 5,
      sessionsSkipped: 2,
      errors: [],
      durationMs: 1200,
    };
    assert.ok(CollectionLogSchema.safeParse(log).success);
  });

  it("accepts collection log with errors", () => {
    const log = {
      runAt: "2026-05-17T12:00:00Z",
      sessionsProcessed: 3,
      sessionsSkipped: 0,
      errors: ["session abc failed: timeout"],
      durationMs: 5000,
    };
    assert.ok(CollectionLogSchema.safeParse(log).success);
  });

  it("rejects negative sessionsProcessed", () => {
    const log = {
      runAt: "2026-05-17T12:00:00Z",
      sessionsProcessed: -1,
      sessionsSkipped: 0,
      errors: [],
      durationMs: 100,
    };
    assert.ok(!CollectionLogSchema.safeParse(log).success);
  });
});
