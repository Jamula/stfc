#!/usr/bin/env node
/**
 * CI gate: every Azure Functions HTTP handler must import + call
 * requireAllowedUser or requireOwner (from api/src/_lib/auth.ts) AS THE
 * FIRST NON-TRIVIAL STATEMENT in the handler function body.
 *
 * Usage:
 *   node scripts/ci/check-api-auth.ts
 *   node scripts/ci/check-api-auth.ts --api-dir <path>   # for tests
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const apiDirArgIdx = process.argv.indexOf("--api-dir");
const API_DIR =
  apiDirArgIdx !== -1 ? (process.argv[apiDirArgIdx + 1] ?? "api/src") : "api/src";

const EXCLUDE_SEGMENTS = new Set(["_lib", "dist", "node_modules"]);

function walk(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!EXCLUDE_SEGMENTS.has(entry)) {
        results.push(...walk(full));
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

function isHandlerFile(content: string): boolean {
  return (
    content.includes('"@azure/functions"') ||
    content.includes("'@azure/functions'")
  );
}

function hasAnonymousJustification(content: string): boolean {
  return content.includes("@auth-anonymous-justification");
}

function hasAuthImport(content: string): boolean {
  return (
    content.includes("requireAllowedUser") || content.includes("requireOwner")
  );
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  let str: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < src.length && depth > 0) {
    const c = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (str) {
      if (c === "\\") {
        i++;
      } else if (c === str) {
        str = null;
      }
    } else {
      if (c === "/" && next === "/") {
        inLineComment = true;
        i++;
      } else if (c === "/" && next === "*") {
        inBlockComment = true;
        i++;
      } else if (c === "'" || c === '"' || c === "`") {
        str = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }
  return -1;
}

function findHandlerBodies(content: string): Array<{ openBrace: number; body: string }> {
  const bodies: Array<{ openBrace: number; body: string }> = [];
  const seenStarts = new Set<number>();
  const patterns = [
    /\bhandler\s*:\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*=>\s*\{/g,
    /(?:export\s+)?(?:async\s+)?function\s+handler\s*(?:<[^>]*>)?\s*\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*\{/g,
    /(?:export\s+)?const\s+handler\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*=>\s*\{/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const openBrace = m.index + m[0].length - 1;
      if (content[openBrace] !== "{") continue;
      if (seenStarts.has(openBrace)) continue;
      const close = findMatchingBrace(content, openBrace);
      if (close === -1) continue;
      seenStarts.add(openBrace);
      bodies.push({
        openBrace,
        body: content.slice(openBrace + 1, close),
      });
    }
  }
  return bodies;
}

function firstNonTrivialStatement(body: string): string | null {
  let pos = 0;
  while (pos < body.length) {
    while (pos < body.length && /\s/.test(body[pos] ?? "")) pos++;
    if (pos >= body.length) return null;
    if (body[pos] === "/" && body[pos + 1] === "/") {
      while (pos < body.length && body[pos] !== "\n") pos++;
      continue;
    }
    if (body[pos] === "/" && body[pos + 1] === "*") {
      pos += 2;
      while (pos < body.length && !(body[pos] === "*" && body[pos + 1] === "/")) {
        pos++;
      }
      pos += 2;
      continue;
    }
    const tail = body.slice(pos);
    const tryMatch = tail.match(/^try\s*\{/);
    if (tryMatch) {
      const innerOpen = pos + tryMatch[0].length - 1;
      const innerClose = findMatchingBrace(body, innerOpen);
      if (innerClose === -1) return null;
      return firstNonTrivialStatement(body.slice(innerOpen + 1, innerClose));
    }
    if (/^type\s+\w/.test(tail)) {
      let j = pos;
      let depth = 0;
      while (j < body.length) {
        const c = body[j];
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
        else if (depth === 0 && c === ";") {
          j++;
          break;
        }
        j++;
      }
      pos = j;
      continue;
    }
    if (/^interface\s+\w/.test(tail)) {
      const open = body.indexOf("{", pos);
      if (open === -1) return null;
      const close = findMatchingBrace(body, open);
      if (close === -1) return null;
      pos = close + 1;
      continue;
    }
    let depth = 0;
    let str: string | null = null;
    let j = pos;
    while (j < body.length) {
      const c = body[j];
      const n = body[j + 1];
      if (str) {
        if (c === "\\") j++;
        else if (c === str) str = null;
      } else if (c === "/" && n === "/") {
        while (j < body.length && body[j] !== "\n") j++;
        continue;
      } else if (c === "/" && n === "*") {
        j += 2;
        while (j < body.length && !(body[j] === "*" && body[j + 1] === "/")) j++;
        j += 1;
      } else if (c === "'" || c === '"' || c === "`") {
        str = c;
      } else if (c === "{" || c === "(" || c === "[") {
        depth++;
      } else if (c === "}" || c === ")" || c === "]") {
        depth--;
      } else if (depth === 0 && (c === ";" || c === "\n")) {
        break;
      }
      j++;
    }
    return body.slice(pos, j).trim();
  }
  return null;
}

function isAuthGuardCall(stmt: string | null): boolean {
  if (!stmt) return false;
  return /^(?:(?:const|let|var)\s+[\w{},\s:[\]<>|?]+?\s*=\s*)?(?:await\s+)?(?:requireAllowedUser|requireOwner)\s*\(/.test(
    stmt,
  );
}

function checkPosition(content: string): string[] {
  const bodies = findHandlerBodies(content);
  if (bodies.length === 0) {
    return [];
  }
  const violations: string[] = [];
  for (const { body } of bodies) {
    const stmt = firstNonTrivialStatement(body);
    if (!isAuthGuardCall(stmt)) {
      violations.push(
        stmt === null
          ? "handler body is empty (no auth guard call)"
          : `first non-trivial statement is not requireAllowedUser/requireOwner: \`${stmt.replace(/\s+/g, " ").slice(0, 80)}\``,
      );
    }
  }
  return violations;
}

const files = walk(API_DIR);

if (files.length === 0) {
  console.log(
    `check-api-auth: no handler files found under "${API_DIR}" — skipping.`,
  );
  process.exit(0);
}

const offenders: Array<{ file: string; reasons: string[] }> = [];

for (const file of files) {
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    continue;
  }

  if (!isHandlerFile(content)) continue;
  if (hasAnonymousJustification(content)) continue;

  const reasons: string[] = [];

  if (!hasAuthImport(content)) {
    reasons.push("missing requireAllowedUser/requireOwner import");
  } else {
    const positionViolations = checkPosition(content);
    reasons.push(...positionViolations);
  }

  if (reasons.length > 0) {
    offenders.push({ file: relative(process.cwd(), file), reasons });
  }
}

if (offenders.length > 0) {
  console.error(
    "check-api-auth FAILED — the following handlers are non-compliant:\n",
  );
  for (const { file, reasons } of offenders) {
    console.error(`  ✗  ${file}`);
    for (const r of reasons) {
      console.error(`        - ${r}`);
    }
  }
  console.error(
    "\nEvery HTTP handler must call requireAllowedUser() or requireOwner() from",
  );
  console.error(
    "api/src/_lib/auth.ts as its FIRST non-trivial statement (or as the first",
  );
  console.error("statement inside a leading `try {` block).");
  console.error(
    '\nTo opt out: add "// @auth-anonymous-justification: <reason>" to the file.\n',
  );
  process.exit(1);
}

const handlerCount = files.filter((f) => {
  try {
    const c = readFileSync(f, "utf-8");
    return isHandlerFile(c);
  } catch {
    return false;
  }
}).length;

console.log(
  `check-api-auth: OK — ${handlerCount} handler(s) checked, 0 violations.`,
);
process.exit(0);
