import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

type Step = { name?: string; if?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps?: Step[] }>;
};

function readWorkflow(name: string): Workflow {
  return YAML.parse(readFileSync(`.squad/templates/workflows/${name}.yml`, "utf8")) as Workflow;
}

test("promotion dispatches the main release only after a real push", () => {
  const promotion = readWorkflow("squad-promote");
  assert.equal(promotion.permissions.actions, "write");
  assert.equal(promotion.permissions.contents, "write");

  const steps = promotion.jobs["preview-to-main"]?.steps;
  assert.ok(steps, "promotion must include the preview-to-main job");
  const pushIndex = steps.findIndex((step) => step.name === "Merge preview → main");
  const dispatchIndex = steps.findIndex((step) => step.name === "Dispatch release");
  assert.ok(pushIndex >= 0, "promotion must include the main push step");
  assert.ok(dispatchIndex > pushIndex, "dispatch must follow the main push");
  const push = steps[pushIndex]!;
  const dispatch = steps[dispatchIndex]!;
  assert.equal(push.if, "${{ inputs.dry_run == 'false' }}");
  assert.match(push.run!, /^\s*git push origin main\s*$/m);
  assert.equal(dispatch.if, "${{ inputs.dry_run == 'false' }}");
  assert.equal(dispatch.env?.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  assert.equal(
    dispatch.run,
    'gh workflow run squad-release.yml --ref main -f expected_sha="$(git rev-parse HEAD)"'
  );
});

test("release binds promotion dispatches to their expected commit", () => {
  const release = readWorkflow("squad-release");
  assert.deepEqual(release.on.push, { branches: ["main"] });
  assert.deepEqual(release.on.workflow_dispatch, {
    inputs: {
      expected_sha: {
        description: "Expected main commit SHA (optional for manual releases)",
        required: false,
        type: "string",
      },
    },
  });
  assert.equal(release.jobs.release?.if, "github.ref == 'refs/heads/main'");
  assert.equal(release.permissions.contents, "write");
  const steps = release.jobs.release?.steps;
  assert.ok(steps);
  const validation = steps[0];
  assert.equal(validation?.name, "Validate dispatched commit");
  assert.equal(validation.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(validation.env?.EXPECTED_SHA, "${{ inputs.expected_sha }}");
  assert.match(
    validation.run!,
    /if \[ -n "\$EXPECTED_SHA" \] && \[ "\$EXPECTED_SHA" != "\$GITHUB_SHA" \]; then\s+echo "::error::Main advanced after promotion; refusing to release a different commit\."\s+exit 1\s+fi/
  );
});

test("release commit validation rejects a different main SHA", (t) => {
  const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if ((bash.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    t.skip("bash is unavailable");
    return;
  }
  assert.equal(bash.status, 0, "bash must be runnable");
  const script = readWorkflow("squad-release").jobs.release?.steps?.[0]?.run;
  assert.ok(script);

  for (const [expected, actual, status] of [
    ["abc123", "abc123", 0],
    ["", "abc123", 0],
    ["abc123", "def456", 1],
  ] as const) {
    const result: SpawnSyncReturns<string> = spawnSync("bash", ["--noprofile", "--norc", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, EXPECTED_SHA: expected, GITHUB_SHA: actual },
    });

    assert.equal(result.status, status, `expected SHA ${expected || "(empty)"}, actual SHA ${actual}: ${result.stderr}`);
    if (status !== 0) {
      assert.match(result.stdout, /::error::Main advanced after promotion/);
    }
  }
});

test("active Squad release observes the existing Release workflow instead of publishing a competing release", () => {
  const release = YAML.parse(readFileSync(".github/workflows/squad-release.yml", "utf8")) as Workflow;
  assert.deepEqual(release.on.workflow_run, {
    workflows: ["Release"],
    types: ["completed"],
    branches: ["main"],
  });
  assert.equal(release.permissions.contents, "read");
  assert.match(release.jobs.report?.steps?.[0]?.run ?? "", /"\$CONCLUSION" != "success"/);
});
