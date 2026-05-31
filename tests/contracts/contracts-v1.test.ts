// Contract schema round-trip tests for the three v1 Phase 0 wave 3 contracts
// (issue #110). Loads each JSON Schema with Ajv 2020-12, verifies:
//  1. round-trips a known-good fixture (passes)
//  2. unknown schema_version is rejected
//  3. every required field, removed individually, is rejected
//  4. (audit-event) forbidden redaction fields (prompt/raw_error/args/payload) are rejected
//  5. (run-result) each workflow's business_result shape mismatch is rejected
//
// Schemas are the source of truth; TS types under shared/contracts/ will be
// generated from these in Phase 1 (FR-015 in spec.md).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// ajv + ajv-formats publish CJS. Using createRequire avoids the
// ESM-default-export quirks of NodeNext + esModuleInterop while keeping
// runtime behaviour identical to a plain require().
const Ajv2020 = require("ajv/dist/2020.js") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

const CONTRACTS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "specs",
  "005-web-control-panel",
  "contracts",
);

function loadSchema(name: string): Record<string, unknown> {
  const file = path.join(CONTRACTS_DIR, name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function makeValidator(schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function validRunResultRedeem() {
  return {
    schema_version: "1",
    correlation_id: "hmac-abc123",
    workflow: "redeem",
    triggered_by: "cyrusjamula",
    reason: "manual sweep before maintenance",
    started_at: "2026-05-31T22:00:00Z",
    finished_at: "2026-05-31T22:00:12Z",
    duration_ms: 12000,
    conclusion: "success",
    business_result: {
      claimed: 3,
      redeemed: 5,
      infra_errors: [],
    },
  };
}

function validRunResultDiscord() {
  return {
    schema_version: "1",
    correlation_id: "cron-12345",
    workflow: "discord-monitor",
    triggered_by: "schedule",
    reason: null,
    started_at: "2026-05-31T22:10:00Z",
    finished_at: "2026-05-31T22:10:08Z",
    duration_ms: 8000,
    conclusion: "success",
    business_result: {
      digests_added: 1,
      codes_extracted: 4,
      infra_errors: [],
    },
  };
}

function validRunResultRefresh() {
  return {
    schema_version: "1",
    correlation_id: "hmac-def456",
    workflow: "refresh-token",
    triggered_by: "cyrusjamula",
    reason: "rotate creds",
    started_at: "2026-05-31T22:20:00Z",
    finished_at: "2026-05-31T22:20:30Z",
    duration_ms: 30000,
    conclusion: "success",
    business_result: {
      token_refreshed_for: ["primary", "alt1"],
      infra_errors: [],
    },
  };
}

function validAuditEvent() {
  return {
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
}

function validChatToolCall() {
  return {
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
}

// ── Round-trip + unknown-version + required-field tests ─────────────────────

type Fixture = () => Record<string, unknown>;

function runContractSuite(
  schemaFile: string,
  validFixtures: Array<{ label: string; make: Fixture }>,
) {
  const schema = loadSchema(schemaFile);
  const validate = makeValidator(schema);

  describe(`${schemaFile} — round-trip + version + required-fields`, () => {
    for (const { label, make } of validFixtures) {
      it(`accepts known-good fixture (${label})`, () => {
        const fixture = make();
        const ok = validate(fixture);
        assert.ok(
          ok,
          `expected fixture to validate; errors=${JSON.stringify(validate.errors)}`,
        );
      });

      it(`rejects schema_version "2" (${label}) — unknown-version`, () => {
        const fixture = make();
        fixture.schema_version = "2";
        assert.equal(
          validate(fixture),
          false,
          "expected schema_version=2 to be rejected",
        );
      });
    }

    // Required-field test: use the first fixture as the baseline and remove
    // each required field individually; expect failure each time.
    const baseline = validFixtures[0]!.make();
    const required = (schema.required as string[]) ?? [];
    assert.ok(required.length > 0, `schema ${schemaFile} must declare required[]`);

    for (const field of required) {
      it(`rejects fixture missing required field "${field}"`, () => {
        const fixture = validFixtures[0]!.make();
        delete (fixture as Record<string, unknown>)[field];
        assert.equal(
          validate(fixture),
          false,
          `expected removal of required field "${field}" to be rejected`,
        );
      });
    }

    void baseline;
  });
}

runContractSuite("run-result.json", [
  { label: "redeem", make: validRunResultRedeem },
  { label: "discord-monitor", make: validRunResultDiscord },
  { label: "refresh-token", make: validRunResultRefresh },
]);

runContractSuite("audit-event.json", [
  { label: "ok ui dispatch", make: validAuditEvent },
]);

runContractSuite("chat-tool-call.json", [
  { label: "run_redeem confirm", make: validChatToolCall },
]);

// ── audit-event: redaction-by-design (forbidden fields) ─────────────────────

describe("audit-event.json — redaction-by-design", () => {
  const validate = makeValidator(loadSchema("audit-event.json"));

  for (const forbidden of ["prompt", "raw_error", "args", "payload"] as const) {
    it(`rejects fixture containing forbidden field "${forbidden}"`, () => {
      const fixture = validAuditEvent() as Record<string, unknown>;
      fixture[forbidden] = "this should never appear in the audit stream";
      assert.equal(
        validate(fixture),
        false,
        `expected audit event with "${forbidden}" to be rejected`,
      );
    });
  }
});

// ── run-result: workflow-specific business_result oneOf ─────────────────────

describe("run-result.json — workflow-specific business_result", () => {
  const validate = makeValidator(loadSchema("run-result.json"));

  it("rejects redeem with discord-monitor business_result shape", () => {
    const fixture = validRunResultRedeem() as Record<string, unknown>;
    fixture.business_result = {
      digests_added: 1,
      codes_extracted: 4,
      infra_errors: [],
    };
    assert.equal(
      validate(fixture),
      false,
      "expected wrong business_result shape for redeem to be rejected",
    );
  });

  it("rejects discord-monitor with refresh-token business_result shape", () => {
    const fixture = validRunResultDiscord() as Record<string, unknown>;
    fixture.business_result = {
      token_refreshed_for: ["primary"],
      infra_errors: [],
    };
    assert.equal(
      validate(fixture),
      false,
      "expected wrong business_result shape for discord-monitor to be rejected",
    );
  });

  it("rejects refresh-token with redeem business_result shape", () => {
    const fixture = validRunResultRefresh() as Record<string, unknown>;
    fixture.business_result = {
      claimed: 0,
      redeemed: 0,
      infra_errors: [],
    };
    assert.equal(
      validate(fixture),
      false,
      "expected wrong business_result shape for refresh-token to be rejected",
    );
  });

  it("rejects redeem business_result missing the `redeemed` sub-field", () => {
    const fixture = validRunResultRedeem() as Record<string, unknown>;
    fixture.business_result = { claimed: 1, infra_errors: [] };
    assert.equal(
      validate(fixture),
      false,
      "expected redeem business_result missing `redeemed` to be rejected",
    );
  });
});
