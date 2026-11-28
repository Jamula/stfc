import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DeadCodeCacheError,
  parsePromoCodes,
  readDeadCodes,
  readPromoCodes,
} from "../../src/lib/promoCodes.ts";

describe("parsePromoCodes", () => {
  it("parses simple newline list", () => {
    assert.deepEqual(parsePromoCodes("CODE1\nCODE2\n"), ["CODE1", "CODE2"]);
  });

  it("strips full-line comments", () => {
    assert.deepEqual(parsePromoCodes("# this is a comment\nCODE1\n"), ["CODE1"]);
  });

  it("strips inline comments", () => {
    assert.deepEqual(parsePromoCodes("CODE1   # bonus\n"), ["CODE1"]);
  });

  it("strips blank lines and whitespace", () => {
    assert.deepEqual(
      parsePromoCodes("\n  CODE1  \n\n  \nCODE2\n"),
      ["CODE1", "CODE2"],
    );
  });

  it("handles CRLF", () => {
    assert.deepEqual(parsePromoCodes("CODE1\r\nCODE2\r\n"), ["CODE1", "CODE2"]);
  });

  it("empty string → empty array", () => {
    assert.deepEqual(parsePromoCodes(""), []);
  });
});

describe("readPromoCodes", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-promo-"));
  });

  describe("readDeadCodes", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-dead-codes-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("treats a missing cache as empty and normalizes valid cache keys", async () => {
      const file = path.join(dir, "dead.json");
      assert.deepEqual(await readDeadCodes(file), new Set());
      fs.writeFileSync(file, JSON.stringify({
        " deadCode ": {
          marked_dead_at: "2026-05-15T00:00:00.000Z",
          first_seen_outcome: "CODE_INVALID_OR_EXPIRED",
          accounts_tried: ["main"],
        },
      }));
      assert.deepEqual(await readDeadCodes(file), new Set(["DEADCODE"]));
    });

    it("rejects malformed, invalid, and unreadable caches without revealing their contents", async () => {
      const file = path.join(dir, "dead.json");
      for (const raw of [
        '{"private-cache-content"',
        '[]',
        '{"private-cache-content":{"first_seen_outcome":"CODE_REDEEMED"}}',
      ]) {
        fs.writeFileSync(file, raw);
        await assert.rejects(readDeadCodes(file), (err: unknown) => {
          assert.ok(err instanceof DeadCodeCacheError);
          assert.doesNotMatch(err.message, /private-cache-content/);
          return true;
        });
      }
      await assert.rejects(readDeadCodes(dir), DeadCodeCacheError);
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for missing file", async () => {
    const codes = await readPromoCodes(path.join(dir, "does-not-exist.txt"));
    assert.deepEqual(codes, []);
  });

  it("reads and parses an existing file", async () => {
    const file = path.join(dir, "codes.txt");
    fs.writeFileSync(file, "# header\nALPHA\nBETA  # inline\n\nGAMMA\n", "utf8");
    const codes = await readPromoCodes(file);
    assert.deepEqual(codes, ["ALPHA", "BETA", "GAMMA"]);
  });
});
