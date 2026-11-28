import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const IGNORED_WALK_DIRS = new Set([".git", "node_modules", "dist", ".wrangler"]);

function parseJsonc(raw: string): unknown {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        out += raw[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      i += 2;
      while (i < raw.length && raw[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) {
        if (raw[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  const withoutTrailingCommas = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function collectTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_WALK_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function collectManifests(dir: string, predicate: (fileName: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_WALK_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectManifests(fullPath, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

describe("coding style & repository manifest invariants", () => {
  it("imports every tests/**/*.test.ts suite in tests/index.test.ts", () => {
    const testsDir = path.join(REPO_ROOT, "tests");
    const indexFile = path.join(testsDir, "index.test.ts");
    const indexSource = readFileSync(indexFile, "utf8").replace(/\r\n/g, "\n");

    const importedSpecifiers = new Set<string>();
    for (const line of indexSource.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) continue;
      const match = /^import\s+["'](\.\/[^"']+\.test\.ts)["']\s*;/.exec(trimmed);
      if (match?.[1]) {
        importedSpecifiers.add(match[1]);
      }
    }

    const discoveredSpecifiers = collectTestFiles(testsDir)
      .filter((filePath) => path.resolve(filePath) !== path.resolve(indexFile))
      .map((filePath) => `./${toPosix(path.relative(testsDir, filePath))}`)
      .filter((specifier) => !specifier.startsWith("./worker/"))
      .sort();

    const unimported = discoveredSpecifiers.filter(
      (specifier) => !importedSpecifiers.has(specifier),
    );
    const missingOnDisk = [...importedSpecifiers]
      .filter((specifier) => !discoveredSpecifiers.includes(specifier))
      .sort();

    assert.deepEqual(
      unimported,
      [],
      `Every tests/**/*.test.ts file must be registered in tests/index.test.ts (missing: ${unimported.join(", ")})`,
    );
    assert.deepEqual(
      missingOnDisk,
      [],
      `tests/index.test.ts imports nonexistent test files: ${missingOnDisk.join(", ")}`,
    );
  });

  it("keeps package.json and tsconfig*.json manifests free of tab indentation", () => {
    const manifests = collectManifests(
      REPO_ROOT,
      (name) => name === "package.json" || /^tsconfig(?:\..+)?\.json$/.test(name),
    );

    const expectedManifests = [
      "package.json",
      "api/package.json",
      "web/package.json",
      "pwa-browser/package.json",
      "pwa-token-api/package.json",
      "worker/package.json",
      "tsconfig.json",
      "api/tsconfig.json",
      "web/tsconfig.json",
      "pwa-browser/tsconfig.json",
      "pwa-token-api/tsconfig.json",
      "worker/tsconfig.json",
    ];
    const discoveredRelative = manifests.map((filePath) =>
      toPosix(path.relative(REPO_ROOT, filePath)),
    );
    for (const expected of expectedManifests) {
      assert.ok(
        discoveredRelative.includes(expected),
        `Expected manifest ${expected} to be covered by style invariant check`,
      );
    }

    const tabViolations: string[] = [];
    for (const filePath of manifests) {
      const relative = toPosix(path.relative(REPO_ROOT, filePath));
      const lines = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").split("\n");
      lines.forEach((line, idx) => {
        if (/^\s*\t/.test(line)) {
          tabViolations.push(`${relative}:${idx + 1}`);
        }
      });
    }

    assert.deepEqual(
      tabViolations,
      [],
      `Manifests must use 2-space indentation without tabs (violations: ${tabViolations.join(", ")})`,
    );
  });

  it("retains compilerOptions.strict === true across all tsconfig*.json files", () => {
    const tsconfigs = collectManifests(REPO_ROOT, (name) => /^tsconfig(?:\..+)?\.json$/.test(name));
    assert.ok(tsconfigs.length >= 6, "Expected root and all 5 subpackage tsconfig files");

    const strictViolations: string[] = [];
    for (const filePath of tsconfigs) {
      const relative = toPosix(path.relative(REPO_ROOT, filePath));
      const raw = readFileSync(filePath, "utf8");
      let config: { compilerOptions?: { strict?: unknown } } | undefined;
      try {
        config = parseJsonc(raw) as { compilerOptions?: { strict?: unknown } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        strictViolations.push(`${relative} (parse error: ${message})`);
        continue;
      }
      if (config?.compilerOptions?.strict !== true) {
        strictViolations.push(
          `${relative} (compilerOptions.strict = ${JSON.stringify(config?.compilerOptions?.strict)})`,
        );
      }
    }

    assert.deepEqual(
      strictViolations,
      [],
      `All tsconfig*.json files must retain "strict": true (${strictViolations.join(", ")})`,
    );
  });

  it("defines canonical EditorConfig and Prettier configuration at repository root", () => {
    const editorconfig = readFileSync(path.join(REPO_ROOT, ".editorconfig"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    assert.match(editorconfig, /^root\s*=\s*true$/m);
    assert.match(editorconfig, /^charset\s*=\s*utf-8$/m);
    assert.match(editorconfig, /^indent_style\s*=\s*space$/m);
    assert.match(editorconfig, /^indent_size\s*=\s*2$/m);
    assert.match(editorconfig, /^end_of_line\s*=\s*lf$/m);
    const gitattributes = readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    if (!/\beol=crlf\b/.test(gitattributes)) {
      assert.doesNotMatch(
        editorconfig,
        /^end_of_line\s*=\s*crlf$/m,
        ".editorconfig must not force end_of_line = crlf when .gitattributes enforces eol=lf",
      );
    }

    const prettierrc = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".prettierrc.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(prettierrc.semi, true);
    assert.equal(prettierrc.singleQuote, false);
    assert.equal(prettierrc.tabWidth, 2);
    assert.equal(prettierrc.useTabs, false);
    assert.equal(prettierrc.endOfLine, "lf");

    const prettierignore = readFileSync(path.join(REPO_ROOT, ".prettierignore"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    assert.match(prettierignore, /^shared\/contracts\/$/m);
  });

  it("keeps *.local-backup crust untracked and ignored across the repository", () => {
    const lsFiles = spawnSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.ifError(lsFiles.error);
    assert.equal(lsFiles.status, 0, `git ls-files failed: ${lsFiles.stderr}`);

    const trackedPaths = lsFiles.stdout.split("\0").filter(Boolean);
    assert.deepEqual(
      trackedPaths.filter((file) => file.endsWith(".local-backup")),
      [],
      "No *.local-backup crust files may be tracked",
    );

    const checkIgnore = spawnSync(
      "git",
      ["check-ignore", "--no-index", "-q", "--", "README.md.local-backup"],
      { cwd: REPO_ROOT },
    );
    assert.ifError(checkIgnore.error);
    assert.equal(checkIgnore.status, 0, "README.md.local-backup must remain gitignored");
  });

  it("keeps the PR template, enforcement-gate checklist, and secondary docs aligned with the 0.1.0 baseline", () => {
    const readRepoFile = (...segments: string[]): string =>
      readFileSync(path.join(REPO_ROOT, ...segments), "utf8").replace(/\r\n/g, "\n");

    const prTemplate = readRepoFile(".github", "pull_request_template.md");
    for (const heading of [
      "## Type of change",
      "## Test-first evidence",
      "## Spec linkage",
      "## Tests run",
      "## Enforcement-gate changes",
      "## Constitution check",
      "## Reviewer lanes",
      "## What was changed and why",
      "## Manual smoke-test",
    ]) {
      assert.ok(prTemplate.includes(heading), `PR template must keep heading ${heading}`);
    }

    assert.match(prTemplate, /same PR includes the migration/i);
    assert.match(prTemplate, /tracked mutable paths are untracked and ignored/i);
    assert.match(prTemplate, /static configuration remains trackable/i);
    assert.match(prTemplate, /real repository invariant, not only synthetic fixtures/i);
    assert.match(prTemplate, /classified as static or mutable/i);

    const instructions = readRepoFile(".github", "copilot-instructions.md");
    assert.match(
      instructions,
      /classify every guarded path as static configuration or mutable runtime state/i,
    );
    assert.match(instructions, /companion migration in the same PR/i);
    assert.match(instructions, /actual repository invariant/i);
    assert.match(instructions, /STFC_ACCOUNTS_FILE/);
    assert.match(instructions, /automation-state/);
    assert.doesNotMatch(
      instructions,
      /read `STFC_ACCOUNTS`, claim gifts, redeem promo codes, commit `docs\/redeem-history\.md`/,
    );

    for (const file of [
      [".github", "pull_request_template.md"],
      [".github", "copilot-instructions.md"],
      ["docs", "ARCHITECTURE.md"],
      ["docs", "DISCORD-BOT-SETUP.md"],
      ["docs", "SETUP.md"],
      ["docs", "CREW-OPTIMIZER.md"],
      ["docs", "STFC-TOKEN-PWA.md"],
      ["docs", "SWA-SETUP.md"],
      ["discord", "RUNBOOK.md"],
    ]) {
      const content = readRepoFile(...file);
      assert.doesNotMatch(
        content,
        /\bPrinciple [IVX]+\b|\bRule \d+[a-z]?\b|Complexity Tracking|Development Workflow & Quality Gates/,
        `${file.join("/")} must not cite retired Spec Kit principles or removed numbered rules`,
      );
    }

    const architecture = readRepoFile("docs", "ARCHITECTURE.md");
    assert.match(architecture, /0\.1\.0/);
    assert.match(architecture, /pwa-token-api\//);
    assert.match(architecture, /pwa-browser\//);
    assert.match(architecture, /STFC_ACCOUNTS_FILE/);
    assert.match(architecture, /automation-state/);
  });
});
