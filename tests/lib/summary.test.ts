import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSummaryWriter, table, heading, bullet } from "../../src/lib/summary.ts";

describe("createSummaryWriter", () => {
  let dir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-summary-"));
    savedEnv = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = savedEnv;
  });

  it("no envValue & no GITHUB_STEP_SUMMARY → no-op writer", async () => {
    const summary = createSummaryWriter(undefined);
    assert.equal(summary.path, null);
    await summary.append("anything"); // must not throw
    // No file produced anywhere we can check; assertion is just no-throw.
  });

  it("explicit envValue writes to that path", async () => {
    const file = path.join(dir, "step-summary.md");
    const summary = createSummaryWriter(file);
    assert.equal(summary.path, file);
    await summary.append("# hi\n");
    await summary.append("more\n");
    const contents = fs.readFileSync(file, "utf8");
    assert.equal(contents, "# hi\nmore\n");
  });

  it("appends a trailing newline if missing", async () => {
    const file = path.join(dir, "s.md");
    const summary = createSummaryWriter(file);
    await summary.append("no newline");
    const contents = fs.readFileSync(file, "utf8");
    assert.equal(contents, "no newline\n");
  });
});

describe("table", () => {
  it("renders a basic Markdown table", () => {
    const out = table(["A", "B"], [["1", "2"], ["3", "4"]]);
    assert.equal(
      out,
      [
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "| 3 | 4 |",
        "",
      ].join("\n"),
    );
  });

  it("escapes pipe characters in cells", () => {
    const out = table(["X"], [["a|b"]]);
    assert.match(out, /\| a\\\|b \|/);
  });

  it("returns empty string for no headers", () => {
    assert.equal(table([], [["x"]]), "");
  });
});

describe("heading", () => {
  it("renders levels 1-3", () => {
    assert.equal(heading(1, "x"), "# x\n");
    assert.equal(heading(2, "x"), "## x\n");
    assert.equal(heading(3, "x"), "### x\n");
  });
});

describe("bullet", () => {
  it("renders a bullet line", () => {
    assert.equal(bullet("hi"), "- hi\n");
  });
});
