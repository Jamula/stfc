// Skill integration tests — full cycle, exit codes, result shape.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { telemetry } from "../../src/skills/telemetry.ts";
import { _resetTierCache } from "../../src/telemetry/tiers.ts";
import {
  appendTelemetryRecord,
  buildTelemetryRecord,
} from "../../src/telemetry/collector.ts";
import type { ModelTierMap } from "../../src/telemetry/schemas.ts";

// ── Setup ───────────────────────────────────────────────────────────────────

const TIER_MAP: ModelTierMap = {
  version: 1,
  tiers: { "claude-opus-4.6": "high", "gpt-5.4-mini": "standard" },
  defaultTier: "unknown",
};

let tmpDir: string;
let originalArgv: string[];
let originalSessionsEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-skill-"));
  await fs.mkdir(`${tmpDir}/reports`, { recursive: true });
  _resetTierCache();
  originalArgv = [...process.argv];
  originalSessionsEnv = process.env.TELEMETRY_SESSIONS_FILE;
});

afterEach(async () => {
  process.argv = originalArgv;
  if (originalSessionsEnv === undefined) {
    delete process.env.TELEMETRY_SESSIONS_FILE;
  } else {
    process.env.TELEMETRY_SESSIONS_FILE = originalSessionsEnv;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
  _resetTierCache();
});

// ── US4-S1: Full cycle ──────────────────────────────────────────────────────

describe("telemetry skill — full cycle (US4-S1)", () => {
  it("default (no subcommand) runs collect → recommend → report in sequence", async () => {
    // Seed sessions.jsonl with test data
    const record = buildTelemetryRecord(
      {
        id: "test-session-1",
        agent_name: "Copilot CLI",
        summary: "implement feature",
        created_at: "2026-05-17T10:00:00Z",
        updated_at: "2026-05-17T11:00:00Z",
      },
      [{ usage_model: "claude-opus-4.6", usage_input_tokens: 50000, usage_output_tokens: 3000, usage_cache_read_tokens: 10000 }],
      [{ ref_type: "commit", ref_value: "abc123" }],
      TIER_MAP,
    );
    await appendTelemetryRecord(`${tmpDir}/sessions.jsonl`, record);

    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
    });

    assert.equal(exitCode, 0);
    assert.equal(typeof result.sessionsCollected, "number");
    assert.equal(typeof result.sessionsSkipped, "number");
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.reportPath !== null, "report path should be set");
    assert.equal(typeof result.recommendations, "number");
  });

  it("returns exit code 0 for zero sessions", async () => {
    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
    });

    assert.equal(exitCode, 0);
    assert.equal(result.sessionsCollected, 0);
  });

  it("returns exit code 1 for infrastructure errors", async () => {
    const { exitCode } = await telemetry({
      modelTiersPath: "/nonexistent/model-tiers.json",
      dataDir: tmpDir,
    });

    assert.equal(exitCode, 1);
  });
});

// ── US4-S2: TelemetryResult shape ──────────────────────────────────────────

describe("telemetry skill — result shape (US4-S2)", () => {
  it("TelemetryResult contains all fields needed for audit trail", async () => {
    const { result } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "collect",
    });

    assert.ok("sessionsCollected" in result);
    assert.ok("sessionsSkipped" in result);
    assert.ok("errors" in result);
    assert.ok("reportPath" in result);
    assert.ok("recommendations" in result);
  });
});

// ── Individual subcommands ──────────────────────────────────────────────────

describe("telemetry skill — subcommands", () => {
  it("collect subcommand ingests sessions from --sessions-file JSONL", async () => {
    const sessionsFile = path.join(tmpDir, "sessions-input.jsonl");
    await fs.writeFile(
      sessionsFile,
      `${JSON.stringify({
        session: {
          id: "input-session-1",
          agent_name: "Copilot CLI",
          summary: "implement feature",
          created_at: "2026-05-17T10:00:00Z",
          updated_at: "2026-05-17T10:10:00Z",
        },
        usageEvents: [
          {
            usage_model: "claude-opus-4.6",
            usage_input_tokens: 1000,
            usage_output_tokens: 100,
            usage_cache_read_tokens: 0,
          },
        ],
        refs: [{ ref_type: "commit", ref_value: "abc123" }],
      })}\n`,
      "utf-8",
    );

    process.argv = ["node", "src/cli.ts", "telemetry", "collect", "--sessions-file", sessionsFile];

    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "collect",
    });

    assert.equal(exitCode, 0);
    assert.equal(result.sessionsCollected, 1);
    const collected = await fs.readFile(path.join(tmpDir, "sessions.jsonl"), "utf-8");
    assert.ok(collected.includes("\"sessionHash\""));
  });

  it("collect subcommand runs only collection", async () => {
    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "collect",
    });

    assert.equal(exitCode, 0);
    // report and recommendations should not be set
    assert.equal(result.reportPath, null);
    assert.equal(result.recommendations, 0);
  });

  it("report subcommand generates report from existing data", async () => {
    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "report",
    });

    assert.equal(exitCode, 0);
    assert.ok(result.reportPath !== null);
  });

  it("recommend subcommand generates recommendations only", async () => {
    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "recommend",
    });

    assert.equal(exitCode, 0);
    assert.equal(typeof result.recommendations, "number");
    assert.equal(result.reportPath, null);
  });

  it("collect subcommand accepts TELEMETRY_SESSIONS_FILE env var", async () => {
    const sessionsFile = path.join(tmpDir, "sessions-env-input.jsonl");
    await fs.writeFile(
      sessionsFile,
      `${JSON.stringify({
        session: {
          id: "input-session-env-1",
          agent_name: "Copilot CLI",
          summary: "implement feature",
          created_at: "2026-05-17T10:00:00Z",
          updated_at: "2026-05-17T10:10:00Z",
        },
        usageEvents: [
          {
            usage_model: "gpt-5.4-mini",
            usage_input_tokens: 500,
            usage_output_tokens: 50,
            usage_cache_read_tokens: 0,
          },
        ],
        refs: [{ ref_type: "commit", ref_value: "def456" }],
      })}\n`,
      "utf-8",
    );
    process.env.TELEMETRY_SESSIONS_FILE = sessionsFile;

    const { result, exitCode } = await telemetry({
      dataDir: tmpDir,
      modelTiersPath: "config/model-tiers.json",
      subcommand: "collect",
    });

    assert.equal(exitCode, 0);
    assert.equal(result.sessionsCollected, 1);
  });
});
