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

  it("never invokes node --test against a glob that could match zero files (#242, #214, #222)", () => {
    // `node --test <arg>` exits 0 when <arg> is a glob that matches zero
    // files — that's exactly how the removed `test/*.test.cjs` reference
    // (the legacy scaffold path; the real suite lives under tests/) passed
    // vacuously instead of failing. Rather than pin the one literal string
    // that has already been fixed, scan every workflow `run` step for ANY
    // `node --test <arg>` invocation whose argument contains a glob
    // metacharacter (`*`, `?`, `[`, `{`), so the same anti-pattern can't
    // quietly return under a different path. Concrete file arguments (e.g.
    // `tests/index.test.ts`) contain no glob metacharacters and are not
    // flagged.
    const nodeTestInvocation = /\bnode\s+--test\s+(\S+)/g;
    const globMetacharacters = /[*?[{]/;
    for (const { file, step } of workflowSteps) {
      if (!step.run) continue;
      for (const match of step.run.matchAll(nodeTestInvocation)) {
        const argument = match[1] ?? "";
        assert.ok(
          !globMetacharacters.test(argument),
          `${file} must not run node --test against a glob (${argument}) that can silently match zero files`,
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
