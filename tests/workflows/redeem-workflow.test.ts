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
// live-verified evidence). Kirk/Picard's governance decision on #241
// explicitly rejected any RepositoryRole/User/PAT-based bypass (it would
// recreate #220's auto-landing vector), so these tests also assert that no
// such bypass mechanism was reintroduced.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

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
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

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
        /merge-promo-codes\.mjs[\s\S]*promo-codes\.txt/,
        "must merge human promo seeds with operational promo codes",
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
        /git -C "\$STATE_DIR" push origin "HEAD:automation-state"/,
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
        "must not read a PAT secret for pushing — Kirk/Picard rejected RepositoryRole/User/PAT bypass on #241",
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
      const titles = [...yaml!.matchAll(/^\s+TITLE: "([^"]+)"$/gm)].map((match) => match[1]);
      const requiredLabels = [...yaml!.matchAll(/^\s+REQUIRED_LABELS: "([^"]+)"$/gm)].map(
        (match) => match[1],
      );

      assert.deepEqual(titles, [expectedTitle, expectedTitle]);
      assert.deepEqual(requiredLabels, ["bug,priority:p1", "bug,priority:p1"]);
      assert.ok(requiredLabels.every((labels) => !labels.includes("squad:")));
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
