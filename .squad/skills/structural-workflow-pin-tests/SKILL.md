# Structural Workflow Pin Tests

Use this skill when adding or hardening pinning tests for `.github/workflows/*.yml`.

## Goal

Pin the GitHub Actions workflow semantics, not incidental text. Comments and unrelated strings must not satisfy or fail workflow acceptance guards.

## Template

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(
  readFileSync(".github/workflows/example.yml", "utf8"),
) as {
  on: {
    push?: { paths?: string[] };
    schedule?: unknown;
    workflow_dispatch?: Record<string, never>;
  };
  permissions?: Record<string, string>;
  concurrency?: { group?: string };
  jobs: Record<string, { steps: Array<{ name?: string; uses?: string; run?: string }> }>;
};

const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const usesSteps = steps.filter(
  (step): step is { uses: string } => typeof step.uses === "string",
);
const shaPinnedAction = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40}$/;

describe("example workflow", () => {
  it("pins triggers", () => {
    assert.deepStrictEqual(Object.keys(workflow.on), ["push", "workflow_dispatch"]);
    assert.deepStrictEqual(workflow.on.push?.paths, ["data/example/**"]);
    assert.strictEqual(workflow.on.schedule, undefined, "workflow must not have a cron");
  });

  for (const step of usesSteps) {
    it(`SHA-pins ${step.uses} as <owner>/<repo>@<40-hex>`, () => {
      assert.match(step.uses, shaPinnedAction);
    });
  }
});
```

## Checklist

- Parse with `yaml.parse()` before asserting.
- Assert `Object.keys(workflow.on)` for exact trigger set and order when order matters.
- Assert path filters at `workflow.on.push.paths`, never by whole-file substring.
- Assert no scheduled cron with `workflow.on.schedule === undefined`.
- Assert permissions and concurrency at parsed keys.
- Walk every job step; every `uses:` value must match `<owner>/<repo>@<40-hex>`.
- Find required `run:` commands from parsed steps and compare exact strings where possible.
- Avoid raw `grep "schedule:"` or broad regex over the full YAML except as an optional hygiene check.
