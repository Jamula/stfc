// Garak (PR #250 review): monitor and handler wrote automation-state under
// different concurrency groups. A monitor run could fetch the tip *after*
// a handler push landed, then wholesale-replace data/discord with its own
// (older) job-start snapshot — a plain fast-forward commit with nothing for
// the push-retry loop to ever detect, silently deleting the handler's
// game-state upload. This suite reproduces that exact interleaving against
// real git plumbing (not YAML text) and proves:
//   1. the production allowlist helper (scripts/discord-monitor-state.mjs,
//      as wired into discord-monitor.yml's persist step) survives it
//      (game-state preserved, monitor-owned files still update, push
//      succeeds on the first fast-forward attempt — no rebase needed to
//      expose the bug); and
//   2. the previously shipped rm -rf + cp -a pattern actually loses data
//      under the identical interleaving, so this is a real regression guard.
//
// Round 2 (Garak, PR #250 review): the shared stfc-gift-redeemer
// concurrency group across redeem.yml/discord-monitor.yml/discord-command-
// handler.yml (for /game-state) is the PRIMARY fix — it makes this
// interleaving impossible in production because the handler and monitor
// jobs can never run concurrently. This suite intentionally does not (and
// cannot) exercise that GitHub Actions scheduling guarantee; it proves the
// second, independent line of defense (path-level ownership exclusion)
// holds even in the worst case where serialization is somehow bypassed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { persistDiscordMonitorState } from "../../scripts/discord-monitor-state.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  // Force LF-only regardless of the host machine's global core.autocrlf
  // (Windows commonly defaults this to true), so byte-for-byte assertions
  // below are stable across platforms per the project's cross-platform
  // convention (normalize CRLF, don't assume it away).
  return execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args],
    {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

/** Builds the baseline `automation-state` tip: an old handler upload plus a monitor-owned file. */
function seedBaseline(scratch: string, origin: string): void {
  const seed = path.join(scratch, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", "automation-state");
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.invalid");
  git(seed, "remote", "add", "origin", origin);

  mkdirSync(path.join(seed, "data", "discord", "game-state", "2026-08-20"), { recursive: true });
  writeFileSync(path.join(seed, "data", "discord", "cursors.json"), '{"cursor":"old"}\n');
  writeFileSync(
    path.join(seed, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
    "old-upload-bytes",
  );
  writeFileSync(
    path.join(seed, "data", "discord", "game-state", "2026-08-20", "_index.json"),
    '{"files":[{"filename":"000000-old-upload.png"}]}\n',
  );
  git(seed, "add", "-A");
  git(seed, "commit", "--no-verify", "-m", "baseline state");
  git(seed, "push", "-q", "origin", "HEAD:automation-state");
}

/** Simulates discord-command-handler.yml pushing a NEW game-state upload, advancing the tip. */
function pushHandlerUpload(scratch: string, origin: string): void {
  const handlerDir = path.join(scratch, "handler");
  git(scratch, "clone", "-q", "--branch", "automation-state", origin, handlerDir);
  git(handlerDir, "config", "user.name", "Test");
  git(handlerDir, "config", "user.email", "test@example.invalid");

  mkdirSync(path.join(handlerDir, "data", "discord", "game-state", "2026-08-23"), { recursive: true });
  writeFileSync(
    path.join(handlerDir, "data", "discord", "game-state", "2026-08-23", "120000-new-upload.png"),
    "new-upload-bytes",
  );
  writeFileSync(
    path.join(handlerDir, "data", "discord", "game-state", "2026-08-23", "_index.json"),
    '{"files":[{"filename":"120000-new-upload.png"}]}\n',
  );
  git(handlerDir, "add", "--", "data/discord/game-state/2026-08-23");
  git(handlerDir, "commit", "--no-verify", "-m", "data(game-state): handler upload");
  git(handlerDir, "push", "-q", "origin", "HEAD:automation-state");
}

/**
 * The monitor's job-start workspace: stale (pre-handler-push) game-state
 * content it snapshotted at checkout, plus this run's own fresh write to a
 * monitor-owned file. Laid out exactly like $GITHUB_WORKSPACE (data/discord/…
 * at the root), matching what scripts/discord-monitor-state.mjs's
 * persistDiscordMonitorState() expects as `workspaceRoot`.
 */
function buildStaleMonitorWorkspace(scratch: string): string {
  const workspaceRoot = path.join(scratch, "monitor-workspace");
  mkdirSync(path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
    "old-upload-bytes",
  );
  writeFileSync(
    path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20", "_index.json"),
    '{"files":[{"filename":"000000-old-upload.png"}]}\n',
  );
  // This run's own monitor-owned write — proves monitor-owned files still update.
  writeFileSync(path.join(workspaceRoot, "data", "discord", "cursors.json"), '{"cursor":"new-from-this-run"}\n');
  return workspaceRoot;
}

describe("automation-state writer race (Garak, PR #250 review)", () => {
  it("the production allowlist helper survives a stale monitor snapshot applied after a newer handler upload, on a clean fast-forward push", async () => {
    const scratch = mkdtempSync(path.join(REPO_ROOT, ".automation-state-race-test-"));
    try {
      const origin = path.join(scratch, "origin.git");
      execFileSync("git", ["init", "-q", "--bare", "-b", "automation-state", origin], { encoding: "utf8" });

      seedBaseline(scratch, origin);
      pushHandlerUpload(scratch, origin);
      const monitorWorkspace = buildStaleMonitorWorkspace(scratch);

      // Monitor's persist step: fresh clone of the CURRENT tip (post-handler-push).
      const stateDir = path.join(scratch, "monitor-state-worktree");
      git(scratch, "clone", "-q", "--branch", "automation-state", origin, stateDir);
      git(stateDir, "config", "user.name", "github-actions[bot]");
      git(stateDir, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");

      // Sanity: the fresh fetch already contains the handler's newer upload.
      assert.ok(
        existsSync(path.join(stateDir, "data", "discord", "game-state", "2026-08-23", "120000-new-upload.png")),
        "precondition: the freshly fetched tip must already contain the handler's push",
      );

      // Exercises the exact helper discord-monitor.yml's persist step calls
      // (`node scripts/discord-monitor-state.mjs persist "$GITHUB_WORKSPACE" "$STATE_DIR"`).
      await persistDiscordMonitorState({
        workspaceRoot: monitorWorkspace,
        stateRoot: stateDir,
      });

      // Mirror discord-monitor.yml's exact per-file staging: an allowlist
      // of monitor-owned files, never a broad `git add -A -- data/discord`
      // that could stage a deletion of game-state.
      git(stateDir, "add", "-A", "--", "data/discord/cursors.json");
      git(stateDir, "commit", "--no-verify", "-m", "chore(discord-monitor): run race-test");
      // No fetch/rebase before this push — reproduces the exact race: the
      // clone above is already the latest tip, so this succeeds as a plain
      // fast-forward, exactly like the buggy scenario Garak found.
      git(stateDir, "push", "-q", "origin", "HEAD:automation-state");

      const checkDir = path.join(scratch, "final-check");
      git(scratch, "clone", "-q", "--branch", "automation-state", origin, checkDir);

      assert.equal(
        readFileSync(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "120000-new-upload.png"),
          "utf8",
        ),
        "new-upload-bytes",
        "the handler's newer upload must survive the monitor's commit",
      );
      assert.equal(
        readFileSync(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "_index.json"),
          "utf8",
        ),
        '{"files":[{"filename":"120000-new-upload.png"}]}\n',
        "the handler's _index.json must survive untouched",
      );
      assert.equal(
        readFileSync(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
          "utf8",
        ),
        "old-upload-bytes",
        "the pre-existing older upload must also survive",
      );
      assert.equal(
        readFileSync(path.join(checkDir, "data", "discord", "cursors.json"), "utf8"),
        '{"cursor":"new-from-this-run"}\n',
        "monitor-owned files must still be updated by this run",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("regression guard: the previously shipped rm -rf + cp -a pattern loses the upload under the identical interleaving", () => {
    const scratch = mkdtempSync(path.join(REPO_ROOT, ".automation-state-race-regression-"));
    try {
      const origin = path.join(scratch, "origin.git");
      execFileSync("git", ["init", "-q", "--bare", "-b", "automation-state", origin], { encoding: "utf8" });

      seedBaseline(scratch, origin);
      pushHandlerUpload(scratch, origin);
      const monitorWorkspace = buildStaleMonitorWorkspace(scratch);

      const stateDir = path.join(scratch, "monitor-state-worktree");
      git(scratch, "clone", "-q", "--branch", "automation-state", origin, stateDir);
      git(stateDir, "config", "user.name", "github-actions[bot]");
      git(stateDir, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");

      // The pattern this PR replaces: wholesale rm -rf + cp -a of the whole
      // directory, then `git add -A -- data/discord` with no exclusion.
      rmSync(path.join(stateDir, "data", "discord"), { recursive: true, force: true });
      execFileSync("node", [
        "-e",
        "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true })",
        path.join(monitorWorkspace, "data", "discord"),
        path.join(stateDir, "data", "discord"),
      ]);
      git(stateDir, "add", "-A", "--", "data/discord");
      git(stateDir, "commit", "--no-verify", "-m", "chore(discord-monitor): pre-fix run");
      git(stateDir, "push", "-q", "origin", "HEAD:automation-state");

      const checkDir = path.join(scratch, "final-check");
      git(scratch, "clone", "-q", "--branch", "automation-state", origin, checkDir);

      assert.equal(
        existsSync(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "120000-new-upload.png"),
        ),
        false,
        "documents the bug: the pre-fix pattern silently deletes the newer handler upload",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
