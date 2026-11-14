// Regression tests for issue #211:
// bug(security): capture-token error may echo the raw STFC_ACCOUNTS value
//
// Verifies that parse errors from mergeIntoEnv do NOT include the raw
// STFC_ACCOUNTS line contents (which may contain live JWTs) in thrown
// error messages.  All token values used here are clearly fake fixtures.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { mergeIntoEnv } from "../../scripts/capture-token.mjs";

// ---------------------------------------------------------------------------
// Fake fixture values — clearly not real credentials.
// ---------------------------------------------------------------------------
const FAKE_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".FAKE_PAYLOAD_NOT_A_REAL_JWT" +
  ".FAKE_SIGNATURE";

const MALFORMED_VALUE = `NOT_VALID_JSON_${FAKE_TOKEN}`;
const NON_ARRAY_VALUE = JSON.stringify({ not: "an array", token: FAKE_TOKEN });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpEnv(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "stfc-test-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, content, "utf8");
  return envFile;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeIntoEnv error redaction (issue #211)", () => {
  const tmpDirs: string[] = [];

  after(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("malformed JSON error does not contain the raw STFC_ACCOUNTS value", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${MALFORMED_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    let caughtError: Error | undefined;
    try {
      await mergeIntoEnv({
        name: "test-account",
        token: "new-fake-token",
        force: false,
        _envPath: envFile,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    assert.ok(caughtError, "Expected an error to be thrown");
    assert.ok(
      !caughtError.message.includes(MALFORMED_VALUE),
      `Error message must not contain raw STFC_ACCOUNTS value.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      !caughtError.message.includes(FAKE_TOKEN),
      `Error message must not contain fake token string.\nGot: ${caughtError.message}`,
    );
    // Should still report file/line for actionability
    assert.ok(
      caughtError.message.includes("line 1"),
      `Error should report the line number.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("STFC_ACCOUNTS"),
      `Error should name the field.\nGot: ${caughtError.message}`,
    );
  });

  it("non-array JSON error does not contain the raw STFC_ACCOUNTS value", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${NON_ARRAY_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    let caughtError: Error | undefined;
    try {
      await mergeIntoEnv({
        name: "test-account",
        token: "new-fake-token",
        force: false,
        _envPath: envFile,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    assert.ok(caughtError, "Expected an error to be thrown");
    assert.ok(
      !caughtError.message.includes(NON_ARRAY_VALUE),
      `Error message must not contain raw STFC_ACCOUNTS value.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      !caughtError.message.includes(FAKE_TOKEN),
      `Error message must not contain fake token string.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("line 1"),
      `Error should report the line number.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("STFC_ACCOUNTS"),
      `Error should name the field.\nGot: ${caughtError.message}`,
    );
  });

  it("force=true with malformed JSON overwrites without throwing", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${MALFORMED_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    const result = await mergeIntoEnv({
      name: "test-account",
      token: "new-fake-token",
      force: true,
      _envPath: envFile,
    });

    assert.ok(Array.isArray(result), "Should return an array on force=true");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "test-account");
  });
});
