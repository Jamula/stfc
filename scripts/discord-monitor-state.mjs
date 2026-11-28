#!/usr/bin/env node

import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { mergePromoCodeFiles } from "./merge-promo-codes.mjs";

const DISCORD_MONITOR_STATE_FILES = [
  "data/discord/cursors.json",
  "data/discord/candidates.jsonl",
  "data/discord/tips-seen.jsonl",
  "data/discord/cooldowns.json",
];

const DISCORD_MONITOR_STATE_DIRECTORIES = [
  "data/digests",
];

const DISCORD_MONITOR_PROMO_CODES = "promo-codes.txt";

async function pathType(targetPath) {
  try {
    const details = await stat(targetPath);
    if (details.isFile()) return "file";
    if (details.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function copyFileIfPresent(sourceRoot, destinationRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if ((await pathType(sourcePath)) !== "file") return false;
  const destinationPath = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true });
  return true;
}

async function copyDirectoryIfPresent(sourceRoot, destinationRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if ((await pathType(sourcePath)) !== "directory") return false;
  const destinationPath = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
  return true;
}

export async function restoreDiscordMonitorState({
  restoreRoot,
  workspaceRoot,
  mainRef = "HEAD",
}) {
  for (const relativePath of DISCORD_MONITOR_STATE_FILES) {
    await copyFileIfPresent(restoreRoot, workspaceRoot, relativePath);
  }
  for (const relativePath of DISCORD_MONITOR_STATE_DIRECTORIES) {
    await copyDirectoryIfPresent(restoreRoot, workspaceRoot, relativePath);
  }

  const statePromoCodes = path.join(restoreRoot, DISCORD_MONITOR_PROMO_CODES);
  if ((await pathType(statePromoCodes)) === "file") {
    await mergePromoCodeFiles(
      path.join(workspaceRoot, DISCORD_MONITOR_PROMO_CODES),
      statePromoCodes,
      path.join(workspaceRoot, DISCORD_MONITOR_PROMO_CODES),
      mainRef,
    );
  }
}

export async function persistDiscordMonitorState({
  workspaceRoot,
  stateRoot,
}) {
  for (const relativePath of DISCORD_MONITOR_STATE_FILES) {
    await copyFileIfPresent(workspaceRoot, stateRoot, relativePath);
  }
  for (const relativePath of DISCORD_MONITOR_STATE_DIRECTORIES) {
    await copyDirectoryIfPresent(workspaceRoot, stateRoot, relativePath);
  }
  await copyFileIfPresent(workspaceRoot, stateRoot, DISCORD_MONITOR_PROMO_CODES);
}

async function main() {
  const [mode, sourceRoot, destinationRoot, mainRef] = process.argv.slice(2);
  if (!mode || !sourceRoot || !destinationRoot) {
    throw new Error(
      "Usage: node scripts/discord-monitor-state.mjs <restore|persist> <source-root> <destination-root> [main-ref]",
    );
  }

  if (mode === "restore") {
    await restoreDiscordMonitorState({
      restoreRoot: sourceRoot,
      workspaceRoot: destinationRoot,
      mainRef: mainRef ?? "HEAD",
    });
    return;
  }

  if (mode === "persist") {
    await persistDiscordMonitorState({
      workspaceRoot: sourceRoot,
      stateRoot: destinationRoot,
    });
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
