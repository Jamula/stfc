import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs";
import YAML from "yaml";

const workflowPath = ".github/workflows/deploy-cloudflare-worker.yml";

test("deploy-cloudflare-worker.yml: pinning tests", async (t) => {
  assert.ok(fs.existsSync(workflowPath), `${workflowPath} exists`);

  const workflowContent = fs.readFileSync(workflowPath, "utf-8");
  const workflow = YAML.parse(workflowContent) as Record<string, unknown>;

  await t.test("trigger: push on main with worker/** path filter", () => {
    const pushTrigger = (
      workflow.on as Record<string, Record<string, unknown>>
    ).push as Record<string, unknown>;
    assert.deepEqual(
      pushTrigger.branches,
      ["main"],
      "push trigger includes main branch"
    );
    assert.deepEqual(
      pushTrigger.paths,
      ["worker/**", ".github/workflows/deploy-cloudflare-worker.yml"],
      "push trigger includes worker/** path filter"
    );
  });

  await t.test("trigger: workflow_dispatch for manual redeploy", () => {
    const triggers = workflow.on as Record<string, unknown>;
    assert.ok(
      triggers["workflow_dispatch"],
      "workflow_dispatch trigger exists for manual redeploy"
    );
  });

  await t.test("permissions: contents: read only", () => {
    const permissions = workflow.permissions as Record<string, string>;
    assert.equal(permissions.contents, "read", "permissions.contents = read");
    assert.ok(
      Object.keys(permissions).length === 1,
      "no other permissions granted (minimal principle)"
    );
  });

  await t.test("concurrency: group=deploy-cloudflare-worker, never cancel", () => {
    const concurrency = workflow.concurrency as Record<string, unknown>;
    assert.equal(
      concurrency.group,
      "deploy-cloudflare-worker",
      "concurrency group = deploy-cloudflare-worker"
    );
    assert.equal(
      concurrency["cancel-in-progress"],
      false,
      "cancel-in-progress = false (never cancel in-flight deploys)"
    );
  });

  await t.test("jobs.deploy: action SHA pins for checkout, setup-node, wrangler", () => {
    const steps = (
      (workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >
    ).steps as Array<Record<string, unknown>>;

    const checkoutStep = steps.find((s) => (s.uses as string)?.includes("actions/checkout"));
    assert.ok(
      (checkoutStep?.uses as string)?.includes("34e114876b0b11c390a56381ad16ebd13914f8d5"),
      "actions/checkout pinned to SHA 34e114876b0b11c390a56381ad16ebd13914f8d5 (v4.3.0)"
    );

    const setupNodeStep = steps.find((s) => (s.uses as string)?.includes("actions/setup-node"));
    assert.ok(
      (setupNodeStep?.uses as string)?.includes("49933ea5288caeca8642d1e84afbd3f7d6820020"),
      "actions/setup-node pinned to SHA 49933ea5288caeca8642d1e84afbd3f7d6820020 (v4.4.0)"
    );

    const wranglerStep = steps.find((s) => (s.uses as string)?.includes("cloudflare/wrangler-action"));
    assert.ok(
      (wranglerStep?.uses as string)?.includes("ebbaa1584979971c8614a24965b4405ff95890e0"),
      "cloudflare/wrangler-action pinned to SHA ebbaa1584979971c8614a24965b4405ff95890e0 (v4.0.0)"
    );
  });

  await t.test("setup-node: node-version-file points to root .nvmrc", () => {
    const steps = (
      (workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >
    ).steps as Array<Record<string, unknown>>;

    const setupNodeStep = steps.find((s) => (s.uses as string)?.includes("actions/setup-node"));
    const withObj = (setupNodeStep?.with as Record<string, unknown>) || {};

    assert.equal(
      withObj["node-version-file"],
      ".nvmrc",
      "node-version-file points to root .nvmrc (not worker/.nvmrc)"
    );
  });

  await t.test("steps: npm test and npm run typecheck before deploy", () => {
    const steps = (
      (workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >
    ).steps as Array<Record<string, unknown>>;

    const npmCiIndex = steps.findIndex(
      (s) => (s.run as string)?.includes("npm ci") && (s.run as string)?.includes("worker")
    );
    const npmTestIndex = steps.findIndex(
      (s) => (s.run as string)?.includes("npm test") && (s.run as string)?.includes("worker")
    );
    const typecheckIndex = steps.findIndex(
      (s) => (s.run as string)?.includes("npm run typecheck") && (s.run as string)?.includes("worker")
    );
    const deployIndex = steps.findIndex((s) => (s.uses as string)?.includes("wrangler-action"));

    assert.ok(npmCiIndex > 0, "npm ci step exists in worker/");
    assert.ok(npmTestIndex > npmCiIndex, "npm test runs after npm ci");
    assert.ok(typecheckIndex > npmTestIndex, "npm run typecheck runs after npm test");
    assert.ok(deployIndex > typecheckIndex, "deploy step runs after all tests pass");
  });

  await t.test("wrangler-action inputs: command=deploy, workingDirectory=worker, secrets", () => {
    const steps = (
      (workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >
    ).steps as Array<Record<string, unknown>>;

    const wranglerStep = steps.find((s) => (s.uses as string)?.includes("wrangler-action"));
    const withObj = (wranglerStep?.with as Record<string, unknown>) || {};

    assert.equal(
      withObj.command,
      "deploy",
      "wrangler-action command=deploy"
    );
    assert.equal(
      withObj.workingDirectory,
      "worker",
      "wrangler-action workingDirectory=worker"
    );
    assert.ok(
      String(withObj.apiToken).includes("secrets.CLOUDFLARE_API_TOKEN"),
      "apiToken references secrets.CLOUDFLARE_API_TOKEN"
    );
    assert.ok(
      String(withObj.accountId).includes("secrets.CLOUDFLARE_ACCOUNT_ID"),
      "accountId references secrets.CLOUDFLARE_ACCOUNT_ID"
    );
  });

  await t.test("secrets: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID referenced (never logged)", () => {
    const workflowStr = JSON.stringify(workflow);
    assert.ok(
      workflowStr.includes("CLOUDFLARE_API_TOKEN"),
      "workflow references CLOUDFLARE_API_TOKEN"
    );
    assert.ok(
      workflowStr.includes("CLOUDFLARE_ACCOUNT_ID"),
      "workflow references CLOUDFLARE_ACCOUNT_ID"
    );

    // Ensure secrets are not echoed/logged in run commands
    const steps = (
      ((workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >).steps as Array<Record<string, unknown>>
    ) || [];
    
    for (const step of steps) {
      const runCmd = (step.run as string) || "";
      // Check if any run step echoes or logs the token (e.g., "echo $CLOUDFLARE_API_TOKEN" or "console.log")
      assert.ok(
        !runCmd.includes("echo") || (!runCmd.includes("$CLOUDFLARE_API_TOKEN") && !runCmd.includes("CLOUDFLARE_API_TOKEN")),
        "CLOUDFLARE_API_TOKEN value is not echoed/logged in any run command"
      );
    }
  });

  await t.test("job summary: reports deployed URL for operator", () => {
    const steps = (
      (workflow.jobs as Record<string, Record<string, unknown>>).deploy as Record<
        string,
        unknown
      >
    ).steps as Array<Record<string, unknown>>;

    const summaryStep = steps.find(
      (s) => (s.run as string)?.includes("GITHUB_STEP_SUMMARY")
    );
    assert.ok(
      summaryStep,
      "final step writes to GITHUB_STEP_SUMMARY with deployment URL"
    );
    assert.ok(
      (summaryStep?.run as string)?.includes("Cloudflare Worker Deployed"),
      "summary includes 'Cloudflare Worker Deployed' message"
    );
  });
});
