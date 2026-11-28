/**
 * Tests for pre-commit enforcement checks.
 *
 * The check functions are pure-ish: they read staged file lists, env vars,
 * and the filesystem. We use node:test mocking to isolate them.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

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
    join(scriptsDir, "pre-commit.ts"),
    readFileSync(resolve("scripts/pre-commit.ts"), "utf8"),
  );
  writeFileSync(
    join(scriptsDir, "pre-commit-checks.ts"),
    readFileSync(resolve("scripts/pre-commit-checks.ts"), "utf8"),
  );
  writeFileSync(join(scriptsDir, "check-artifact-hygiene.ts"), "process.exit(0);\n");

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
    const mod = await import("../../scripts/pre-commit-checks.ts");
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
    const mod = await import("../../scripts/pre-commit-checks.ts");
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
    const mod = await import("../../scripts/pre-commit-checks.ts");
    checkWorkflowPinningTests = mod.checkWorkflowPinningTests;
    grepTestsForWorkflow = mod.grepTestsForWorkflow;
  });

  describe("pre-commit runner", () => {
    it("scans staged artifacts for secrets before running tests", () => {
      const source = readFileSync("scripts/pre-commit.ts", "utf8");
      const scanAt = source.indexOf("check-artifact-hygiene.ts --staged");
      const testAt = source.indexOf("npm test");
      assert.ok(scanAt >= 0, "artifact hygiene scanner must be enabled");
      assert.ok(testAt > scanAt, "artifact hygiene scanner must run before tests");
    });

    it("clears hook-only Git environment before running tests in nested repositories", () => {
      const source = readFileSync("scripts/pre-commit.ts", "utf8");
      const envSetupAt = source.indexOf("const testEnv");
      const envClearAt = source.indexOf(
        'if (key.startsWith("GIT_")) delete testEnv[key];',
      );
      const testCallAt = source.indexOf('execSync("npm test"');

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
      const scanner = resolve("scripts/check-artifact-hygiene.ts");
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
        const output = `${result.stdout}${result.stderr}`;
        assert.equal(result.status, 1);
        assert.match(output, /\[JWT\]/);
        assert.match(output, /matched content → <REDACTED-TOKEN>/);
        assert.doesNotMatch(output, new RegExp(stagedSecret.replaceAll(".", "\\.")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("scans staged JSONL and HTML files for raw tokens", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-hygiene-jsonl-"));
      const scanner = resolve("scripts/check-artifact-hygiene.ts");
      const artifact = join(dir, "data", "discord", "records.JSONL");
      const html = join(dir, "web", "index.html");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }
      const secret = "sensitive-upstream-token-value";
      const jwt = [
        `eyJ${"a".repeat(10)}`,
        "b".repeat(10),
        "c".repeat(10),
      ].join(".");
      try {
        mkdirSync(join(dir, "data", "discord"), { recursive: true });
        mkdirSync(join(dir, "web"), { recursive: true });
        execFileSync("git", ["init", "--quiet"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        writeFileSync(artifact, `{"access_token":"${secret}"}\n`);
        writeFileSync(html, `<script>const token = "${jwt}";</script>\n`);
        execFileSync("git", ["add", "data/discord/records.JSONL", "web/index.html"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const result = spawnSync(process.execPath, [scanner, "--staged"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        const output = `${result.stdout}${result.stderr}`;
        assert.equal(result.status, 1);
        assert.match(output, /\[STFC_RAW_UPSTREAM_RESPONSE\]/);
        assert.match(output, /web[\\/]index\.html:1  \[JWT\]/);
        assert.match(output, /matched content → <REDACTED-TOKEN>/);
        assert.doesNotMatch(output, new RegExp(secret));
        assert.doesNotMatch(output, new RegExp(jwt.replaceAll(".", "\\.")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("scans changed contribution documents and source code for secrets and account data", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-hygiene-changed-"));
      const scanner = resolve("scripts/check-artifact-hygiene.ts");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      const secret = `eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`;
      const accountField = '"account_' + 'id": 12345';
      try {
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Artifact hygiene test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "artifact-hygiene@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        writeFileSync(join(dir, "SECURITY.md"), "Safe reporting guidance.\n");
        writeFileSync(join(dir, "CHANGELOG.md"), "Safe change log.\n");
        mkdirSync(join(dir, "config"));
        writeFileSync(join(dir, "config", "discord-allowlist.json"), "{}\n");
        mkdirSync(join(dir, "data", "crew", "roster"), { recursive: true });
        writeFileSync(join(dir, "data", "crew", "roster", "demo.yaml"), "account: demo\n");
        mkdirSync(join(dir, "discord"));
        writeFileSync(join(dir, "discord", "commands.json"), "{}\n");
        mkdirSync(join(dir, "src"));
        writeFileSync(join(dir, "src", "example.ts"), "export const account = {};\n");
        mkdirSync(join(dir, "scripts"));
        writeFileSync(join(dir, "scripts", "types.d.mts"), "export {};\n");
        mkdirSync(join(dir, "shared"));
        writeFileSync(join(dir, "shared", "example.ts"), "export const token = 'safe';\n");
        mkdirSync(join(dir, "web"));
        writeFileSync(join(dir, "web", "index.html"), "<main>safe</main>\n");
        execFileSync("git", ["add", "."], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "base"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        writeFileSync(join(dir, "SECURITY.md"), `Token: ${secret}\n`);
        writeFileSync(join(dir, "CHANGELOG.md"), `Token: ${secret}\n`);
        writeFileSync(join(dir, "config", "discord-allowlist.json"), `{"token":"${secret}"}\n`);
        writeFileSync(join(dir, "data", "crew", "roster", "demo.yaml"), `token: ${secret}\n`);
        writeFileSync(join(dir, "discord", "commands.json"), `{"token":"${secret}"}\n`);
        writeFileSync(
          join(dir, "src", "example.ts"),
          `const token = "${secret}";\nconst account = {${accountField}};\n`,
        );
        writeFileSync(join(dir, "scripts", "types.d.mts"), `const token = "${secret}";\n`);
        writeFileSync(join(dir, "shared", "example.ts"), `export const token = "${secret}";\n`);
        writeFileSync(join(dir, "web", "index.html"), `<script>${secret}</script>\n`);
        execFileSync("git", ["add", "."], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "change"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const result = spawnSync(process.execPath, [scanner, "--base-ref", "HEAD^"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        const output = `${result.stdout}${result.stderr}`;
        assert.equal(result.status, 1);
        assert.match(output, /SECURITY\.md:\d+  \[JWT\]/);
        assert.match(output, /CHANGELOG\.md:\d+  \[JWT\]/);
        assert.match(output, /config[\\/]discord-allowlist\.json:1  \[JWT\]/);
        assert.match(output, /data[\\/]crew[\\/]roster[\\/]demo\.yaml:1  \[JWT\]/);
        assert.match(output, /discord[\\/]commands\.json:1  \[JWT\]/);
        assert.match(output, /src[\\/]example\.ts:1  \[JWT\]/);
        assert.match(output, /src[\\/]example\.ts:2  \[STFC_ACCOUNT_DATA\]/);
        assert.match(output, /scripts[\\/]types\.d\.mts:1  \[JWT\]/);
        assert.match(output, /shared[\\/]example\.ts:1  \[JWT\]/);
        assert.match(output, /web[\\/]index\.html:1  \[JWT\]/);
        assert.match(output, /matched content → <REDACTED-TOKEN>/);
        assert.doesNotMatch(output, new RegExp(secret.replaceAll(".", "\\.")));
        assert.doesNotMatch(output, /12345/);

        writeFileSync(join(dir, "SECURITY.md"), "Safe reporting guidance.\n");
        writeFileSync(join(dir, "CHANGELOG.md"), "Safe change log.\n");
        writeFileSync(join(dir, "config", "discord-allowlist.json"), "{}\n");
        writeFileSync(join(dir, "data", "crew", "roster", "demo.yaml"), "account: demo\n");
        writeFileSync(join(dir, "discord", "commands.json"), "{}\n");
        writeFileSync(join(dir, "src", "example.ts"), "export const account = {};\n");
        writeFileSync(join(dir, "scripts", "types.d.mts"), "export {};\n");
        writeFileSync(join(dir, "shared", "example.ts"), "export const token = 'safe';\n");
        writeFileSync(join(dir, "web", "index.html"), "<main>safe</main>\n");
        const cleanArtifact = spawnSync(process.execPath, [scanner, "--base-ref", "HEAD^"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(cleanArtifact.status, 0, cleanArtifact.stderr);
        assert.match(cleanArtifact.stdout, /9 file\(s\) scanned, 0 violations/);
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

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.ts")], {
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

  it("does not confuse a prefixed workflow name with an exact filename", () => {
    assert.ok(
      grepTestsForWorkflow("test-gate.yml").includes(
        "tests/workflows/workflow-consolidation.test.ts",
      ),
    );
    assert.ok(
      !grepTestsForWorkflow("gate.yml").includes(
        "tests/workflows/workflow-consolidation.test.ts",
      ),
    );
  });
});

// ── Coding-style & structural repository invariants ───────────────────

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function normalizeLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function walkFiles(
  rootDir: string,
  predicate: (relPosix: string) => boolean,
  skipDirs: ReadonlySet<string> = new Set([
    ".git",
    "node_modules",
    "dist",
    "dist-demo",
    ".wrangler",
    "coverage",
  ]),
): string[] {
  const results: string[] = [];
  function visit(currentDir: string): void {
    if (!existsSync(currentDir)) return;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          visit(join(currentDir, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relPosix = toPosixPath(relative(REPO_ROOT, join(currentDir, entry.name)));
      if (predicate(relPosix)) {
        results.push(relPosix);
      }
    }
  }
  visit(rootDir);
  return results.sort();
}

function evaluateTestRegistration(
  discoveredFromTestsDir: readonly string[],
  indexSource: string,
): {
  unregistered: string[];
  missingOnDisk: string[];
  duplicates: string[];
} {
  const normalized = normalizeLf(indexSource);
  const imported: string[] = [];
  const importRegex = /^\s*import\s+["']\.\/([^"']+)["']\s*;?\s*$/gm;
  for (const match of normalized.matchAll(importRegex)) {
    const rawTarget = match[1]!.replace(/\.test\.js$/, ".test.ts");
    imported.push(rawTarget);
  }

  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  for (const spec of imported) {
    if (seen.has(spec)) duplicateSet.add(spec);
    seen.add(spec);
  }

  const discoveredSet = new Set(discoveredFromTestsDir);
  const unregistered = discoveredFromTestsDir.filter((file) => !seen.has(file));
  const missingOnDisk = [...seen].filter((file) => !discoveredSet.has(file));

  return {
    unregistered,
    missingOnDisk,
    duplicates: [...duplicateSet].sort(),
  };
}

function findManifestIndentationViolations(fileLabel: string, rawContent: string): string[] {
  const normalized = normalizeLf(rawContent);
  const violations: string[] = [];
  if (!normalized.endsWith("\n")) {
    violations.push(`${fileLabel}: missing trailing newline`);
  }
  const lines = normalized.split("\n");
  let depth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;

    const ws = /^[ \t]*/.exec(line)?.[0] ?? "";
    const trimmed = line.slice(ws.length);

    if (ws.includes("\t")) {
      violations.push(`${fileLabel}:${i + 1}: uses tab indentation`);
    } else if (trimmed.length > 0) {
      if (inBlockComment) {
        const expectedCommentSpaces = trimmed.startsWith("*") ? depth * 2 + 1 : depth * 2;
        if (ws.length !== expectedCommentSpaces && ws.length !== depth * 2) {
          violations.push(
            `${fileLabel}:${i + 1}: expected ${expectedCommentSpaces} leading spaces inside block comment, got ${ws.length}`,
          );
        }
      } else {
        let leadingClosers = 0;
        while (
          leadingClosers < trimmed.length &&
          (trimmed[leadingClosers] === "}" || trimmed[leadingClosers] === "]")
        ) {
          leadingClosers++;
        }
        const expectedSpaces = Math.max(0, depth - leadingClosers) * 2;
        if (ws.length !== expectedSpaces) {
          violations.push(
            `${fileLabel}:${i + 1}: expected ${expectedSpaces} leading spaces for nesting depth, got ${ws.length}`,
          );
        }
      }
    }

    let inString = false;
    for (let j = 0; j < trimmed.length; j++) {
      const ch = trimmed[j]!;
      if (inBlockComment) {
        if (ch === "*" && trimmed[j + 1] === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (inString) {
        if (ch === "\\" && j + 1 < trimmed.length) {
          j++;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "/" && trimmed[j + 1] === "/") {
        break;
      } else if (ch === "/" && trimmed[j + 1] === "*") {
        inBlockComment = true;
        j++;
      } else if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return violations;
}

function parseEditorConfig(rawContent: string): {
  root: string | undefined;
  wildcard: Record<string, string>;
} {
  const lines = normalizeLf(rawContent).split("\n");
  let root: string | undefined;
  let currentSection: string | null = null;
  const wildcard: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim();
      continue;
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim().toLowerCase();
    if (currentSection === null && key === "root") {
      root = val;
    } else if (currentSection === "*") {
      wildcard[key] = val;
    }
  }
  return { root, wildcard };
}

function evaluateStyleConfigAlignment(editorRaw: string, prettierRaw: string): string[] {
  const issues: string[] = [];
  const editor = parseEditorConfig(editorRaw);
  let prettier: Record<string, unknown>;
  try {
    prettier = JSON.parse(prettierRaw) as Record<string, unknown>;
  } catch (err) {
    return [`Invalid .prettierrc.json: ${(err as Error).message}`];
  }

  if (editor.root !== "true") {
    issues.push(".editorconfig must set root = true");
  }
  if (editor.wildcard["charset"] !== "utf-8") {
    issues.push(`.editorconfig [*] charset expected "utf-8", got "${editor.wildcard["charset"]}"`);
  }
  if (editor.wildcard["indent_style"] !== "space") {
    issues.push(`.editorconfig [*] indent_style expected "space", got "${editor.wildcard["indent_style"]}"`);
  }
  if (editor.wildcard["indent_size"] !== "2") {
    issues.push(`.editorconfig [*] indent_size expected "2", got "${editor.wildcard["indent_size"]}"`);
  }
  if (editor.wildcard["end_of_line"] !== "lf") {
    issues.push(`.editorconfig [*] end_of_line expected "lf", got "${editor.wildcard["end_of_line"]}"`);
  }
  if (editor.wildcard["insert_final_newline"] !== "true") {
    issues.push(".editorconfig [*] must set insert_final_newline = true");
  }
  if (editor.wildcard["trim_trailing_whitespace"] !== "true") {
    issues.push(".editorconfig [*] must set trim_trailing_whitespace = true");
  }

  if (prettier["useTabs"] !== false) {
    issues.push(`.prettierrc.json useTabs expected false, got ${String(prettier["useTabs"])}`);
  }
  if (prettier["tabWidth"] !== 2) {
    issues.push(`.prettierrc.json tabWidth expected 2, got ${String(prettier["tabWidth"])}`);
  }
  if (prettier["semi"] !== true) {
    issues.push(`.prettierrc.json semi expected true, got ${String(prettier["semi"])}`);
  }
  if (prettier["singleQuote"] !== false) {
    issues.push(`.prettierrc.json singleQuote expected false, got ${String(prettier["singleQuote"])}`);
  }
  if (prettier["endOfLine"] !== "lf") {
    issues.push(`.prettierrc.json endOfLine expected "lf", got ${String(prettier["endOfLine"])}`);
  }

  const editorUsesSpaces = editor.wildcard["indent_style"] === "space";
  if (typeof prettier["useTabs"] === "boolean" && editorUsesSpaces !== !prettier["useTabs"]) {
    issues.push(".editorconfig indent_style and .prettierrc.json useTabs disagree");
  }
  if (Number(editor.wildcard["indent_size"]) !== prettier["tabWidth"]) {
    issues.push(".editorconfig indent_size and .prettierrc.json tabWidth disagree");
  }
  if (editor.wildcard["end_of_line"] !== prettier["endOfLine"]) {
    issues.push(".editorconfig end_of_line and .prettierrc.json endOfLine disagree");
  }

  return issues;
}

function stripJsoncComments(raw: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        out += raw[++i]!;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && raw[i + 1] === "/") {
      i += 2;
      while (i < raw.length && raw[i] !== "\n") i++;
      if (i < raw.length) out += "\n";
    } else if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) {
        if (raw[i] === "\n") out += "\n";
        i++;
      }
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function resolveTsconfigStrict(configPath: string, rawOverride?: string, seen = new Set<string>()): boolean | undefined {
  const canonical = resolve(configPath);
  if (seen.has(canonical)) return undefined;
  seen.add(canonical);

  const raw = rawOverride ?? readFileSync(canonical, "utf8");
  const parsed = JSON.parse(stripJsoncComments(raw)) as {
    extends?: unknown;
    compilerOptions?: { strict?: unknown };
  };

  if (typeof parsed.compilerOptions?.strict === "boolean") {
    return parsed.compilerOptions.strict;
  }

  if (typeof parsed.extends === "string" && parsed.extends.startsWith(".")) {
    const parentCandidate = resolve(dirname(canonical), parsed.extends);
    const parentPath = parentCandidate.endsWith(".json") ? parentCandidate : `${parentCandidate}.json`;
    if (existsSync(parentPath)) {
      return resolveTsconfigStrict(parentPath, undefined, seen);
    }
  }

  return undefined;
}

function evaluateTsconfigStrictness(configPath: string, rawText?: string): string[] {
  const label = toPosixPath(relative(REPO_ROOT, configPath));
  let strictVal: boolean | undefined;
  try {
    strictVal = resolveTsconfigStrict(configPath, rawText);
  } catch (err) {
    return [`${label}: JSONC parse error (${(err as Error).message})`];
  }

  if (strictVal !== true) {
    return [`${label}: compilerOptions.strict must resolve to true (got ${String(strictVal)})`];
  }
  return [];
}

interface JsToken {
  kind: "word" | "string" | "punct";
  value: string;
  quote?: "'" | '"' | "`";
  line: number;
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "in",
  "of",
  "typeof",
  "instanceof",
  "void",
  "delete",
  "new",
  "await",
  "yield",
  "else",
  "do",
]);

function canStartRegexLiteral(prev: JsToken | undefined): boolean {
  if (!prev) return true;
  if (prev.kind === "word") return REGEX_PRECEDING_KEYWORDS.has(prev.value);
  if (prev.kind === "punct") {
    return prev.value !== ")" && prev.value !== "]" && prev.value !== "++" && prev.value !== "--";
  }
  return false;
}

function tokenizeJsModule(source: string): JsToken[] {
  const text = normalizeLf(source);
  const tokens: JsToken[] = [];
  let i = 0;
  let line = 1;

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const startLine = line;
      i++;
      let val = "";
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < text.length) {
          if (text[i + 1] === "\n") line++;
          val += text[i + 1]!;
          i += 2;
          continue;
        }
        if (text[i] === "\n") line++;
        val += text[i]!;
        i++;
      }
      if (i < text.length) i++;
      tokens.push({ kind: "string", value: val, quote, line: startLine });
      continue;
    }

    if (ch === "`") {
      const startLine = line;
      i++;
      let exprDepth = 0;
      while (i < text.length) {
        const tc = text[i]!;
        if (tc === "\n") line++;
        if (exprDepth === 0) {
          if (tc === "\\" && i + 1 < text.length) {
            if (text[i + 1] === "\n") line++;
            i += 2;
            continue;
          }
          if (tc === "`") {
            i++;
            break;
          }
          if (tc === "$" && text[i + 1] === "{") {
            exprDepth = 1;
            i += 2;
            continue;
          }
          i++;
        } else {
          if (tc === "'" || tc === '"') {
            const q = tc;
            i++;
            while (i < text.length && text[i] !== q) {
              if (text[i] === "\n") line++;
              if (text[i] === "\\" && i + 1 < text.length) {
                if (text[i + 1] === "\n") line++;
                i += 2;
                continue;
              }
              i++;
            }
            if (i < text.length) i++;
            continue;
          }
          if (tc === "{") exprDepth++;
          else if (tc === "}") exprDepth--;
          i++;
        }
      }
      tokens.push({ kind: "string", value: "", quote: "`", line: startLine });
      continue;
    }

    if (ch === "/" && canStartRegexLiteral(tokens[tokens.length - 1])) {
      let j = i + 1;
      let inCharClass = false;
      let validRegex = false;
      while (j < text.length && text[j] !== "\n") {
        const rc = text[j]!;
        if (rc === "\\" && j + 1 < text.length && text[j + 1] !== "\n") {
          j += 2;
          continue;
        }
        if (rc === "[") {
          inCharClass = true;
        } else if (rc === "]") {
          inCharClass = false;
        } else if (rc === "/" && !inCharClass) {
          validRegex = true;
          j++;
          while (j < text.length && /[A-Za-z]/.test(text[j]!)) j++;
          break;
        }
        j++;
      }
      if (validRegex) {
        tokens.push({ kind: "punct", value: "/regex/", line });
        i = j;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < text.length && /[\w$]/.test(text[end]!)) end++;
      tokens.push({ kind: "word", value: text.slice(i, end), line });
      i = end;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let end = i + 1;
      while (end < text.length && /[\w.]/.test(text[end]!)) end++;
      tokens.push({ kind: "word", value: text.slice(i, end), line });
      i = end;
      continue;
    }

    if (text.startsWith("...", i)) {
      tokens.push({ kind: "punct", value: "...", line });
      i += 3;
      continue;
    }
    const twoChar = text.slice(i, i + 2);
    if (twoChar === "=>" || twoChar === "++" || twoChar === "--") {
      tokens.push({ kind: "punct", value: twoChar, line });
      i += 2;
      continue;
    }

    tokens.push({ kind: "punct", value: ch, line });
    i++;
  }

  return tokens;
}

function extractBindingPatternNames(
  tokens: readonly JsToken[],
  startIdx: number,
): { names: string[]; nextIdx: number } {
  const tok = tokens[startIdx];
  if (!tok) return { names: [], nextIdx: startIdx };

  if (tok.kind === "word") {
    return { names: [tok.value], nextIdx: startIdx + 1 };
  }

  if (tok.kind === "punct" && tok.value === "{") {
    const names: string[] = [];
    let idx = startIdx + 1;
    while (idx < tokens.length && !(tokens[idx]!.kind === "punct" && tokens[idx]!.value === "}")) {
      if (tokens[idx]!.kind === "punct" && tokens[idx]!.value === ",") {
        idx++;
        continue;
      }
      if (tokens[idx]!.kind === "punct" && tokens[idx]!.value === "...") {
        const rest = extractBindingPatternNames(tokens, idx + 1);
        names.push(...rest.names);
        idx = rest.nextIdx;
        continue;
      }
      const keyTok = tokens[idx];
      if (!keyTok) break;
      if (tokens[idx + 1]?.kind === "punct" && tokens[idx + 1]!.value === ":") {
        const nested = extractBindingPatternNames(tokens, idx + 2);
        names.push(...nested.names);
        idx = nested.nextIdx;
      } else {
        if (keyTok.kind === "word") names.push(keyTok.value);
        idx++;
      }
      // Skip optional default initializer `= expr` inside object pattern
      if (tokens[idx]?.kind === "punct" && tokens[idx]!.value === "=") {
        idx++;
        let depth = 0;
        while (idx < tokens.length) {
          const t = tokens[idx]!;
          if (t.kind === "punct") {
            if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
            else if (t.value === ")" || t.value === "]") depth--;
            else if (t.value === "}") {
              if (depth === 0) break;
              depth--;
            } else if (t.value === "," && depth === 0) {
              break;
            }
          }
          idx++;
        }
      }
    }
    return { names, nextIdx: idx < tokens.length ? idx + 1 : idx };
  }

  if (tok.kind === "punct" && tok.value === "[") {
    const names: string[] = [];
    let idx = startIdx + 1;
    while (idx < tokens.length && !(tokens[idx]!.kind === "punct" && tokens[idx]!.value === "]")) {
      if (tokens[idx]!.kind === "punct" && tokens[idx]!.value === ",") {
        idx++;
        continue;
      }
      if (tokens[idx]!.kind === "punct" && tokens[idx]!.value === "...") {
        idx++;
      }
      const elem = extractBindingPatternNames(tokens, idx);
      names.push(...elem.names);
      idx = elem.nextIdx;
      if (tokens[idx]?.kind === "punct" && tokens[idx]!.value === "=") {
        idx++;
        let depth = 0;
        while (idx < tokens.length) {
          const t = tokens[idx]!;
          if (t.kind === "punct") {
            if (t.value === "(" || t.value === "[" || t.value === "{") depth++;
            else if (t.value === ")" || t.value === "}") depth--;
            else if (t.value === "]") {
              if (depth === 0) break;
              depth--;
            } else if (t.value === "," && depth === 0) {
              break;
            }
          }
          idx++;
        }
      }
    }
    return { names, nextIdx: idx < tokens.length ? idx + 1 : idx };
  }

  return { names: [], nextIdx: startIdx + 1 };
}

function extractMjsValueExports(source: string): string[] {
  const tokens = tokenizeJsModule(source);
  const names = new Set<string>();
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "punct") {
      if (tok.value === "{") braceDepth++;
      else if (tok.value === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (tok.value === "(") parenDepth++;
      else if (tok.value === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.value === "[") bracketDepth++;
      else if (tok.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (braceDepth !== 0 || parenDepth !== 0 || bracketDepth !== 0) continue;
    if (!(tok.kind === "word" && tok.value === "export")) continue;

    let k = i + 1;
    const next = tokens[k];
    if (!next) continue;

    if (next.kind === "word" && (next.value === "type" || next.value === "interface")) {
      continue;
    }

    if (next.kind === "word" && next.value === "default") {
      const afterDefault = tokens[k + 1];
      if (!(afterDefault?.kind === "word" && (afterDefault.value === "interface" || afterDefault.value === "type"))) {
        names.add("default");
      }
      continue;
    }

    if (tokens[k]?.kind === "word" && tokens[k]!.value === "declare") {
      k++;
      if (tokens[k]?.kind === "word" && (tokens[k]!.value === "type" || tokens[k]!.value === "interface")) {
        continue;
      }
    }

    const head = tokens[k];
    if (!head) continue;

    if (head.kind === "word" && head.value === "async" && tokens[k + 1]?.kind === "word" && tokens[k + 1]!.value === "function") {
      k += 2;
      if (tokens[k]?.kind === "punct" && tokens[k]!.value === "*") k++;
      if (tokens[k]?.kind === "word") names.add(tokens[k]!.value);
      continue;
    }

    if (head.kind === "word" && head.value === "function") {
      k += 1;
      if (tokens[k]?.kind === "punct" && tokens[k]!.value === "*") k++;
      if (tokens[k]?.kind === "word") names.add(tokens[k]!.value);
      continue;
    }

    if (head.kind === "word" && head.value === "abstract" && tokens[k + 1]?.kind === "word" && tokens[k + 1]!.value === "class") {
      if (tokens[k + 2]?.kind === "word") names.add(tokens[k + 2]!.value);
      continue;
    }

    if (head.kind === "word" && (head.value === "class" || head.value === "enum")) {
      if (tokens[k + 1]?.kind === "word") names.add(tokens[k + 1]!.value);
      continue;
    }

    if (head.kind === "word" && head.value === "const" && tokens[k + 1]?.kind === "word" && tokens[k + 1]!.value === "enum") {
      if (tokens[k + 2]?.kind === "word") names.add(tokens[k + 2]!.value);
      continue;
    }

    if (head.kind === "word" && (head.value === "const" || head.value === "let" || head.value === "var")) {
      k += 1;
      while (k < tokens.length) {
        const pattern = extractBindingPatternNames(tokens, k);
        for (const bound of pattern.names) names.add(bound);
        k = pattern.nextIdx;

        let pDepth = 0;
        let bDepth = 0;
        let cDepth = 0;
        let angleDepth = 0;
        let inTypeAnnotation = false;
        let hasMoreDeclarators = false;

        while (k < tokens.length) {
          const dt = tokens[k]!;
          const atTop = pDepth === 0 && bDepth === 0 && cDepth === 0 && angleDepth === 0;
          if (atTop && dt.kind === "punct") {
            if (dt.value === ":") {
              inTypeAnnotation = true;
              k++;
              continue;
            }
            if (dt.value === "=") {
              inTypeAnnotation = false;
              k++;
              continue;
            }
            if (dt.value === ",") {
              hasMoreDeclarators = true;
              k++;
              break;
            }
            if (dt.value === ";") {
              k++;
              break;
            }
          }
          if (
            atTop &&
            !inTypeAnnotation &&
            k > 0 &&
            dt.line > tokens[k - 1]!.line &&
            dt.kind === "word" &&
            (dt.value === "export" ||
              dt.value === "import" ||
              dt.value === "function" ||
              dt.value === "const" ||
              dt.value === "let" ||
              dt.value === "var" ||
              dt.value === "class" ||
              dt.value === "interface" ||
              dt.value === "type")
          ) {
            break;
          }

          if (dt.kind === "punct") {
            if (dt.value === "(") pDepth++;
            else if (dt.value === ")") pDepth = Math.max(0, pDepth - 1);
            else if (dt.value === "[") bDepth++;
            else if (dt.value === "]") bDepth = Math.max(0, bDepth - 1);
            else if (dt.value === "{") cDepth++;
            else if (dt.value === "}") cDepth = Math.max(0, cDepth - 1);
            else if (inTypeAnnotation && dt.value === "<") angleDepth++;
            else if (inTypeAnnotation && dt.value === ">") angleDepth = Math.max(0, angleDepth - 1);
          }
          k++;
        }

        if (!hasMoreDeclarators) break;
      }
      continue;
    }

    if (head.kind === "punct" && head.value === "*") {
      if (tokens[k + 1]?.kind === "word" && tokens[k + 1]!.value === "as" && tokens[k + 2]?.kind === "word") {
        names.add(tokens[k + 2]!.value);
      } else if (tokens[k + 1]?.kind === "word" && tokens[k + 1]!.value === "from" && tokens[k + 2]?.kind === "string") {
        names.add(`*:${tokens[k + 2]!.value}`);
      }
      continue;
    }

    if (head.kind === "punct" && head.value === "{") {
      k += 1;
      let specTokens: JsToken[] = [];
      const flushSpec = (): void => {
        if (specTokens.length === 0) return;
        if (specTokens[0]!.kind === "word" && specTokens[0]!.value === "type" && specTokens.length > 1) {
          specTokens = [];
          return;
        }
        const asIdx = specTokens.findIndex((t) => t.kind === "word" && t.value === "as");
        const exportedTok = asIdx !== -1 ? specTokens[asIdx + 1] : specTokens[0];
        if (exportedTok && (exportedTok.kind === "word" || exportedTok.kind === "string") && exportedTok.value) {
          names.add(exportedTok.value);
        }
        specTokens = [];
      };

      while (k < tokens.length && !(tokens[k]!.kind === "punct" && tokens[k]!.value === "}")) {
        if (tokens[k]!.kind === "punct" && tokens[k]!.value === ",") {
          flushSpec();
        } else {
          specTokens.push(tokens[k]!);
        }
        k++;
      }
      flushSpec();
    }
  }

  return [...names].sort();
}

function evaluateMjsDeclarationPairing(
  mjsSources: ReadonlyMap<string, string>,
  dmtsSources: ReadonlyMap<string, string>,
): string[] {
  const issues: string[] = [];

  for (const [mjsPath, mjsContent] of mjsSources) {
    const expectedDmts = mjsPath.replace(/\.mjs$/, ".d.mts");
    const mjsExports = extractMjsValueExports(mjsContent);
    const dmtsContent = dmtsSources.get(expectedDmts);

    if (mjsExports.length > 0 && dmtsContent === undefined) {
      issues.push(`${mjsPath}: exports [${mjsExports.join(", ")}] but missing paired ${expectedDmts}`);
      continue;
    }

    if (dmtsContent !== undefined) {
      const dmtsExports = extractMjsValueExports(dmtsContent);
      const missingInDmts = mjsExports.filter((name) => !dmtsExports.includes(name));
      const extraInDmts = dmtsExports.filter((name) => !mjsExports.includes(name));
      if (missingInDmts.length > 0) {
        issues.push(`${expectedDmts}: missing value exports [${missingInDmts.join(", ")}] from ${mjsPath}`);
      }
      if (extraInDmts.length > 0) {
        issues.push(`${expectedDmts}: declares value exports [${extraInDmts.join(", ")}] not exported by ${mjsPath}`);
      }
    }
  }

  for (const dmtsPath of dmtsSources.keys()) {
    const expectedMjs = dmtsPath.replace(/\.d\.mts$/, ".mjs");
    if (!mjsSources.has(expectedMjs)) {
      issues.push(`${dmtsPath}: orphaned declaration file with no matching ${expectedMjs}`);
    }
  }

  return issues;
}

function findTsStyleAndImportViolations(fileLabel: string, rawContent: string): string[] {
  const normalized = normalizeLf(rawContent);
  const lines = normalized.split("\n");
  const issues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("\t")) {
      issues.push(`${fileLabel}:${i + 1}: uses tab indentation`);
    }
  }

  const tokens = tokenizeJsModule(normalized);
  const moduleSpecifierSpans: Array<{ startLine: number; specifier: string }> = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "punct") {
      if (tok.value === "{") braceDepth++;
      else if (tok.value === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (tok.value === "(") parenDepth++;
      else if (tok.value === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.value === "[") bracketDepth++;
      else if (tok.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (braceDepth !== 0 || parenDepth !== 0 || bracketDepth !== 0) continue;

    if (tok.kind === "word" && tok.value === "import") {
      const next = tokens[i + 1];
      if (!next) continue;
      // Ignore `import.meta` and dynamic `import(...)` expressions.
      if (next.kind === "punct" && (next.value === "." || next.value === "(")) continue;

      if (next.kind === "string") {
        if (next.quote === "'") {
          issues.push(`${fileLabel}:${next.line}: uses single-quoted module specifier`);
        }
        moduleSpecifierSpans.push({ startLine: tok.line, specifier: next.value });
        continue;
      }

      let k = i + 1;
      let clauseBraceDepth = 0;
      while (k < tokens.length) {
        const ct = tokens[k]!;
        if (ct.kind === "punct") {
          if (ct.value === "{") clauseBraceDepth++;
          else if (ct.value === "}") clauseBraceDepth = Math.max(0, clauseBraceDepth - 1);
          else if (ct.value === ";" && clauseBraceDepth === 0) break;
        } else if (
          clauseBraceDepth === 0 &&
          ct.kind === "word" &&
          ct.value === "from" &&
          tokens[k + 1]?.kind === "string"
        ) {
          const specTok = tokens[k + 1]!;
          if (specTok.quote === "'") {
            issues.push(`${fileLabel}:${specTok.line}: uses single-quoted module specifier`);
          }
          moduleSpecifierSpans.push({ startLine: tok.line, specifier: specTok.value });
          break;
        }
        k++;
      }
      continue;
    }

    if (tok.kind === "word" && tok.value === "export") {
      let k = i + 1;
      if (tokens[k]?.kind === "word" && tokens[k]!.value === "type") {
        k++;
      }
      const head = tokens[k];
      if (!head || head.kind !== "punct" || (head.value !== "{" && head.value !== "*")) {
        continue;
      }

      if (head.value === "{") {
        let clauseBraceDepth = 1;
        k++;
        while (k < tokens.length && clauseBraceDepth > 0) {
          if (tokens[k]!.kind === "punct") {
            if (tokens[k]!.value === "{") clauseBraceDepth++;
            else if (tokens[k]!.value === "}") clauseBraceDepth--;
          }
          k++;
        }
      } else {
        k++;
        if (tokens[k]?.kind === "word" && tokens[k]!.value === "as" && tokens[k + 1]?.kind === "word") {
          k += 2;
        }
      }

      if (tokens[k]?.kind === "word" && tokens[k]!.value === "from" && tokens[k + 1]?.kind === "string") {
        const specTok = tokens[k + 1]!;
        if (specTok.quote === "'") {
          issues.push(`${fileLabel}:${specTok.line}: uses single-quoted module specifier`);
        }
        moduleSpecifierSpans.push({ startLine: tok.line, specifier: specTok.value });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*\/\/\s*@ts-(?:ignore|expect-error)\b/.test(line)) {
      const directiveLine = i + 1;
      const nextLine = lines[i + 1] ?? "";
      const suppressesMjsImport =
        /\.mjs["']/.test(nextLine) ||
        moduleSpecifierSpans.some(
          (span) => span.startLine === directiveLine + 1 && span.specifier.endsWith(".mjs"),
        );
      if (suppressesMjsImport) {
        issues.push(
          `${fileLabel}:${directiveLine}: suppresses typecheck on .mjs import instead of using a paired .d.mts`,
        );
      }
    }
  }

  return issues;
}

describe("coding-style and structural repository invariants", () => {
  it("registers 100% of tests/**/*.test.ts suites in tests/index.test.ts", () => {
    const testsDir = join(REPO_ROOT, "tests");
    const discovered = walkFiles(testsDir, (rel) => rel.endsWith(".test.ts") && rel !== "tests/index.test.ts")
      .map((rel) => rel.replace(/^tests\//, ""));
    const indexSource = readFileSync(join(testsDir, "index.test.ts"), "utf8");

    const report = evaluateTestRegistration(discovered, indexSource);
    assert.deepEqual(
      report.unregistered,
      [],
      `Unregistered test suites missing from tests/index.test.ts: ${report.unregistered.join(", ")}`,
    );
    assert.deepEqual(
      report.missingOnDisk,
      [],
      `Broken imports in tests/index.test.ts missing on disk: ${report.missingOnDisk.join(", ")}`,
    );
    assert.deepEqual(
      report.duplicates,
      [],
      `Duplicate test imports in tests/index.test.ts: ${report.duplicates.join(", ")}`,
    );

    // Negative mutation checks proving the registration gate fails on drift.
    const withUnregistered = evaluateTestRegistration(
      [...discovered, "skills/unregistered-drift.test.ts"],
      indexSource,
    );
    assert.deepEqual(withUnregistered.unregistered, ["skills/unregistered-drift.test.ts"]);

    const withMissing = evaluateTestRegistration(
      discovered,
      `${indexSource}\nimport "./skills/deleted-suite.test.ts";\n`,
    );
    assert.deepEqual(withMissing.missingOnDisk, ["skills/deleted-suite.test.ts"]);

    const withDuplicate = evaluateTestRegistration(
      discovered,
      `${indexSource}\nimport "./scripts/pre-commit.test.ts";\n`,
    );
    assert.deepEqual(withDuplicate.duplicates, ["scripts/pre-commit.test.ts"]);
  });

  it("keeps root and subpackage package.json and tsconfig*.json files 2-space indented", () => {
    const manifestPaths = [
      "package.json",
      "tsconfig.json",
      "api/package.json",
      "api/tsconfig.json",
      "web/package.json",
      "web/tsconfig.json",
      "worker/package.json",
      "worker/tsconfig.json",
      "pwa-browser/package.json",
      "pwa-browser/tsconfig.json",
      "pwa-token-api/package.json",
      "pwa-token-api/tsconfig.json",
    ];

    const violations: string[] = [];
    for (const relPath of manifestPaths) {
      const fullPath = join(REPO_ROOT, relPath);
      assert.ok(existsSync(fullPath), `Expected ${relPath} to exist`);
      const content = readFileSync(fullPath, "utf8");
      if (relPath.endsWith("package.json")) {
        JSON.parse(content);
      }
      violations.push(...findManifestIndentationViolations(relPath, content));
    }
    assert.deepEqual(violations, []);

    // Negative mutation check: tab indentation in root package.json turns red.
    const rootPkg = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    const tabMutated = rootPkg.replace(/^  "name":/m, '\t"name":');
    assert.match(
      findManifestIndentationViolations("package.json", tabMutated).join("\n"),
      /package\.json:\d+: uses tab indentation/,
    );

    // Negative mutation check: 4-space indentation in root package.json turns red.
    const fourSpaceMutated = normalizeLf(rootPkg).replace(/^([ ]+)/gm, (spaces) => spaces.repeat(2));
    assert.match(
      findManifestIndentationViolations("package.json", fourSpaceMutated).join("\n"),
      /package\.json:2: expected 2 leading spaces for nesting depth, got 4/,
    );
  });

  it("keeps .editorconfig, .prettierrc.json, and .prettierignore present and aligned", () => {
    const editorPath = join(REPO_ROOT, ".editorconfig");
    const prettierPath = join(REPO_ROOT, ".prettierrc.json");
    const prettierIgnorePath = join(REPO_ROOT, ".prettierignore");

    assert.ok(existsSync(editorPath), ".editorconfig must exist at repository root");
    assert.ok(existsSync(prettierPath), ".prettierrc.json must exist at repository root");
    assert.ok(existsSync(prettierIgnorePath), ".prettierignore must exist at repository root");

    const editorRaw = readFileSync(editorPath, "utf8");
    const prettierRaw = readFileSync(prettierPath, "utf8");
    const prettierIgnoreRaw = normalizeLf(readFileSync(prettierIgnorePath, "utf8"));

    assert.deepEqual(evaluateStyleConfigAlignment(editorRaw, prettierRaw), []);
    for (const requiredIgnore of ["node_modules/", "dist/", "shared/contracts/", "docs/redeem-history.md"]) {
      assert.ok(
        prettierIgnoreRaw.includes(requiredIgnore),
        `.prettierignore must exclude ${requiredIgnore}`,
      );
    }

    // Negative mutation checks proving style config drift is caught.
    const mutatedTabs = JSON.stringify({ ...JSON.parse(prettierRaw), useTabs: true });
    assert.ok(
      evaluateStyleConfigAlignment(editorRaw, mutatedTabs).some((msg) => msg.includes("useTabs")),
    );

    const mutatedWidth = JSON.stringify({ ...JSON.parse(prettierRaw), tabWidth: 4 });
    assert.ok(
      evaluateStyleConfigAlignment(editorRaw, mutatedWidth).some((msg) => msg.includes("tabWidth")),
    );
  });

  it("enforces compilerOptions.strict === true across every tsconfig*.json", () => {
    const tsconfigPaths = [
      "tsconfig.json",
      "api/tsconfig.json",
      "web/tsconfig.json",
      "worker/tsconfig.json",
      "pwa-browser/tsconfig.json",
      "pwa-token-api/tsconfig.json",
    ].map((rel) => join(REPO_ROOT, rel));

    const issues = tsconfigPaths.flatMap((cfgPath) => evaluateTsconfigStrictness(cfgPath));
    assert.deepEqual(issues, []);

    // Negative mutation check: disabling strict in a real tsconfig turns red.
    const rootTsconfigPath = join(REPO_ROOT, "tsconfig.json");
    const mutatedStrictOff = readFileSync(rootTsconfigPath, "utf8").replace(
      /"strict"\s*:\s*true/,
      '"strict": false',
    );
    assert.match(
      evaluateTsconfigStrictness(rootTsconfigPath, mutatedStrictOff).join("\n"),
      /tsconfig\.json: compilerOptions\.strict must resolve to true/,
    );
  });

  it("eliminates legacy .mjs and .d.mts modules from scripts/ and shared/", () => {
    const mjsFiles = [
      ...walkFiles(join(REPO_ROOT, "scripts"), (rel) => rel.endsWith(".mjs")),
      ...walkFiles(join(REPO_ROOT, "shared"), (rel) => rel.endsWith(".mjs")),
    ];
    const dmtsFiles = [
      ...walkFiles(join(REPO_ROOT, "scripts"), (rel) => rel.endsWith(".d.mts")),
      ...walkFiles(join(REPO_ROOT, "shared"), (rel) => rel.endsWith(".d.mts")),
    ];

    assert.deepEqual(mjsFiles, [], "scripts/ and shared/ must use native .ts modules instead of .mjs");
    assert.deepEqual(dmtsFiles, [], "hand-written .d.mts sidecars must not remain in scripts/ or shared/");

    // Synthetic checks proving the pairing evaluator still flags missing or drifted .d.mts pairs.
    const syntheticMjs = new Map<string, string>([
      [
        "scripts/pre-push.mjs",
        [
          "export function isPushToMain(stdin) { return Boolean(stdin); }",
          "export function getCommitsBehind() { return 0; }",
          "export function rebaseOntoOrigin() { return { success: true }; }",
        ].join("\n"),
      ],
    ]);
    assert.match(
      evaluateMjsDeclarationPairing(syntheticMjs, new Map()).join("\n"),
      /scripts\/pre-push\.mjs: exports .* missing paired scripts\/pre-push\.d\.mts/,
    );

    const driftedExportMap = new Map<string, string>([
      ["scripts/pre-push.d.mts", "export function isPushToMain(stdin: string): boolean;\n"],
    ]);
    assert.match(
      evaluateMjsDeclarationPairing(syntheticMjs, driftedExportMap).join("\n"),
      /scripts\/pre-push\.d\.mts: missing value exports \[getCommitsBehind, rebaseOntoOrigin\]/,
    );

    // Negative mutation checks for default exports, comma-separated bindings, destructuring, and re-exports.
    const advancedMjs = new Map<string, string>([
      [
        "scripts/synthetic-advanced.mjs",
        [
          "export default function runMain() {}",
          "export const first = 1, second = 2;",
          "export const { alpha, raw: beta = 3 } = source;",
          'export { localFn as renamedFn } from "./helper.mjs";',
          'export * as helperNs from "./helper.mjs";',
          'export * from "./shared-values.mjs";',
        ].join("\n"),
      ],
    ]);
    const incompleteAdvancedDmts = new Map<string, string>([
      ["scripts/synthetic-advanced.d.mts", "export declare const first: number;\n"],
    ]);
    assert.match(
      evaluateMjsDeclarationPairing(advancedMjs, incompleteAdvancedDmts).join("\n"),
      /scripts\/synthetic-advanced\.d\.mts: missing value exports \[\*:.*shared-values\.mjs, alpha, beta, default, helperNs, renamedFn, second\]/,
    );

    const matchingAdvancedDmts = new Map<string, string>([
      [
        "scripts/synthetic-advanced.d.mts",
        [
          "export default function runMain(): void;",
          "export declare const first: number, second: number;",
          "export declare const alpha: string;",
          "export declare const beta: number;",
          'export { type IgnoredType, renamedFn } from "./helper.mjs";',
          'export * as helperNs from "./helper.mjs";',
          'export * from "./shared-values.mjs";',
        ].join("\n"),
      ],
    ]);
    assert.deepEqual(evaluateMjsDeclarationPairing(advancedMjs, matchingAdvancedDmts), []);
  });

  it("keeps active TypeScript files free of tab indentation, single-quoted imports, and @ts-ignore .mjs imports", () => {
    const roots = [
      "src",
      "scripts",
      "api",
      "web",
      "shared",
      "tests",
      "worker",
      "pwa-browser",
      "pwa-token-api",
    ];

    const tsFiles = roots
      .filter((dir) => existsSync(join(REPO_ROOT, dir)))
      .flatMap((dir) =>
        walkFiles(
          join(REPO_ROOT, dir),
          (rel) =>
            rel.endsWith(".ts") &&
            !rel.endsWith(".d.ts") &&
            !rel.startsWith("shared/contracts/"),
        ),
      );

    assert.ok(tsFiles.length >= 100, `Expected >= 100 active .ts files, found ${tsFiles.length}`);

    const violations = tsFiles.flatMap((rel) =>
      findTsStyleAndImportViolations(rel, readFileSync(join(REPO_ROOT, rel), "utf8")),
    );
    assert.deepEqual(violations, []);

    // Negative mutation checks proving single-line and multiline single-quote imports, tabs, and @ts-ignore .mjs are caught.
    assert.match(
      findTsStyleAndImportViolations("src/example.ts", "import { foo } from './bar.js';\n").join("\n"),
      /src\/example\.ts:1: uses single-quoted module specifier/,
    );
    assert.match(
      findTsStyleAndImportViolations(
        "src/reexport.ts",
        "export {\n  foo,\n  bar,\n} from './bar.js';\n",
      ).join("\n"),
      /src\/reexport\.ts:4: uses single-quoted module specifier/,
    );
    const typesSyncSource = normalizeLf(
      readFileSync(join(REPO_ROOT, "tests/contracts/types-sync.test.ts"), "utf8"),
    );
    const multilineSingleQuoteMutated = typesSyncSource.replace(
      '} from "../../scripts/lib/generate-contracts.ts";',
      "} from '../../scripts/lib/generate-contracts.ts';",
    );
    assert.notEqual(multilineSingleQuoteMutated, typesSyncSource);
    assert.match(
      findTsStyleAndImportViolations("tests/contracts/types-sync.test.ts", multilineSingleQuoteMutated).join("\n"),
      /tests\/contracts\/types-sync\.test\.ts:23: uses single-quoted module specifier/,
    );

    const multilineTsIgnoreMutated = typesSyncSource
      .replace(
        '} from "../../scripts/lib/generate-contracts.ts";',
        '} from "../../scripts/lib/generate-contracts.mjs";',
      )
      .replace("import {\n  SCHEMAS,", "// @ts-ignore\nimport {\n  SCHEMAS,");
    assert.notEqual(multilineTsIgnoreMutated, typesSyncSource);
    assert.match(
      findTsStyleAndImportViolations("tests/contracts/types-sync.test.ts", multilineTsIgnoreMutated).join("\n"),
      /tests\/contracts\/types-sync\.test\.ts:17: suppresses typecheck on \.mjs import/,
    );

    assert.match(
      findTsStyleAndImportViolations("src/example.ts", "export function f(): void {\n\treturn;\n}\n").join("\n"),
      /src\/example\.ts:2: uses tab indentation/,
    );
    assert.match(
      findTsStyleAndImportViolations(
        "tests/example.test.ts",
        '// @ts-ignore\nimport { x } from "../../scripts/pre-push.mjs";\n',
      ).join("\n"),
      /tests\/example\.test\.ts:1: suppresses typecheck on \.mjs import/,
    );
  });
});
