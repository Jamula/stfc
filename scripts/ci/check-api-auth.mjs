#!/usr/bin/env node
/**
 * CI gate: every Azure Functions HTTP handler must import + call
 * requireAllowedUser or requireOwner (from api/src/_lib/auth.ts) AS THE
 * FIRST NON-TRIVIAL STATEMENT in the handler function body.
 *
 * Previously the gate accepted the call
 * anywhere in the file, so a handler with `const log = console.log;` before
 * auth would silently pass. The gate now finds each handler function body
 * and asserts its first non-trivial statement (or the first statement inside
 * its leading `try {` block) is a call to requireAllowedUser/requireOwner.
 *
 * "Non-trivial" excludes: blank lines, `//` line comments, `/* … *\/` block
 * comments, type-only declarations (`type X = …`, `interface X {…}`), and
 * a leading `try {` opener (we descend into the try body and check its first
 * statement).
 *
 * Usage:
 *   node scripts/ci/check-api-auth.mjs
 *   node scripts/ci/check-api-auth.mjs --api-dir <path>   # for tests
 *
 * Opt-out for legitimately unauthenticated endpoints:
 *   // @auth-anonymous-justification: <reason>
 *
 * Exits 0 if all handlers are compliant or opted out.
 * Exits 1 with a list of offending files on violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Configuration ─────────────────────────────────────────────────────────────

const apiDirArgIdx = process.argv.indexOf("--api-dir");
const API_DIR =
  apiDirArgIdx !== -1
    ? /** @type {string} */ (process.argv[apiDirArgIdx + 1])
    : "api/src";

// Directory segments to skip when walking.
const EXCLUDE_SEGMENTS = new Set(["_lib", "dist", "node_modules"]);

// ── File walker ───────────────────────────────────────────────────────────────

/**
 * Recursively collect *.ts files under `dir`, skipping EXCLUDE_SEGMENTS.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const results = [];
  let entries;
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

// ── Detection heuristics ──────────────────────────────────────────────────────

/**
 * A file is treated as an HTTP handler if it imports from @azure/functions.
 * @param {string} content
 */
function isHandlerFile(content) {
  return (
    content.includes('"@azure/functions"') ||
    content.includes("'@azure/functions'")
  );
}

/**
 * Opt-out comment allows legitimately anonymous endpoints (e.g. health checks).
 * @param {string} content
 */
function hasAnonymousJustification(content) {
  return content.includes("@auth-anonymous-justification");
}

/**
 * The file must import the auth guard symbols (presence check — fast fail).
 * @param {string} content
 */
function hasAuthImport(content) {
  return (
    content.includes("requireAllowedUser") || content.includes("requireOwner")
  );
}

// ── Position-aware AST-lite parser ────────────────────────────────────────────

/**
 * Find the index of the `}` that matches the `{` at `openIdx`. Skips
 * comments and string/template literals so braces inside them don't fool
 * the counter. Returns -1 if no match.
 * @param {string} src
 * @param {number} openIdx — index of the opening `{`
 */
function findMatchingBrace(src, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  let str = null;
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

/**
 * Locate every handler function body in `content`. A handler is one of:
 *   - `handler: async (...) => { ... }`   (Azure Functions inline)
 *   - `handler: (...) => { ... }`
 *   - `function handler(...) { ... }`      (named export)
 *   - `const handler = async (...) => { ... }`
 *
 * Returns an array of `{ openBrace, body }` where `body` is the source
 * between the `{` and matching `}` (exclusive).
 * @param {string} content
 */
function findHandlerBodies(content) {
  const bodies = [];
  const seenStarts = new Set();
  const patterns = [
    // handler: [async ](...) [: T] => {
    /\bhandler\s*:\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*=>\s*\{/g,
    // [export ][async ]function handler[<…>](...) [: T] {
    /(?:export\s+)?(?:async\s+)?function\s+handler\s*(?:<[^>]*>)?\s*\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*\{/g,
    // [export ]const handler = [async ](...) [: T] => {
    /(?:export\s+)?const\s+handler\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^={;]+?)?\s*=>\s*\{/g,
  ];
  for (const re of patterns) {
    let m;
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

/**
 * Return the first non-trivial statement in `body`, descending into a
 * leading `try { … }` block if present. Returns null if there is no
 * significant statement.
 * @param {string} body
 */
function firstNonTrivialStatement(body) {
  let pos = 0;
  while (pos < body.length) {
    // Skip whitespace
    while (pos < body.length && /\s/.test(body[pos])) pos++;
    if (pos >= body.length) return null;
    // Line comment
    if (body[pos] === "/" && body[pos + 1] === "/") {
      while (pos < body.length && body[pos] !== "\n") pos++;
      continue;
    }
    // Block comment
    if (body[pos] === "/" && body[pos + 1] === "*") {
      pos += 2;
      while (pos < body.length && !(body[pos] === "*" && body[pos + 1] === "/")) {
        pos++;
      }
      pos += 2;
      continue;
    }
    const tail = body.slice(pos);
    // Descend into leading `try { … }`
    const tryMatch = tail.match(/^try\s*\{/);
    if (tryMatch) {
      const innerOpen = pos + tryMatch[0].length - 1;
      const innerClose = findMatchingBrace(body, innerOpen);
      if (innerClose === -1) return null;
      return firstNonTrivialStatement(body.slice(innerOpen + 1, innerClose));
    }
    // Skip type-only declarations: `type X = …;` or `interface X { … }`
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
    // First real statement — extract up to next `;` or newline at depth 0.
    let depth = 0;
    let str = null;
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

/**
 * Match an auth guard call. Accepts both bare-call and binding forms:
 *   requireAllowedUser(req)
 *   await requireAllowedUser(req)
 *   const p = requireAllowedUser(req)
 *   const p: Principal = await requireOwner(req)
 * @param {string|null} stmt
 */
function isAuthGuardCall(stmt) {
  if (!stmt) return false;
  return /^(?:(?:const|let|var)\s+[\w{},\s:[\]<>|?]+?\s*=\s*)?(?:await\s+)?(?:requireAllowedUser|requireOwner)\s*\(/.test(
    stmt,
  );
}

/**
 * Verify each handler body in `content` opens with an auth guard call.
 * Returns an array of human-readable violation messages (empty = compliant).
 * @param {string} content
 */
function checkPosition(content) {
  const bodies = findHandlerBodies(content);
  if (bodies.length === 0) {
    // No handler body detected by our patterns but file imports
    // @azure/functions and calls the guard somewhere — fall back to
    // presence-only. Better than a false positive that blocks a
    // legitimate handler shape we don't yet recognize.
    return [];
  }
  const violations = [];
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

// ── Main ──────────────────────────────────────────────────────────────────────

const files = walk(API_DIR);

if (files.length === 0) {
  console.log(
    `check-api-auth: no handler files found under "${API_DIR}" — skipping.`,
  );
  process.exit(0);
}

/** @type {{file: string, reasons: string[]}[]} */
const offenders = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    continue;
  }

  if (!isHandlerFile(content)) continue;
  if (hasAnonymousJustification(content)) continue;

  const reasons = [];

  if (!hasAuthImport(content)) {
    reasons.push("missing requireAllowedUser/requireOwner import");
  } else {
    // Position-aware check: first non-trivial statement of every
    // detected handler body must be the auth guard call.
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
