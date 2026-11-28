import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const IGNORED_WALK_DIRS = new Set([".git", "node_modules", "dist", ".wrangler", ".squad"]);

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

function collectManifests(
  dir: string,
  predicate: (fileName: string) => boolean,
): string[] {
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
    const tsconfigs = collectManifests(REPO_ROOT, (name) =>
      /^tsconfig(?:\..+)?\.json$/.test(name),
    );
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

    const prettierignore = readFileSync(
      path.join(REPO_ROOT, ".prettierignore"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.match(prettierignore, /^shared\/contracts\/$/m);
  });

  it("covers every npm package directory and github-actions with weekly routine grouping in .github/dependabot.yml (#316)", () => {
    const dependabotPath = path.join(REPO_ROOT, ".github", "dependabot.yml");
    assert.ok(existsSync(dependabotPath), ".github/dependabot.yml must exist");

    const parsed = parseYaml(readFileSync(dependabotPath, "utf8")) as {
      version?: number;
      updates?: Array<{
        "package-ecosystem"?: string;
        directory?: string;
        schedule?: { interval?: string };
        groups?: Record<
          string,
          { patterns?: string[]; "update-types"?: string[] }
        >;
      }>;
    };

    assert.equal(parsed.version, 2);
    const updates = parsed.updates ?? [];

    const packageJsonDirs = collectManifests(
      REPO_ROOT,
      (name) => name === "package.json",
    ).map((filePath) => {
      const relDir = toPosix(path.dirname(path.relative(REPO_ROOT, filePath)));
      return relDir === "." ? "/" : `/${relDir}`;
    });

    for (const expectedDir of packageJsonDirs) {
      const entry = updates.find(
        (u) => u["package-ecosystem"] === "npm" && u.directory === expectedDir,
      );
      assert.ok(
        entry,
        `.github/dependabot.yml must configure npm updates for ${expectedDir}`,
      );
      assert.equal(
        entry.schedule?.interval,
        "weekly",
        `Dependabot npm schedule for ${expectedDir} must be weekly`,
      );
      const routineTypes = entry.groups?.routine?.["update-types"] ?? [];
      assert.deepEqual(
        [...routineTypes].sort(),
        ["minor", "patch"],
        `Dependabot routine group for ${expectedDir} must batch minor and patch updates while leaving major updates ungrouped`,
      );
    }

    const actionsEntry = updates.find(
      (u) => u["package-ecosystem"] === "github-actions" && u.directory === "/",
    );
    assert.ok(
      actionsEntry,
      ".github/dependabot.yml must configure github-actions updates for /",
    );
    assert.equal(actionsEntry.schedule?.interval, "weekly");
    assert.deepEqual(
      [...(actionsEntry.groups?.routine?.["update-types"] ?? [])].sort(),
      ["minor", "patch"],
    );
  });

  it("keeps non-Squad tracked files free of unapproved byte-identical duplicates (#454)", () => {
    const trackedPaths = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(Boolean)
      .filter(
        (rel) =>
          !rel.startsWith(".squad/") &&
          !rel.startsWith(".github/skills/") &&
          !(rel.startsWith(".github/workflows/") && rel.includes("squad")) &&
          rel !== ".github/agents/squad.agent.md" &&
          !rel.startsWith("tests/squad/"),
      );

    const byHash = new Map<string, string[]>();
    for (const rel of trackedPaths) {
      const fullPath = path.join(REPO_ROOT, rel);
      if (!existsSync(fullPath)) continue;
      const digest = createHash("sha256")
        .update(readFileSync(fullPath))
        .digest("hex");
      const group = byHash.get(digest) ?? [];
      group.push(rel);
      byHash.set(digest, group);
    }

    const allowedDuplicateGroup = [
      "tests/ci/fixtures/badPosition/_lib/auth.ts",
      "tests/ci/fixtures/good/_lib/auth.ts",
      "tests/ci/fixtures/goodTryWrap/_lib/auth.ts",
    ];

    const unexpectedDuplicates = [...byHash.values()]
      .filter((paths) => paths.length > 1)
      .map((paths) => [...paths].sort())
      .filter(
        (paths) =>
          JSON.stringify(paths) !== JSON.stringify(allowedDuplicateGroup),
      );

    assert.deepEqual(
      unexpectedDuplicates,
      [],
      `Unexpected byte-identical tracked files found: ${JSON.stringify(unexpectedDuplicates)}`,
    );
  });

  it("verifies artifact-hygiene clean and contaminated spec fixtures end-to-end (#454)", () => {
    const scanner = path.join(REPO_ROOT, "scripts", "check-artifact-hygiene.mjs");
    const cleanFixture = path.join(
      REPO_ROOT,
      "tests",
      "fixtures",
      "artifact-hygiene",
      "clean-spec.md",
    );
    const contaminatedFixture = path.join(
      REPO_ROOT,
      "fixtures",
      "artifact-hygiene",
      "contaminated-spec.md",
    );

    const cleanRun = spawnSync(process.execPath, [scanner, cleanFixture], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(cleanRun.status, 0, cleanRun.stderr);

    const contaminatedRun = spawnSync(
      process.execPath,
      [scanner, contaminatedFixture],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(contaminatedRun.status, 1);
    for (const patternName of [
      "JWT",
      "BEARER_TOKEN",
      "GITHUB_TOKEN",
      "AWS_ACCESS_KEY",
      "API_KEY",
      "STFC_ACCOUNT_DATA",
    ]) {
      assert.match(
        contaminatedRun.stderr,
        new RegExp(`\\[${patternName}\\]`),
        `Expected contaminated-spec.md to trigger ${patternName}`,
      );
    }
  });
});
