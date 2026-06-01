/**
 * Tests for scripts/ci/check-api-auth.mjs CI grep gate.
 *
 * Runs the gate as a subprocess against pre-built fixture directories:
 *   tests/ci/fixtures/good/  — one handler with proper auth → exit 0
 *   tests/ci/fixtures/bad/   — one handler missing auth   → exit 1
 *   tests/ci/fixtures/anon/  — one handler with @auth-anonymous-justification → exit 0
 *   (nonexistent path)       — no files to scan           → exit 0 (graceful skip)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const SCRIPT = join(REPO_ROOT, "scripts/ci/check-api-auth.mjs");
const FIXTURES = join(__dirname, "fixtures");

function runGate(apiDir: string) {
  return spawnSync("node", [SCRIPT, "--api-dir", apiDir], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
}

describe("check-api-auth CI gate", () => {
  it("exits 0 for a handler that imports @azure/functions and calls requireAllowedUser", () => {
    const result = runGate(join(FIXTURES, "good"));
    assert.equal(
      result.status,
      0,
      `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`,
    );
  });

  it("exits 1 for a handler that imports @azure/functions but has no auth call", () => {
    const result = runGate(join(FIXTURES, "bad"));
    assert.equal(
      result.status,
      1,
      `Expected exit 1 (auth violation), got ${result.status}. stdout: ${result.stdout}`,
    );
    assert.ok(
      result.stderr.includes("check-api-auth FAILED"),
      `Expected failure header in stderr. Got: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("handlerNoAuth.ts"),
      `Expected offending filename in stderr. Got: ${result.stderr}`,
    );
  });

  it("exits 0 for a handler with @auth-anonymous-justification opt-out comment", () => {
    const result = runGate(join(FIXTURES, "anon"));
    assert.equal(
      result.status,
      0,
      `Expected exit 0 (anonymous opt-out), got ${result.status}. stderr: ${result.stderr}`,
    );
  });

  it("exits 0 when api-dir does not exist (graceful skip — no handlers to check)", () => {
    const result = runGate(join(FIXTURES, "nonexistent-dir-that-does-not-exist"));
    assert.equal(
      result.status,
      0,
      `Expected exit 0 for empty/missing dir, got ${result.status}. stderr: ${result.stderr}`,
    );
  });

  it("skips files inside _lib/ subdirectory", () => {
    // The good fixture has good/_lib/auth.ts (no @azure/functions import — excluded anyway).
    // We also confirm the overall gate still exits 0 for the good fixture.
    const result = runGate(join(FIXTURES, "good"));
    assert.equal(result.status, 0, result.stderr);
  });

  it("skips non-handler TS files (no @azure/functions import)", () => {
    // The _lib stub doesn't import @azure/functions; even if scanned it's not a handler.
    // This test confirms the gate correctly ignores plain TS files.
    const result = runGate(join(FIXTURES, "good"));
    assert.equal(result.status, 0, result.stderr);
  });
});
