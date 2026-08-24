import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

type Step = {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "working-directory"?: string;
};

type Workflow = {
  jobs: Record<string, { steps: Step[] }>;
};

function loadWorkflow(path: string): Workflow {
  return parse(readFileSync(path, "utf8")) as Workflow;
}

function steps(workflow: Workflow): Step[] {
  const job = Object.values(workflow.jobs)[0];
  assert.ok(job, "workflow must define a job");
  return job.steps;
}

function namedStep(workflow: Workflow, name: string): Step {
  const step = steps(workflow).find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

const redeem = loadWorkflow(".github/workflows/redeem.yml");
const monitor = loadWorkflow(".github/workflows/discord-monitor.yml");
const handler = loadWorkflow(".github/workflows/discord-command-handler.yml");
const storage = loadWorkflow(".github/workflows/storage-size-monitor.yml");

const scheduled = [
  {
    name: "redeem",
    workflow: redeem,
    runStep: "Redeem",
    persistStep: "Commit redeem state to automation-state (if changed)",
    paths: ["docs/redeem-history.md", "data/promo-code-dead.json", "promo-codes.txt"],
  },
  {
    name: "discord monitor",
    workflow: monitor,
    runStep: undefined,
    persistStep: "Commit state + digest + promo-codes to automation-state (if changed)",
    paths: [
      "data/discord/cursors.json",
      "data/discord/candidates.jsonl",
      "data/discord/tips-seen.jsonl",
      "data/discord/cooldowns.json",
      "data/digests",
      "promo-codes.txt",
    ],
  },
] as const;

describe("automation-state scheduled workflow contract", () => {
  for (const config of scheduled) {
    it(`${config.name} gates always() persistence on a complete restore`, () => {
      const restore = namedStep(
        config.workflow,
        "Restore automation state from automation-state branch",
      );
      const persist = namedStep(config.workflow, config.persistStep);
      assert.equal(restore.id, "restore_state");
      assert.match(restore.run ?? "", /echo "complete=true" >> "\$GITHUB_OUTPUT"/);
      assert.equal(
        persist.if,
        "always() && steps.restore_state.outputs.complete == 'true'",
      );

      const restoreIndex = steps(config.workflow).indexOf(restore);
      const runIndex = config.runStep
        ? steps(config.workflow).indexOf(namedStep(config.workflow, config.runStep))
        : steps(config.workflow).findIndex(
            (step) => step.run === "npm run skill:discord-monitor",
          );
      assert.ok(restoreIndex < runIndex, "restore must finish before the product run");
    });

    it(`${config.name} bootstraps through an authenticated linked worktree`, () => {
      const persist = namedStep(config.workflow, config.persistStep).run ?? "";
      assert.match(persist, /git worktree add --detach "\$STATE_DIR" HEAD/);
      assert.match(persist, /git -C "\$STATE_DIR" switch --orphan automation-state/);
      assert.match(
        persist,
        /git -C "\$STATE_DIR" rm -rf --cached --ignore-unmatch \./,
      );
      assert.doesNotMatch(persist, /\bgit init\b/);
      assert.doesNotMatch(persist, /\bgit remote add\b/);
    });

    it(`${config.name} preserves missing optional state and stages allowlisted paths individually`, () => {
      const persist = namedStep(config.workflow, config.persistStep).run ?? "";
      for (const statePath of config.paths) {
        assert.match(
          persist,
          new RegExp(
            `if \\[ -[fd] "\\$STATE_DIR/${statePath.replace(/[/.]/g, "\\$&")}" \\]`,
          ),
          `${statePath} must be guarded before staging`,
        );
      }

      const addLines = persist
        .split(/\r?\n/)
        .filter((line) => line.includes('git -C "$STATE_DIR" add'));
      assert.equal(addLines.length, config.paths.length);
      for (const [index, statePath] of config.paths.entries()) {
        assert.equal(
          addLines[index]?.trim(),
          `git -C "$STATE_DIR" add -A -- ${statePath}`,
        );
      }
      assert.doesNotMatch(persist, /\badd -A --? \.\s*$/m);
      assert.doesNotMatch(persist, /\badd\b[^\n]*\|\| true/);
    });

    it(`${config.name} performs exactly three visible push attempts`, () => {
      const persist = namedStep(config.workflow, config.persistStep).run ?? "";
      const loopStart = persist.indexOf("for attempt in 1 2 3; do");
      const finalError = persist.indexOf("::error::All 3 push attempts failed");
      assert.ok(loopStart >= 0 && finalError > loopStart);
      const loop = persist.slice(loopStart, finalError);
      assert.match(loop, /push origin "HEAD:automation-state"/);
      assert.match(loop, /if git ls-remote --exit-code --heads origin automation-state/);
      assert.match(loop, /pull --rebase origin automation-state/);
      assert.doesNotMatch(loop, /pull --rebase[^\n]*\|\| true/);
      assert.match(persist.slice(finalError), /exit 1/);
      assert.doesNotMatch(persist, /HEAD:\$GITHUB_REF_NAME/);
    });
  }

  it("both scheduled workflows merge main promo seeds with operational state", () => {
    for (const workflow of [redeem, monitor]) {
      const restore = namedStep(
        workflow,
        "Restore automation state from automation-state branch",
      ).run ?? "";
      assert.match(restore, /MAIN_SHA=\$\(git rev-parse HEAD\)/);
      if (workflow === redeem) {
      assert.match(
        restore,
        /node scripts\/merge-promo-codes\.mjs[\s\S]*promo-codes\.txt "\$RESTORE_DIR\/promo-codes\.txt" promo-codes\.txt "\$MAIN_SHA"/,
      );
      } else {
      assert.match(
        restore,
        /node scripts\/discord-monitor-state\.mjs restore[\s\S]*"\$RESTORE_DIR" "\$GITHUB_WORKSPACE" "\$MAIN_SHA"/,
      );
      }
    }
  });

  it("introduces no PAT, deploy-key, bypass secret, or broad staging", () => {
    for (const workflow of [redeem, monitor, handler]) {
      const source = JSON.stringify(workflow);
      assert.doesNotMatch(source, /secrets\.[A-Z_]*PAT[A-Z_]*/i);
      assert.doesNotMatch(source, /AUTOMATION_DEPLOY_KEY/i);
      assert.doesNotMatch(source, /\badd -A --? \./);
    }
  });
});

describe("automation-state Discord handler contract", () => {
  it("serializes the handler under the shared automation-state writer lock", () => {
    assert.equal((handler as { concurrency?: { group?: string } }).concurrency?.group, "stfc-gift-redeemer");
  });

  it("executes main's handler code from the live state worktree", () => {
    const prepare = namedStep(handler, "Prepare automation-state handler worktree");
    const route = namedStep(handler, "Route command and post Discord follow-up");
    const cleanup = namedStep(handler, "Remove automation-state handler worktree");
    const run = prepare.run ?? "";

    assert.equal(prepare.id, "state_worktree");
    assert.match(run, /git worktree add -B automation-state/);
    assert.match(run, /git worktree add --detach "\$STATE_DIR" HEAD/);
    assert.match(run, /switch --orphan automation-state/);
    assert.doesNotMatch(run, /\bgit checkout\b[\s\S]* -- docs\/redeem-history\.md/);
    assert.doesNotMatch(run, /\bgit add\b/);
    assert.equal(route.if, "steps.state_worktree.outputs.complete == 'true'");
    assert.equal(
      route["working-directory"],
      "${{ steps.state_worktree.outputs.state_dir }}",
    );
    assert.equal(route.env?.STFC_STATE_BRANCH, "automation-state");
    assert.equal(route.run, 'node "$GITHUB_WORKSPACE/scripts/discord-handler.mjs"');
    assert.equal(
      cleanup.if,
      "always() && steps.state_worktree.outputs.complete == 'true'",
    );
  });
});

describe("automation-state storage monitor contract", () => {
  it("checks out and measures the live automation-state ref", () => {
    const checkout = steps(storage)[0];
    assert.equal(checkout?.with?.ref, "automation-state");
    const size = namedStep(storage, "Compute folder size").run ?? "";
    assert.match(size, /if \[ ! -d data\/discord\/game-state \]/);
    assert.match(size, /::error::automation-state is missing/);
    assert.doesNotMatch(size, /\|\| echo 0/);
  });

  it("remains read-only and does not join the automation-state writer lock", () => {
    assert.equal((storage as { concurrency?: { group?: string } }).concurrency?.group, "storage-size-monitor");
  });
});
