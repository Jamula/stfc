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
const AZURE_LOGIN_ACTION_SHA = "a641126d1b8aa4d1fa005f4f92df94a3a4c4c906";

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

  it("permissions include id-token: write (OIDC)", () => {
    assert.match(
      yaml,
      /id-token:\s*write/,
      "id-token: write required for OIDC federated credential auth",
    );
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

  it(`azure/login is pinned to contract SHA (${AZURE_LOGIN_ACTION_SHA})`, () => {
    assert.match(
      yaml,
      new RegExp(`azure/login@${AZURE_LOGIN_ACTION_SHA}`),
      `expected azure/login@${AZURE_LOGIN_ACTION_SHA} — update deploy-contract.md and this test together`,
    );
  });

  it("DISABLE_WRITES: \"1\" is set in the deploy env block (kill switch, Phase 1 default)", () => {
    assert.match(
      yaml,
      /DISABLE_WRITES:\s*["']1["']/,
      'DISABLE_WRITES: "1" must be set until Phase 3 acceptance — do not remove without updating deploy-contract.md §6',
    );
  });

  it("AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_SUBSCRIPTION_ID are wired from secrets (OIDC)", () => {
    // azure/login uses kebab-case input names (tenant-id, client-id, subscription-id)
    // not screaming-snake env vars — match the actual YAML keys.
    assert.match(yaml, /tenant-id:\s*\$\{\{\s*secrets\.AZURE_TENANT_ID\s*\}\}/);
    assert.match(yaml, /client-id:\s*\$\{\{\s*secrets\.AZURE_CLIENT_ID\s*\}\}/);
    assert.match(yaml, /subscription-id:\s*\$\{\{\s*secrets\.AZURE_SUBSCRIPTION_ID\s*\}\}/);
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
      "deploy must wait for OIDC preflight and API validation",
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

  it("deploy and teardown jobs are gated on AZURE_CLIENT_ID being set (secret-presence guard)", () => {
    // Both jobs must skip gracefully when OIDC secrets are not yet provisioned,
    // so a missing-secret state produces `skipped` rather than `failure`.
    //
    // The `secrets` context is NOT available in a job-level `if:` — using it
    // there makes the whole workflow fail to start (startup_failure), not skip.
    // So the guard is implemented as a `preflight` job that probes the secret in
    // a step and exposes a `has-oidc` output; deploy/teardown gate on it via
    // `needs.preflight.outputs.has-oidc`. See fix(deploy) commit.
    assert.match(
      yaml,
      /has-oidc:\s*\$\{\{\s*steps\.probe\.outputs\.has-oidc\s*\}\}/,
      "preflight job must expose a has-oidc output probed from secrets.AZURE_CLIENT_ID",
    );
    assert.match(
      yaml,
      /AZURE_CLIENT_ID:\s*\$\{\{\s*secrets\.AZURE_CLIENT_ID\s*\}\}/,
      "preflight probe must read secrets.AZURE_CLIENT_ID via an env var (the only place secrets are allowed)",
    );
    const gateMatches = yaml.match(/needs\.preflight\.outputs\.has-oidc\s*==\s*'true'/g) ?? [];
    assert.ok(
      gateMatches.length >= 2,
      "deploy AND teardown jobs must gate on needs.preflight.outputs.has-oidc == 'true' so unprovisioned secrets skip rather than fail",
    );
    // The forbidden pattern must NOT reappear in any job-level `if:`.
    assert.doesNotMatch(
      yaml,
      /if:[^\n]*secrets\.AZURE_CLIENT_ID/,
      "secrets.* must never appear in a job-level if: — it causes a workflow startup failure",
    );
  });
});
