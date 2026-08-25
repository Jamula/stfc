import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const workflowsDirectory = ".github/workflows";
const workflowFiles = readdirSync(workflowsDirectory)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();
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

const GLOB_METACHARACTERS = /[*?[{]/;

function tokenizeShellCommand(command: string): string[] {
  const words = command.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return words.map((word) => {
    const isSingleQuoted = word.startsWith("'") && word.endsWith("'");
    const isDoubleQuoted = word.startsWith('"') && word.endsWith('"');
    return isSingleQuoted || isDoubleQuoted ? word.slice(1, -1) : word;
  });
}

function findNodeTestInvocations(
  runScript: string,
): Array<{ command: string; targets: string[] }> {
  // Join backslash-newline shell line continuations (e.g. `node --test \`
  // followed by `tests/*.test.ts` on the next line) into a single logical
  // line *before* splitting on line breaks. Without this, a continued
  // command is torn in two: the `node --test` invocation ends up with the
  // trailing `\` as its only "target" (not a glob, so nothing is flagged),
  // and the glob on the following line is examined on its own -- where it
  // no longer looks like a `node`/`npx tsx` invocation at all and is
  // skipped entirely. Either way the guard passes vacuously.
  const continuationJoined = runScript.replace(/\\\r?\n[ \t]*/g, " ");
  // Split on both line breaks (CRLF-safe) and common shell separators, so a
  // multi-line `run: |` block or a `cmd1 && cmd2` one-liner is examined
  // command-by-command rather than as one opaque blob.
  const commands = continuationJoined
    .split(/\r?\n/)
    .flatMap((line) => line.split(/&&|\|\||[;|]/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const invocations: Array<{ command: string; targets: string[] }> = [];
  for (const command of commands) {
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

  it("does not restore superseded workflows", () => {
    for (const file of [
      "squad-ci.yml",
      "squad-docs.yml",
      "squad-insider-release.yml",
      "squad-preview.yml",
      "squad-promote.yml",
      "test.yml",
    ]) {
      assert.ok(!workflowFiles.includes(file), `${file} must remain removed`);
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
});
