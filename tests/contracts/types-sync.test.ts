/**
 * tests/contracts/types-sync.test.ts
 *
 * Verifies that:
 *  1. The generator runs without error for every schema.
 *  2. The generated .ts files exist at their expected paths.
 *  3. Compile-time: known-good fixtures are assignable to the generated types
 *     (TypeScript verifies this at `npm run typecheck`).
 *  4. The sync gate catches a mutated schema (diff-gate correctness).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SCHEMAS,
  OUTPUT_DIR,
  SCHEMAS_DIR,
  generateTypes,
  compileSchema,
} from "../../scripts/lib/generate-contracts.mjs";

// ── 1. Generator produces output for every schema ───────────────────────────

describe("contract generator — output exists for each schema", () => {
  for (const { file } of SCHEMAS) {
    it(`generates TypeScript from ${file} without throwing`, async () => {
      const ts = await generateTypes(file);
      assert.ok(ts.length > 0, `expected non-empty output for ${file}`);
      assert.ok(
        ts.includes("export type") || ts.includes("export interface"),
        `expected at least one exported type/interface in output for ${file}`,
      );
    });
  }
});

// ── 2. Generated files exist at expected paths ───────────────────────────────

describe("contract generator — output files are present on disk", () => {
  for (const { output } of SCHEMAS) {
    it(`shared/contracts/${output} exists`, () => {
      const p = path.join(OUTPUT_DIR, output);
      assert.ok(fs.existsSync(p), `${p} not found — run: npm run build:contracts`);
    });
  }
});

// ── 3. Generated files carry the auto-generated banner ───────────────────────

describe("contract generator — generated files have correct banner", () => {
  for (const { output, file } of SCHEMAS) {
    it(`${output} contains the auto-generated banner referencing ${file}`, () => {
      const p = path.join(OUTPUT_DIR, output);
      const content = fs.readFileSync(p, "utf8");
      assert.ok(
        content.includes("AUTO-GENERATED"),
        `${output} is missing the AUTO-GENERATED banner`,
      );
      assert.ok(
        content.includes(file),
        `${output} banner does not reference source schema ${file}`,
      );
    });
  }
});

// ── 4. run-result.ts exports a proper discriminated union ────────────────────

describe("run-result.ts — discriminated union exports", () => {
  it("exports all three variant interfaces", () => {
    const content = fs.readFileSync(path.join(OUTPUT_DIR, "run-result.ts"), "utf8");
    assert.ok(content.includes("export interface RedeemRunResult"), "missing RedeemRunResult");
    assert.ok(
      content.includes("export interface DiscordMonitorRunResult"),
      "missing DiscordMonitorRunResult",
    );
    assert.ok(
      content.includes("export interface RefreshTokenRunResult"),
      "missing RefreshTokenRunResult",
    );
  });

  it("exports the RunResult union type", () => {
    const content = fs.readFileSync(path.join(OUTPUT_DIR, "run-result.ts"), "utf8");
    assert.ok(
      content.includes("export type RunResult ="),
      "missing RunResult union type alias",
    );
    assert.ok(
      content.includes("RedeemRunResult") &&
        content.includes("DiscordMonitorRunResult") &&
        content.includes("RefreshTokenRunResult"),
      "RunResult union does not include all three variants",
    );
  });

  it('schema_version is the const literal "1" in every variant', () => {
    const content = fs.readFileSync(path.join(OUTPUT_DIR, "run-result.ts"), "utf8");
    // json-schema-to-typescript emits single-quoted literal '1' in generated output
    const matches = [...content.matchAll(/schema_version:\s*['"']1['"']/g)];
    assert.ok(
      matches.length >= 3,
      `expected schema_version: '1' in all 3 variants, found ${matches.length}`,
    );
  });
});

// ── 5. Sync gate — detects schema mutations ──────────────────────────────────

describe("sync gate — detects out-of-sync files", () => {
  it("regenerated content matches committed file for audit-event.json", async () => {
    const { output, file } = SCHEMAS.find((s) => s.file === "audit-event.json")!;
    const expected = await generateTypes(file);
    const actual = fs.readFileSync(path.join(OUTPUT_DIR, output), "utf8");
    assert.equal(actual, expected, `${output} is out of sync — run: npm run build:contracts`);
  });

  it("regenerated content matches committed file for chat-tool-call.json", async () => {
    const { output, file } = SCHEMAS.find((s) => s.file === "chat-tool-call.json")!;
    const expected = await generateTypes(file);
    const actual = fs.readFileSync(path.join(OUTPUT_DIR, output), "utf8");
    assert.equal(actual, expected, `${output} is out of sync — run: npm run build:contracts`);
  });

  it("regenerated content matches committed file for run-result.json", async () => {
    const { output, file } = SCHEMAS.find((s) => s.file === "run-result.json")!;
    const expected = await generateTypes(file);
    const actual = fs.readFileSync(path.join(OUTPUT_DIR, output), "utf8");
    assert.equal(actual, expected, `${output} is out of sync — run: npm run build:contracts`);
  });

  it("gate catches a mutated schema — adding a spurious field changes the output", async () => {
    // Load the real audit-event schema and mutate it (add a new property).
    const schemaPath = path.join(SCHEMAS_DIR, "audit-event.json");
    const mutated = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
    (mutated.properties as Record<string, unknown>)["mutated_field"] = {
      type: "string",
      description: "Intentionally injected to simulate schema drift.",
    };

    // Generate from the mutated schema.
    const mutatedTs = await compileSchema(mutated, "audit-event.json");

    // The committed file must NOT match the mutated output.
    const committed = fs.readFileSync(path.join(OUTPUT_DIR, "audit-event.ts"), "utf8");
    assert.notEqual(
      committed,
      mutatedTs,
      "expected mutated schema to produce different output (gate would catch it)",
    );
    assert.ok(
      mutatedTs.includes("mutated_field"),
      "expected mutated output to contain the injected field",
    );
  });
});

// ── 6. Compile-time type assignment (TypeScript verifies at typecheck) ────────
//
// These imports + assignments are intentionally NOT inside test blocks — they
// are checked by `tsc --noEmit` (`npm run typecheck`) at compile time.
// If the generated types regress, typecheck will fail before tests even run.

import type { RunResult, RedeemRunResult } from "../../shared/contracts/run-result.js";
import type { AuditEvent } from "../../shared/contracts/audit-event.js";
import type { ChatToolCall } from "../../shared/contracts/chat-tool-call.js";

// Redeem variant
const _redeem: RedeemRunResult = {
  schema_version: "1",
  correlation_id: "hmac-abc123",
  workflow: "redeem",
  triggered_by: "cyrusjamula",
  reason: "manual sweep before maintenance",
  started_at: "2026-05-31T22:00:00Z",
  finished_at: "2026-05-31T22:00:12Z",
  duration_ms: 12000,
  conclusion: "success",
  business_result: { claimed: 3, redeemed: 5, infra_errors: [] },
};

// Union type accepts redeem variant
const _runResult: RunResult = _redeem;

// AuditEvent
const _audit: AuditEvent = {
  schema_version: "1",
  ts: "2026-05-31T22:30:00Z",
  actor: "cyrusjamula",
  action: "/api/ops/redeem",
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  result: "ok",
  latency_ms: 142,
  surface: "ui",
  workflow: "redeem",
  run_id: "9876543210",
  correlation_id: "hmac-abc123",
  error_code: null,
};

// ChatToolCall
const _chat: ChatToolCall = {
  schema_version: "1",
  tool_name: "run_redeem",
  args: { reason: "manual sweep" },
  actor: "cyrusjamula",
  session_id: "sess-2026-05-31-001",
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  reason: "manual sweep before maintenance",
  idempotency_key: "hmac-key-xyz",
  issued_at: "2026-05-31T22:40:00Z",
  ttl_seconds: 60,
};

// Silence "unused variable" warnings while keeping tsc happy.
void _redeem;
void _runResult;
void _audit;
void _chat;
