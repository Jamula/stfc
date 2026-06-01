#!/usr/bin/env node
/**
 * CI gate: every Azure Functions HTTP handler must import + call
 * requireAllowedUser or requireOwner (from api/src/_lib/auth.ts).
 *
 * Kirk required change #3: "Per-Function auth becomes a CI grep gate —
 * static check fails build if any api/**\/**.ts handler doesn't import +
 * call requireAllowedUser as first statement." (plan.md line 24)
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
 * This catches both `import { app } from "@azure/functions"` and
 * `import type { HttpRequest } from "@azure/functions"`.
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
 * The file must import the auth guard symbols (presence check).
 * @param {string} content
 */
function hasAuthImport(content) {
  return (
    content.includes("requireAllowedUser") || content.includes("requireOwner")
  );
}

/**
 * The file must call at least one auth guard function.
 * @param {string} content
 */
function hasAuthCall(content) {
  return (
    /requireAllowedUser\s*\(/.test(content) ||
    /requireOwner\s*\(/.test(content)
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = walk(API_DIR);

if (files.length === 0) {
  console.log(
    `check-api-auth: no handler files found under "${API_DIR}" — skipping.`,
  );
  process.exit(0);
}

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

  if (!hasAuthImport(content) || !hasAuthCall(content)) {
    offenders.push(relative(process.cwd(), file));
  }
}

if (offenders.length > 0) {
  console.error(
    "check-api-auth FAILED — the following handlers are missing requireAllowedUser/requireOwner:\n",
  );
  for (const f of offenders) {
    console.error(`  ✗  ${f}`);
  }
  console.error(
    "\nEvery HTTP handler must call requireAllowedUser() or requireOwner() from",
  );
  console.error("api/src/_lib/auth.ts as its first non-trivial statement.");
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
