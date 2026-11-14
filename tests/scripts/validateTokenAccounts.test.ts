import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/validate-token-accounts.mjs");
const TOKEN = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature";

function validateMigrationData(value: unknown): ReturnType<typeof spawnSync> {
  const directory = mkdtempSync(join(tmpdir(), "stfc-account-validation-"));
  const file = join(directory, "accounts.json");
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  try {
    return spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("legacy account-token migration validation", () => {
  it("accepts account records matching the token API schema", () => {
    const result = validateMigrationData([
      { name: "main", token: TOKEN },
      { name: "alt-1.example", token: TOKEN },
    ]);

    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "");
    assert.equal(result.stderr.toString(), "");
  });

  it("rejects account data the token API cannot read before upload", () => {
    const invalid = [
      [],
      [{ name: "main account", token: TOKEN }],
      [{ name: "x".repeat(65), token: TOKEN }],
      [{ name: "main", token: "not-a-jwt" }],
      [{ name: "main", token: TOKEN, extra: true }],
      [{ name: "main", token: TOKEN }, { name: "main", token: TOKEN }],
    ];

    for (const value of invalid) {
      const result = validateMigrationData(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr.toString(), /Account-token data is invalid/);
      assert.equal(result.stderr.toString().includes(TOKEN), false);
    }
  });
});
