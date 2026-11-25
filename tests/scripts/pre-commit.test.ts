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
      const scanner = resolve("scripts/check-artifact-hygiene.mjs");
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
      const scanner = resolve("scripts/check-artifact-hygiene.mjs");
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

  it("does not confuse a suffixed workflow name with an exact filename", () => {
    const matches = grepTestsForWorkflow("release.yml");
    assert.ok(matches.includes("tests/workflows/workflow-consolidation.test.ts"));
    assert.ok(!matches.includes("tests/workflows/squad-release-templates.test.ts"));
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    const indentMatch = /^([ \t]+)/.exec(line);
    if (!indentMatch) continue;
    const ws = indentMatch[1]!;
    if (ws.includes("\t")) {
      violations.push(`${fileLabel}:${i + 1}: uses tab indentation`);
      continue;
    }
    const trimmed = line.slice(ws.length);
    if (!trimmed.startsWith("*") && ws.length % 2 !== 0) {
      violations.push(`${fileLabel}:${i + 1}: uses odd space indentation (${ws.length} spaces)`);
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

function extractMjsValueExports(source: string): string[] {
  const withoutComments = normalizeLf(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const names = new Set<string>();
  const declRegex =
    /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of withoutComments.matchAll(declRegex)) {
    names.add(match[1]!);
  }

  const blockRegex = /^\s*export\s*\{([^}]*)\}/gm;
  for (const match of withoutComments.matchAll(blockRegex)) {
    const specifiers = match[1]!.split(",");
    for (const rawSpec of specifiers) {
      const spec = rawSpec.replace(/\/\/.*$/g, "").trim();
      if (!spec || spec.startsWith("type ")) continue;
      const parts = spec.split(/\s+as\s+/);
      const exportedName = (parts[1] ?? parts[0])!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exportedName)) {
        names.add(exportedName);
      }
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
    if (/^(?:import|export)\b[^;\n]*'[^'\n]+'\s*;?\s*$/.test(line)) {
      issues.push(`${fileLabel}:${i + 1}: uses single-quoted module specifier`);
    }
    if (/^\s*\/\/\s*@ts-(?:ignore|expect-error)\b/.test(line)) {
      const nextLine = lines[i + 1] ?? "";
      if (/\.mjs["']/.test(nextLine)) {
        issues.push(`${fileLabel}:${i + 1}: suppresses typecheck on .mjs import instead of using a paired .d.mts`);
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

  it("pairs every exporting .mjs module with an export-identical .d.mts declaration", () => {
    const mjsFiles = [
      ...walkFiles(join(REPO_ROOT, "scripts"), (rel) => rel.endsWith(".mjs")),
      ...walkFiles(join(REPO_ROOT, "shared"), (rel) => rel.endsWith(".mjs")),
    ];
    const dmtsFiles = [
      ...walkFiles(join(REPO_ROOT, "scripts"), (rel) => rel.endsWith(".d.mts")),
      ...walkFiles(join(REPO_ROOT, "shared"), (rel) => rel.endsWith(".d.mts")),
    ];

    const mjsMap = new Map(mjsFiles.map((rel) => [rel, readFileSync(join(REPO_ROOT, rel), "utf8")]));
    const dmtsMap = new Map(dmtsFiles.map((rel) => [rel, readFileSync(join(REPO_ROOT, rel), "utf8")]));

    assert.deepEqual(evaluateMjsDeclarationPairing(mjsMap, dmtsMap), []);

    // Negative mutation checks: missing .d.mts or drifted export list turns red.
    const missingPairMap = new Map(dmtsMap);
    missingPairMap.delete("scripts/pre-push.d.mts");
    assert.match(
      evaluateMjsDeclarationPairing(mjsMap, missingPairMap).join("\n"),
      /scripts\/pre-push\.mjs: exports .* missing paired scripts\/pre-push\.d\.mts/,
    );

    const driftedExportMap = new Map(dmtsMap);
    driftedExportMap.set(
      "scripts/pre-push.d.mts",
      "export function isPushToMain(stdin: string): boolean;\n",
    );
    assert.match(
      evaluateMjsDeclarationPairing(mjsMap, driftedExportMap).join("\n"),
      /scripts\/pre-push\.d\.mts: missing value exports \[getCommitsBehind, rebaseOntoOrigin\]/,
    );
  });

  it("keeps active TypeScript files free of tab indentation, single-quoted imports, and @ts-ignore .mjs imports", () => {
    const pendingPrototypeExclusions = new Set([
      "scripts/pwa-demo.ts",
      "shared/pwa-demo.ts",
      "web/src/pwa-demo.ts",
      "web/vite.demo.config.ts",
      "tests/web/pwa-login.test.ts",
      "src/crew/ocrPoc.ts",
      "tests/crew/ocrPoc.test.ts",
    ]);

    const roots = [
      "src",
      "api",
      "web",
      "shared",
      "tests",
      "worker",
      "pwa-browser",
      "pwa-token-api",
    ];

    const tsFiles = roots.flatMap((dir) =>
      walkFiles(
        join(REPO_ROOT, dir),
        (rel) =>
          rel.endsWith(".ts") &&
          !rel.endsWith(".d.ts") &&
          !rel.startsWith("shared/contracts/") &&
          !pendingPrototypeExclusions.has(rel),
      ),
    );

    assert.ok(tsFiles.length >= 100, `Expected >= 100 active .ts files, found ${tsFiles.length}`);

    const violations = tsFiles.flatMap((rel) =>
      findTsStyleAndImportViolations(rel, readFileSync(join(REPO_ROOT, rel), "utf8")),
    );
    assert.deepEqual(violations, []);

    // Negative mutation checks proving single-quote imports, tabs, and @ts-ignore .mjs are caught.
    assert.match(
      findTsStyleAndImportViolations("src/example.ts", "import { foo } from './bar.js';\n").join("\n"),
      /src\/example\.ts:1: uses single-quoted module specifier/,
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
