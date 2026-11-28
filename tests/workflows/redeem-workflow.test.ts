// Pinning tests for `.github/workflows/redeem.yml`.
//
// These tests assert structural properties of the workflow YAML so that
// accidental regressions are caught by CI before they cause silent data loss
// or swallowed push failures in production.
//
// Assertions mirror the acceptance criteria from issue #212 (state must be
// captured correctly) AND issue #241 (state must land on `automation-state`,
// never on `main`, since the repository ruleset rejects direct pushes from
// GITHUB_TOKEN's `github-actions` identity and cannot be given a bypass
// actor for it on this org/plan — see the retro comments on #241 for the
// live-verified evidence). The decision on #241
// explicitly rejected any RepositoryRole/User/PAT-based bypass (it would
// recreate #220's auto-landing vector), so these tests also assert that no
// such bypass mechanism was reintroduced.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "redeem.yml");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const yaml = readIfExists(WORKFLOW);

function getNamedStep(source: string, name: string): string {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected workflow step "${name}"`);
  const end = source.indexOf("\n      - ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

const ALERT_SCRIPT = path.join(REPO_ROOT, "scripts", "dead-token-alert.mjs");
const alertScript = readIfExists(ALERT_SCRIPT);

describe(".github/workflows/redeem.yml", () => {
  it("selects Azure only for complete configuration and refuses every partial combination", () => {
    const workflow = parse(yaml!);
    const step = workflow.jobs.redeem.steps.find(
      (entry: { id?: string }) => entry.id === "token_source",
    );
    const script = step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "");
    const keys = Object.keys(step.env);
    const values: Record<string, string> = {
      AZURE_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
      AZURE_TENANT_ID: "fixture.onmicrosoft.com",
      AZURE_SUBSCRIPTION_ID: "33333333-3333-3333-3333-333333333333",
      AZURE_TOKEN_STORAGE_ACCOUNT: "teststorage1",
      AZURE_TOKEN_CONTAINER: "private-token-store",
      AZURE_TOKEN_BLOB: "fixture/accounts.json",
    };
    assert.equal(keys.length, 6);
    const directory = fs.mkdtempSync(path.join(tmpdir(), "stfc-source-"));
    try {
      for (let mask = 0; mask < 64; mask++) {
        const output = path.join(directory, "output");
        fs.writeFileSync(output, "");
        const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: output };
        keys.forEach((key, index) => { env[key] = mask & (1 << index) ? values[key] : ""; });
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
        const complete = mask === 0 || mask === 63;
        assert.equal(result.status, complete ? 0 : 1, `configuration mask ${mask}`);
        assert.equal(fs.readFileSync(output, "utf8"),
          complete ? `source=${mask === 63 ? "azure" : "secret"}\n` : "",
          `source output for mask ${mask}`);
        if (!complete) assert.match(result.stderr, /incomplete; refusing secret fallback/);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses secret fallback for each invalid complete Azure configuration without logging values", () => {
    const workflow = parse(yaml!);
    const step = workflow.jobs.redeem.steps.find(
      (entry: { id?: string }) => entry.id === "token_source",
    );
    const script = step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "");
    const values: Record<string, string> = {
      AZURE_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
      AZURE_TENANT_ID: "fixture.onmicrosoft.com",
      AZURE_SUBSCRIPTION_ID: "33333333-3333-3333-3333-333333333333",
      AZURE_TOKEN_STORAGE_ACCOUNT: "teststorage1",
      AZURE_TOKEN_CONTAINER: "private-token-store",
      AZURE_TOKEN_BLOB: "fixture/accounts.json",
    };
    const invalidValues: Record<string, string> = {
      AZURE_CLIENT_ID: "invalid-client-marker",
      AZURE_TENANT_ID: "invalid tenant marker",
      AZURE_SUBSCRIPTION_ID: "invalid-subscription-marker",
      AZURE_TOKEN_STORAGE_ACCOUNT: "InvalidStorageMarker",
      AZURE_TOKEN_CONTAINER: "invalid--container-marker",
      AZURE_TOKEN_BLOB: "x".repeat(1025),
    };
    const directory = fs.mkdtempSync(path.join(tmpdir(), "stfc-source-invalid-"));
    try {
      const output = path.join(directory, "output");
      for (const [key, value] of Object.entries(invalidValues)) {
        fs.writeFileSync(output, "");
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
          env: { ...process.env, ...values, [key]: value, GITHUB_OUTPUT: output },
          encoding: "utf8",
        });
        assert.equal(result.status, 1, `${key} must fail closed`);
        assert.match(result.stderr, /invalid; refusing secret fallback/);
        assert.ok(result.stderr.includes(key));
        assert.ok(!(result.stdout + result.stderr).includes(value));
        for (const validValue of Object.values(values)) {
          assert.ok(!(result.stdout + result.stderr).includes(validValue));
        }
        assert.equal(fs.readFileSync(output, "utf8"), "");
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the entire legacy inventory without logging it and fails closed on invalid data", () => {
    const workflow = parse(yaml!);
    const step = workflow.jobs.redeem.steps.find(
      (entry: { name?: string }) => entry.name === "Load legacy account tokens",
    );
    assert.equal(step.env.STFC_ACCOUNTS, "${{ secrets.STFC_ACCOUNTS }}");
    assert.match(step.run, /refresh override\(s\) were rejected/);
    assert.ok(step.run.indexOf("await mergeAvailableRefreshedAccounts(") < step.run.indexOf("writeFileSync(join("),
      "only independently validated overrides may enter the temporary inventory");
    const script = step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "");
    const directory = fs.mkdtempSync(path.join(tmpdir(), "stfc-legacy-"));
    const file = path.join(directory, "stfc-accounts.json");
    const accounts = JSON.stringify([
      { name: "main", token: "header.payload.signature" },
      { name: "alt", token: "other.payload.signature" },
    ]);
    const run = (value: string) => spawnSync(process.execPath,
      ["--input-type=module", "-e", script], {
        cwd: REPO_ROOT, encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: directory, STFC_ACCOUNTS: value, STFC_ACCOUNT_REFRESH: "" },
      });
    try {
      const valid = run(accounts);
      assert.equal(valid.status, 0, valid.stderr);
      assert.equal(fs.readFileSync(file, "utf8"), accounts);
      assert.equal(valid.stdout + valid.stderr, "");
      fs.unlinkSync(file);
      for (const value of ["", "private-invalid-value", "[]", '[{"name":"main","token":"not-a-jwt"}]']) {
        const invalid = run(value);
        assert.equal(invalid.status, 1);
        assert.match(invalid.stderr, /::error::STFC_ACCOUNTS/);
        assert.ok(!fs.existsSync(file));
        if (value) assert.ok(!(invalid.stdout + invalid.stderr).includes(value));
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it(
    "installs dependencies before Azure login and token download, then removes tokens after redemption",
    { skip: yaml === undefined },
    () => {
      const installIdx = yaml!.indexOf("      - run: npm ci");
      const loginIdx = yaml!.indexOf("      - name: Sign in to Azure with GitHub OIDC");
      const downloadIdx = yaml!.indexOf("      - name: Download account tokens");
      const redeemIdx = yaml!.indexOf("      - name: Redeem");
      const cleanupIdx = yaml!.indexOf("      - name: Remove account-token file");

      assert.ok(installIdx >= 0 && loginIdx > installIdx && downloadIdx > loginIdx &&
        redeemIdx > downloadIdx && cleanupIdx > redeemIdx);
      assert.match(getNamedStep(yaml!, "Remove account-token file"), /if:\s*always\(\)/);
    },
  );

  it(
    "restores state from automation-state before running the redeemer",
    { skip: yaml === undefined },
    () => {
      const restoreIdx = yaml!.indexOf("Restore automation state from automation-state branch");
      const redeemIdx = yaml!.indexOf("name: Redeem\n");
      assert.notEqual(restoreIdx, -1, "must have a restore-state step");
      assert.notEqual(redeemIdx, -1, "must have the Redeem step");
      assert.ok(
        restoreIdx < redeemIdx,
        "restore step must precede the Redeem step so the run sees fresh state",
      );
      assert.match(
        yaml!,
        /cp "\$RESTORE_DIR\/docs\/redeem-history\.md" docs\/redeem-history\.md/,
        "must restore docs/redeem-history.md from automation-state",
      );
      assert.match(
        yaml!,
        /cp "\$RESTORE_DIR\/data\/promo-code-dead\.json" data\/promo-code-dead\.json/,
        "must restore data/promo-code-dead.json from automation-state",
      );
      assert.match(
        yaml!,
        /node scripts\/merge-promo-codes\.mjs[\s\S]*promo-codes\.txt "\$RESTORE_DIR\/promo-codes\.txt" promo-codes\.txt "\$MAIN_SHA"/,
        "must merge with automation-state as the canonical starting point (state path second, main-seed workspace copy first per mergePromoCodeFiles(mainPath, statePath, outputPath, mainRef)) and a deterministic $MAIN_SHA seed marker (ARCH-241-R D2)",
      );
    },
  );

  it(
    "stages docs/redeem-history.md when changed",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /add -A -- docs\/redeem-history\.md/,
        "commit step must stage docs/redeem-history.md",
      );
    },
  );

  it(
    "stages data/promo-code-dead.json when changed",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /add[^\n]*data\/promo-code-dead\.json/,
        "commit step must stage data/promo-code-dead.json",
      );
    },
  );

  it(
    "skips commit when nothing changed relative to automation-state",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /git -C "\$STATE_DIR" diff --cached --quiet/,
        "must gate the commit on a diff against automation-state's own history, not main's",
      );
    },
  );

  it(
    "uses --no-verify on the generated commit",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /git -C "\$STATE_DIR" commit --no-verify/,
        "generated commit must use --no-verify so the pre-commit hook does not block CI",
      );
    },
  );

  it(
    "retries the push with a bounded loop against automation-state",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /for attempt in \d/,
        "must retry push with a bounded loop",
      );
      assert.match(
        yaml!,
        /git -C "\$STATE_DIR" push --no-verify origin "HEAD:automation-state"/,
        "push target must be automation-state",
      );
      assert.doesNotMatch(
        yaml!,
        /git -C "\$STATE_DIR" pull --rebase[^\n]*\|\| true/,
        "rebase failures must not be swallowed (issue #212)",
      );
    },
  );

  it(
    "never pushes to $GITHUB_REF_NAME (main)",
    { skip: yaml === undefined },
    () => {
      assert.doesNotMatch(
        yaml!,
        /git push origin "HEAD:\$GITHUB_REF_NAME"/,
        "must not push automation state directly to main — issue #241",
      );
      assert.doesNotMatch(
        yaml!,
        /git -C "\$STATE_DIR" push origin "HEAD:\$GITHUB_REF_NAME"/,
        "must not push automation state directly to main — issue #241",
      );
    },
  );

  it(
    "emits a visible ::error:: annotation and exits non-zero after all retries exhausted",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /::error::/,
        "must emit a GitHub Actions error annotation when all push attempts fail",
      );
      assert.match(
        yaml!,
        /exit 1/,
        "must exit non-zero after exhausting push retries",
      );
    },
  );

  it(
    "triggers on schedule and workflow_dispatch",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /schedule:/, "must trigger on schedule");
      assert.match(yaml!, /workflow_dispatch:/, "must trigger on workflow_dispatch");
    },
  );

  it(
    "documents the declared cron as a best-effort target with measured history",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /cron:\s*"\*\/10 \* \* \* \*"/);
      assert.match(yaml!, /GitHub scheduled delivery is best-effort, not a 10-minute guarantee/i);
      assert.match(
        yaml!,
        /Issue #184 measured 34 runs in 22 complete hours \(1\.55\/hour vs 6\/hour expected\) during 2026-08-20\/21/i,
      );
    },
  );

  it(
    "serializes on the shared writer group with a bounded FIFO queue, never the lossy default",
    { skip: yaml === undefined },
    () => {
      // redeem.yml runs every 10 minutes, so it is the workflow most likely
      // to arrive while something else is pending on stfc-gift-redeemer. On
      // the default `queue: single` its arrival would cancel and replace that
      // pending run — including a pending /game-state upload Discord has
      // already acknowledged. `queue: max` queues up to 100 instead, FIFO.
      assert.match(yaml!, /^concurrency:\s*$/m);
      assert.match(yaml!, /^\s{2}group:\s*stfc-gift-redeemer\s*$/m);
      assert.match(yaml!, /^\s{2}queue:\s*max\s*$/m);
      assert.match(yaml!, /^\s{2}cancel-in-progress:\s*false\s*$/m);
      assert.doesNotMatch(yaml!, /^\s*queue:\s*single\s*$/m);
      // GitHub rejects queue: max + cancel-in-progress: true as a workflow
      // validation error, which would take redemption offline entirely.
      assert.doesNotMatch(yaml!, /^\s*cancel-in-progress:\s*true\b/m);
    },
  );

  it(
    "declares contents: write permission for the commit step",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /contents:\s*write/,
        "must declare contents: write so the bot can push the generated commit",
      );
    },
  );

  it(
    "does not introduce a PAT-based or deploy-key bypass secret (issue #241 governance decision)",
    { skip: yaml === undefined },
    () => {
      assert.doesNotMatch(
        yaml!,
        /secrets\.[A-Z_]*PAT[A-Z_]*/,
        "must not read a PAT secret for pushing — the RepositoryRole/User/PAT bypass was rejected on #241",
      );
      assert.doesNotMatch(
        yaml!,
        /secrets\.AUTOMATION_DEPLOY_KEY/,
        "must not use a deploy key either — the approved fix is the automation-state branch, not a bypass actor",
      );
    },
  );

  it(
    "declares issues: write permission for dead-token issue management",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /permissions:[\s\S]*?issues:\s*write/,
        "dead-token alert creation and closure require issues: write",
      );
    },
  );

  it(
    "uses the same exact title and stable required labels for create and resolve",
    { skip: yaml === undefined },
    () => {
      const expectedTitle =
        "STFC token rejected — redemption is stopped until STFC_ACCOUNTS is refreshed";
      const titles = [...yaml!.matchAll(/^\s+TITLE: "([^"]+)"\r?$/gm)].map((match) => match[1]);
      const requiredLabels = [...yaml!.matchAll(/^\s+REQUIRED_LABELS: "([^"]+)"\r?$/gm)].map(
        (match) => match[1],
      );

      assert.deepEqual(titles, [expectedTitle, expectedTitle]);
      assert.deepEqual(requiredLabels, ["bug", "bug"]);
      assert.match(yaml!, /--label "bug,priority:p1"/);
    },
  );

  it(
    "syncs the persistent degraded-gift alert only after a non-fatal redeem run",
    { skip: yaml === undefined },
    () => {
      const alertStep = getNamedStep(yaml!, "Sync persistent degraded-gift alert");
      assert.match(alertStep, /if: always\(\) && steps\.redeem\.outputs\.exit_code == '0'/);
      assert.match(alertStep, /continue-on-error:\s*true/);
      assert.match(alertStep, /STATE_FILE: data\/redeem-degraded-state\.json/);
      assert.match(alertStep, /node scripts\/degraded-gift-alert\.mjs sync/);
    },
  );

  it(
    "restores and stages persistent degraded-gift state on automation-state",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /cp "\$RESTORE_DIR\/data\/redeem-degraded-state\.json" data\/redeem-degraded-state\.json/,
      );
      const commitStep = getNamedStep(yaml!, "Commit redeem state to automation-state (if changed)");
      assert.match(
        commitStep,
        /cp data\/redeem-degraded-state\.json "\$STATE_DIR\/data\/redeem-degraded-state\.json"/,
      );
      assert.match(
        commitStep,
        /git -C "\$STATE_DIR" add -A -- data\/redeem-degraded-state\.json/,
      );
    },
  );

  it(
    "routes both alert lookups through the shared selection script",
    { skip: yaml === undefined },
    () => {
      // Structural symmetry: instead of two hand-written jq predicates that
      // can drift apart, both halves invoke one implementation. The behaviour
      // of that implementation is proven in tests/scripts/deadTokenAlert.test.ts.
      const createStep = getNamedStep(yaml!, "Alert on dead token");
      const resolveStep = getNamedStep(yaml!, "Auto-resolve dead-token alert");

      assert.match(createStep, /existing=\$\(node scripts\/dead-token-alert\.mjs find\)/);
      assert.match(resolveStep, /node scripts\/dead-token-alert\.mjs resolve/);
      assert.ok(alertScript !== undefined, "scripts/dead-token-alert.mjs must exist");
    },
  );

  it(
    "keeps no inline issue-selection or close logic in the workflow",
    { skip: yaml === undefined },
    () => {
      // A second copy of the predicate — or a `gh issue close` in a shell loop —
      // is exactly the drift the shared script exists to prevent.
      assert.doesNotMatch(yaml!, /gh issue list/, "issue lookup belongs to the shared script");
      assert.doesNotMatch(yaml!, /gh issue close/, "issue closing belongs to the shared script");
      assert.doesNotMatch(yaml!, /sort_by\(\.number\)/, "no inline jq selection predicate");
    },
  );

  it(
    "invokes the resolve script directly, with no extra shell logic",
    { skip: yaml === undefined },
    () => {
      // The at-most-one-close and non-fatal guarantees are proven by execution
      // in tests/scripts/deadTokenAlert.test.ts. What the workflow must
      // guarantee is that it does not wrap the script in shell that could
      // loop it or swallow its contract.
      const resolveStep = getNamedStep(yaml!, "Auto-resolve dead-token alert");
      const run = resolveStep.slice(resolveStep.indexOf("run:")).replace(/\r/g, "").trim();
      assert.equal(run, "run: node scripts/dead-token-alert.mjs resolve");
      assert.ok(alertScript !== undefined, "scripts/dead-token-alert.mjs must exist");
    },
  );

  it(
    "auto-resolve is exit-code-0 gated and non-fatal",
    { skip: yaml === undefined },
    () => {
      const resolveStep = getNamedStep(yaml!, "Auto-resolve dead-token alert");
      assert.match(
        resolveStep,
        /if: always\(\) && steps\.redeem\.outputs\.exit_code == '0'/,
      );
      assert.match(resolveStep, /continue-on-error:\s*true/);
      assert.match(
        resolveStep,
        /RUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/,
        "the close comment must link the run that proved the token recovered",
      );
    },
  );
});
