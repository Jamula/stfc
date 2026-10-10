// Pinning tests for `.github/workflows/knowledge-rebuild.yml` (O'Brien's
// push-on-change knowledge-embedding rebuild workflow).
//
// Rule 3: workflow YAML changes need pinning tests in the same commit.
// Per the directive, this workflow must:
//   - trigger on push to docs/stfc-game-knowledge.md, data/crew/officers.json,
//     and data/crew/tasks/** AND workflow_dispatch ONLY;
//   - never have a scheduled cron — push-on-change, not periodic;
//   - use concurrency group `stfc-knowledge-rebuild` (distinct from
//     `stfc-gift-redeemer`, `stfc-crew-optimizer`, `stfc-knowledge-monitor`);
//   - declare `permissions: contents: write` for bot commits;
//   - SHA-pin all `uses:` actions as `<owner>/<repo>@<40-hex>`;
//   - commit changed data/crew/knowledge-embeddings.json with msg
//     `chore(crew): regen knowledge embeddings [skip ci]`.
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
  if?: string;
  with?: Record<string, string>;
};

type KnowledgeRebuildWorkflow = {
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
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "knowledge-rebuild.yml");
const workflowYaml = readFileSync(WORKFLOW, "utf8");
const workflow = parseYaml(workflowYaml) as KnowledgeRebuildWorkflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const runBlocks = steps
  .map((step) => step.run)
  .filter((run): run is string => typeof run === "string");
const usesSteps = steps.filter(
  (step): step is WorkflowStep & { uses: string } => typeof step.uses === "string",
);
const SHA_PINNED_ACTION = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40}$/;

describe(".github/workflows/knowledge-rebuild.yml", () => {
  it("workflow file exists", () => {
    assert.ok(workflowYaml.length > 0, `expected ${WORKFLOW} to exist`);
  });

  it("declares only push and workflow_dispatch triggers", () => {
    assert.deepStrictEqual(Object.keys(workflow.on), [
      "push",
      "workflow_dispatch",
    ]);
  });

  it("declares `push.paths` with exactly 3 knowledge source entries", () => {
    assert.deepStrictEqual(workflow.on.push.paths, [
      "docs/stfc-game-knowledge.md",
      "data/crew/officers.json",
      "data/crew/tasks/**",
    ]);
  });

  it("does NOT have a scheduled cron trigger", () => {
    assert.strictEqual(
      workflow.on.schedule,
      undefined,
      "knowledge-rebuild.yml must NOT have a scheduled cron",
    );
  });

  it("uses concurrency group `stfc-knowledge-rebuild`", () => {
    assert.strictEqual(workflow.concurrency.group, "stfc-knowledge-rebuild");
  });

  it("concurrency group is distinct from `stfc-gift-redeemer`", () => {
    assert.notStrictEqual(workflow.concurrency.group, "stfc-gift-redeemer");
  });

  it("concurrency group is distinct from `stfc-crew-optimizer`", () => {
    assert.notStrictEqual(workflow.concurrency.group, "stfc-crew-optimizer");
  });

  it("declares `permissions: contents: write`", () => {
    assert.strictEqual(workflow.permissions.contents, "write");
  });

  it("runs `npm run crew:knowledge:rebuild`", () => {
    assert.ok(
      runBlocks.includes("npm run crew:knowledge:rebuild"),
      "workflow must invoke crew:knowledge:rebuild",
    );
  });

  it("commit step uses the pinned knowledge embeddings message", () => {
    const commitStep = steps.find(
      (step) => step.name === "Commit knowledge embeddings (if changed)",
    );
    assert.ok(commitStep?.run, "expected a named commit step with a run block");
    assert.ok(
      commitStep.run.includes(
        "chore(crew): regen knowledge embeddings [skip ci]",
      ),
      "commit message must match the pinned format",
    );
  });

  it("commit step bypasses local hooks for generated artifact commits", () => {
    const commitStep = steps.find(
      (step) => step.name === "Commit knowledge embeddings (if changed)",
    );
    assert.ok(commitStep?.run, "expected a named commit step with a run block");
    assert.match(commitStep.run, /git commit --no-verify -m/);
  });

  it("commit step stages data/crew/knowledge-embeddings.json", () => {
    const commitStep = steps.find(
      (step) => step.name === "Commit knowledge embeddings (if changed)",
    );
    assert.ok(commitStep?.run, "expected a named commit step");
    assert.ok(
      commitStep.run.includes("data/crew/knowledge-embeddings.json"),
      "commit step must stage data/crew/knowledge-embeddings.json",
    );
  });

  it("commit step has rebase-before-push pattern", () => {
    const commitStep = steps.find(
      (step) => step.name === "Commit knowledge embeddings (if changed)",
    );
    assert.ok(commitStep?.run, "expected a named commit step");
    assert.ok(
      commitStep.run.includes("git pull --rebase origin"),
      "commit step must rebase before push (Rule 4)",
    );
    assert.ok(
      commitStep.run.includes("git push origin"),
      "commit step must push after rebase",
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

  it("uses actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 (v7.0.1 — matches sibling workflows)", () => {
    const checkoutStep = usesSteps.find((s) => s.uses.startsWith("actions/checkout@"));
    assert.ok(checkoutStep, "expected an actions/checkout step");
    assert.strictEqual(
      checkoutStep.uses,
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
  });

  it("uses actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 (v7.0.0 — matches sibling workflows)", () => {
    const setupNodeStep = usesSteps.find((s) => s.uses.startsWith("actions/setup-node@"));
    assert.ok(setupNodeStep, "expected an actions/setup-node step");
    assert.strictEqual(
      setupNodeStep.uses,
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
  });
});
