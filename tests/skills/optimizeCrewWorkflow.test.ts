// Pinning tests for `.github/workflows/optimize-crew.yml` (O'Brien's
// push-on-change crew optimizer workflow).
//
// Rule 3: workflow YAML changes need pinning tests in the same commit.
// Per the directive, this workflow must:
//   - trigger on push to data/crew/** AND workflow_dispatch ONLY
//     (NO schedule: cron — push-on-change, not periodic);
//   - use concurrency group `stfc-crew-optimizer` (distinct from
//     `stfc-gift-redeemer` and `discord-monitor`);
//   - declare `permissions: contents: write` for bot commits;
//   - SHA-pin all `uses:` actions (40-hex);
//   - commit changed docs/crew/*.md with msg
//     `chore(crew): regen optimizer recommendations [skip ci]`.
//
// We assert via regex over the raw YAML body (same pattern as
// `tests/workflows/discord-ops-workflow.test.ts`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "optimize-crew.yml");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const yaml = readIfExists(WORKFLOW);

describe(".github/workflows/optimize-crew.yml", () => {
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it(
    "declares `push:` trigger with paths `data/crew/**`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^\s+push:\s*\n/m,
        "must trigger on push",
      );
      assert.match(
        yaml!,
        /data\/crew\/\*\*/,
        "push trigger must include path data/crew/**",
      );
    },
  );

  it(
    "declares `workflow_dispatch:` trigger",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^\s+workflow_dispatch:/m,
        "must trigger on workflow_dispatch",
      );
    },
  );

  it(
    "does NOT have a `schedule:` cron trigger",
    { skip: yaml === undefined },
    () => {
      // Carve out the `on:` block by slicing from `on:` to the next
      // top-level key (any line starting at column 0 with a word char).
      const onIdx = /^on:/m.exec(yaml!);
      assert.ok(onIdx, "could not locate `on:` block");
      const tail = yaml!.slice(onIdx.index);
      const nextTop = /\n[a-zA-Z_][\w-]*:\s*\n/.exec(tail);
      const onBlock = nextTop ? tail.slice(0, nextTop.index) : tail;
      assert.doesNotMatch(
        onBlock,
        /^\s+schedule:/m,
        "workflow MUST NOT have a schedule: trigger — push-on-change only",
      );
    },
  );

  it(
    "uses concurrency group `stfc-crew-optimizer`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /group:\s*stfc-crew-optimizer\b/,
        "concurrency group must be stfc-crew-optimizer",
      );
    },
  );

  it(
    "concurrency group is distinct from `stfc-gift-redeemer`",
    { skip: yaml === undefined },
    () => {
      assert.doesNotMatch(
        yaml!,
        /group:\s*stfc-gift-redeemer\b/,
        "must NOT share the stfc-gift-redeemer concurrency group",
      );
    },
  );

  it(
    "declares `permissions: contents: write`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /^permissions:\s*\n/m,
        "expected a top-level `permissions:` block",
      );
      assert.match(
        yaml!,
        /\bcontents:\s*write\b/,
        "permissions must grant contents: write for bot commits",
      );
    },
  );

  it(
    "runs `npm run skill:optimize-crew -- --all`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /npm\s+run\s+skill:optimize-crew\s+--\s+--all/,
        "workflow must invoke skill:optimize-crew with --all",
      );
    },
  );

  it(
    "runs `npm run skill:progression -- --all`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /npm\s+run\s+skill:progression\s+--\s+--all/,
        "workflow must invoke skill:progression with --all",
      );
    },
  );

  it(
    "commit message is `chore(crew): regen optimizer recommendations [skip ci]`",
    { skip: yaml === undefined },
    () => {
      assert.match(
        yaml!,
        /chore\(crew\): regen optimizer recommendations \[skip ci\]/,
        "commit message must match the pinned format",
      );
    },
  );

  it(
    "all `uses:` actions are SHA-pinned (40-hex)",
    { skip: yaml === undefined },
    () => {
      const uses = [...yaml!.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
      assert.ok(uses.length > 0, "expected at least one `uses:` action");
      for (const u of uses) {
        assert.match(u, /@[0-9a-f]{40}\b/, `not SHA-pinned: ${u}`);
      }
    },
  );
});
