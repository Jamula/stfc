import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";

type PullRequest = {
  number: number;
  state: string;
  draft: boolean;
  auto_merge: object | null;
  user: { login: string } | null;
  base: { ref: string };
  head: { repo: { id: number } | null; sha: string };
};

const workflow = parse(readFileSync(".github/workflows/auto-merge.yml", "utf8")) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: {
    "auto-merge": {
      permissions: Record<string, string>;
      steps: Array<{
        id?: string;
        if?: string;
        uses?: string;
        env?: Record<string, string>;
        run?: string;
        with: Record<string, unknown> & { script?: string };
      }>;
    };
  };
};
const [appConfigStep, appTokenStep, scriptStep] = workflow.jobs["auto-merge"].steps;
assert.ok(appConfigStep, "auto-merge workflow must check optional App credentials");
assert.ok(appTokenStep, "auto-merge workflow must create an App token");
assert.ok(scriptStep, "auto-merge workflow must contain a script step");
assert.equal(typeof scriptStep.with.script, "string", "script step must contain a script");
const script = scriptStep.with.script;
assert.ok(script);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;
const runScript = new AsyncFunction("github", "context", "core", "require", script);

function pr(number: number, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number, state: "open", draft: false, auto_merge: null,
    user: { login: "contributor" },
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
        id: 1, default_branch: "main",
      } }) },
      pulls: {
        list,
        get: async ({ pull_number }: { pull_number: number }) => ({
          data: pulls.find((item) => item.number === pull_number),
        }),
      },
    },
    graphql: async () => ({
      repository: { autoMergeAllowed: true, squashMergeAllowed: true },
    }),
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
    assert.deepEqual(workflow.permissions, {});
    assert.deepEqual(workflow.jobs["auto-merge"].permissions, {
      contents: "write",
      "pull-requests": "write",
    });
    assert.equal(workflow.jobs["auto-merge"].steps.length, 3);
    assert.match(scriptStep.uses ?? "", /^actions\/github-script@[0-9a-f]{40}$/);
  });

  it("disables auto-merge when GitHub App credentials are unavailable", () => {
    assert.equal(appConfigStep.id, "app-config");
    assert.deepEqual(appConfigStep.env, {
      APP_CLIENT_ID: "${{ vars.AUTO_MERGE_APP_CLIENT_ID }}",
      APP_PRIVATE_KEY: "${{ secrets.AUTO_MERGE_APP_PRIVATE_KEY }}",
    });
    assert.match(appConfigStep.run ?? "", /\[\[ -n "\$APP_CLIENT_ID" && -n "\$APP_PRIVATE_KEY" \]\]/);
    assert.match(appConfigStep.run ?? "", /configured=false/);
    assert.match(appConfigStep.run ?? "", /auto-merge is disabled/);
    assert.equal(appTokenStep.if, "steps.app-config.outputs.configured == 'true'");
    assert.equal(
      appTokenStep.uses,
      "actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510",
    );
    assert.deepEqual(appTokenStep.with, {
      "client-id": "${{ vars.AUTO_MERGE_APP_CLIENT_ID }}",
      "private-key": "${{ secrets.AUTO_MERGE_APP_PRIVATE_KEY }}",
      owner: "${{ github.repository_owner }}",
      repositories: "${{ github.event.repository.name }}",
      "permission-contents": "write",
      "permission-pull-requests": "write",
    });
    assert.equal(scriptStep.if, "steps.app-config.outputs.configured == 'true'");
    assert.equal(
      scriptStep.with["github-token"],
      "${{ steps.app-token.outputs.token }}",
    );
    assert.equal(scriptStep.env?.GH_TOKEN, "${{ steps.app-token.outputs.token }}");
    assert.doesNotMatch(JSON.stringify(scriptStep), /github\.token/);
  });

  it("uses GraphQL merge policy when REST fields are omitted and enables squash auto-merge", async () => {
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

  it("does not automatically enroll Dependabot PRs on events or scheduled sweeps", async () => {
    const dependabotPr = pr(1, { user: { login: "dependabot[bot]" } });
    const event = harness([dependabotPr]);
    await event.run("pull_request_target");
    assert.deepEqual(event.commands, []);

    const sweep = harness([dependabotPr, pr(2)]);
    await sweep.run("schedule");
    assert.deepEqual(sweep.commands.map((command) => command[3]), ["2"]);
  });

  it("fails closed when the pull request author is unavailable", async () => {
    const h = harness([pr(1, { user: null })]);
    await assert.rejects(h.run("schedule"), /author.*PR #1/i);
    assert.deepEqual(h.commands, []);
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

  it("fails closed when the GitHub App token can bypass a ruleset", async () => {
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
