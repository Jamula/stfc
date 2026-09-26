import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

type Concurrency = {
  group?: string;
  queue?: string;
  "cancel-in-progress"?: boolean | string;
};

const WORKFLOW_DIR = path.join(".github", "workflows");

/**
 * The one repository-scoped lock every `automation-state` writer serializes
 * on. GitHub compares concurrency group names case-insensitively, so every
 * comparison against it goes through `normalizeGroup`.
 */
const SHARED_WRITER_GROUP = "stfc-gift-redeemer";

function normalizeGroup(value: string): string {
  return value.toLowerCase();
}

function concurrencyOf(workflow: Workflow): Concurrency {
  const raw = (workflow as { concurrency?: Concurrency | string }).concurrency;
  if (typeof raw === "string") return { group: raw };
  return raw ?? {};
}

function loadWorkflow(file: string): Workflow {
  return parse(readFileSync(file, "utf8")) as Workflow;
}

type ConcurrencyDecl = { file: string; scope: string; concurrency: Concurrency };

/**
 * Every parsed `concurrency:` block in `.github/workflows`, workflow-level and
 * job-level. Parsed values only — a group named in a YAML comment is not a
 * declaration and must not be picked up.
 */
function allConcurrencyDeclarations(): ConcurrencyDecl[] {
  const declarations: ConcurrencyDecl[] = [];
  const files = readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

  for (const file of files) {
    const workflow = loadWorkflow(path.join(WORKFLOW_DIR, file));
    const top = concurrencyOf(workflow);
    if (Object.keys(top).length > 0) {
      declarations.push({ file, scope: "workflow", concurrency: top });
    }
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const raw = (job as { concurrency?: Concurrency | string }).concurrency;
      if (raw === undefined) continue;
      declarations.push({
        file,
        scope: `job:${jobId}`,
        concurrency: typeof raw === "string" ? { group: raw } : raw,
      });
    }
  }

  return declarations;
}

/**
 * A declaration can join the shared writer lock when its group value can
 * resolve to that name — either as a literal or as one branch of an
 * expression. Checking the raw group text covers both without needing a real
 * Actions expression evaluator.
 */
function joinsSharedWriterGroup(concurrency: Concurrency): boolean {
  return normalizeGroup(concurrency.group ?? "").includes(SHARED_WRITER_GROUP);
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
const refreshToken = loadWorkflow(".github/workflows/refresh-token.yml");
const storage = loadWorkflow(".github/workflows/storage-size-monitor.yml");

const scheduled = [
  {
    name: "redeem",
    workflow: redeem,
    runStep: "Redeem",
    persistStep: "Commit redeem state to automation-state (if changed)",
    paths: [
      "docs/redeem-history.md",
      "data/promo-code-dead.json",
      "data/redeem-degraded-state.json",
      "promo-codes.txt",
    ],
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

  it("redeem retries preserve the degraded-gift state path", () => {
    const persist = namedStep(redeem, "Commit redeem state to automation-state (if changed)").run ?? "";
    assert.match(
      persist,
      /node scripts\/automation-state-retry\.mjs \\\n\s+"\$STATE_DIR" automation-state \\\n\s+docs\/redeem-history\.md data\/promo-code-dead\.json \\\n\s+data\/redeem-degraded-state\.json promo-codes\.txt/,
    );
  });

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
    const concurrency = concurrencyOf(handler);
    const group = concurrency.group ?? "";

    // Pin the exact expression text, not just a loose regex match, so a
    // silent rewrite of the branching (e.g. swapping which side is the
    // writer group) is caught immediately.
    assert.equal(
      group,
      "${{ github.event.client_payload.command == 'game-state' && 'stfc-gift-redeemer' || format('stfc-discord-handler-{0}', github.event.client_payload.command) }}",
    );
    assert.equal(concurrency["cancel-in-progress"], false);
    // Sharing the group is necessary but not sufficient: on the default
    // `queue: single` the shared group holds one pending run, so the next
    // redeem/monitor/refresh run would cancel a pending /game-state job
    // after Discord already got its deferred response (Garak, PR #266).
    assert.equal(concurrency.queue, "max");

    // Mirror the expression's branching (not just its raw text) and pin
    // concrete resolved values per command. GitHub's `==` operator compares
    // strings case-INsensitively, and concurrency group names are themselves
    // case-insensitive, so this mirror lower-cases before comparing. It is
    // deliberately not a case-sensitive parity claim (Garak, PR #266 review):
    // https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
    const resolveHandlerConcurrencyGroup = (command: string): string =>
      command.toLowerCase() === "game-state"
        ? "stfc-gift-redeemer"
        : `stfc-discord-handler-${command}`;
    const sameGroup = (a: string, b: string): boolean =>
      normalizeGroup(a) === normalizeGroup(b);

    for (const writer of [redeem, monitor, refreshToken]) {
      assert.ok(
        sameGroup(
          resolveHandlerConcurrencyGroup("game-state"),
          concurrencyOf(writer).group ?? "",
        ),
        "/game-state must resolve to the same group as every scheduled writer",
      );
    }

    // Case variants over-serialize: GitHub's case-insensitive `==` puts them
    // on the shared writer lock rather than letting them escape it, and
    // scripts/discord-handler.mjs dispatches on exact lower-case strings, so
    // they return "Unknown command" without touching git (proved in
    // tests/scripts/discordHandler.test.ts).
    for (const variant of ["GAME-STATE", "Game-State", "gAmE-sTaTe"]) {
      assert.equal(
        resolveHandlerConcurrencyGroup(variant),
        SHARED_WRITER_GROUP,
        `${variant} must over-serialize onto the writer lock, never escape it`,
      );
    }

    assert.equal(resolveHandlerConcurrencyGroup("redeem-status"), "stfc-discord-handler-redeem-status");
    assert.equal(resolveHandlerConcurrencyGroup("trigger-redeem"), "stfc-discord-handler-trigger-redeem");
    for (const readOnly of ["redeem-status", "trigger-redeem", "REDEEM-STATUS", "Trigger-Redeem"]) {
      assert.ok(
        !sameGroup(resolveHandlerConcurrencyGroup(readOnly), concurrencyOf(redeem).group ?? ""),
        `${readOnly} must stay off the shared writer lock`,
      );
    }
    // A case variant of a read-only command collapses onto the same isolated
    // group as its lower-case form — it does not fork a second queue.
    assert.ok(
      sameGroup(
        resolveHandlerConcurrencyGroup("REDEEM-STATUS"),
        resolveHandlerConcurrencyGroup("redeem-status"),
      ),
    );
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
    assert.equal(route.env?.CLOUDFLARE_ACCOUNT_ID, "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    assert.equal(route.env?.CLOUDFLARE_R2_ACCESS_KEY_ID, "${{ secrets.CLOUDFLARE_R2_ACCESS_KEY_ID }}");
    assert.equal(route.env?.CLOUDFLARE_R2_SECRET_ACCESS_KEY, "${{ secrets.CLOUDFLARE_R2_SECRET_ACCESS_KEY }}");
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

describe("shared stfc-gift-redeemer writer queue contract (Garak, PR #266 review)", () => {
  const declarations = allConcurrencyDeclarations();
  const sharedWriters = declarations.filter((decl) => joinsSharedWriterGroup(decl.concurrency));

  it("discovers every workflow that can join the shared writer group — the contract is repo-wide, not per-caller", () => {
    // Enumerated from disk, so a NEW workflow joining the group is covered
    // automatically; the explicit list below then fails loudly whenever the
    // membership changes, forcing the queue contract to be re-examined.
    assert.deepEqual(
      [...new Set(sharedWriters.map((decl) => decl.file))].sort(),
      [
        "discord-command-handler.yml",
        "discord-monitor.yml",
        "redeem.yml",
        "refresh-token.yml",
      ],
    );
    for (const decl of sharedWriters) {
      assert.equal(
        decl.scope,
        "workflow",
        `${decl.file}: the writer lock must be declared workflow-level, not per job`,
      );
    }
  });

  it("no shared writer is left on the default single-slot queue", () => {
    // `queue: single` (the default when the key is omitted) keeps at most ONE
    // pending run per group: every newer shared-group run cancels and replaces
    // the pending one. With redeem.yml on a */10 cron, that would routinely
    // evict a pending /game-state upload before it ever executed.
    assert.ok(sharedWriters.length >= 4, "expected the full writer group to be discovered");
    for (const { file, concurrency } of sharedWriters) {
      assert.notEqual(
        concurrency.queue,
        undefined,
        `${file}: omitting queue leaves the shared writer group on the lossy default (single)`,
      );
      assert.notEqual(concurrency.queue, "single", `${file}: queue: single is lossy for a shared writer`);
      assert.equal(
        concurrency.queue,
        "max",
        `${file}: every shared writer must declare queue: max (up to 100 pending runs, FIFO)`,
      );
    }
  });

  it("shared writers never cancel in progress, and never combine queue: max with cancel-in-progress: true", () => {
    for (const { file, concurrency } of sharedWriters) {
      const cancel = concurrency["cancel-in-progress"];
      assert.notEqual(cancel, true, `${file}: a shared writer must not cancel in-progress runs`);
      assert.notEqual(String(cancel ?? false), "true", `${file}: cancel-in-progress must not be truthy`);
    }

    // Repo-wide: GitHub rejects `queue: max` + `cancel-in-progress: true` as a
    // workflow validation error, which would take the workflow offline rather
    // than merely degrade it.
    for (const { file, scope, concurrency } of declarations) {
      if (concurrency.queue !== "max") continue;
      assert.notEqual(
        String(concurrency["cancel-in-progress"] ?? false),
        "true",
        `${file} (${scope}): queue: max cannot be combined with cancel-in-progress: true`,
      );
    }
  });

  it("the scheduled writers declare byte-identical group and queue values", () => {
    const scheduledWriters: Array<[string, Workflow]> = [
      ["redeem.yml", redeem],
      ["discord-monitor.yml", monitor],
      ["refresh-token.yml", refreshToken],
    ];
    for (const [file, workflow] of scheduledWriters) {
      assert.equal(concurrencyOf(workflow).group, SHARED_WRITER_GROUP, `${file}: group mismatch`);
      assert.equal(concurrencyOf(workflow).queue, "max", `${file}: queue mismatch`);
    }
    // The handler reaches the same group through an expression branch rather
    // than a literal, so it is compared on queue only here; its group is pinned
    // exactly in the handler contract suite above.
    assert.equal(concurrencyOf(handler).queue, "max");
  });

  it("read-only and unrelated workflows stay off the shared writer lock", () => {
    const offLock = declarations.filter((decl) => !joinsSharedWriterGroup(decl.concurrency));
    assert.ok(offLock.length > 0);
    for (const { file, concurrency } of offLock) {
      assert.ok(
        !normalizeGroup(concurrency.group ?? "").includes(SHARED_WRITER_GROUP),
        `${file} must not join the writer lock`,
      );
    }
    assert.ok(
      offLock.some((decl) => decl.file === "storage-size-monitor.yml"),
      "the read-only storage monitor must remain off the writer lock",
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
