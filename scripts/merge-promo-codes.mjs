#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const GENERATED_MARKER =
  "# --- automation-state codes (generated; human edits belong above this line) ---";

export function normalizePromoCodeLine(line) {
  return line.split("#", 1)[0].trim().toUpperCase();
}

function lines(text) {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function mergePromoCodeText(mainText, stateText) {
  const mainLines = lines(mainText);
  if (mainLines.at(-1) === "") mainLines.pop();

  const known = new Set();
  for (const line of mainLines) {
    const normalized = normalizePromoCodeLine(line);
    if (normalized) known.add(normalized);
  }

  const automationOnly = [];
  for (const line of lines(stateText)) {
    const normalized = normalizePromoCodeLine(line);
    if (!normalized || known.has(normalized)) continue;
    known.add(normalized);
    automationOnly.push(line.trim());
  }

  const merged = [...mainLines];
  if (automationOnly.length > 0) {
    if (merged.length > 0 && merged.at(-1) !== "") merged.push("");
    merged.push(GENERATED_MARKER, ...automationOnly);
  }

  return `${merged.join("\n")}\n`;
}

export async function mergePromoCodeFiles(mainPath, statePath, outputPath) {
  const [mainText, stateText] = await Promise.all([
    readFile(mainPath, "utf8"),
    readFile(statePath, "utf8"),
  ]);
  const merged = mergePromoCodeText(mainText, stateText);
  await writeFile(outputPath, merged, "utf8");
  return merged;
}

async function main() {
  const [mainPath, statePath, outputPath] = process.argv.slice(2);
  if (!mainPath || !statePath || !outputPath) {
    throw new Error(
      "Usage: node scripts/merge-promo-codes.mjs <main-seed> <automation-state> <output>",
    );
  }
  await mergePromoCodeFiles(mainPath, statePath, outputPath);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
