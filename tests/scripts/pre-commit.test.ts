/**
 * Tests for pre-commit enforcement checks.
 *
 * The check functions are pure-ish: they read staged file lists, env vars,
 * and the filesystem. We use node:test mocking to isolate them.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

type StagedRename = {
  status: string;
  source: string;
  destination: string;
};

function setupPreCommitTestRepo(dir: string): NodeJS.ProcessEnv {
  const scriptsDir = join(dir, "scripts");
  const binDir = join(dir, "bin");
  const isolatedGitEnv = { ...process.env };
  for (const key of Object.keys(isolatedGitEnv)) {
    if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
  }

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(binDir);
  writeFileSync(
    join(scriptsDir, "pre-commit.mjs"),
    readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
  );
  writeFileSync(
    join(scriptsDir, "pre-commit-checks.mjs"),
    readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
  );
  writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

  const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
  } else {
    writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }

  execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
  execFileSync("git", ["config", "user.name", "Pre-commit test"], {
    cwd: dir,
    env: isolatedGitEnv,
  });
  execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
    cwd: dir,
    env: isolatedGitEnv,
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, env: isolatedGitEnv });
  return isolatedGitEnv;
}

describe("parseNameStatus", () => {
  let parseNameStatus: (raw: string) => {
    staged: string[];
    deleted: string[];
    renamedFrom: string[];
    renames: StagedRename[];
  };

  beforeEach(async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    parseNameStatus = mod.parseNameStatus;
  });

  it("parses added/modified/deleted entries, including the deleted path in staged", () => {
    const raw = ["A", "src/new.ts", "M", "src/existing.ts", "D", "src/old.ts", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["src/new.ts", "src/existing.ts", "src/old.ts"],
      deleted: ["src/old.ts"],
      renamedFrom: [],
      renames: [],
    });
  });

  it("parses a rename into both staged (destination) and renamedFrom (source)", () => {
    const raw = ["R100", "docs/original.md", "docs/ordinary.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/ordinary.md"],
      deleted: [],
      renamedFrom: ["docs/original.md"],
      renames: [
        {
          status: "R100",
          source: "docs/original.md",
          destination: "docs/ordinary.md",
        },
      ],
    });
  });

  it("parses a copy the same way as a rename (destination staged, source tracked)", () => {
    const raw = ["C100", "docs/template.md", "docs/copy.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/copy.md"],
      deleted: [],
      renamedFrom: ["docs/template.md"],
      renames: [
        {
          status: "C100",
          source: "docs/template.md",
          destination: "docs/copy.md",
        },
      ],
    });
  });

  it("handles a mix of statuses in one diff, including the deleted path in staged", () => {
    const raw = [
      "A",
      "src/new.ts",
      "R087",
      "docs/previous.md",
      "docs/moved.md",
      "D",
      "src/old.ts",
      "",
    ].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["src/new.ts", "docs/moved.md", "src/old.ts"],
      deleted: ["src/old.ts"],
      renamedFrom: ["docs/previous.md"],
      renames: [
        {
          status: "R087",
          source: "docs/previous.md",
          destination: "docs/moved.md",
        },
      ],
    });
  });

  it("returns empty lists for empty input", () => {
    assert.deepEqual(parseNameStatus(""), {
      staged: [],
      deleted: [],
      renamedFrom: [],
      renames: [],
    });
  });
});

// ── #11 — Portable filenames ─────────────────────────────────────────

describe("checkPortableFilenames", () => {
  let checkPortableFilenames: (staged: string[], exists?: (path: string) => boolean) => void;
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
    checkPortableFilenames(["docs/log/2026-08-13T04-38-00Z-session.md"]);
    assert.equal(exitState.code, null);
  });

  it("fails for colons in a filename (the #186 regression)", () => {
    assert.throws(
      () => checkPortableFilenames(["docs/log/2026-05-12T05:16:11Z-clarify.md"], () => true),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("allows deleting legacy files with non-portable names", () => {
    checkPortableFilenames(["docs/log/2026-05-12T05:16:11Z-clarify.md"], () => false);
    assert.equal(exitState.code, null);
  });

  it("fails for other Windows-illegal characters", () => {
    for (const bad of ["docs/what?.md", 'docs/a"b.md', "docs/a*b.md", "docs/a|b.md"]) {
      exitState = captureExit();
      assert.throws(() => checkPortableFilenames([bad], () => true), /process\.exit\(1\)/);
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
      () => checkPortableFilenames(["docs/log/2026-05-12T05:16:11Z-x.md"], () => true),
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

    it("clears hook-only Git environment before running tests in nested repositories", () => {
      const source = readFileSync("scripts/pre-commit.mjs", "utf8");
      const envSetupAt = source.indexOf("const testEnv = { ...process.env };");
      const envClearAt = source.indexOf(
        "if (key.startsWith('GIT_')) delete testEnv[key];",
      );
      const testCallAt = source.indexOf("execSync('npm test'");

      assert.ok(envSetupAt >= 0, "the test runner must copy the process env");
      assert.ok(
        envClearAt > envSetupAt && envClearAt < testCallAt,
        "Git hook variables must be cleared before running the suite",
      );
      assert.ok(
        source.includes("env: testEnv"),
        "npm test must receive the sanitized environment",
      );
    });

    it("artifact hygiene scans index content rather than the working tree", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-hygiene-index-"));
      const scanner = resolve("scripts/check-artifact-hygiene.mjs");
      const artifact = join(dir, "docs", "capture.md");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }
      try {
        mkdirSync(join(dir, "docs"));
        execFileSync("git", ["init", "--quiet"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        const stagedSecret = [
          `eyJ${"a".repeat(10)}`,
          "b".repeat(10),
          "c".repeat(10),
        ].join(".");
        writeFileSync(artifact, stagedSecret);
        execFileSync("git", ["add", "docs/capture.md"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        writeFileSync(artifact, "<REDACTED>");

        const result = spawnSync(process.execPath, [scanner, "--staged"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /\[JWT\]/);
        assert.doesNotMatch(result.stderr, new RegExp(stagedSecret.replaceAll(".", "\\.")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("runs successfully in a repository with no agent-team state", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-"));
      try {
        const env = setupPreCommitTestRepo(dir);
        mkdirSync(join(dir, "src"));
        writeFileSync(join(dir, "src", "change.ts"), "export const value = 1;\n");
        execFileSync("git", ["add", "src/change.ts"], { cwd: dir, env });

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
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
