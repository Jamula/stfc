#!/usr/bin/env node

import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { mergePromoCodeFiles } from "./merge-promo-codes.ts";

export const DISCORD_MONITOR_STATE_FILES: readonly string[] = [
  "data/discord/cursors.json",
  "data/discord/command-acks.json",
  "data/discord/candidates.jsonl",
  "data/discord/tips-seen.jsonl",
  "data/discord/cooldowns.json",
];

export const DISCORD_MONITOR_STATE_DIRECTORIES: readonly string[] = [
  "data/digests",
];

export const DISCORD_MONITOR_PROMO_CODES = "promo-codes.txt";
const DISCORD_MONITOR_DEAD_CODES = "data/promo-code-dead.json";
const DISCORD_MONITOR_ALLOWLIST = "config/discord-allowlist.json";

async function promoScanEnabled(workspaceRoot: string): Promise<boolean> {
  const allowlistPath = path.join(workspaceRoot, DISCORD_MONITOR_ALLOWLIST);
  const allowlist: unknown = JSON.parse(await readFile(allowlistPath, "utf8"));
  // The monitor performs full schema validation; restoration must at least
  // determine scan eligibility without treating ambiguous configuration as off.
  if (
    allowlist === null ||
    typeof allowlist !== "object" ||
    Array.isArray(allowlist) ||
    (allowlist as Record<string, unknown>)["version"] !== 1 ||
    !Array.isArray((allowlist as Record<string, unknown>)["entries"])
  ) {
    throw new Error(`Invalid Discord promo-channel allowlist: ${allowlistPath}`);
  }
  const entries = (allowlist as { entries: unknown[] }).entries;
  if (
    entries.some(
      (entry) =>
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof (entry as Record<string, unknown>)["enabled"] !== "boolean",
    )
  ) {
    throw new Error(`Invalid Discord promo-channel allowlist: ${allowlistPath}`);
  }
  return (entries as Array<{ enabled: boolean }>).some((entry) => entry.enabled);
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

async function copyFileIfPresent(
  sourceRoot: string,
  destinationRoot: string,
  relativePath: string,
): Promise<boolean> {
  const sourcePath = path.join(sourceRoot, relativePath);
  if ((await pathType(sourcePath)) !== "file") return false;
  const destinationPath = path.join(destinationRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true });
  return true;
}

async function copyDirectoryIfPresent(
  sourceRoot: string,
  destinationRoot: string,
  relativePath: string,
): Promise<boolean> {
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
}: {
  restoreRoot: string;
  workspaceRoot: string;
  mainRef?: string;
}): Promise<void> {
  for (const relativePath of DISCORD_MONITOR_STATE_FILES) {
    await copyFileIfPresent(restoreRoot, workspaceRoot, relativePath);
  }
  for (const relativePath of DISCORD_MONITOR_STATE_DIRECTORIES) {
    await copyDirectoryIfPresent(restoreRoot, workspaceRoot, relativePath);
  }

  if (await promoScanEnabled(workspaceRoot)) {
    const deadCodesType = await pathType(path.join(restoreRoot, DISCORD_MONITOR_DEAD_CODES));
    if (deadCodesType !== undefined && deadCodesType !== "file") {
      throw new Error("The dead-code cache on automation-state is not a file.");
    }
    await copyFileIfPresent(restoreRoot, workspaceRoot, DISCORD_MONITOR_DEAD_CODES);
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
}: {
  workspaceRoot: string;
  stateRoot: string;
}): Promise<void> {
  for (const relativePath of DISCORD_MONITOR_STATE_FILES) {
    await copyFileIfPresent(workspaceRoot, stateRoot, relativePath);
  }
  for (const relativePath of DISCORD_MONITOR_STATE_DIRECTORIES) {
    await copyDirectoryIfPresent(workspaceRoot, stateRoot, relativePath);
  }
  await copyFileIfPresent(workspaceRoot, stateRoot, DISCORD_MONITOR_PROMO_CODES);
}

async function main(): Promise<void> {
  const [mode, sourceRoot, destinationRoot, mainRef] = process.argv.slice(2);
  if (!mode || !sourceRoot || !destinationRoot) {
    throw new Error(
      "Usage: node scripts/discord-monitor-state.ts <restore|persist> <source-root> <destination-root> [main-ref]",
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
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
