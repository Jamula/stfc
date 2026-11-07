import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";

type PullRequest = {
  number: number;
  state: string;
  draft: boolean;
  auto_merge: object | null;
  base: { ref: string };
  head: { repo: { id: number } | null; sha: string };
};

const workflow = parse(readFileSync(".github/workflows/auto-merge.yml", "utf8")) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: { "auto-merge": { steps: Array<{ uses: string; with: { script: string } }> } };
};
const step = workflow.jobs["auto-merge"].steps[0];
assert.ok(step, "auto-merge workflow must contain a step");
const script = step.with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;
const runScript = new AsyncFunction("github", "context", "core", "require", script);

function pr(number: number, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number, state: "open", draft: false, auto_merge: null,
    base: { ref: "main" }, head: { repo: { id: 1 }, sha: `sha-${number}` },
    ...overrides,
  };
}

function harness(
  pulls: PullRequest[],
  checks = [
    { context: "npm test (required)", integration_id: 15368 },
    { context: "verify", integration_id: 15368 },
  ],
  strict = true,
  failedPr?: string,
  bypass = "never",
) {
  const commands: string[][] = [];
  const errors: string[] = [];
  const list = () => pulls;
  const github = {
    rest: {
      repos: { get: async () => ({ data: {
        id: 1, default_branch: "main", allow_auto_merge: true, allow_squash_merge: true,
      } }) },
      pulls: {
        list,
        get: async ({ pull_number }: { pull_number: number }) => ({
          data: pulls.find((item) => item.number === pull_number),
        }),
      },
    },
    paginate: async () => pulls,
    request: async (route: string) => route.includes("/rulesets/")
      ? { data: { current_user_can_bypass: bypass } }
      : { data: [{
          ruleset_id: 42,
          type: "required_status_checks",
          parameters: { strict_required_status_checks_policy: strict, required_status_checks: checks },
        }] },
  };
  const core = {
    notice: () => {},
    error: (message: string) => errors.push(message),
    setFailed: (message: string) => errors.push(message),
  };
  const requireMock = (name: string) => {
    assert.equal(name, "node:child_process");
    return {
      execFileSync: (command: string, args: string[]) => {
        commands.push([command, ...args]);
        if (args[2] === failedPr) throw new Error("permission denied");
      },
    };
  };
  return {
    commands,
    errors,
    run: (eventName: string, number = 1) => runScript(
      github,
      { repo: { owner: "Jamula", repo: "stfc" }, eventName, payload: { pull_request: { number } } },
      core,
      requireMock,
    ),
  };
}

describe("auto-merge workflow", () => {
  it("uses trusted PR events and periodic reconciliation without checking out PR code", () => {
    assert.ok(workflow.on.pull_request_target);
    assert.ok(workflow.on.schedule);
    assert.deepEqual(workflow.permissions, { contents: "write", "pull-requests": "write" });
    assert.equal(workflow.jobs["auto-merge"].steps.length, 1);
    assert.match(step.uses, /^actions\/github-script@[0-9a-f]{40}$/);
  });

  it("enables squash auto-merge for the current eligible PR with a matching head SHA", async () => {
    const h = harness([pr(1), pr(2)]);
    await h.run("pull_request_target");
    assert.deepEqual(h.commands, [[
      "gh", "pr", "merge", "1", "--repo", "Jamula/stfc",
      "--auto", "--squash", "--match-head-commit", "sha-1",
    ]]);
    assert.deepEqual(h.errors, []);
  });

  it("reconciles only open, ready, same-repository default-branch PRs", async () => {
    const h = harness([
      pr(1), pr(2, { draft: true }), pr(3, { state: "closed" }),
      pr(4, { base: { ref: "other" } }), pr(5, { head: { repo: { id: 2 }, sha: "fork" } }),
      pr(6, { head: { repo: null, sha: "deleted" } }), pr(7, { auto_merge: {} }),
      pr(8),
    ]);
    await h.run("schedule");
    assert.deepEqual(h.commands.map((command) => command[3]), ["1", "8"]);
  });

  it("fails closed if a required check is missing or supplied by another integration", async () => {
    for (const checks of [
      [{ context: "npm test (required)", integration_id: 15368 }],
      [
        { context: "npm test (required)", integration_id: 15368 },
        { context: "verify", integration_id: 123 },
      ],
    ]) {
      const h = harness([pr(1)], checks);
      await assert.rejects(h.run("schedule"), /must strictly require GitHub Actions checks/);
      assert.deepEqual(h.commands, []);
    }
  });

  it("fails closed if the checks are not strict", async () => {
    const h = harness([pr(1)], undefined, false);
    await assert.rejects(h.run("schedule"), /must strictly require GitHub Actions checks/);
    assert.deepEqual(h.commands, []);
  });

  it("fails closed when the workflow token can bypass a ruleset", async () => {
    const h = harness([pr(1)], undefined, true, undefined, "always");
    await assert.rejects(h.run("schedule"), /must not bypass ruleset 42/);
    assert.deepEqual(h.commands, []);
  });

  it("reports an enrollment failure while still processing other eligible PRs", async () => {
    const h = harness([pr(1), pr(2)], undefined, true, "1");
    await h.run("schedule");
    assert.deepEqual(h.commands.map((command) => command[3]), ["1", "2"]);
    assert.equal(h.errors.length, 2);
    assert.match(h.errors.join("\n"), /PR #1.*permission denied/);
    assert.match(h.errors.join("\n"), /failed for 1 PR/);
  });
});
