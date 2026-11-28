/**
 * Tests for scripts/ci/check-api-auth.ts CI grep gate.
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
const SCRIPT = join(REPO_ROOT, "scripts/ci/check-api-auth.ts");
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

  it("excludes _lib handlers and non-handler TypeScript files", () => {
    const result = runGate(join(FIXTURES, "skipped"));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 handler\(s\) checked/);
  });

  // ── Position-aware enforcement ────────────────────────────────────────────

  it("exits 1 when the handler runs any statement BEFORE requireAllowedUser", () => {
    // A handler that imports + calls the auth
    // guard but executes `const log = console.log;` first must be flagged.
    // The legacy presence-only gate let this slip through.
    const result = runGate(join(FIXTURES, "badPosition"));
    assert.equal(
      result.status,
      1,
      `Expected exit 1 (auth-position violation), got ${result.status}. stdout: ${result.stdout}`,
    );
    assert.ok(
      result.stderr.includes("handlerLateAuth.ts"),
      `Expected offending filename in stderr. Got: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("first non-trivial statement"),
      `Expected position-violation diagnostic in stderr. Got: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("const log = console.log") ||
        result.stderr.includes("console.log"),
      `Expected offending statement excerpt in stderr. Got: ${result.stderr}`,
    );
  });

  it("exits 0 when the auth guard is the first statement INSIDE a leading try block", () => {
    // The canonical pattern from the swa-auth-shape-review skill wraps the
    // handler body in `try { requireAllowedUser(req); … } catch (e) { errorResponse(e) }`.
    // The hardened gate must descend into the leading `try {` opener and
    // recognise the auth guard as the first statement inside it.
    const result = runGate(join(FIXTURES, "goodTryWrap"));
    assert.equal(
      result.status,
      0,
      `Expected exit 0 (try-wrap canonical pattern), got ${result.status}. stderr: ${result.stderr}`,
    );
  });
});
