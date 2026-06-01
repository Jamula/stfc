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

// SHA from deploy-contract.md §2 — must match workflow bit-for-bit.
const SWA_DEPLOY_ACTION_SHA = "1a947af9992250f3bc2e68ad0754c0b0c11566c9";
const AZURE_LOGIN_ACTION_SHA = "532459ea530d8321f2fb9bb10d1e0bcf23869a43";

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

  it("repo_token wired from secrets.GITHUB_TOKEN (PR comment support)", () => {
    assert.match(yaml, /repo_token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  it("app_location is 'web' and api_location is 'api'", () => {
    assert.match(yaml, /app_location:\s*web/);
    assert.match(yaml, /api_location:\s*api/);
  });
});
