// Monitor and handler wrote automation-state under
// different concurrency groups. A monitor run could fetch the tip *after*
// a handler push landed, then wholesale-replace data/discord with its own
// (older) job-start snapshot — a plain fast-forward commit with nothing for
// the push-retry loop to ever detect, silently deleting the handler's
// game-state upload. This suite reproduces that exact interleaving against
// real git plumbing (not YAML text) and proves:
//   1. the production allowlist helper (scripts/discord-monitor-state.mjs,
//      as wired into the monitor workflow's persist step) survives it
//      (game-state preserved, monitor-owned files still update, push
//      succeeds on the first fast-forward attempt — no rebase needed to
//      expose the bug); and
//   2. the previously shipped rm -rf + cp -a pattern actually loses data
//      under the identical interleaving, so this is a real regression guard.
//
// Round 2 (PR #250 review): the shared stfc-gift-redeemer
// concurrency group across the redemption, monitor, and Discord command
// handler workflows (for /game-state) is the PRIMARY fix — it makes this
// interleaving impossible in production because the handler and monitor
// jobs can never run concurrently. This suite intentionally does not (and
// cannot) exercise that GitHub Actions scheduling guarantee; it proves the
// second, independent line of defense (path-level ownership exclusion)
// holds even in the worst case where serialization is somehow bypassed.
//
// Round 3 (PR #266 review): every git call below is asynchronous.
// The earlier execFileSync version blocked the shared node:test event loop
// for ~10–20s per test, which starved unrelated suites' before-hooks and
// made the required full `npm test` gate intermittently red (observed
// failure: tests/ci/check-bundle-budget.test.ts, ~40% of full-suite runs).
// Scratch roots also live under os.tmpdir(), never REPO_ROOT, so a run can
// never leave untracked scratch directories behind in the working tree.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { persistDiscordMonitorState } from "../../scripts/discord-monitor-state.ts";

const execFileAsync = promisify(execFile);

/**
 * Scratch lives in the OS temp dir, never the repo root: a crashed run can
 * then never leave an untracked `.automation-state-*` directory sitting in
 * the working tree (PR #266 review).
 */
async function makeScratch(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  // Force LF-only regardless of the host machine's global core.autocrlf
  // (Windows commonly defaults this to true), so byte-for-byte assertions
  // below are stable across platforms per the project's cross-platform
  // convention (normalize CRLF, don't assume it away).
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args],
    { cwd, env, encoding: "utf8" },
  );
  return stdout.trim();
}

async function initBareOrigin(scratch: string): Promise<string> {
  const origin = path.join(scratch, "origin.git");
  await git(scratch, "init", "-q", "--bare", "-b", "automation-state", origin);
  return origin;
}

/** Builds the baseline `automation-state` tip: an old handler upload plus a monitor-owned file. */
async function seedBaseline(scratch: string, origin: string): Promise<void> {
  const seed = path.join(scratch, "seed");
  await mkdir(seed, { recursive: true });
  await git(seed, "init", "-q", "-b", "automation-state");
  await git(seed, "config", "user.name", "Test");
  await git(seed, "config", "user.email", "test@example.invalid");
  await git(seed, "remote", "add", "origin", origin);

  await mkdir(path.join(seed, "data", "discord", "game-state", "2026-08-20"), { recursive: true });
  await writeFile(path.join(seed, "data", "discord", "cursors.json"), '{"cursor":"old"}\n');
  await writeFile(
    path.join(seed, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
    "old-upload-bytes",
  );
  await writeFile(
    path.join(seed, "data", "discord", "game-state", "2026-08-20", "_index.json"),
    '{"files":[{"filename":"000000-old-upload.png"}]}\n',
  );
  await git(seed, "add", "-A");
  await git(seed, "commit", "--no-verify", "-m", "baseline state");
  await git(seed, "push", "-q", "origin", "HEAD:automation-state");
}

/** Simulates discord-command-handler.yml pushing a NEW game-state manifest, advancing the tip. */
async function pushHandlerUpload(scratch: string, origin: string): Promise<void> {
  const handlerDir = path.join(scratch, "handler");
  await git(scratch, "clone", "-q", "--branch", "automation-state", origin, handlerDir);
  await git(handlerDir, "config", "user.name", "Test");
  await git(handlerDir, "config", "user.email", "test@example.invalid");

  await mkdir(path.join(handlerDir, "data", "discord", "game-state", "2026-08-23"), { recursive: true });
  await writeFile(
    path.join(handlerDir, "data", "discord", "game-state", "2026-08-23", "_index.json"),
    '{"files":[{"filename":"120000-new-upload.png"}]}\n',
  );
  await writeFile(
    path.join(handlerDir, "data", "discord", "game-state", "2026-08-23", "manifest.json"),
    '{"version":1,"bucket":"custom-game-state","files":[{"filename":"120000-new-upload.png","r2_bucket":"custom-game-state","r2_key":"2026-08-23/120000-new-upload.png"}]}\n',
  );
  await git(handlerDir, "add", "--", "data/discord/game-state/2026-08-23");
  await git(handlerDir, "commit", "--no-verify", "-m", "data(game-state): handler upload");
  await git(handlerDir, "push", "-q", "origin", "HEAD:automation-state");
}

/**
 * The monitor's job-start workspace: stale (pre-handler-push) game-state
 * content it snapshotted at checkout, plus this run's own fresh write to a
 * monitor-owned file. Laid out exactly like $GITHUB_WORKSPACE (data/discord/…
 * at the root), matching what scripts/discord-monitor-state.mjs's
 * persistDiscordMonitorState() expects as `workspaceRoot`.
 */
async function buildStaleMonitorWorkspace(scratch: string): Promise<string> {
  const workspaceRoot = path.join(scratch, "monitor-workspace");
  await mkdir(path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
    "old-upload-bytes",
  );
  await writeFile(
    path.join(workspaceRoot, "data", "discord", "game-state", "2026-08-20", "_index.json"),
    '{"files":[{"filename":"000000-old-upload.png"}]}\n',
  );
  // This run's own monitor-owned write — proves monitor-owned files still update.
  await writeFile(path.join(workspaceRoot, "data", "discord", "cursors.json"), '{"cursor":"new-from-this-run"}\n');
  return workspaceRoot;
}

/** Fresh clone of the monitor's state worktree at the CURRENT (post-handler-push) tip. */
async function cloneMonitorStateWorktree(scratch: string, origin: string): Promise<string> {
  const stateDir = path.join(scratch, "monitor-state-worktree");
  await git(scratch, "clone", "-q", "--branch", "automation-state", origin, stateDir);
  await git(stateDir, "config", "user.name", "github-actions[bot]");
  await git(
    stateDir,
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  );
  return stateDir;
}

describe("automation-state writer race (PR #250 review)", () => {
  it("the production allowlist helper survives a stale monitor snapshot applied after a newer handler upload, on a clean fast-forward push", async () => {
    const scratch = await makeScratch("stfc-automation-state-race-");
    try {
      const origin = await initBareOrigin(scratch);

      await seedBaseline(scratch, origin);
      await pushHandlerUpload(scratch, origin);
      const monitorWorkspace = await buildStaleMonitorWorkspace(scratch);

      // Monitor's persist step: fresh clone of the CURRENT tip (post-handler-push).
      const stateDir = await cloneMonitorStateWorktree(scratch, origin);

      // Sanity: the fresh fetch already contains the handler's newer upload.
      assert.ok(
        existsSync(path.join(stateDir, "data", "discord", "game-state", "2026-08-23", "manifest.json")),
        "precondition: the freshly fetched tip must already contain the handler's push",
      );

      // Exercises the exact helper the monitor workflow's persist step calls
      // (`node scripts/discord-monitor-state.mjs persist "$GITHUB_WORKSPACE" "$STATE_DIR"`).
      await persistDiscordMonitorState({
        workspaceRoot: monitorWorkspace,
        stateRoot: stateDir,
      });

      // Mirror the monitor workflow's exact per-file staging: an allowlist
      // of monitor-owned files, never a broad `git add -A -- data/discord`
      // that could stage a deletion of game-state.
      await git(stateDir, "add", "-A", "--", "data/discord/cursors.json");
      await git(stateDir, "commit", "--no-verify", "-m", "chore(discord-monitor): run race-test");
      // No fetch/rebase before this push — reproduces the exact race: the
      // clone above is already the latest tip, so this succeeds as a plain
      // fast-forward, exactly like the original buggy scenario.
      await git(stateDir, "push", "-q", "origin", "HEAD:automation-state");

      const checkDir = path.join(scratch, "final-check");
      await git(scratch, "clone", "-q", "--branch", "automation-state", origin, checkDir);

      assert.equal(
        await readFile(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "manifest.json"),
          "utf8",
        ),
        '{"version":1,"bucket":"custom-game-state","files":[{"filename":"120000-new-upload.png","r2_bucket":"custom-game-state","r2_key":"2026-08-23/120000-new-upload.png"}]}\n',
        "the handler's newer manifest must survive the monitor's commit",
      );
      assert.equal(
        await readFile(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "_index.json"),
          "utf8",
        ),
        '{"files":[{"filename":"120000-new-upload.png"}]}\n',
        "the handler's _index.json must survive untouched",
      );
      assert.equal(
        await readFile(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-20", "000000-old-upload.png"),
          "utf8",
        ),
        "old-upload-bytes",
        "the pre-existing older upload must also survive",
      );
      assert.equal(
        await readFile(path.join(checkDir, "data", "discord", "cursors.json"), "utf8"),
        '{"cursor":"new-from-this-run"}\n',
        "monitor-owned files must still be updated by this run",
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("regression guard: the previously shipped rm -rf + cp -a pattern loses the upload under the identical interleaving", async () => {
    const scratch = await makeScratch("stfc-automation-state-race-regression-");
    try {
      const origin = await initBareOrigin(scratch);

      await seedBaseline(scratch, origin);
      await pushHandlerUpload(scratch, origin);
      const monitorWorkspace = await buildStaleMonitorWorkspace(scratch);

      const stateDir = await cloneMonitorStateWorktree(scratch, origin);

      // The pattern this PR replaces: wholesale rm -rf + cp -a of the whole
      // directory (recursive copy, same semantics as the shell `cp -a` the
      // old persist step ran), then `git add -A -- data/discord` with no
      // ownership exclusion.
      await rm(path.join(stateDir, "data", "discord"), { recursive: true, force: true });
      await cp(
        path.join(monitorWorkspace, "data", "discord"),
        path.join(stateDir, "data", "discord"),
        { recursive: true },
      );
      await git(stateDir, "add", "-A", "--", "data/discord");
      await git(stateDir, "commit", "--no-verify", "-m", "chore(discord-monitor): pre-fix run");
      await git(stateDir, "push", "-q", "origin", "HEAD:automation-state");

      const checkDir = path.join(scratch, "final-check");
      await git(scratch, "clone", "-q", "--branch", "automation-state", origin, checkDir);

      assert.equal(
        existsSync(
          path.join(checkDir, "data", "discord", "game-state", "2026-08-23", "manifest.json"),
        ),
        false,
        "documents the bug: the pre-fix pattern silently deletes the newer handler manifest",
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("keeps all scratch state outside the repository working tree", async () => {
    const scratch = await makeScratch("stfc-automation-state-race-scope-");
    try {
      const repoRoot = path.resolve(import.meta.dirname, "..", "..");
      assert.ok(
        !path.resolve(scratch).startsWith(path.resolve(repoRoot) + path.sep),
        `scratch root must live outside ${repoRoot}, got ${scratch}`,
      );
      assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir())));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
