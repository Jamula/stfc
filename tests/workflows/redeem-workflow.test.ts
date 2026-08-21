// Pinning tests for `.github/workflows/redeem.yml`.
//
// These tests assert structural properties of the workflow YAML so that
// accidental regressions are caught by CI before they cause silent data loss
// or swallowed push failures in production.
//
// Assertions mirror the acceptance criteria from issue #212:
//   - Both docs/redeem-history.md AND data/promo-code-dead.json are staged.
//   - No commit is created when neither file changed.
//   - Rebase failures are retried with a bounded loop and fail visibly.
//   - The generated commit continues to use --no-verify.

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

describe(".github/workflows/redeem.yml", () => {
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it(
    "stages docs/redeem-history.md when changed",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /git add docs\/redeem-history\.md/,
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
        /git add data\/promo-code-dead\.json/,
        "commit step must stage data/promo-code-dead.json",
      );
    },
  );

  it(
    "skips commit when neither history nor dead-code cache changed",
    { skip: yaml === undefined },
    () => {
      // Both porcelain checks must be present — the guard is conjunction, not disjunction.
      assert.match(
        yaml!,
        /HISTORY_CHANGED.*porcelain.*redeem-history|porcelain.*redeem-history.*HISTORY_CHANGED/s,
        "must gate on history change",
      );
      assert.match(
        yaml!,
        /DEAD_CHANGED.*porcelain.*promo-code-dead|porcelain.*promo-code-dead.*DEAD_CHANGED/s,
        "must gate on dead-code cache change",
      );
      assert.match(
        yaml!,
        /\$HISTORY_CHANGED.*\$DEAD_CHANGED|\$DEAD_CHANGED.*\$HISTORY_CHANGED/,
        "exit path must reference both change flags",
      );
    },
  );

  it(
    "uses --no-verify on the generated commit",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /git commit --no-verify/,
        "generated commit must use --no-verify so the pre-commit hook does not block CI",
      );
    },
  );

  it(
    "retries the push with a bounded loop (does NOT use '|| true' to swallow rebase failures)",
    { skip: yaml === undefined },
    () => {
      // Must have a loop construct for bounded retry.
      assert.match(
        yaml!,
        /for attempt in \d/,
        "must retry push with a bounded loop",
      );
      // The old swallowed-failure pattern must be gone.
      assert.doesNotMatch(
        yaml!,
        /git pull --rebase.*\|\| true/,
        "rebase failures must NOT be swallowed with '|| true'",
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
});
