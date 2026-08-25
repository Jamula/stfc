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

type Concurrency = { group?: string; "cancel-in-progress"?: boolean };

function concurrencyOf(workflow: Workflow): Concurrency {
  return (workflow as { concurrency?: Concurrency }).concurrency ?? {};
}

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

    it(`${config.name} shallow-fetches automation-state before attaching a worktree`, () => {
      const combined = [
        namedStep(config.workflow, "Restore automation state from automation-state branch").run ?? "",
        namedStep(config.workflow, config.persistStep).run ?? "",
      ].join("\n");
      const matches = combined.match(
        /git fetch --depth=1 --no-tags origin \\\n\s+refs\/heads\/automation-state:refs\/remotes\/origin\/automation-state/g,
      );
      assert.equal(matches?.length, 2);
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
      assert.match(loop, /push --no-verify origin "HEAD:automation-state"/);
      assert.doesNotMatch(loop, /push origin "HEAD:automation-state"/);
      assert.match(loop, /if git ls-remote --exit-code --heads origin automation-state/);
      assert.match(loop, /node scripts\/automation-state-retry\.mjs/);
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
  it("joins the shared stfc-gift-redeemer writer lock only for /game-state, the one command that writes automation-state directly, and isolates every other command onto its own per-command queue (Garak, PR #250 review round 2)", () => {
    // /game-state commits + pushes to automation-state from inside this
    // job (scripts/discord-handler.mjs), so it must share the exact same
    // lock as redeem.yml/discord-monitor.yml — the interleaving that let a
    // monitor run silently delete a handler upload applies to it too.
    // /redeem-status and /trigger-redeem never touch git (proved in
    // tests/scripts/discordHandler.test.ts), so isolating them keeps
    // Discord responsive instead of queuing behind scheduled runs.
    const group = concurrencyOf(handler).group ?? "";
    const cancelInProgress = concurrencyOf(handler)["cancel-in-progress"];

    // Pin the exact expression text, not just a loose regex match, so a
    // silent rewrite of the branching (e.g. swapping which side is the
    // writer group) is caught immediately.
    assert.equal(
      group,
      "${{ github.event.client_payload.command == 'game-state' && 'stfc-gift-redeemer' || format('stfc-discord-handler-{0}', github.event.client_payload.command) }}",
    );
    assert.equal(cancelInProgress, false);

    // Mirror the expression's exact branching (not just its raw text) and
    // pin concrete resolved values per command — a real GitHub Actions
    // expression evaluator isn't available in this unit test, so this
    // reimplementation is kept deliberately trivial (one equality check)
    // to stay in lockstep with the workflow expression above.
    const resolveHandlerConcurrencyGroup = (command: string): string =>
      command === "game-state" ? "stfc-gift-redeemer" : `stfc-discord-handler-${command}`;

    assert.equal(resolveHandlerConcurrencyGroup("game-state"), concurrencyOf(redeem).group);
    assert.equal(resolveHandlerConcurrencyGroup("game-state"), concurrencyOf(monitor).group);
    assert.equal(resolveHandlerConcurrencyGroup("redeem-status"), "stfc-discord-handler-redeem-status");
    assert.equal(resolveHandlerConcurrencyGroup("trigger-redeem"), "stfc-discord-handler-trigger-redeem");
    assert.notEqual(resolveHandlerConcurrencyGroup("redeem-status"), concurrencyOf(redeem).group);
    assert.notEqual(resolveHandlerConcurrencyGroup("trigger-redeem"), concurrencyOf(redeem).group);
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

  it("discord-monitor's persist step never touches data/discord/game-state, as defense in depth on top of the shared writer lock", () => {
    const persist = namedStep(
      monitor,
      "Commit state + digest + promo-codes to automation-state (if changed)",
    ).run ?? "";
    assert.doesNotMatch(persist, /data\/discord\/game-state/);
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
