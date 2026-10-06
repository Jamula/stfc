import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const workerPackageJson = JSON.parse(
  readFileSync("worker/package.json", "utf8"),
) as {
  scripts?: Record<string, string>;
};

const workflowsDirectory = ".github/workflows";
const workflowFiles = readdirSync(workflowsDirectory)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();
const retiredWorkflowFiles = [
  "squad-ci.yml",
  "squad-docs.yml",
  "squad-insider-release.yml",
  "squad-preview.yml",
  "squad-promote.yml",
  "test.yml",
] as const;
const squadTemplateWorkflowFiles = readdirSync(".squad/templates/workflows")
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();
const gitWorkflowSkillPaths = [
  ".github/skills/git-workflow/SKILL.md",
  ".squad/templates/skills/git-workflow/SKILL.md",
] as const;
const workflowSources = workflowFiles.map((file) => ({
  file,
  source: readFileSync(path.join(workflowsDirectory, file), "utf8"),
}));
const workflows = workflowSources.map(({ file, source }) => ({
  file,
  workflow: parseYaml(source) as {
    jobs?: Record<
      string,
      {
        name?: string;
        steps?: Array<{
          run?: string;
          uses?: string;
          "working-directory"?: string;
          with?: Record<string, unknown>;
        }>;
      }
    >;
  },
}));
const workflowSteps = workflows.flatMap(({ file, workflow }) =>
  Object.values(workflow.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).map((step) => ({ file, step })),
  ),
);

// --- node --test guard helpers (#242, #214, #222) -------------------------
//
// This repo invokes Node's test runner in more than one shape:
//   - `node --test test/*.test.cjs`              (the removed legacy form)
//   - `node --import tsx --test tests/index.test.ts`         (npm's `test`)
//   - `node --import tsx --test --watch tests/index.test.ts` (`test:watch`)
//   - `npx tsx --test tests/**/*.test.ts`                    (ad hoc form)
// A prior guard (`/\bnode\s+--test\s+(\S+)/g`) only matched the first shape:
// it requires `--test` immediately after `node`, so it never matches when
// `--import tsx` (or any other option) sits in between, and it never matches
// an `npx tsx --test ...` invocation at all. It also only ever captured the
// single token right after `--test`, so `node --test --watch <glob>` had it
// capture `--watch` (never a glob character) instead of the actual target.
//
// findNodeTestInvocations first joins `\`-newline shell line continuations
// (so a `run: |` block split across lines is treated as one logical
// command), then tokenizes each shell command in a workflow `run` step
// (handling `&&`/`;`/`|`/CRLF-or-LF separated commands and quoted tokens),
// locates invocations of `node` or `npx ... tsx` that carry a bare
// `--test` flag anywhere in their arguments, and returns the positional
// test-target tokens that follow `--test` -- skipping every other flag and,
// for flags known to consume a following value (e.g. `--test-name-pattern
// foo`), that value too. A flag's own `--flag=value` form is always skipped
// whole, so a pattern like `--test-name-pattern=foo*` is never mistaken for
// a target. Concrete file targets (e.g. `tests/index.test.ts`) contain no
// glob metacharacters and are therefore never flagged.

// Node test-runner flags that consume a separate following token as their
// value, so that token is never mistaken for a positional test target.
const NODE_TEST_VALUE_FLAGS = new Set([
  "--test-concurrency",
  "--test-name-pattern",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-shard",
  "--test-timeout",
  "--import",
  "--require",
  "--experimental-loader",
]);

const NPM_SUBCOMMAND_VALUE_FLAGS = new Set([
  "--access",
  "--audit-level",
  "--cache",
  "--globalconfig",
  "--include",
  "--install-strategy",
  "--loglevel",
  "--logs-dir",
  "--omit",
  "--otp",
  "--prefix",
  "--registry",
  "--scope",
  "--tag",
  "--userconfig",
  "--workspace",
  "-w",
]);

const SHELL_CONTROL_WORDS = new Set([
  "elif",
  "else",
  "if",
  "then",
  "!",
]);
const SHELL_WRAPPERS = new Set([
  "command",
  "env",
  "exec",
  "nohup",
  "sudo",
  "time",
]);
const SHELL_WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
  command: new Set(),
  env: new Set(["-C", "--chdir", "-S", "--split-string", "-u", "--unset"]),
  exec: new Set(["-a"]),
  nohup: new Set(),
  sudo: new Set([
    "-C",
    "--close-from",
    "-D",
    "--chdir",
    "-g",
    "--group",
    "-h",
    "--host",
    "-p",
    "--prompt",
    "-R",
    "--chroot",
    "-r",
    "--role",
    "-t",
    "--type",
    "-T",
    "--command-timeout",
    "-u",
    "--user",
  ]),
  time: new Set(["-f", "--format", "-o", "--output"]),
};
const SHELL_WRAPPER_BOOLEAN_FLAGS: Record<string, Set<string>> = {
  command: new Set(["-p"]),
  env: new Set(["-0", "--null", "-i", "--ignore-environment", "-v", "--debug"]),
  exec: new Set(["-c", "-l"]),
  nohup: new Set(),
  sudo: new Set([
    "-A",
    "--askpass",
    "-b",
    "--background",
    "-E",
    "--preserve-env",
    "-H",
    "--set-home",
    "-n",
    "--non-interactive",
    "-P",
    "--preserve-groups",
    "-S",
    "--stdin",
    "-V",
    "--version",
    "-k",
    "--reset-timestamp",
    "-K",
    "--remove-timestamp",
  ]),
  time: new Set(["-p", "--portability", "-v", "--verbose"]),
};
const SHELL_ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const GLOB_METACHARACTERS = /[*?[{]/;

function tokenizeShellCommand(command: string): string[] {
  const words = command.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return words.map((word) => {
    const isSingleQuoted = word.startsWith("'") && word.endsWith("'");
    const isDoubleQuoted = word.startsWith('"') && word.endsWith('"');
    return isSingleQuoted || isDoubleQuoted ? word.slice(1, -1) : word;
  });
}

function splitShellCommands(runScript: string): string[] {
  // Join backslash-newline shell line continuations (e.g. `node --test \`
  // followed by `tests/*.test.ts` on the next line) into a single logical
  // line before splitting on line breaks.
  const continuationJoined = runScript.replace(/\\\r?\n[ \t]*/g, " ");
  // Split on both line breaks (CRLF-safe) and common shell separators, so a
  // multi-line `run: |` block or a `cmd1 && cmd2` one-liner is examined
  // command-by-command rather than as one opaque blob.
  return continuationJoined
    .split(/\r?\n/)
    .flatMap((line) => line.split(/&&|\|\||[;|]/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function findNodeTestInvocations(
  runScript: string,
): Array<{ command: string; targets: string[] }> {
  const invocations: Array<{ command: string; targets: string[] }> = [];
  for (const command of splitShellCommands(runScript)) {
    const tokens = tokenizeShellCommand(command);
    const first = tokens[0];
    const isNodeInvocation = first === "node";
    const isNpxTsxInvocation = first === "npx" && tokens.includes("tsx");
    if (!isNodeInvocation && !isNpxTsxInvocation) continue;

    const testFlagIndex = tokens.indexOf("--test");
    if (testFlagIndex === -1) continue;

    const targets: string[] = [];
    for (let i = testFlagIndex + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      if (token.startsWith("-")) {
        // A flag with an attached `=value` is self-contained; a flag known
        // to take a separate value token consumes the next token too.
        if (!token.includes("=") && NODE_TEST_VALUE_FLAGS.has(token)) {
          i += 1;
        }
        continue;
      }
      targets.push(token);
    }
    invocations.push({ command, targets });
  }
  return invocations;
}

function globTestTargets(
  runScript: string,
): Array<{ command: string; target: string }> {
  return findNodeTestInvocations(runScript).flatMap(({ command, targets }) =>
    targets
      .filter((target) => GLOB_METACHARACTERS.test(target))
      .map((target) => ({ command, target })),
  );
}

function findNpmPublishInvocations(runScript: string): string[] {
  const invocations: string[] = [];
  for (const command of splitShellCommands(runScript)) {
    const tokens = tokenizeShellCommand(command);
    let npmIndex = -1;
    let wrapper: string | undefined;
    let hasUnknownWrapperOption = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      if (token === "npm") {
        npmIndex = i;
        break;
      }
      if (
        SHELL_CONTROL_WORDS.has(token) ||
        SHELL_ENV_ASSIGNMENT.test(token)
      ) {
        continue;
      }
      if (SHELL_WRAPPERS.has(token)) {
        wrapper = token;
        hasUnknownWrapperOption = false;
        continue;
      }
      if (wrapper && token === "--") continue;
      if (wrapper && token.startsWith("-")) {
        if (token.includes("=")) continue;
        if (SHELL_WRAPPER_VALUE_FLAGS[wrapper]?.has(token)) {
          i += 1;
          continue;
        }
        if (SHELL_WRAPPER_BOOLEAN_FLAGS[wrapper]?.has(token)) continue;
        hasUnknownWrapperOption = true;
        continue;
      }
      if (wrapper && hasUnknownWrapperOption) continue;
      break;
    }
    if (npmIndex === -1) continue;

    let hasUnknownOption = false;
    for (let i = npmIndex + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === undefined) continue;
      if (token === "--") {
        if (tokens[i + 1] === "publish") invocations.push(command);
        break;
      }
      if (token.startsWith("-")) {
        if (!token.includes("=") && NPM_SUBCOMMAND_VALUE_FLAGS.has(token)) {
          i += 1;
        } else if (!token.includes("=")) {
          hasUnknownOption = true;
        }
        continue;
      }
      if (token === "publish") {
        invocations.push(command);
        break;
      }
      if (!hasUnknownOption) break;
    }
  }
  return invocations;
}

describe("npm publish workflow guard (self-tests)", () => {
  const publishCommandFixtures = [
    ["bare publish command", "npm publish"],
    ["workspace option before subcommand", "npm --workspace foo publish"],
    ["short workspace option before subcommand", "npm -w foo publish"],
    ["access option before subcommand", "npm --access public publish"],
    ["include option before subcommand", "npm --include dev publish"],
    [
      "environment assignment before executable",
      'NODE_AUTH_TOKEN="$TOKEN" npm publish',
    ],
    [
      "env assignment before executable",
      'env NODE_AUTH_TOKEN="$TOKEN" npm publish',
    ],
    [
      "if control word before executable",
      "if npm publish; then echo done",
      ["if npm publish"],
    ],
    ["env ignore flag before executable", "env -i npm publish"],
    ["sudo user option before executable", "sudo -u root npm publish"],
    ["time portability flag before executable", "time -p npm publish"],
    [
      "multiple separate-value options before subcommand",
      "npm --workspace foo --access public publish",
    ],
    [
      "attached-value options before subcommand",
      "npm --workspace=foo --access=public publish",
    ],
    [
      "unknown option fails closed before a publish subcommand",
      "npm --future-option value publish",
    ],
    ["publish option after subcommand", "npm publish --tag beta"],
    [
      "publish in a later shell segment",
      "npm ci && npm --workspace foo publish",
      ["npm --workspace foo publish"],
    ],
  ] as const;

  const nonPublishCommandFixtures = [
    ["npm run script named publish", "npm run publish"],
    ["install command with a publish argument", "npm install publish"],
    [
      "workspace install command with a publish argument",
      "npm --workspace foo install publish",
    ],
    ["quoted diagnostic text", 'echo "npm publish"'],
    [
      "environment-prefixed install with publish argument",
      'env NODE_AUTH_TOKEN="$TOKEN" npm install publish',
    ],
    [
      "sudo-prefixed install with publish argument",
      "sudo -u root npm install publish",
    ],
    ["unrelated command", "git push origin main"],
  ] as const;

  for (const [label, command, expectedCommands = [command]] of publishCommandFixtures) {
    it(`flags: ${label}`, () => {
      assert.deepStrictEqual(
        findNpmPublishInvocations(command),
        expectedCommands,
        `expected npm publish to be detected in \`${command}\``,
      );
    });
  }

  for (const [label, command] of nonPublishCommandFixtures) {
    it(`accepts: ${label}`, () => {
      assert.deepStrictEqual(
        findNpmPublishInvocations(command),
        [],
        `expected no npm publish command in \`${command}\``,
      );
    });
  }
});

describe("findNodeTestInvocations guard (self-tests)", () => {
  // These fixtures are not read from any workflow file -- they prove the
  // helper itself is sound against the historical failure and every gap
  // Kirk identified, plus common false-positive shapes, independent of
  // whatever the live workflows currently contain.
  const globCommandFixtures = [
    ["historical bare form (#242 original)", "node --test test/*.test.cjs"],
    [
      "Kirk gap 1: options before --test",
      "node --import tsx --test 'tests/**/*.test.ts'",
    ],
    [
      "Kirk gap 2: options after --test",
      "node --test --watch tests/**/*.test.ts",
    ],
    ["Kirk gap 3: npx tsx form", "npx tsx --test tests/**/*.test.ts"],
    [
      "glob target quoted with double quotes",
      'node --import tsx --test "tests/**/*.test.ts"',
    ],
    [
      "glob buried in a multi-command step",
      "npm ci && node --test tests/*.test.cjs && echo done",
    ],
    [
      "backslash-newline shell line continuation",
      "node --test \\\ntests/*.test.ts",
    ],
  ] as const;

  const cleanCommandFixtures = [
    ["npm's real test script", "node --import tsx --test tests/index.test.ts"],
    [
      "npm's real test:watch script",
      "node --import tsx --test --watch tests/index.test.ts",
    ],
    [
      "npx tsx form with a concrete file",
      "npx tsx --test tests/index.test.ts",
    ],
    [
      "backslash-newline line continuation with a concrete file",
      "node --import tsx --test \\\ntests/index.test.ts",
    ],
    [
      "attached pattern flag is not a target (false-positive guard)",
      "node --test --test-name-pattern=foo* tests/index.test.ts",
    ],
    [
      "separate-value flag does not leak its value as a target",
      "node --test --test-reporter tap tests/index.test.ts",
    ],
    ["npm test indirection is not a node/npx invocation", "npm test"],
    [
      "quoted diagnostic string containing a wildcard",
      'echo "no wildcards like * here"',
    ],
    ["unrelated command", 'git commit -m "test *"'],
  ] as const;

  for (const [label, command] of globCommandFixtures) {
    it(`flags: ${label}`, () => {
      assert.ok(
        globTestTargets(command).length > 0,
        `expected a glob-target violation in \`${command}\``,
      );
    });
  }

  for (const [label, command] of cleanCommandFixtures) {
    it(`accepts: ${label}`, () => {
      assert.deepStrictEqual(
        globTestTargets(command),
        [],
        `expected no glob-target violation in \`${command}\``,
      );
    });
  }
});

describe("workflow consolidation", () => {
  it("keeps one canonical repository test gate", () => {
    assert.deepStrictEqual(
      workflows
        .filter(({ workflow }) =>
          Object.values(workflow.jobs ?? {}).some(
            (job) => job.name === "npm test (required)",
          ),
        )
        .map(({ file }) => file),
      ["squad-test-gate.yml"],
    );
  });

  it("runs worker typecheck and Vitest in the existing required gate", () => {
    const gate = workflows.find(({ file }) => file === "squad-test-gate.yml");
    assert.ok(gate, "squad-test-gate.yml must exist");

    const job = Object.values(gate.workflow.jobs ?? {}).find(
      ({ name }) => name === "npm test (required)",
    );
    assert.ok(job, "worker checks must remain inside npm test (required)");
    const steps = job.steps ?? [];

    const rootInstallIndex = steps.findIndex(
      (step) => step.run?.trim() === "npm ci" && !step["working-directory"],
    );
    const rootTypecheckIndex = steps.findIndex(
      (step) =>
        step.run?.trim() === "npm run typecheck" &&
        !step["working-directory"],
    );
    const rootTestIndex = steps.findIndex(
      (step) => step.run?.trim() === "npm test" && !step["working-directory"],
    );
    assert.ok(rootInstallIndex >= 0, "the gate must install root deps");
    assert.ok(rootTypecheckIndex >= 0, "the gate must retain root typecheck");
    assert.ok(rootTestIndex >= 0, "the gate must retain root tests");
    assert.ok(
      rootTypecheckIndex > rootInstallIndex && rootTestIndex > rootInstallIndex,
      "root checks must run after root npm ci",
    );

    const workerInstallIndex = steps.findIndex(
      (step) =>
        step.run?.trim() === "npm ci" &&
        step["working-directory"] === "worker",
    );
    const workerTypecheckIndex = steps.findIndex(
      (step) =>
        step.run?.trim() === "npm run typecheck" &&
        step["working-directory"] === "worker",
    );
    const workerTestIndex = steps.findIndex(
      (step) =>
        step.run?.trim() === "npm test" &&
        step["working-directory"] === "worker",
    );

    assert.ok(workerInstallIndex >= 0, "the gate must install worker deps");
    assert.ok(
      workerTypecheckIndex > workerInstallIndex,
      "worker typecheck must run after worker npm ci",
    );
    assert.ok(
      workerTestIndex > workerInstallIndex,
      "worker Vitest must run after worker npm ci",
    );
    assert.equal(
      workerPackageJson.scripts?.typecheck,
      "tsc --noEmit",
      "worker typecheck must remain an independent TypeScript check",
    );
    assert.equal(
      workerPackageJson.scripts?.test,
      "vitest run",
      "worker test must remain the Vitest suite",
    );

    const setupNodeStep = steps.find((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    );
    assert.ok(setupNodeStep, "the gate must set up Node");
    const cacheDependencyPath =
      setupNodeStep.with?.["cache-dependency-path"];
    const cacheDependencyFiles =
      typeof cacheDependencyPath === "string"
        ? cacheDependencyPath
            .split(/\r?\n/)
            .map((entry) => entry.trim())
        : [];
    assert.ok(
      cacheDependencyFiles.includes("package-lock.json") &&
        cacheDependencyFiles.includes("worker/package-lock.json"),
      "npm cache must track both root and worker lockfiles",
    );
  });

  it("does not restore superseded workflows", () => {
    for (const file of retiredWorkflowFiles) {
      assert.ok(!workflowFiles.includes(file), `${file} must remain removed`);
    }
  });

  it("does not keep templates for retired dev/preview release-train workflows", () => {
    for (const file of retiredWorkflowFiles) {
      assert.ok(
        !squadTemplateWorkflowFiles.includes(file),
        `.squad/templates/workflows/${file} must remain removed`,
      );
    }
  });

  it("documents the supported main-only branch model in git-workflow skills", () => {
    for (const skillPath of gitWorkflowSkillPaths) {
      const skill = readFileSync(skillPath, "utf8");
      assert.match(
        skill,
        /\bmain-only\b/,
        `${skillPath} must explicitly describe the main-only model`,
      );
      const normalizedSkill = skill.replace(/\s+/g, " ");
      assert.match(
        normalizedSkill,
        /For `local`\/`worktree` backends, use the configured state tools with canonical logical paths when available; the checkout-snapshot fallback below is permitted only when those tools are unavailable\./i,
        `${skillPath} must limit checkout snapshots to local/worktree fallback`,
      );
      assert.match(
        normalizedSkill,
        /For `orphan`, `two-layer`, or `git-notes` backends, reconcile and clean mutable state only through the configured state tools using canonical logical paths.{0,300}Never read or copy a worktree `\.squad\/` checkout snapshot for these backends\. If any required state tool is unavailable, fail closed/i,
        `${skillPath} must fail closed and avoid checkout snapshots for non-local backends`,
      );
      for (const lane of ["scope", "technical", "operations"]) {
        assert.match(
          skill,
          new RegExp(`\\b${lane}\\b`, "i"),
          `${skillPath} must record ${lane} implications`,
        );
      }
      assert.doesNotMatch(
        skill,
        /dev\s*→\s*preview|preview\s*→\s*main|origin\/dev|origin\/preview|--base\s+dev/,
        `${skillPath} must not describe the retired dev/preview promotion workflow`,
      );
    }
  });

  it("documents the private GitHub-release process without stale npm guidance", () => {
    const releaseProcess = readFileSync(
      ".squad/templates/skills/release-process/SKILL.md",
      "utf8",
    );
    assert.match(
      releaseProcess,
      /private\s+`stfc-gift-redeemer`\s+package/,
      "release guidance must identify this repository's private package",
    );
    assert.match(
      releaseProcess,
      /\.github\/workflows\/squad-release\.yml/,
      "release guidance must reference the actual release workflow",
    );
    assert.match(
      releaseProcess,
      /does not publish to a package\s+registry/i,
      "release guidance must state that the workflow does not publish packages",
    );
    assert.match(
      releaseProcess,
      /workflow\s+consolidation regression test/i,
      "release guidance must describe the active workflow publishing guard",
    );
    assert.doesNotMatch(
      releaseProcess,
      /packages\/squad-(?:sdk|cli)|@bradygaster\/squad-cli|squad-npm-publish\.yml/,
      "release guidance must not retain Squad CLI package or workflow instructions",
    );
  });

  it("keeps versioning guidance aligned with the main-only private package", () => {
    const versioningPolicy = readFileSync(
      ".squad/templates/skills/versioning-policy/SKILL.md",
      "utf8",
    );
    const normalizedPolicy = versioningPolicy.replace(/\s+/g, " ");
    assert.match(
      normalizedPolicy,
      /\bmain-only\b/,
      "versioning guidance must state the supported branch model",
    );
    assert.match(
      normalizedPolicy,
      /private `stfc-gift-redeemer` package/,
      "versioning guidance must identify the actual private package",
    );
    assert.match(
      normalizedPolicy,
      /\.github\/workflows\/squad-release\.yml/,
      "versioning guidance must reference the actual release workflow",
    );
    assert.doesNotMatch(
      versioningPolicy,
      /@bradygaster\/squad-(?:sdk|cli)|packages\/squad-(?:sdk|cli)|prerelease-version-guard|skip-version-check|bump-build\.mjs|`dev`|`preview`/,
      "versioning guidance must not retain stale Squad workspace or branch instructions",
    );
  });

  it("does not publish npm packages from active workflows", () => {
    for (const { file, step } of workflowSteps) {
      const invocations = findNpmPublishInvocations(step.run ?? "");
      assert.deepStrictEqual(
        invocations,
        [],
        `${file} must not run npm publish without a separately reviewed publishing policy`,
      );
    }
  });

  it("leaves CodeQL to the single GitHub default-setup workflow", () => {
    const customCodeqlSteps = workflowSteps.filter(({ step }) =>
      step.uses?.startsWith("github/codeql-action/"),
    );
    assert.deepStrictEqual(customCodeqlSteps, []);
  });

  it("keeps code coverage reporting disabled", () => {
    for (const { file, step } of workflowSteps) {
      assert.ok(
        !step.uses?.startsWith("actions/upload-code-coverage@"),
        `${file} must not upload code coverage`,
      );
      assert.ok(
        !step.run?.includes("test:coverage"),
        `${file} must not invoke the coverage test script`,
      );
    }
  });

  it("never invokes node's test runner against a glob that could match zero files (#242, #214, #222)", () => {
    // See "findNodeTestInvocations guard (self-tests)" above for the full
    // rationale and fixture coverage. In short: `node --test <target>` (in
    // any of this repo's real forms -- bare, `node --import tsx --test`, or
    // `npx tsx --test`, with options before or after `--test`) exits 0 when
    // <target> is a glob matching zero files, which is exactly how the
    // removed `test/*.test.cjs` reference passed vacuously instead of
    // failing. Scan every workflow `run` step for such an invocation and
    // reject any positional test-target argument containing a glob
    // metacharacter (`*`, `?`, `[`, `{`).
    for (const { file, step } of workflowSteps) {
      if (!step.run) continue;
      for (const { command, target } of globTestTargets(step.run)) {
        assert.fail(
          `${file} must not run node's test runner against a glob (${target}) in \`${command}\` that can silently match zero files`,
        );
      }
    }
  });

  it("pins every setup-node step to node-version-file: .nvmrc (#214, #222, #242)", () => {
    // Decision D4: every workflow resolves its Node version from `.nvmrc`.
    // Forbidding `node-version` alone isn't enough — a step could omit
    // version configuration entirely and silently fall back to whatever
    // Node the runner image ships with, drifting from `.nvmrc` without any
    // signal. Assert the exact value, not just the absence of the
    // hardcoded-major key.
    for (const { file, step } of workflowSteps) {
      if (!step.uses?.startsWith("actions/setup-node@")) continue;
      assert.ok(
        !("node-version" in (step.with ?? {})),
        `${file} must use node-version-file: .nvmrc, not a hardcoded node-version`,
      );
      assert.equal(
        step.with?.["node-version-file"],
        ".nvmrc",
        `${file}'s setup-node step must set node-version-file: .nvmrc`,
      );
    }
  });

  it("runs the canonical suite entry point on push to main (#242, #222)", () => {
    const release = workflows.find(({ file }) => file === "squad-release.yml");
    assert.ok(release, "squad-release.yml must exist");
    const steps = Object.values(release!.workflow.jobs ?? {}).flatMap(
      (job) => job.steps ?? [],
    );
    // `npm test` targets tests/index.test.ts directly, a concrete file, so
    // (unlike a `test/*.test.cjs` glob) it cannot silently match zero files.
    assert.ok(
      steps.some((step) => step.run?.trim() === "npm test"),
      "squad-release.yml must run npm test, not a hand-rolled glob invocation",
    );
    assert.ok(
      steps.some((step) => step.run?.trim() === "npm run typecheck"),
      "squad-release.yml must run npm run typecheck alongside npm test",
    );
  });

  it("installs locked dependencies before release validation", () => {
    const release = workflows.find(({ file }) => file === "squad-release.yml");
    assert.ok(release, "squad-release.yml must exist");
    const steps = Object.values(release!.workflow.jobs ?? {}).flatMap(
      (job) => job.steps ?? [],
    );
    const installIndex = steps.findIndex(
      (step) => step.run?.trim() === "npm ci",
    );
    const typecheckIndex = steps.findIndex(
      (step) => step.run?.trim() === "npm run typecheck",
    );
    const testIndex = steps.findIndex(
      (step) => step.run?.trim() === "npm test",
    );

    assert.ok(installIndex >= 0, "squad-release.yml must run npm ci");
    assert.ok(
      installIndex < typecheckIndex && installIndex < testIndex,
      "squad-release.yml must install dependencies before typecheck and tests",
    );
  });

  it("pins npm's \"test\" script to the concrete tests/index.test.ts entry point, not a glob (#242, #222)", () => {
    // The assertion above only proves squad-release.yml literally invokes
    // the string `npm test`; it says nothing about what that indirection
    // actually runs. Read package.json's "test" script through JSON.parse
    // (not a raw-text regex, which would be brittle against reformatting)
    // and run it through the same tokenizing guard used on workflow `run`
    // steps, so this stays a single source of truth for "is this a real
    // node --test invocation against a concrete file, or a glob that could
    // silently match zero files".
    const testScript = packageJson.scripts?.test;
    assert.ok(testScript, 'package.json must define a "test" script');
    const invocations = findNodeTestInvocations(testScript!);
    assert.equal(
      invocations.length,
      1,
      `expected exactly one node --test invocation in npm's "test" script, got: ${testScript}`,
    );
    assert.deepStrictEqual(
      invocations[0]!.targets,
      ["tests/index.test.ts"],
      `npm's "test" script must target tests/index.test.ts directly, got: ${testScript}`,
    );
    assert.deepStrictEqual(
      globTestTargets(testScript!),
      [],
      `npm's "test" script must not target a glob that could match zero files, got: ${testScript}`,
    );
  });
});
