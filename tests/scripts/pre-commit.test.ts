/**
 * Tests for pre-commit enforcement checks (#8, #9, #10).
 *
 * The check functions are pure-ish: they read staged file lists, env vars,
 * and the filesystem. We use node:test mocking to isolate them.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────────────

/** Capture process.exit calls instead of actually exiting. */
function captureExit(): { code: number | null } {
  const state = { code: null as number | null };
  mock.method(process, "exit", ((c: number) => {
    state.code = c;
    throw new Error(`process.exit(${c})`);
  }) as any);
  return state;
}

// ── #8 — Constitution sync ──────────────────────────────────────────

describe("checkConstitutionSync", () => {
  let checkConstitutionSync: (
    staged: string[],
    readFile?: (p: string) => string,
    exists?: (p: string) => boolean,
  ) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkConstitutionSync = mod.checkConstitutionSync;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("passes when constitution.md is not staged", () => {
    checkConstitutionSync(["src/index.ts"]);
    assert.equal(exitState.code, null);
  });

  it("passes when both constitution.md and plan-template.md are staged", () => {
    checkConstitutionSync([
      ".specify/memory/constitution.md",
      ".specify/templates/plan-template.md",
    ]);
    assert.equal(exitState.code, null);
  });

  it("passes when constitution staged, template not staged, but no drift", () => {
    const content = "line about STFC_ACCOUNTS and discord.com\n";
    const readFile = () => content;
    const exists = () => true;

    checkConstitutionSync([".specify/memory/constitution.md"], readFile, exists);
    assert.equal(exitState.code, null);
  });

  it("fails when constitution staged, template not staged, and keywords drift", () => {
    const readFile = (p: string) => {
      if (p.includes("constitution")) {
        return "STFC_ACCOUNTS\nDISCORD_BOT_TOKEN\nhuggingface\n";
      }
      return "STFC_ACCOUNTS\nhuggingface\n";
    };
    const exists = () => true;

    assert.throws(
      () => checkConstitutionSync([".specify/memory/constitution.md"], readFile, exists),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails when template has extra keywords not in constitution", () => {
    const readFile = (p: string) => {
      if (p.includes("constitution")) {
        return "STFC_ACCOUNTS\n";
      }
      return "STFC_ACCOUNTS\nDISCORD_BOT_TOKEN\n";
    };
    const exists = () => true;

    assert.throws(
      () => checkConstitutionSync([".specify/memory/constitution.md"], readFile, exists),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });
});

// ── #9 — Squad boundary ─────────────────────────────────────────────

describe("checkSquadBoundary", () => {
  let checkSquadBoundary: (staged: string[]) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkSquadBoundary = mod.checkSquadBoundary;
    delete process.env.SQUAD_SCRIBE;
  });

  afterEach(() => {
    delete process.env.SQUAD_SCRIBE;
    mock.restoreAll();
  });

  it("passes for non-.squad/ files", () => {
    checkSquadBoundary(["src/index.ts", "package.json"]);
    assert.equal(exitState.code, null);
  });

  it("passes for .squad/ files that are NOT Scribe-owned", () => {
    checkSquadBoundary([".squad/team.md", ".squad/routing.md"]);
    assert.equal(exitState.code, null);
  });

  it("fails for .squad/agents/*/history.md without bypass", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/agents/scotty/history.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails for .squad/decisions.md without bypass", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/decisions.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails for .squad/decisions/inbox/* without bypass", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/decisions/inbox/001.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails for .squad/log/* without bypass", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/log/2026-05-16.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails for .squad/orchestration-log/* without bypass", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/orchestration-log/session.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("passes when SQUAD_SCRIBE=1 is set", () => {
    process.env.SQUAD_SCRIBE = "1";
    checkSquadBoundary([".squad/agents/scotty/history.md", ".squad/decisions.md"]);
    assert.equal(exitState.code, null);
  });

  it("error message mentions bypass instructions", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkSquadBoundary([".squad/log/session.md"]),
      /process\.exit\(1\)/,
    );
    const output = errors.join("\n");
    assert.match(output, /SQUAD_SCRIBE=1/);
    assert.match(output, /\[scribe\]/);
  });
});

// ── #11 — Portable filenames ─────────────────────────────────────────

describe("checkPortableFilenames", () => {
  let checkPortableFilenames: (staged: string[]) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkPortableFilenames = mod.checkPortableFilenames;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("passes for ordinary paths", () => {
    checkPortableFilenames(["src/index.ts", ".github/workflows/redeem.yml"]);
    assert.equal(exitState.code, null);
  });

  it("passes for the safe timestamp form", () => {
    checkPortableFilenames([".squad/log/2026-08-13T04-38-00Z-session.md"]);
    assert.equal(exitState.code, null);
  });

  it("fails for colons in a filename (the #186 regression)", () => {
    assert.throws(
      () => checkPortableFilenames([".squad/log/2026-05-12T05:16:11Z-clarify.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("fails for other Windows-illegal characters", () => {
    for (const bad of ["docs/what?.md", 'docs/a"b.md', "docs/a*b.md", "docs/a|b.md"]) {
      exitState = captureExit();
      assert.throws(() => checkPortableFilenames([bad]), /process\.exit\(1\)/);
      assert.equal(exitState.code, 1, `expected ${bad} to be rejected`);
    }
  });

  it("does not flag forward slashes as path separators", () => {
    checkPortableFilenames(["a/b/c/d.md"]);
    assert.equal(exitState.code, null);
  });

  it("error message suggests the safe timestamp format", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkPortableFilenames([".squad/log/2026-05-12T05:16:11Z-x.md"]),
      /process\.exit\(1\)/,
    );
    assert.match(errors.join("\n"), /2026-08-13T04-38-00Z/);
  });
});

// ── #10 — Workflow pinning tests ─────────────────────────────────────

describe("checkWorkflowPinningTests", () => {
  let checkWorkflowPinningTests: (staged: string[], grep?: (basename: string) => string[]) => void;
  let grepTestsForWorkflow: (basename: string) => string[];
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkWorkflowPinningTests = mod.checkWorkflowPinningTests;
    grepTestsForWorkflow = mod.grepTestsForWorkflow;
  });

  describe("pre-commit runner", () => {
    it("scans staged artifacts for secrets before running tests", () => {
      const source = readFileSync("scripts/pre-commit.mjs", "utf8");
      const scanAt = source.indexOf("check-artifact-hygiene.mjs --staged");
      const testAt = source.indexOf("npm test");
      assert.ok(scanAt >= 0, "artifact hygiene scanner must be enabled");
      assert.ok(testAt > scanAt, "artifact hygiene scanner must run before tests");
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("passes when no workflow files are staged", () => {
    checkWorkflowPinningTests(["src/index.ts"]);
    assert.equal(exitState.code, null);
  });

  it("passes when workflow staged but no tests reference it", () => {
    const grep = () => [] as string[];
    checkWorkflowPinningTests([".github/workflows/ci.yml"], grep);
    assert.equal(exitState.code, null);
  });

  it("passes when workflow staged and referencing tests are also staged", () => {
    const grep = () => ["tests/skills/discordMonitor.test.ts"];
    checkWorkflowPinningTests(
      [".github/workflows/discord-monitor.yml", "tests/skills/discordMonitor.test.ts"],
      grep,
    );
    assert.equal(exitState.code, null);
  });

  it("fails when workflow staged but referencing test is NOT staged", () => {
    const grep = () => ["tests/skills/discordMonitor.test.ts"];
    assert.throws(
      () => checkWorkflowPinningTests([".github/workflows/discord-monitor.yml"], grep),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("error message names the workflow and test file", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));
    const grep = () => ["tests/skills/redeemCodes.test.ts"];

    assert.throws(
      () => checkWorkflowPinningTests([".github/workflows/redeem.yml"], grep),
      /process\.exit\(1\)/,
    );
    const output = errors.join("\n");
    assert.match(output, /redeem\.yml/);
    assert.match(output, /tests\/skills\/redeemCodes\.test\.ts/);
  });

  it("handles multiple workflows with mixed pass/fail", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));
    const grep = (basename: string) => {
      if (basename === "redeem.yml") return ["tests/skills/redeemCodes.test.ts"];
      return [];
    };

    assert.throws(
      () =>
        checkWorkflowPinningTests(
          [".github/workflows/redeem.yml", ".github/workflows/ci.yml"],
          grep,
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("ignores self-referential matches in tests/scripts/pre-commit.test.ts", () => {
    // This file references workflow filenames only as fixture strings to
    // exercise the hook — they are not real pinning regression guards, so
    // they must NOT force the test file to be re-staged with every
    // workflow edit.
    const grep = () => ["tests/scripts/pre-commit.test.ts"];
    checkWorkflowPinningTests([".github/workflows/redeem.yml"], grep);
    assert.equal(exitState.code, null);
  });

  it("treats workflow names as text instead of shell commands", () => {
    assert.deepEqual(
      grepTestsForWorkflow("$(printf redeem).yml"),
      ["tests/scripts/pre-commit.test.ts"],
    );
  });
});
