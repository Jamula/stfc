// Regression pin test for issue #214 — "Squad workflows reference
// non-existent tests and hardcode Node 22".
//
// `.github/workflows/squad-ci.yml` and `.github/workflows/squad-insider-release.yml`
// were unmodified copies of the generic Squad-framework scaffold templates
// (`.squad/templates/workflows/*.yml`). Neither was ever adapted to this
// repo:
//   - both ran `node --test test/*.test.cjs`, but this repo's real suite is
//     `tests/` (aggregated by `tests/index.test.ts`) — `test/` never existed
//     here, so that step always failed;
//   - both hardcoded `node-version: 22`, violating decision D4
//     (`.squad/decisions/decisions.md`) that no workflow may hardcode a
//     Node version — `.nvmrc` (currently 24) is the single lever;
//   - `squad-ci.yml`'s job was fully superseded by `squad-test-gate.yml`,
//     whose own header comment says it "consolidates the former Tests +
//     Squad CI workflows"; `squad-ci.yml` was leftover duplication;
//   - `squad-insider-release.yml` only triggered on `push` to a branch
//     named `insider`, which has never existed in this repository (the
//     documented channel name is `insiders`, plural — see
//     `.github/skills/git-workflow/SKILL.md`), so it could never fire, and
//     its release notes hardcoded install instructions for a completely
//     different package (`@bradygaster/squad-cli`) than this repo's own
//     `stfc-gift-redeemer`.
//
// Both were removed rather than repaired: neither carried any trigger
// coverage the still-live `squad-test-gate.yml` required-check doesn't
// already provide. This test pins that removal and pins that the
// surviving required check remains intact and hardcode-free, so neither
// regresses silently (e.g. via a future `.squad/templates/` scaffold
// refresh re-copying the stale templates back into `.github/workflows/`).
//
// Rule 3 (O'Brien's charter): workflow YAML changes ship with pinning
// tests in the same commit. Assertions run via regex over raw YAML (same
// pattern as `tests/workflows/discord-ops-workflow.test.ts`) — no YAML
// parser dependency.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const REMOVED_WORKFLOWS = ["squad-ci.yml", "squad-insider-release.yml"];
const TEST_GATE_WORKFLOW = path.join(WORKFLOWS_DIR, "squad-test-gate.yml");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

describe("issue #214 — superseded Squad workflows removed", () => {
  for (const name of REMOVED_WORKFLOWS) {
    it(`${name} no longer exists under .github/workflows/`, () => {
      const p = path.join(WORKFLOWS_DIR, name);
      assert.equal(
        fs.existsSync(p),
        false,
        `expected ${p} to have been removed (superseded by squad-test-gate.yml; ` +
          `see tests/workflows/squad-ci-removed.test.ts header for rationale)`,
      );
    });
  }

  it("no remaining workflow file is named 'Squad CI' or 'Squad Insider Release'", () => {
    const files = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    for (const f of files) {
      const contents = fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8");
      const nameMatch = /^name:\s*(.+)$/m.exec(contents);
      const workflowName = nameMatch?.[1]?.trim();
      assert.notEqual(
        workflowName,
        "Squad CI",
        `${f} must not resurrect the removed "Squad CI" workflow`,
      );
      assert.notEqual(
        workflowName,
        "Squad Insider Release",
        `${f} must not resurrect the removed "Squad Insider Release" workflow`,
      );
    }
  });
});

describe("squad-test-gate.yml — surviving required check stays intact", () => {
  const yaml = readIfExists(TEST_GATE_WORKFLOW);

  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${TEST_GATE_WORKFLOW} to exist`);
  });

  it(
    "keeps the required job name `npm test (required)`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /name:\s*npm test \(required\)/,
        "the job name is the GitHub required-status-check identity; renaming it " +
          "silently breaks branch protection (see .squad/decisions-archive.md)",
      );
    },
  );

  it(
    "reads the Node version from .nvmrc — never hardcodes node-version",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /node-version-file:\s*\.nvmrc/,
        "expected node-version-file: .nvmrc",
      );
      assert.doesNotMatch(
        yaml!,
        /node-version:\s*['"]?\d+['"]?\s*$/m,
        "must not hardcode a Node major version (decision D4)",
      );
    },
  );

  it(
    "invokes the real test entry (`npm test`), never a `test/*.test.cjs` path",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /^\s*-\s*run:\s*npm test\s*$/m, "expected a `run: npm test` step");
      assert.doesNotMatch(
        yaml!,
        /test\/\*\.test\.cjs/,
        "must not reference the non-existent test/*.test.cjs path",
      );
    },
  );

  it(
    "still triggers on pull_request for all branches (no coverage gap left by the removal)",
    { skip: yaml === undefined },
    () => {
      assert.match(yaml!, /pull_request:\s*\n\s*branches:\s*\[\s*["']\*\*["']\s*\]/, (
        "expected pull_request: branches: [\"**\"] so every PR (main, dev, preview, " +
          "insiders, etc.) is still covered without squad-ci.yml"
      ));
    },
  );
});
