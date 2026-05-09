// Promo-codes file parser. The file is committed alongside the code; one
// code per line, blank lines and `#` comments are ignored. Inline comments
// after a code (separated by whitespace + #) are also stripped.

import { promises as fs } from "node:fs";

export class PromoCodesFileError extends Error {
  override readonly name = "PromoCodesFileError";
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
