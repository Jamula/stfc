#!/usr/bin/env node

import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const GIT_REPOSITORY_CONTEXT_VARIABLES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
  "GIT_REPLACE_REF_BASE",
]);

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (GIT_REPOSITORY_CONTEXT_VARIABLES.has(key)) delete env[key];
  }
  return env;
}

async function runGit(args: string[], { cwd }: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
  });
  return stdout.trim();
}

async function pathType(targetPath: string): Promise<"file" | "directory" | "other" | undefined> {
  try {
    const details = await stat(targetPath);
    if (details.isFile()) return "file";
    if (details.isDirectory()) return "directory";
    return "other";
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function snapshotPaths(
  sourceRoot: string,
  snapshotRoot: string,
  relativePaths: string[],
): Promise<void> {
  await rm(snapshotRoot, { recursive: true, force: true });
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const kind = await pathType(sourcePath);
    if (!kind) continue;
    const snapshotPath = path.join(snapshotRoot, relativePath);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await cp(sourcePath, snapshotPath, { recursive: kind === "directory", force: true });
  }
}

async function restorePaths(
  snapshotRoot: string,
  destinationRoot: string,
  relativePaths: string[],
): Promise<void> {
  for (const relativePath of relativePaths) {
    const snapshotPath = path.join(snapshotRoot, relativePath);
    const kind = await pathType(snapshotPath);
    if (!kind) continue;
    const destinationPath = path.join(destinationRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(snapshotPath, destinationPath, { recursive: kind === "directory", force: true });
  }
}

async function stagePresentPaths(stateDir: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    if (await pathType(path.join(stateDir, relativePath))) {
      const force = relativePath === "data/discord/command-acks.json" ? ["-f"] : [];
      await runGit(["-C", stateDir, "add", ...force, "-A", "--", relativePath]);
    }
  }
}

async function hasStagedChanges(stateDir: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", stateDir, "diff", "--cached", "--quiet"], {
      env: gitEnvironment(),
      encoding: "utf8",
    });
    return false;
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === 1) return true;
    throw error;
  }
}

async function fetchAutomationState(
  stateDir: string,
  remote: string,
  ref: string,
  gitImpl: (args: string[]) => Promise<string>,
): Promise<string> {
  await gitImpl(["-C", stateDir, "fetch", remote, `refs/heads/${ref}:refs/remotes/${remote}/${ref}`]);
  return `${remote}/${ref}`;
}

export async function isAutomationStateCommitPublished({
  stateDir,
  ref,
  commit,
  remote = "origin",
  runGitImpl = runGit,
}: {
  stateDir: string;
  ref: string;
  commit: string;
  remote?: string;
  runGitImpl?: (args: string[]) => Promise<string>;
}): Promise<boolean> {
  const remoteRef = await fetchAutomationState(stateDir, remote, ref, runGitImpl);
  try {
    await runGitImpl(["-C", stateDir, "merge-base", "--is-ancestor", commit, remoteRef]);
    return true;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === 1) return false;
    throw error;
  }
}

export async function reconcileAutomationStateAfterPushFailure({
  stateDir,
  ref,
  relativePaths,
  remote = "origin",
}: {
  stateDir: string;
  ref: string;
  relativePaths: string[];
  remote?: string;
}): Promise<"rebased" | "replayed" | "noop"> {
  const remoteRef = await fetchAutomationState(stateDir, remote, ref, runGit);

  const headLine = await runGit(["-C", stateDir, "rev-list", "--parents", "-n", "1", "HEAD"]);
  const isRootCommit = headLine.split(/\s+/).length === 1;
  if (!isRootCommit) {
    await runGit(["-C", stateDir, "rebase", remoteRef]);
    return "rebased";
  }

  const commitMessage = await runGit(["-C", stateDir, "show", "-s", "--format=%B", "HEAD"]);
  const snapshotRoot = path.join(stateDir, ".automation-state-retry-overlay");
  await snapshotPaths(stateDir, snapshotRoot, relativePaths);
  await runGit(["-C", stateDir, "reset", "--hard", remoteRef]);
  await restorePaths(snapshotRoot, stateDir, relativePaths);
  await stagePresentPaths(stateDir, relativePaths);

  if (!(await hasStagedChanges(stateDir))) {
    await rm(snapshotRoot, { recursive: true, force: true });
    return "noop";
  }

  const messagePath = path.join(snapshotRoot, "COMMIT_MESSAGE.txt");
  await writeFile(messagePath, `${commitMessage}\n`, "utf8");
  await runGit(["-C", stateDir, "commit", "--no-verify", "-F", messagePath]);
  await rm(snapshotRoot, { recursive: true, force: true });
  return "replayed";
}

async function main(): Promise<void> {
  const [stateDir, ref, ...relativePaths] = process.argv.slice(2);
  if (!stateDir || !ref || relativePaths.length === 0) {
    throw new Error(
      "Usage: node scripts/automation-state-retry.ts <state-dir> <ref> <path> [path...]",
    );
  }
  await reconcileAutomationStateAfterPushFailure({ stateDir, ref, relativePaths });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
