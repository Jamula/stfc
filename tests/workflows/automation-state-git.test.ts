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
});
