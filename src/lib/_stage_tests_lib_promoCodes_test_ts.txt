import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parsePromoCodes, readPromoCodes } from "../../src/lib/promoCodes.ts";

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
