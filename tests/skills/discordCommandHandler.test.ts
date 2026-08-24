import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "discord-command-handler.yml");

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

const yaml = readIfExists(WORKFLOW);

describe(".github/workflows/discord-command-handler.yml", () => {
  it("workflow file exists", () => {
    assert.ok(yaml !== undefined, `expected ${WORKFLOW} to exist`);
  });

  it("triggers only on repository_dispatch type discord-command", { skip: yaml === undefined }, () => {
    assert.match(yaml!, /^on:\s*[\s\S]*?repository_dispatch:\s*[\s\S]*?types:\s*\[\s*discord-command\s*\]/m);

    const onIdx = /^on:/m.exec(yaml!);
    assert.ok(onIdx, "could not locate `on:` block");
    const tail = yaml!.slice(onIdx.index);
    const nextTop = /\n[a-zA-Z_][\w-]*:\s*\n/.exec(tail);
    const onBlock = nextTop ? tail.slice(0, nextTop.index) : tail;

    assert.doesNotMatch(onBlock, /^\s+push:/m, "must not trigger on push");
    assert.doesNotMatch(onBlock, /^\s+schedule:/m, "must not trigger on schedule");
    assert.doesNotMatch(onBlock, /^\s+workflow_dispatch:/m, "must not trigger on workflow_dispatch");
  });

  it("pins the shared automation-state writer concurrency group and does not cancel in-progress", { skip: yaml === undefined }, () => {
    assert.match(yaml!, /concurrency:\s*\n(?:\s+#.*\n)*\s+group:\s*stfc-gift-redeemer\b/);
    assert.match(yaml!, /cancel-in-progress:\s*false\b/);
  });

  it("declares minimal permissions needed for handler", { skip: yaml === undefined }, () => {
    assert.match(yaml!, /^permissions:\s*\n\s+contents:\s*write\s*\n\s+actions:\s*write\b/m);
    assert.doesNotMatch(yaml!, /\bpull-requests:\s*write\b/);
    assert.doesNotMatch(yaml!, /\bid-token:\s*write\b/);
  });

  it("uses SHA-pinned actions", { skip: yaml === undefined }, () => {
    const uses = [...yaml!.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    assert.ok(uses.length > 0, "expected at least one uses: action");
    for (const u of uses) {
      assert.match(u, /@[0-9a-f]{40}\b/, `not SHA-pinned: ${u}`);
    }
  });

  it("invokes main's scripts/discord-handler.mjs from the state worktree", { skip: yaml === undefined }, () => {
    assert.match(yaml!, /node\s+"\$GITHUB_WORKSPACE\/scripts\/discord-handler\.mjs"/);
    assert.match(yaml!, /working-directory:\s*\$\{\{\s*steps\.state_worktree\.outputs\.state_dir\s*\}\}/);
    assert.match(yaml!, /STFC_STATE_BRANCH:\s*automation-state/);
    assert.match(yaml!, /DISCORD_BOT_TOKEN:\s*\$\{\{\s*secrets\.DISCORD_BOT_TOKEN\s*\}\}/);
    assert.match(yaml!, /ALLOWED_GUILD_IDS:\s*\$\{\{\s*secrets\.ALLOWED_GUILD_IDS\s*\}\}/);
  });

  it("does not print the bot token variable in run commands", { skip: yaml === undefined }, () => {
    assert.doesNotMatch(yaml!, /echo\s+\"?\$DISCORD_BOT_TOKEN/);
    assert.doesNotMatch(yaml!, /set\s+-x/);
  });

  it(
    "prepares automation-state before invoking the handler (issue #241)",
    { skip: yaml === undefined },
    () => {
      // main's checked-out copy of docs/redeem-history.md is frozen (issue
      // #241 — automation state lives on automation-state, not main), so
      // /redeem-status would report stale data without this restore step.
      const restoreIdx = yaml!.indexOf("Prepare automation-state handler worktree");
      const runIdx = yaml!.indexOf('node "$GITHUB_WORKSPACE/scripts/discord-handler.mjs"');
      assert.notEqual(restoreIdx, -1, "must have a restore-state step");
      assert.ok(restoreIdx < runIdx, "restore must precede the handler invocation");
      assert.match(yaml!, /git worktree add -B automation-state/);
      assert.doesNotMatch(yaml!, /git checkout origin\/automation-state --/);
    },
  );
});
