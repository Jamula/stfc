#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const GENERATED_MARKER = "# --- seeded from main@";

export function normalizePromoCodeLine(line: string): string {
  return (line.split("#", 1)[0] ?? "").trim().toUpperCase();
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function dedupeStateLines(rawLines: string[], known: Set<string>): string[] {
  const deduped: string[] = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trimEnd();
    if (isGeneratedMarker(line)) {
      deduped.push(line);
      continue;
    }
    const normalized = normalizePromoCodeLine(line);
    if (!normalized) {
      deduped.push(line);
      continue;
    }
    if (known.has(normalized)) continue;
    known.add(normalized);
    deduped.push(line);
  }
  while (deduped.at(-1) === "") deduped.pop();
  return deduped;
}

function isGeneratedMarker(line: string): boolean {
  return line.startsWith(GENERATED_MARKER) && line.endsWith(" ---");
}

export function mergePromoCodeText(
  mainText: string,
  stateText: string,
  mainRef = "HEAD",
): string {
  const stateLines = dedupeStateLines(lines(stateText), new Set<string>());

  const known = new Set<string>();
  for (const line of stateLines) {
    const normalized = normalizePromoCodeLine(line);
    if (normalized) known.add(normalized);
  }

  const mainOnly: string[] = [];
  const mainKnown = new Set<string>();
  for (const rawLine of lines(mainText)) {
    const line = rawLine.trimEnd();
    const normalized = normalizePromoCodeLine(line);
    if (!normalized) continue;
    if (mainKnown.has(normalized)) continue;
    mainKnown.add(normalized);
    if (known.has(normalized)) continue;
    known.add(normalized);
    mainOnly.push(line);
  }

  const merged = [...stateLines];
  if (mainOnly.length > 0) {
    if (merged.length > 0 && merged.at(-1) !== "") merged.push("");
    merged.push(`${GENERATED_MARKER}${mainRef} ---`, ...mainOnly);
  }

  return `${merged.join("\n")}\n`;
}

export async function mergePromoCodeFiles(
  mainPath: string,
  statePath: string,
  outputPath: string,
  mainRef = "HEAD",
): Promise<string> {
  const [mainText, stateText] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(statePath, "utf8"),
  ]);
  const merged = mergePromoCodeText(mainText, stateText, mainRef);
  await writeFile(outputPath, merged, "utf8");
  return merged;
}

async function main(): Promise<void> {
  const [mainPath, statePath, outputPath, mainRef] = process.argv.slice(2);
  if (!mainPath || !statePath || !outputPath) {
    throw new Error(
      "Usage: node scripts/merge-promo-codes.ts <main-seed> <automation-state> <output> [main-ref]",
    );
  }
  await mergePromoCodeFiles(mainPath, statePath, outputPath, mainRef ?? "HEAD");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
