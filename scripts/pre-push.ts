#!/usr/bin/env node
/**
 * Pre-push hook: auto-rebase main onto origin/main before push.
 *
 * Automation state is pushed to automation-state, but human and release
 * tooling can still advance main while a local main checkout is stale.
 *
 * Installed by simple-git-hooks. Emergency bypass (avoid routine use):
 *   git push --no-verify
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Determine whether any line of git's pre-push stdin targets the main branch.
 * Git sends lines of: `<local ref> <local sha> <remote ref> <remote sha>`
 */
export function isPushToMain(stdin: string): boolean {
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
export function getCommitsBehind(): number {
  const count = execSync("git rev-list --count HEAD..origin/main", {
    encoding: "utf8",
  }).trim();
  return parseInt(count, 10);
}

/**
 * Attempt `git rebase origin/main`. Returns success/failure.
 */
export function rebaseOntoOrigin():
  | { success: true }
  | { success: false; error: string } {
  try {
    execSync("git rebase origin/main", { stdio: "pipe", encoding: "utf8" });
    return { success: true };
  } catch (err: unknown) {
    try {
      execSync("git rebase --abort", { stdio: "pipe" });
    } catch {
      // ignore — abort may fail if rebase already cleaned up
    }
    const execErr = err as { stderr?: Buffer | string; message?: string };
    return {
      success: false,
      error: execErr.stderr?.toString() ?? execErr.message ?? String(err),
    };
  }
}

/* ── main ──────────────────────────────────────────────────────────── */

function main(): void {
  const stdin = readFileSync(0, "utf8");

  if (!isPushToMain(stdin)) {
    process.exit(0);
  }

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
