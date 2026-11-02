import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".notes-sync-test-" + process.pid);
const scripts = resolve(".squad", "templates", "scripts", "notes");
const remote = join(root, "remote.git");
const local = join(root, "local");
const peer = join(root, "peer");

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  return result;
}

function git(repo: string, ...args: string[]) {
  const result = run("git", ["-C", repo, ...args]);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function script(name: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const command = `if ($env:NOTES_TEST_NO_SLEEP) { function global:Start-Sleep { param($Seconds) } }; & ${quote(join(scripts, name))} ${args.join(" ")}; exit $LASTEXITCODE`;
  return run("pwsh", ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], env);
}

function note(repo: string, text: string) {
  git(repo, "notes", "--ref=squad/data", "append", "-m", text, "HEAD");
}

function write(content: string, extra = "", env: NodeJS.ProcessEnv = {}) {
  const json = JSON.stringify({ content }).replaceAll("'", "''");
  return script("write-note.ps1", [`-RepoPath '${local.replaceAll("'", "''")}'`, "-Agent data", "-Type progress", `-Content '${json}'`, extra, "-Quiet"], env);
}

test("notes sync preserves unpublished notes, merges remote-only refs and reports push failures", {
  skip: spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status !== 0 ? "PowerShell is not installed" : false,
}, () => {
  mkdirSync(root);
  try {
    assert.equal(run("git", ["init", "--bare", remote]).status, 0);
    assert.equal(run("git", ["init", local]).status, 0);
    for (const repo of [local]) {
      git(repo, "config", "user.name", "Notes Test");
      git(repo, "config", "user.email", "notes@example.invalid");
    }
    git(local, "commit", "--allow-empty", "-m", "base");
    git(local, "remote", "add", "origin", remote);
    git(local, "push", "origin", "HEAD:refs/heads/main");
    note(local, "remote original");
    git(local, "push", "origin", "refs/notes/squad/data");
    assert.equal(run("git", ["clone", "-b", "main", remote, peer]).status, 0);
    git(peer, "config", "user.name", "Notes Test");
    git(peer, "config", "user.email", "notes@example.invalid");

    // A legacy configuration must not overwrite local-only notes even before -Setup migrates it.
    git(local, "config", "--add", "remote.origin.fetch", "refs/notes/*:refs/notes/*");
    assert.equal(write("local one", "-NoPush").status, 0);
    assert.equal(write("local two", "-NoPush").status, 0);
    let result = git(local, "notes", "--ref=squad/data", "show", "HEAD");
    assert.match(result, /remote original/);
    assert.match(result, /local one/);
    assert.match(result, /local two/);

    const setup = script("fetch.ps1", [`-RepoPath '${local.replaceAll("'", "''")}'`, "-Setup", "-Merge", "-Quiet"]);
    assert.equal(setup.status, 0, setup.stderr);
    const configured = git(local, "config", "--get-all", "remote.origin.fetch");
    assert.match(configured, /\+refs\/notes\/\*:refs\/remotes\/origin\/notes\/\*/);
    assert.doesNotMatch(configured, /refs\/notes\/\*:refs\/notes\/\*/);

    git(peer, "notes", "--ref=squad/research", "add", "-m", "remote-only namespace", "HEAD");
    git(peer, "push", "origin", "refs/notes/squad/research");
    const merge = script("fetch.ps1", [`-RepoPath '${local.replaceAll("'", "''")}'`, "-Merge", "-Quiet"]);
    assert.equal(merge.status, 0, merge.stderr);
    assert.match(git(local, "notes", "--ref=squad/research", "show", "HEAD"), /remote-only namespace/);

    // Advance the remote during the first push, forcing the real rejection/retry path.
    git(peer, "fetch", "origin", "+refs/notes/squad/data:refs/notes/squad/data");
    note(peer, "concurrent remote");
    const hook = join(local, ".git", "hooks", "pre-push");
    writeFileSync(hook, "#!/bin/sh\nif [ ! -f \"$NOTES_TEST_MARKER\" ]; then\n  touch \"$NOTES_TEST_MARKER\"\n  git -C \"$NOTES_TEST_PEER\" push origin refs/notes/squad/data || exit 1\nfi\n");
    chmodSync(hook, 0o755);
    const race = write("local retry", "", { NOTES_TEST_MARKER: join(root, "pushed"), NOTES_TEST_PEER: peer, NOTES_TEST_NO_SLEEP: "1" });
    assert.equal(race.status, 0, race.stderr);
    result = git(local, "notes", "--ref=squad/data", "show", "HEAD");
    for (const expected of ["remote original", "concurrent remote", "local one", "local two", "local retry"]) assert.match(result, new RegExp(expected));
    git(peer, "fetch", "origin", "+refs/notes/squad/data:refs/notes/squad/data");
    assert.equal(git(peer, "notes", "--ref=squad/data", "show", "HEAD"), result);

    rmSync(hook);
    const rejectHook = join(remote, "hooks", "pre-receive");
    writeFileSync(rejectHook, "#!/bin/sh\nexit 1\n");
    chmodSync(rejectHook, 0o755);
    const rejected = write("retained after rejection", "", { NOTES_TEST_NO_SLEEP: "1" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Failed to push notes after 5 attempts/);
    assert.match(rejected.stderr, /rejected/);
    assert.match(git(local, "notes", "--ref=squad/data", "show", "HEAD"), /retained after rejection/);
    rmSync(rejectHook);

    git(local, "remote", "set-url", "--push", "origin", join(root, "missing.git"));
    const failed = write("retained after failure");
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /Failed to push notes after 5 attempts/);
    assert.match(git(local, "notes", "--ref=squad/data", "show", "HEAD"), /retained after failure/);

    // Create a real manually unresolved notes merge with work the user has edited.
    const base = git(local, "rev-parse", "refs/notes/squad/research");
    git(local, "update-ref", "refs/notes/squad/conflict", base);
    git(local, "update-ref", "refs/notes/squad/conflict-other", base);
    git(local, "notes", "--ref=squad/conflict", "add", "-f", "-m", "local conflicting note", "HEAD");
    git(local, "notes", "--ref=squad/conflict-other", "add", "-f", "-m", "other conflicting note", "HEAD");
    const conflict = run("git", ["-C", local, "notes", "--ref=squad/conflict", "merge", "refs/notes/squad/conflict-other"]);
    assert.notEqual(conflict.status, 0, "expected a real notes merge conflict");
    const partial = resolve(local, git(local, "rev-parse", "--git-path", "NOTES_MERGE_PARTIAL"));
    const mergeRef = resolve(local, git(local, "rev-parse", "--git-path", "NOTES_MERGE_REF"));
    const worktree = resolve(local, git(local, "rev-parse", "--git-path", "NOTES_MERGE_WORKTREE"));
    const conflictFile = join(worktree, git(local, "rev-parse", "HEAD"));
    writeFileSync(conflictFile, "user's in-progress resolution\n");
    const before = [partial, mergeRef, conflictFile].map((path) => readFileSync(path));
    const beforeRef = git(local, "rev-parse", "refs/notes/squad/conflict");
    const blocked = script("fetch.ps1", [`-RepoPath '${local.replaceAll("'", "''")}'`, "-Merge", "-Quiet"]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /notes merge.*in progress/i);
    [partial, mergeRef, conflictFile].forEach((path, i) => assert.deepEqual(readFileSync(path), before[i], `${path} changed`));
    assert.equal(git(local, "rev-parse", "refs/notes/squad/conflict"), beforeRef);
    const blockedWrite = write("must not be written", "-NoPush");
    assert.notEqual(blockedWrite.status, 0);
    [partial, mergeRef, conflictFile].forEach((path, i) => assert.deepEqual(readFileSync(path), before[i], `${path} changed during write`));
    assert.equal(git(local, "rev-parse", "refs/notes/squad/conflict"), beforeRef);
    git(local, "notes", "merge", "--abort");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
