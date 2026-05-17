#!/usr/bin/env node
/**
 * Pre-push hook: auto-rebase main onto origin/main before push.
 *
 * The scheduled redeem.yml workflow commits to docs/redeem-history.md
 * every 15 minutes, causing constant divergence on origin/main.
 * Rebase is always conflict-free since feature work never touches that file.
 *
 * Installed by simple-git-hooks. Emergency bypass (avoid routine use):
 *   git push --no-verify
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

/**
 * Determine whether any line of git's pre-push stdin targets the main branch.
 * Git sends lines of: `<local ref> <local sha> <remote ref> <remote sha>`
 */
export function isPushToMain(stdin) {
  return stdin
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .some((line) => {
      const remoteRef = line.trim().split(/\s+/)[2] ?? "";
      return remoteRef === "refs/heads/main";
    });
}

/**
 * Return how many commits local HEAD is behind origin/main.
 */
export function getCommitsBehind() {
  const count = execSync("git rev-list --count HEAD..origin/main", {
    encoding: "utf8",
  }).trim();
  return parseInt(count, 10);
}

/**
 * Attempt `git rebase origin/main`. Returns success/failure.
 */
export function rebaseOntoOrigin() {
  try {
    execSync("git rebase origin/main", { stdio: "pipe", encoding: "utf8" });
    return { success: true };
  } catch (err) {
    // Abort the failed rebase so the worktree isn't left in a broken state
    try {
      execSync("git rebase --abort", { stdio: "pipe" });
    } catch {
      // ignore — abort may fail if rebase already cleaned up
    }
    return {
      success: false,
      error: err.stderr?.toString() ?? err.message,
    };
  }
}

/* ── main ──────────────────────────────────────────────────────────── */

function main() {
  // Git pipes push info on stdin
  const stdin = readFileSync(0, "utf8");

  if (!isPushToMain(stdin)) {
    process.exit(0); // not pushing to main — nothing to do
  }

  // Fetch latest remote state
  console.log("[pre-push] Fetching origin…");
  execSync("git fetch origin", { stdio: "inherit" });

  const behind = getCommitsBehind();
  if (behind === 0) {
    console.log("[pre-push] Local main is up-to-date with origin/main.");
    process.exit(0);
  }

  console.log(
    `[pre-push] Local main is ${behind} commit(s) behind origin/main. Rebasing…`,
  );
  const result = rebaseOntoOrigin();

  if (!result.success) {
    console.error("[pre-push] ❌ Rebase failed! Resolve manually:");
    console.error("  git fetch origin && git rebase origin/main");
    console.error(`  Error: ${result.error}`);
    process.exit(1);
  }

  console.log("[pre-push] ✅ Rebased successfully. Continuing push.");
}

main();
