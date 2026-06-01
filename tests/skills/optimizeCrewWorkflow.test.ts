// Pinning tests for `.github/workflows/optimize-crew.yml` (O'Brien's
// push-on-change crew optimizer workflow).
//
// Rule 3: workflow YAML changes need pinning tests in the same commit.
// Per the directive, this workflow must:
//   - trigger on push to data/crew/** AND workflow_dispatch ONLY;
//   - never have a scheduled cron — push-on-change, not periodic;
//   - use concurrency group `stfc-crew-optimizer` (distinct from
//     `stfc-gift-redeemer` and `discord-monitor`);
//   - declare `permissions: contents: write` for bot commits;
//   - SHA-pin all `uses:` actions as `<owner>/<repo>@<40-hex>`;
//   - commit changed docs/crew/*.md with msg
//     `chore(crew): regen optimizer recommendations [skip ci]`.
//
// These assertions parse the workflow YAML and assert on structure, not
// substrings, so comments cannot accidentally satisfy or fail the pins.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
};

type OptimizeCrewWorkflow = {
  on: {
    push: {
      paths: string[];
    };
    workflow_dispatch: Record<string, never>;
    schedule?: unknown;
  };
  permissions: {
    contents?: string;
  };
  concurrency: {
    group?: string;
  };
  jobs: Record<
    string,
    {
      steps: WorkflowStep[];
    }
  >;
};

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "optimize-crew.yml");
const workflowYaml = readFileSync(WORKFLOW, "utf8");
const workflow = parseYaml(workflowYaml) as OptimizeCrewWorkflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const runBlocks = steps
  .map((step) => step.run)
  .filter((run): run is string => typeof run === "string");
const usesSteps = steps.filter(
  (step): step is WorkflowStep & { uses: string } => typeof step.uses === "string",
);
const SHA_PINNED_ACTION = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40}$/;

describe(".github/workflows/optimize-crew.yml", () => {
  it("workflow file exists", () => {
    assert.ok(workflowYaml.length > 0, `expected ${WORKFLOW} to exist`);
  });

  it("declares only push and workflow_dispatch triggers", () => {
    assert.deepStrictEqual(Object.keys(workflow.on), [
      "push",
      "workflow_dispatch",
    ]);
  });

  it("declares `push.paths` as exactly `data/crew/**`", () => {
    assert.deepStrictEqual(workflow.on.push.paths, ["data/crew/**"]);
  });

  it("does NOT have a scheduled cron trigger", () => {
    assert.strictEqual(
      workflow.on.schedule,
      undefined,
      "optimize-crew.yml must NOT have a scheduled cron",
    );
  });

  it("uses concurrency group `stfc-crew-optimizer`", () => {
    assert.strictEqual(workflow.concurrency.group, "stfc-crew-optimizer");
  });

  it("concurrency group is distinct from `stfc-gift-redeemer`", () => {
    assert.notStrictEqual(workflow.concurrency.group, "stfc-gift-redeemer");
  });

  it("declares `permissions: contents: write`", () => {
    assert.strictEqual(workflow.permissions.contents, "write");
  });

  it("runs skill:optimize-crew once per task with --task <id>", () => {
    const loopStep = runBlocks.find(
      (block) => block.includes("npm run skill:optimize-crew") && block.includes("--task"),
    );
    assert.ok(
      loopStep !== undefined,
      "workflow must invoke skill:optimize-crew with --task per discovered task",
    );
  });

  it("runs `npm run skill:progression -- --all`", () => {
    assert.ok(
      runBlocks.includes("npm run skill:progression -- --all"),
      "workflow must invoke skill:progression with --all",
    );
  });

  it("commit step uses the pinned crew recommendation message", () => {
    const commitStep = steps.find(
      (step) => step.name === "Commit crew recommendations (if changed)",
    );
    assert.ok(commitStep?.run, "expected a named commit step with a run block");
    assert.ok(
      commitStep.run.includes(
        "chore(crew): regen optimizer recommendations [skip ci]",
      ),
      "commit message must match the pinned format",
    );
  });

  it("has at least one `uses:` action", () => {
    assert.ok(usesSteps.length > 0, "expected at least one `uses:` action");
  });

  for (const step of usesSteps) {
    it(`SHA-pins ${step.uses} as <owner>/<repo>@<40-hex>`, () => {
      assert.match(
        step.uses,
        SHA_PINNED_ACTION,
        `not SHA-pinned as <owner>/<repo>@<40-hex>: ${step.uses}`,
      );
    });
  }
});
