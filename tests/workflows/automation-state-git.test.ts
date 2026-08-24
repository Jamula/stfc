import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reconcileAutomationStateAfterPushFailure } from "../../scripts/automation-state-retry.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("automation-state linked-worktree bootstrap", () => {
  it("inherits checkout-local auth config and creates an allowlisted root commit", () => {
    const scratch = mkdtempSync(path.join(REPO_ROOT, ".automation-state-git-test-"));
    try {
      const repo = path.join(scratch, "repo");
      const state = path.join(scratch, "state");
      mkdirSync(repo);
      git(repo, "init", "-b", "main");
      git(repo, "config", "user.name", "Test");
      git(repo, "config", "user.email", "test@example.invalid");
      git(
        repo,
        "config",
        "http.https://github.com/.extraheader",
        "AUTHORIZATION: basic inherited-test-value",
      );
      writeFileSync(path.join(repo, "main-only.txt"), "main\n");
      git(repo, "add", "main-only.txt");
      git(repo, "commit", "--no-verify", "-m", "main seed");

      git(repo, "worktree", "add", "--detach", state, "HEAD");
      assert.equal(
        git(
          state,
          "config",
          "--local",
          "--get",
          "http.https://github.com/.extraheader",
        ),
        "AUTHORIZATION: basic inherited-test-value",
      );

      git(state, "switch", "--orphan", "automation-state");
      git(state, "rm", "-rf", "--cached", "--ignore-unmatch", ".");
      mkdirSync(path.join(state, "docs"), { recursive: true });
      writeFileSync(path.join(state, "docs", "redeem-history.md"), "# history\n");
      git(state, "add", "-A", "--", "docs/redeem-history.md");
      git(state, "commit", "--no-verify", "-m", "state seed");

      const commitLine = git(state, "rev-list", "--parents", "-n", "1", "HEAD");
      assert.equal(commitLine.split(/\s+/).length, 1, "bootstrap must be a root commit");
      assert.deepEqual(
        git(state, "ls-tree", "-r", "--name-only", "HEAD").split(/\r?\n/),
        ["docs/redeem-history.md"],
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("replays a losing orphan bootstrap onto the winning remote root", async () => {
    const scratch = mkdtempSync(path.join(REPO_ROOT, ".automation-state-git-test-"));
    try {
      const remote = path.join(scratch, "remote.git");
      const seed = path.join(scratch, "seed");
      const writerA = path.join(scratch, "writer-a");
      const writerB = path.join(scratch, "writer-b");
      const stateA = path.join(scratch, "state-a");
      const stateB = path.join(scratch, "state-b");

      mkdirSync(remote);
      git(remote, "init", "--bare");

      mkdirSync(seed);
      git(seed, "init", "-b", "main");
      git(seed, "config", "user.name", "Test");
      git(seed, "config", "user.email", "test@example.invalid");
      writeFileSync(path.join(seed, "seed.txt"), "seed\n");
      git(seed, "add", "seed.txt");
      git(seed, "commit", "--no-verify", "-m", "seed");
      git(seed, "remote", "add", "origin", remote);
      git(seed, "push", "origin", "HEAD:main");

      git(scratch, "clone", remote, writerA);
      git(scratch, "clone", remote, writerB);
      git(writerA, "config", "user.name", "Writer A");
      git(writerA, "config", "user.email", "a@example.invalid");
      git(writerB, "config", "user.name", "Writer B");
      git(writerB, "config", "user.email", "b@example.invalid");

      git(writerA, "worktree", "add", "--detach", stateA, "origin/main");
      git(writerB, "worktree", "add", "--detach", stateB, "origin/main");

      git(stateA, "switch", "--orphan", "automation-state");
      git(stateA, "rm", "-rf", "--cached", "--ignore-unmatch", ".");
      mkdirSync(path.join(stateA, "docs"), { recursive: true });
      writeFileSync(path.join(stateA, "docs", "redeem-history.md"), "# writer A\n");
      git(stateA, "add", "-A", "--", "docs/redeem-history.md");
      git(stateA, "commit", "--no-verify", "-m", "writer a state");

      git(stateB, "switch", "--orphan", "automation-state");
      git(stateB, "rm", "-rf", "--cached", "--ignore-unmatch", ".");
      mkdirSync(path.join(stateB, "data", "discord", "game-state", "2026-08-24"), { recursive: true });
      writeFileSync(
        path.join(stateB, "data", "discord", "game-state", "2026-08-24", "snapshot.txt"),
        "writer-b\n",
      );
      git(stateB, "add", "-A", "--", "data/discord/game-state");
      git(stateB, "commit", "--no-verify", "-m", "writer b state");

      git(stateA, "push", "origin", "HEAD:automation-state");
      assert.throws(() => git(stateB, "push", "origin", "HEAD:automation-state"));

      const mode = await reconcileAutomationStateAfterPushFailure({
        stateDir: stateB,
        ref: "automation-state",
        relativePaths: ["data/discord/game-state"],
      });
      assert.equal(mode, "replayed");

      git(stateB, "push", "origin", "HEAD:automation-state");
      git(writerA, "fetch", "origin", "refs/heads/automation-state:refs/remotes/origin/automation-state");

      assert.deepEqual(
        git(writerA, "ls-tree", "-r", "--name-only", "origin/automation-state").split(/\r?\n/).sort(),
        ["data/discord/game-state/2026-08-24/snapshot.txt", "docs/redeem-history.md"],
      );
      assert.equal(
        git(stateB, "rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/).length,
        2,
        "replayed commit must sit on top of the winning remote root",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
