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

  it("never globs a non-existent test/ directory (#242, #214, #222)", () => {
    // A `node --test <glob>` invocation exits 0 when the glob matches zero
    // files, so a stale `test/*.test.cjs` reference (the removed legacy
    // scaffold path — real suite lives under tests/) would let a workflow
    // pass vacuously instead of failing. Guard the whole directory, not just
    // one file, so this anti-pattern can never quietly come back anywhere.
    for (const { file, step } of workflowSteps) {
      assert.ok(
        !step.run?.includes("test/*.test.cjs"),
        `${file} must not glob the non-existent test/ directory`,
      );
    }
  });

  it("never hardcodes a Node major version in setup-node (#214, #222)", () => {
    // Decision D4: every workflow resolves its Node version from `.nvmrc`
    // rather than pinning a major version inline.
    for (const { file, step } of workflowSteps) {
      if (!step.uses?.startsWith("actions/setup-node@")) continue;
      assert.ok(
        !("node-version" in (step.with ?? {})),
        `${file} must use node-version-file: .nvmrc, not a hardcoded node-version`,
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
