import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

type Step = { name?: string; if?: string; run?: string; "working-directory"?: string; with?: { script?: string } };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps?: Step[] }>;
};

function workflow(name: string): Workflow {
  return YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
}

test("active Squad workflows use main, existing deployment, and protected promotion", () => {
  for (const name of ["squad-ci", "squad-preview"]) {
    const event = workflow(name).on.pull_request as { branches: string[] };
    assert.deepEqual(event.branches, ["main"], name);
  }
  const docs = workflow("squad-docs");
  assert.deepEqual((docs.on.push as { branches: string[] }).branches, ["main"]);
  assert.equal(docs.permissions.contents, "read");
  assert.equal(docs.permissions.pages, undefined);
  assert.ok(docs.jobs.validate?.steps?.some((step) => step.run?.includes("tests/web/shell.test.ts")));

  const promote = workflow("squad-promote");
  assert.equal(promote.permissions.contents, "read");
  assert.equal(promote.permissions["pull-requests"], "read");
  const promotion = promote.jobs.check?.steps?.[0]?.run ?? "";
  assert.match(promotion, /gh pr checks "\$PR_NUMBER" --required/);
  assert.doesNotMatch(promotion, /git push|gh pr merge|--admin/);

  const insider = workflow("squad-insider-release");
  assert.deepEqual(insider.on, { workflow_dispatch: null });
  const steps = insider.jobs.release?.steps ?? [];
  assert.match(steps[0]?.run ?? "", /refs\/heads\/main/);
  assert.ok(steps.some((step) => step.run === "npm run typecheck"));
  assert.ok(steps.some((step) => step.run === "npm test"));
  for (const directory of ["pwa-browser", "pwa-token-api"]) {
    assert.ok(steps.some((step) => step.run === "npm ci" && step["working-directory"] === directory), directory);
  }
  assert.match(steps.at(-1)?.run ?? "", /gh release create.*--verify-tag --prerelease/);
});

test("automatic issue events cannot start a Copilot assignment", () => {
  const assign = workflow("squad-issue-assign");
  const job = assign.jobs["assign-work"];
  assert.match(job?.if ?? "", /github\.event\.label\.name != 'squad:copilot'/);
  for (const name of ["Require Copilot assignment token", "Assign @copilot coding agent", "Ensure parent squad label"]) {
    assert.equal(job?.steps?.find((step) => step.name === name)?.if, "github.event_name == 'workflow_dispatch'", name);
  }
  for (const name of ["squad-triage", "squad-heartbeat"]) {
    assert.equal(workflow(name).permissions.actions, undefined, name);
    assert.doesNotMatch(readFileSync(`.github/workflows/${name}.yml`, "utf8"), /createWorkflowDispatch/);
  }
  const heartbeat = workflow("squad-heartbeat");
  assert.deepEqual(heartbeat.on.issues, { types: ["closed"] });
  assert.match(heartbeat.jobs.heartbeat?.steps?.[1]?.run ?? "", /ralph-triage\.cjs/);
  const sync = workflow("sync-squad-labels");
  const push = sync.on.push as { branches: string[]; paths: string[] };
  assert.deepEqual(push.branches, ["main"]);
  assert.ok(push.paths.includes(".github/workflows/sync-squad-labels.yml"));
});

test("label sync changes only Squad-owned labels", async () => {
  const script = workflow("sync-squad-labels").jobs["sync-labels"]?.steps?.find(
    (step) => step.name === "Parse roster and sync labels",
  )?.with?.script;
  assert.ok(script);
  const created: string[] = [];
  const github = {
    rest: {
      issues: {
        getLabel: async () => { throw Object.assign(new Error("not found"), { status: 404 }); },
        createLabel: async (request: { name: string }) => { created.push(request.name); },
      },
    },
  };
  const context = { repo: { owner: "owner", repo: "repo" } };
  const core = { info: () => {} };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<void>;
  await new AsyncFunction("require", "github", "context", "core", script)(
    createRequire(import.meta.url), github, context, core,
  );
  assert.deepEqual(created.sort(), ["squad", "squad:copilot", "squad:data", "squad:spock", "squad:uhura"].sort());
});

test("live triage routes a suitable issue to a team member, not Copilot", async () => {
  const script = workflow("squad-triage").jobs.triage?.steps?.find(
    (step) => step.name === "Triage issue via deterministic keyword routing",
  )?.with?.script;
  assert.ok(script);
  const labels: string[] = [];
  const comments: string[] = [];
  const context = {
    repo: { owner: "owner", repo: "repo" },
    payload: { issue: { number: 42, state: "open", title: "Documentation fix", body: "", labels: [{ name: "squad" }] } },
  };
  const github = {
    rest: {
      issues: {
        get: async () => ({ data: context.payload.issue }),
        addLabels: async (request: { labels: string[] }) => { labels.push(...request.labels); },
        createComment: async (request: { body: string }) => { comments.push(request.body); },
      },
    },
  };
  const core = { info: () => {}, warning: () => {} };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<void>;
  const execute = new AsyncFunction("require", "github", "context", "core", script);
  await execute(createRequire(import.meta.url), github, context, core);
  assert.ok(labels.some((label) => /^squad:(spock|data|uhura)$/.test(label)), labels.join(", "));
  assert.ok(!labels.some((label) => label.startsWith("go:")), "Triage must not change the human verdict");
  assert.ok(!labels.includes("squad:copilot"));
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0]!, /Assigned to:\*\* @copilot/);
  labels.length = 0;
  context.payload.issue.labels.push({ name: "go:no" });
  await execute(createRequire(import.meta.url), github, context, core);
  assert.ok(!labels.some((label) => label.startsWith("go:")), "An existing go:no verdict must be preserved");
});
