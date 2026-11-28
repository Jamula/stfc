// Promo-codes file parser. The file is committed alongside the code; one
// code per line, blank lines and `#` comments are ignored. Inline comments
// after a code (separated by whitespace + #) are also stripped.

import { promises as fs } from "node:fs";

export const DEFAULT_DEAD_CODES_PATH = "data/promo-code-dead.json";

export class PromoCodesFileError extends Error {
  override readonly name = "PromoCodesFileError";
}

export class DeadCodeCacheError extends Error {
  override readonly name = "DeadCodeCacheError";
}

export async function readDeadCodes(path: string = DEFAULT_DEAD_CODES_PATH): Promise<Set<string>> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw new DeadCodeCacheError(`Could not read dead-code cache at ${path}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DeadCodeCacheError(`Malformed dead-code cache at ${path}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DeadCodeCacheError(`Invalid dead-code cache at ${path}: expected an object.`);
  }

  const codes = new Set<string>();
  for (const [code, value] of Object.entries(parsed)) {
    if (!code.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new DeadCodeCacheError(`Invalid entry in dead-code cache at ${path}.`);
    }
    const entry = value as Record<string, unknown>;
    if (
      entry.first_seen_outcome !== "CODE_INVALID_OR_EXPIRED" ||
      typeof entry.marked_dead_at !== "string" ||
      !Number.isFinite(Date.parse(entry.marked_dead_at)) ||
      !Array.isArray(entry.accounts_tried) ||
      !entry.accounts_tried.every((account: unknown) => typeof account === "string")
    ) {
      throw new DeadCodeCacheError(`Invalid entry in dead-code cache at ${path}.`);
    }
    codes.add(code.trim().toUpperCase());
  }
  return codes;
}

export async function readPromoCodes(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Missing file is not an error — it just means no codes to redeem.
      return [];
    }
    throw new PromoCodesFileError(`Could not read ${path}: ${(err as Error).message}`);
  }
  return parsePromoCodes(raw);
}

export function parsePromoCodes(content: string): string[] {
  const codes: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    let s = line;
    // Strip whole-line and inline comments
    const hash = s.indexOf("#");
    if (hash !== -1) s = s.slice(0, hash);
    s = s.trim();
    if (s.length === 0) continue;
    codes.push(s);
  }
  return codes;
}

/**
 * T023 [US1] — the redeemer-seam entry point. Returns the deduplicated list
 * of codes the redeemer should attempt this run.
 *
 * Combines (a) the static `promo-codes.txt` contents (read via the existing
 * `readPromoCodes` + `parsePromoCodes` pipeline) and (b) any caller-supplied
 * additional candidates from the Discord monitor, in deterministic order
 * (file first, then candidates in insertion order). Dedup key: the value
 * after `trim().toUpperCase()` normalization (matches FR-007 + upstream's
 * case-insensitive promo redeem endpoint).
 *
 * Existing callers that invoke `readPromoCodes(path)` directly continue to
 * work unchanged.
 */
export async function readCodesForRun(opts?: {
  promoCodesPath?: string;
  extraCandidates?: string[];
}): Promise<string[]> {
  const file = opts?.promoCodesPath ? await readPromoCodes(opts.promoCodesPath) : [];
  const extras = opts?.extraCandidates ?? [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...file, ...extras]) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
