// Pinning tests for .github/workflows/swa-deploy.yml
//
// Regression-guards the deployment contract invariants documented in
// specs/005-web-control-panel/deploy-contract.md — same pattern as
// tests/skills/discordMonitor.test.ts (T027 workflow YAML assertions).
//
// If any assertion here fails, the workflow has drifted from the contract.
// Fix the workflow AND update this file in the same commit (Rule 3).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

// SHA from deploy-contract.md §2 — must match workflow bit-for-bit.
const SWA_DEPLOY_ACTION_SHA = "1a947af9992250f3bc2e68ad0754c0b0c11566c9";

const yamlPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "swa-deploy.yml",
);

describe("swa-deploy.yml / contract pinning (T-SWA-001)", () => {
  let yaml: string;

  // Read once; all sub-tests share the same buffer.
  yaml = fs.readFileSync(yamlPath, "utf8");

  it("swa-deploy.yml exists", () => {
    assert.ok(fs.existsSync(yamlPath), `swa-deploy.yml not found at ${yamlPath}`);
  });

  it("triggers on push to main", () => {
    assert.match(yaml, /push:/, "missing push trigger");
    assert.match(yaml, /branches:\s*\n\s*-\s*main/, "push trigger not scoped to main");
  });

  it("triggers on pull_request targeting main", () => {
    assert.match(yaml, /pull_request:/, "missing pull_request trigger");
  });

  it("pull_request trigger includes 'closed' action (preview teardown)", () => {
    assert.match(yaml, /- closed/, "closed action missing — preview teardown won't fire");
  });

  it("does not grant id-token: write because SWA deployment uses its required token input", () => {
    assert.doesNotMatch(yaml, /id-token:\s*write/);
  });

  it("permissions include contents: read", () => {
    assert.match(yaml, /contents:\s*read/);
  });

  it("permissions include pull-requests: write (preview comment)", () => {
    assert.match(yaml, /pull-requests:\s*write/);
  });

  it("concurrency group is defined", () => {
    assert.match(yaml, /concurrency:/, "concurrency block missing");
    assert.match(yaml, /group:\s*swa-deploy-/, "concurrency group must start with swa-deploy-");
  });

  it("all `uses:` actions are SHA-pinned (40-hex)", () => {
    const uses = [...yaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    assert.ok(uses.length > 0, "expected at least one `uses:` line");
    for (const u of uses) {
      assert.match(u, /@[0-9a-f]{40}\b/, `action not SHA-pinned: ${u}`);
    }
  });

  it(`Azure/static-web-apps-deploy is pinned to contract SHA (${SWA_DEPLOY_ACTION_SHA})`, () => {
    assert.match(
      yaml,
      new RegExp(`Azure/static-web-apps-deploy@${SWA_DEPLOY_ACTION_SHA}`),
      `expected Azure/static-web-apps-deploy@${SWA_DEPLOY_ACTION_SHA} — update deploy-contract.md §2 and this test together`,
    );
  });

  it("DISABLE_WRITES: \"1\" is set in the deploy env block (kill switch, Phase 1 default)", () => {
    assert.match(
      yaml,
      /DISABLE_WRITES:\s*["']1["']/,
      'DISABLE_WRITES: "1" must be set until Phase 3 acceptance — do not remove without updating deploy-contract.md §6',
    );
  });

  it("passes the required deployment token to upload and close actions", () => {
    const workflow = parseYaml(yaml) as {
      jobs: Record<string, {
        steps: { uses?: string; with?: Record<string, string> }[];
      }>;
    };
    for (const [job, action] of [["deploy", "upload"], ["teardown", "close"]]) {
      const step = workflow.jobs[job!]!.steps.find(
        (step) => step.uses === `Azure/static-web-apps-deploy@${SWA_DEPLOY_ACTION_SHA}`,
      );
      assert.equal(step?.with?.action, action, `${job} must perform ${action}`);
      assert.equal(
        step?.with?.azure_static_web_apps_api_token,
        "${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}",
        `${job} must pass the repository deployment token`,
      );
    }
    assert.doesNotMatch(yaml, /azure\/login@/);
    assert.doesNotMatch(yaml, /secrets\.AZURE_(CLIENT_ID|TENANT_ID|SUBSCRIPTION_ID)/);
  });

  it("validate-api-node-22 installs, builds, and smoke-tests the API before deploy", () => {
    const normalizedYaml = yaml.replace(/\r\n/g, "\n");
    const validationJob =
      normalizedYaml.match(/^  validate-api-node-22:\n([\s\S]*?)(?=^  deploy:)/m)?.[1] ?? "";

    assert.ok(validationJob, "validate-api-node-22 job must exist");
    assert.match(
      validationJob,
      /^[ \t]+- name: Install API dependencies\n[ \t]+run: npm ci\n[ \t]+working-directory: api$/m,
    );
    assert.match(
      validationJob,
      /^[ \t]+- name: Build API\n[ \t]+run: npm run build\n[ \t]+working-directory: api$/m,
    );
    assert.match(validationJob, /- name: Smoke test built API modules/);
    assert.match(
      validationJob,
      /run: node --input-type=module -e .*import\('\.\/dist\/_lib\/auth\.js'\).*import\('\.\/dist\/_lib\/respond\.js'\)/,
    );
    assert.match(
      normalizedYaml,
      /^  deploy:\n    needs:\n      - preflight\n      - validate-api-node-22$/m,
      "deploy must wait for token preflight and API validation",
    );
  });

  it("limits validate-api-node-22 to contents: read", () => {
    const workflow = parseYaml(yaml) as {
      jobs?: Record<string, { permissions?: Record<string, string> }>;
    };

    assert.deepEqual(
      workflow.jobs?.["validate-api-node-22"]?.permissions,
      { contents: "read" },
      "API validation must not inherit workflow-level write permissions",
    );
  });

  it("repo_token wired from secrets.GITHUB_TOKEN (PR comment support)", () => {
    assert.match(yaml, /repo_token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  it("app_location is 'web' and api_location is 'api'", () => {
    assert.match(yaml, /app_location:\s*web/);
    assert.match(yaml, /api_location:\s*api/);
    assert.match(yaml, /config_file_location:\s*\./);
  });

  it("deploy and teardown jobs are gated on the SWA deployment token (secret-presence guard)", () => {
    // Both jobs must skip gracefully when the deployment token is not provisioned,
    // so a missing-secret state produces `skipped` rather than `failure`.
    //
    // The `secrets` context is NOT available in a job-level `if:` — using it
    // there makes the whole workflow fail to start (startup_failure), not skip.
    // So the guard is implemented as a `preflight` job that probes the secret in
    // a step and exposes a `has-token` output; deploy/teardown gate on it via
    // `needs.preflight.outputs.has-token`.
    assert.match(
      yaml,
      /has-token:\s*\$\{\{\s*steps\.probe\.outputs\.has-token\s*\}\}/,
      "preflight job must expose a has-token output probed from the SWA secret",
    );
    assert.match(
      yaml,
      /SWA_DEPLOY_TOKEN:\s*\$\{\{\s*secrets\.AZURE_STATIC_WEB_APPS_API_TOKEN\s*\}\}/,
      "preflight probe must read the deployment token via an env var",
    );
    const gateMatches = yaml.match(/needs\.preflight\.outputs\.has-token\s*==\s*'true'/g) ?? [];
    assert.ok(
      gateMatches.length >= 2,
      "deploy AND teardown jobs must gate on needs.preflight.outputs.has-token == 'true' so an unprovisioned secret skips rather than fails",
    );
    // The forbidden pattern must NOT reappear in any job-level `if:`.
    assert.doesNotMatch(
      yaml,
      /if:[^\n]*secrets\.AZURE_STATIC_WEB_APPS_API_TOKEN/,
      "secrets.* must never appear in a job-level if: — it causes a workflow startup failure",
    );
  });
});
