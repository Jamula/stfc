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
        steps?: Array<{ run?: string; uses?: string }>;
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
});
