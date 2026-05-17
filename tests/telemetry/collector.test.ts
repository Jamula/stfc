// Collector tests — extraction, dedup, audit logging.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { TelemetryRecordSchema, CollectionLogSchema } from "../../src/telemetry/schemas.ts";
import {
  hashSessionId,
  deriveTaskCategory,
  deriveOutcome,
  buildTelemetryRecord,
  loadExistingHashes,
  appendTelemetryRecord,
  appendCollectionLog,
} from "../../src/telemetry/collector.ts";
import type { ModelTierMap } from "../../src/telemetry/schemas.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TIER_MAP: ModelTierMap = {
  version: 1,
  tiers: { "claude-opus-4.6": "high", "gpt-5.4-mini": "standard" },
  defaultTier: "unknown",
};

function mockSession() {
  return {
    id: "test-session-id-12345",
    agent_name: "Copilot CLI",
    summary: "Implement the authentication module",
    created_at: "2026-05-17T10:00:00Z",
    updated_at: "2026-05-17T11:30:00Z",
  };
}

function mockUsageEvents() {
  return [
    {
      usage_model: "claude-opus-4.6",
      usage_input_tokens: 100000,
      usage_output_tokens: 7000,
      usage_cache_read_tokens: 45000,
    },
    {
      usage_model: "gpt-5.4-mini",
      usage_input_tokens: 25000,
      usage_output_tokens: 1500,
      usage_cache_read_tokens: 0,
    },
  ];
}

function mockRefs() {
  return [{ ref_type: "commit", ref_value: "abc123" }];
}

// ── hashSessionId ───────────────────────────────────────────────────────────

describe("hashSessionId", () => {
  it("produces 16 lowercase hex characters", () => {
    const hash = hashSessionId("test-session-id");
    assert.match(hash, /^[a-f0-9]{16}$/);
  });

  it("is deterministic", () => {
    const a = hashSessionId("same-id");
    const b = hashSessionId("same-id");
    assert.equal(a, b);
  });

  it("produces different hashes for different IDs", () => {
    const a = hashSessionId("id-1");
    const b = hashSessionId("id-2");
    assert.notEqual(a, b);
  });

  it("matches manual SHA-256 truncated to 16 hex", () => {
    const id = "test-session-123";
    const expected = crypto
      .createHash("sha256")
      .update(id)
      .digest("hex")
      .slice(0, 16);
    assert.equal(hashSessionId(id), expected);
  });
});

// ── deriveTaskCategory ──────────────────────────────────────────────────────

describe("deriveTaskCategory", () => {
  it("detects 'implementation' from summary", () => {
    assert.equal(deriveTaskCategory("Implement the auth module"), "implementation");
  });

  it("detects 'review' from summary", () => {
    assert.equal(deriveTaskCategory("Review PR #42"), "review");
  });

  it("detects 'testing' from summary", () => {
    assert.equal(deriveTaskCategory("Run tests for the API"), "testing");
  });

  it("detects 'planning' from speckit reference", () => {
    assert.equal(deriveTaskCategory("speckit.plan for feature 002"), "planning");
  });

  it("returns 'uncategorized' for unrecognized summaries", () => {
    assert.equal(deriveTaskCategory("random session"), "uncategorized");
  });

  it("returns 'uncategorized' for null/undefined summary", () => {
    assert.equal(deriveTaskCategory(null), "uncategorized");
    assert.equal(deriveTaskCategory(undefined), "uncategorized");
  });
});

// ── deriveOutcome ───────────────────────────────────────────────────────────

describe("deriveOutcome", () => {
  it("returns 'success' when session has commit refs", () => {
    assert.equal(deriveOutcome(mockRefs(), 5400), "success");
  });

  it("returns 'success' when session has PR refs", () => {
    assert.equal(
      deriveOutcome([{ ref_type: "pr", ref_value: "42" }], 5400),
      "success",
    );
  });

  it("returns 'partial' when no refs and short duration (<60s)", () => {
    assert.equal(deriveOutcome([], 30), "partial");
  });

  it("returns 'completed' when no refs but normal duration", () => {
    assert.equal(deriveOutcome([], 300), "completed");
  });

  it("returns 'completed' for empty refs with long duration", () => {
    assert.equal(deriveOutcome([], 5400), "completed");
  });
});

// ── buildTelemetryRecord ────────────────────────────────────────────────────

describe("buildTelemetryRecord", () => {
  it("extracts correct fields from mock session data (US1-S1)", () => {
    const record = buildTelemetryRecord(
      mockSession(),
      mockUsageEvents(),
      mockRefs(),
      TIER_MAP,
    );

    // Verify schema compliance
    const result = TelemetryRecordSchema.safeParse(record);
    assert.ok(result.success, `schema validation failed: ${JSON.stringify(result)}`);

    // Verify extracted values
    assert.equal(record.agentName, "Copilot CLI");
    assert.equal(record.inputTokens, 125000);
    assert.equal(record.outputTokens, 8500);
    assert.equal(record.cacheReadTokens, 45000);
    assert.equal(record.durationSeconds, 5400);
    assert.equal(record.outcome, "success");
    assert.equal(record.status, "complete");
    assert.equal(record.usageEventCount, 2);
    assert.equal(record.modelBreakdown.length, 2);
  });

  it("handles missing optional fields as null/unknown (US1-S2)", () => {
    const events = [
      {
        usage_model: null,
        usage_input_tokens: 5000,
        usage_output_tokens: 500,
        usage_cache_read_tokens: null,
      },
    ];
    const session = { ...mockSession(), summary: null };
    const record = buildTelemetryRecord(session, events, [], TIER_MAP);

    assert.ok(TelemetryRecordSchema.safeParse(record).success);
    assert.equal(record.taskCategory, "uncategorized");
    // Model breakdown should use "unknown" for null model
    assert.equal(record.modelBreakdown[0]!.model, "unknown");
  });

  it("marks interrupted session as partial (US1-S3)", () => {
    // Short duration, no refs → partial
    const session = {
      ...mockSession(),
      updated_at: "2026-05-17T10:00:30Z", // 30 seconds
    };
    const record = buildTelemetryRecord(session, mockUsageEvents(), [], TIER_MAP);
    assert.equal(record.outcome, "partial");
  });

  it("hashes session ID with SHA-256 truncated to 16 hex (FR-010)", () => {
    const record = buildTelemetryRecord(
      mockSession(),
      mockUsageEvents(),
      mockRefs(),
      TIER_MAP,
    );
    assert.match(record.sessionHash, /^[a-f0-9]{16}$/);
    // Verify it matches manual hash
    const expected = hashSessionId(mockSession().id);
    assert.equal(record.sessionHash, expected);
  });

  it("resolves model tiers correctly", () => {
    const record = buildTelemetryRecord(
      mockSession(),
      mockUsageEvents(),
      mockRefs(),
      TIER_MAP,
    );
    const opusBkdn = record.modelBreakdown.find((m) => m.model === "claude-opus-4.6");
    const miniBkdn = record.modelBreakdown.find((m) => m.model === "gpt-5.4-mini");
    assert.equal(opusBkdn?.tier, "high");
    assert.equal(miniBkdn?.tier, "standard");
  });
});

// ── Dedup + file I/O ────────────────────────────────────────────────────────

describe("loadExistingHashes", () => {
  it("returns empty set for nonexistent file", async () => {
    const hashes = await loadExistingHashes("/nonexistent/file.jsonl");
    assert.equal(hashes.size, 0);
  });

  it("parses existing JSONL and returns sessionHash set", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dedup-"));
    const tmpFile = path.join(tmpDir, "sessions.jsonl");
    const lines = [
      JSON.stringify({ sessionHash: "aaaa1111bbbb2222", extra: "data" }),
      JSON.stringify({ sessionHash: "cccc3333dddd4444", extra: "other" }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const hashes = await loadExistingHashes(tmpFile);
    assert.equal(hashes.size, 2);
    assert.ok(hashes.has("aaaa1111bbbb2222"));
    assert.ok(hashes.has("cccc3333dddd4444"));

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("appendTelemetryRecord", () => {
  it("appends a valid JSONL line", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "append-"));
    const tmpFile = path.join(tmpDir, "sessions.jsonl");

    const record = buildTelemetryRecord(
      mockSession(),
      mockUsageEvents(),
      mockRefs(),
      TIER_MAP,
    );
    await appendTelemetryRecord(tmpFile, record);

    const content = await fs.readFile(tmpFile, "utf-8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.ok(TelemetryRecordSchema.safeParse(parsed).success);

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("appendCollectionLog", () => {
  it("writes a valid collection log entry (FR-012)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "log-"));
    const tmpFile = path.join(tmpDir, "collection-log.jsonl");

    await appendCollectionLog(tmpFile, {
      runAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      sessionsProcessed: 5,
      sessionsSkipped: 2,
      errors: [],
      durationMs: 1200,
    });

    const content = await fs.readFile(tmpFile, "utf-8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.ok(CollectionLogSchema.safeParse(parsed).success);

    await fs.rm(tmpDir, { recursive: true });
  });
});
