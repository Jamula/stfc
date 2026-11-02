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
  "test.yml",
] as const;
const workflowSources = workflowFiles.map((file) => ({
  file,
  source: readFileSync(path.join(workflowsDirectory, file), "utf8"),
}));
const workflows = workflowSources.map(({ file, source }) => ({
  file,
  workflow: parseYaml(source) as {
    on?: {
      pull_request?: { branches?: string[]; paths?: string[] };
    };
    jobs?: Record<
      string,
      {
        name?: string;
        "continue-on-error"?: boolean | string;
        needs?: string | string[];
        if?: string;
        permissions?: Record<string, string>;
        steps?: Array<{
          "continue-on-error"?: boolean | string;
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
  Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
    (job.steps ?? []).map((step) => ({ file, jobName, step })),
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
  // helper itself is sound against the historical failure and identified
  // gaps, plus common false-positive shapes, independent of
  // whatever the live workflows currently contain.
  const globCommandFixtures = [
    ["historical bare form (#242 original)", "node --test test/*.test.cjs"],
    [
      "options before --test",
      "node --import tsx --test 'tests/**/*.test.ts'",
    ],
    [
      "options after --test",
      "node --test --watch tests/**/*.test.ts",
    ],
    ["npx tsx form", "npx tsx --test tests/**/*.test.ts"],
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
      ["test-gate.yml"],
    );
  });

  it("runs worker typecheck and Vitest in the existing required gate", () => {
    const gate = workflows.find(({ file }) => file === "test-gate.yml");
    assert.ok(gate, "test-gate.yml must exist");
    assert.deepEqual(gate.workflow.on?.pull_request?.branches, ["**"]);

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

  it("propagates failures from every required-gate check", () => {
    const gate = workflows.find(({ file }) => file === "test-gate.yml");
    assert.ok(gate, "test-gate.yml must exist");

    const job = Object.values(gate.workflow.jobs ?? {}).find(
      ({ name }) => name === "npm test (required)",
    );
    assert.ok(job, "the required gate must exist");
    assert.ok(
      job["continue-on-error"] !== true &&
        job["continue-on-error"] !== "true",
      "required-gate job failures must propagate",
    );

    for (const step of job.steps ?? []) {
      if (
        ["npm ci", "npm run typecheck", "npm test"].includes(
          step.run?.trim() ?? "",
        )
      ) {
        assert.ok(
          step["continue-on-error"] !== true &&
            step["continue-on-error"] !== "true",
          `${step.run} failures must propagate`,
        );
      }
    }
  });

  it("does not restore superseded workflows", () => {
    for (const file of retiredWorkflowFiles) {
      assert.ok(!workflowFiles.includes(file), `${file} must remain removed`);
    }
  });

  it("retains the independent artifact-hygiene scan", () => {
    const hygiene = workflows.find(({ file }) => file === "artifact-hygiene.yml");
    assert.ok(hygiene, "artifact-hygiene.yml must exist");
    assert.ok(hygiene.workflow.on?.pull_request?.paths?.includes("docs/**"));
    const steps = Object.values(hygiene.workflow.jobs ?? {}).flatMap(
      (job) => job.steps ?? [],
    );
    assert.ok(
      steps.some((step) => step.run?.includes("node scripts/check-artifact-hygiene.mjs")),
      "the PR workflow must run the artifact scanner",
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

  it("pins setup-node to the root version file except for the scoped SWA API validation job", () => {
    // The API deployment runtime is Node 22; all other workflows remain on
    // the repository's root Node version.
    for (const { file, jobName, step } of workflowSteps) {
      if (!step.uses?.startsWith("actions/setup-node@")) continue;
      const expectedVersionFile =
        file === "swa-deploy.yml" && jobName === "validate-api-node-22"
          ? "api/.nvmrc"
          : ".nvmrc";
      assert.ok(
        !("node-version" in (step.with ?? {})),
        `${file} must use a node-version-file, not a hardcoded node-version`,
      );
      assert.equal(
        step.with?.["node-version-file"],
        expectedVersionFile,
        `${file}'s ${jobName} setup-node step must set node-version-file: ${expectedVersionFile}`,
      );
    }
  });

  it("validates the SWA API under Node 22 before deployment", () => {
    const swa = workflows.find(({ file }) => file === "swa-deploy.yml");
    assert.ok(swa, "swa-deploy.yml must exist");
    const validation = swa.workflow.jobs?.["validate-api-node-22"];
    assert.ok(validation, "swa-deploy.yml must validate the API under Node 22");
    assert.equal(
      validation.if,
      "github.event_name != 'pull_request' || github.event.action != 'closed'",
      "API validation should be skipped only when a pull request is closed",
    );
    assert.deepEqual(
      validation.permissions,
      { contents: "read" },
      "API validation must use only job-level contents: read permissions",
    );
    const steps = validation.steps ?? [];
    assert.ok(
      steps.some((step) => step.run?.trim() === "npm ci" && step["working-directory"] === "api"),
      "API validation must run npm ci in api/",
    );
    assert.ok(
      steps.some(
        (step) => step.run?.trim() === "npm run build" && step["working-directory"] === "api",
      ),
      "API validation must build in api/",
    );
    assert.ok(
      steps.some(
        (step) =>
          step.run?.includes("import('./dist/_lib/auth.js')") &&
          step.run.includes("import('./dist/_lib/respond.js')") &&
          step["working-directory"] === "api",
      ),
      "API validation must smoke-test the built API modules",
    );

    const deploy = swa.workflow.jobs?.["deploy"];
    assert.ok(deploy, "swa-deploy.yml must have a deploy job");
    const dependencies = Array.isArray(deploy.needs) ? deploy.needs : [deploy.needs];
    assert.ok(
      dependencies.includes("validate-api-node-22"),
      "SWA deployment must wait for Node 22 API validation",
    );
    assert.ok(
      dependencies.includes("preflight"),
      "SWA deployment must also wait for the deployment-token presence probe",
    );
    for (const jobName of ["deploy", "teardown"]) {
      assert.match(
        swa.workflow.jobs?.[jobName]?.if ?? "",
        /needs\.preflight\.outputs\.has-token == 'true'/,
        `${jobName} must skip when the SWA deployment token is absent (#127)`,
      );
    }
  });

  it("runs the canonical suite entry point on push to main (#242, #222)", () => {
    const release = workflows.find(({ file }) => file === "release.yml");
    assert.ok(release, "release.yml must exist");
    const steps = Object.values(release!.workflow.jobs ?? {}).flatMap(
      (job) => job.steps ?? [],
    );
    // `npm test` targets tests/index.test.ts directly, a concrete file, so
    // (unlike a `test/*.test.cjs` glob) it cannot silently match zero files.
    assert.ok(
      steps.some((step) => step.run?.trim() === "npm test"),
      "release.yml must run npm test, not a hand-rolled glob invocation",
    );
    assert.ok(
      steps.some((step) => step.run?.trim() === "npm run typecheck"),
      "release.yml must run npm run typecheck alongside npm test",
    );
  });

  it("does not suppress release validation failures", () => {
    const release = workflows.find(({ file }) => file === "release.yml");
    assert.ok(release, "release.yml must exist");
    for (const job of Object.values(release.workflow.jobs ?? {})) {
      assert.ok(!job["continue-on-error"], "release job failures must propagate");
      for (const step of job.steps ?? []) {
        if (["npm ci", "npm test", "npm run typecheck"].includes(step.run?.trim() ?? "")) {
          assert.ok(!step["continue-on-error"], `${step.run} failures must propagate`);
        }
      }
    }
  });

  it("installs locked dependencies before release validation", () => {
    const release = workflows.find(({ file }) => file === "release.yml");
    assert.ok(release, "release.yml must exist");
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

    assert.ok(installIndex >= 0, "release.yml must run npm ci");
    assert.ok(
      installIndex < typecheckIndex && installIndex < testIndex,
      "release.yml must install dependencies before typecheck and tests",
    );
  });

  it("pins npm's \"test\" script to the concrete tests/index.test.ts entry point, not a glob (#242, #222)", () => {
    // The assertion above only proves release.yml literally invokes
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
