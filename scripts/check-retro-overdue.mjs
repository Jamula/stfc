/**
 * Backend-aware, testable implementation of the retro-enforcement skill's
 * Test-RetroOverdue / Test-RetroActionItemsCreated checks (issue #245; #248
 * Garak finding 2 — "the state-backend branch is described, not
 * implemented, and its clocks are unsafe").
 *
 * .squad/skills/retro-enforcement/SKILL.md documents the PowerShell shape of
 * these checks for a coordinator reading prose. This module is the single
 * concrete, testable implementation both the coordinator (via the CLI entry
 * point below) and the test suite actually call — the PowerShell stays
 * illustrative, this is load-bearing.
 *
 * Design: the decision logic (`isRetroOverdue`, `checkActionItemsCreated`) is
 * pure and backend-agnostic — it only ever looks at filenames/content
 * already in hand. `local`/`worktree` backends get those filenames from a
 * thin filesystem reader (`listLocalRetroLogs`) because the checked-out
 * `.squad/log/` tree *is* the state for those backends. `orphan`/`two-layer`/
 * `git-notes` backends cannot be read from a standalone Node process at
 * all — `squad_state_list`/`squad_state_read` are MCP tools only available
 * to the running coordinator — so `checkRetroOverdue` requires the caller to
 * fetch entries via those tools first and pass them in. That boundary IS the
 * adapter: I/O is backend-specific, the overdue decision is not.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Matches any log filename that represents a retrospective, any backend. */
export const RETRO_FILENAME_PATTERN = /retrospective/i;

// Canonical format written today: 2026-08-23T19-01-46Z-retrospective.md
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/;
// Legacy format seen in older .squad/log/ entries: 20260823-190146-retrospective.md
const LEGACY_TIMESTAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

/**
 * Parse the leading timestamp out of a log filename, explicitly in UTC.
 * Returns `null` if the filename does not match either documented format —
 * callers MUST treat `null` as "not recent" (fail closed on ambiguity), per
 * the skill's documented timestamp-parsing note. Never falls back to
 * filesystem mtime: mtime reflects checkout/touch time, not log creation
 * time, and would make an old tracked retro look fresh after a fresh clone.
 */
export function parseLogTimestamp(filename) {
  const base = path.basename(filename);
  let m = ISO_TIMESTAMP_RE.exec(base);
  if (!m) m = LEGACY_TIMESTAMP_RE.exec(base);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  // Reject calendar-invalid values (e.g. month 13, day 32) that the regex's
  // digit groups would otherwise accept — Date.UTC silently rolls those over.
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d) ||
    date.getUTCHours() !== Number(h) ||
    date.getUTCMinutes() !== Number(mi) ||
    date.getUTCSeconds() !== Number(s)
  ) {
    return null;
  }
  return date;
}

/**
 * Pure decision: given a list of log filenames (from any backend), is the
 * retrospective overdue?
 *
 * - Entries not matching `*retrospective*` are ignored.
 * - Entries whose timestamp cannot be parsed are treated as NOT recent
 *   (fail closed on ambiguity — never assumed to satisfy the window).
 * - Entries dated in the future (relative to `now`) are rejected outright —
 *   a clock-skewed or malformed future timestamp must never suppress the
 *   gate.
 */
export function isRetroOverdue({ entries, windowDays = 7, now = new Date() }) {
  if (!Array.isArray(entries)) {
    throw new TypeError("isRetroOverdue: entries must be an array of filenames");
  }
  const nowMs = now.getTime();
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const hasRecentRetro = entries.some((name) => {
    if (!RETRO_FILENAME_PATTERN.test(name)) return false;
    const ts = parseLogTimestamp(name);
    if (ts === null) return false; // unparseable => fail closed => not recent
    const ms = ts.getTime();
    if (ms > nowMs) return false; // future dates never count as "recent"
    return ms >= cutoffMs;
  });

  return !hasRecentRetro;
}

const LOCAL_BACKENDS = new Set(["local", "worktree"]);

/** Filesystem reader for `local`/`worktree` backends. Missing directory (ENOENT) means an empty log — genuinely no retro yet. Any other read error (permissions, I/O) is a real fault and must propagate, not be silently treated as "no logs" (#248 Copilot review finding). */
export function listLocalRetroLogs(logDir) {
  let names;
  try {
    names = fs.readdirSync(logDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new Error(`could not read log directory "${logDir}": ${err.message}`);
  }
  return names.filter((n) => RETRO_FILENAME_PATTERN.test(n));
}

/**
 * The backend-aware adapter. `entries`, when provided, always wins (this is
 * what lets a coordinator running under a governed backend pass in the
 * result of `squad_state_list(dir: "log")`, and what lets tests inject fixed
 * fixtures for the local case too). When `entries` is omitted:
 *   - `local`/`worktree` → read `logDir` off disk.
 *   - anything else → throw, because there is no way to read runtime state
 *     from a standalone script; the caller must supply `entries`.
 */
export function checkRetroOverdue({ backend, logDir = ".squad/log", entries, windowDays = 7, now = new Date() }) {
  if (entries !== undefined) {
    return isRetroOverdue({ entries, windowDays, now });
  }
  if (LOCAL_BACKENDS.has(backend)) {
    return isRetroOverdue({ entries: listLocalRetroLogs(logDir), windowDays, now });
  }
  throw new Error(
    `checkRetroOverdue: backend "${backend}" is not filesystem-backed. Fetch entries via ` +
      `squad_state_list(dir: "log") and pass them as { entries } — this script cannot reach ` +
      `governed state tools directly.`,
  );
}

// ── Test-RetroActionItemsCreated equivalent ───────────────────────────────

const ISSUE_REF_RE = /(?:#\d+|issues\/\d+)/g;
const OPEN_CHECKBOX_RE = /^[ \t]*[-+*][ \t]+\[[ \t]\]/gm;

/**
 * Checks retro log content for GitHub Issue references and flags leftover
 * open markdown checkboxes (the anti-pattern the skill exists to replace).
 */
export function checkActionItemsCreated(content) {
  const issueRefs = [...content.matchAll(ISSUE_REF_RE)];
  const openCheckboxes = [...content.matchAll(OPEN_CHECKBOX_RE)];

  if (openCheckboxes.length > 0) {
    return {
      ok: false,
      reason: `found ${openCheckboxes.length} open markdown checkbox(es) — convert to GitHub Issues`,
      issueRefCount: issueRefs.length,
      openCheckboxCount: openCheckboxes.length,
    };
  }
  return {
    ok: issueRefs.length > 0,
    reason: issueRefs.length > 0 ? null : "no GitHub Issue references found in retro log",
    issueRefCount: issueRefs.length,
    openCheckboxCount: 0,
  };
}

/**
 * Backend-aware content read for `Test-RetroActionItemsCreated`. Same shape
 * as `checkRetroOverdue`: pass `content` directly (governed-backend caller,
 * or a test) or let this read the file for `local`/`worktree`.
 */
export function readRetroLogContent({ backend, retroLogPath, content }) {
  if (content !== undefined) return content;
  if (LOCAL_BACKENDS.has(backend)) return fs.readFileSync(retroLogPath, "utf8");
  throw new Error(
    `readRetroLogContent: backend "${backend}" is not filesystem-backed. Fetch content via ` +
      `squad_state_read(key: "log/{filename}") and pass it as { content }.`,
  );
}

// ── CLI entry point ────────────────────────────────────────────────────────
//
// Documented protocol (#248 Garak finding 2 — "the generic backend path is
// not callable by the coordinator"; a coordinator has MCP/state tools and a
// shell, not an in-process JS import surface, so this is the concrete
// callable bridge):
//
//   node scripts/check-retro-overdue.mjs overdue --backend <backend> [--log-dir DIR] [--window-days N] [--entries-stdin]
//   node scripts/check-retro-overdue.mjs action-items --backend <backend> [--retro-log-path PATH] [--content-stdin]
//
// - `local`/`worktree`: reads the filesystem directly (`--log-dir` /
//   `--retro-log-path`); `--entries-stdin`/`--content-stdin` are optional
//   overrides (mainly for tests).
// - Any other backend (`orphan`, `two-layer`, `git-notes`): the caller (the
//   coordinator, which has `squad_state_list`/`squad_state_read`) MUST fetch
//   the data itself and pipe it in as JSON on stdin:
//     `overdue`:       {"entries": ["2026-08-23T19-01-46Z-retrospective.md", ...]}
//     `action-items`:  {"content": "...raw retro log markdown..."}
//   This CLI has no MCP access and never contacts a governed backend itself.
//
// Exit-code protocol (#248 Garak findings 1 and 2 — "exit 1 for overdue is
// indistinguishable from an ordinary command failure" / "the CLI protocol
// is not unambiguous yet"):
//   0 = evaluated successfully. The domain result (overdue: true/false, or
//       ok: true/false) is in the single line of JSON printed to stdout —
//       callers MUST parse stdout, never infer the result from the exit code.
//   2 = usage error: unknown command/option, a flag missing its required
//       value, an unsupported --backend, or a non-positive/non-finite
//       --window-days. Always a caller mistake, never data-dependent.
//   3 = runtime fault: non-local backend without usable stdin input,
//       malformed stdin JSON, or an unreadable local file/dir. Always
//       data/environment-dependent, never a valid "overdue"/"ok" result.
const VALID_BACKENDS = new Set(["local", "worktree", "orphan", "two-layer", "git-notes"]);
const KNOWN_COMMANDS = new Set(["overdue", "action-items"]);
const KNOWN_FLAGS = new Set([
  "--backend",
  "--log-dir",
  "--window-days",
  "--retro-log-path",
  "--entries-stdin",
  "--content-stdin",
]);

class CliUsageError extends Error {}

function parseArgs(argv) {
  const args = {
    command: "overdue",
    backend: undefined,
    logDir: ".squad/log",
    windowDays: 7,
    retroLogPath: undefined,
    useStdin: false,
  };

  let i = 0;
  if (argv[0] !== undefined && !argv[0].startsWith("--")) {
    if (!KNOWN_COMMANDS.has(argv[0])) {
      throw new CliUsageError(`unknown command "${argv[0]}" (expected "overdue" or "action-items")`);
    }
    args.command = argv[0];
    i = 1;
  }

  // A flag's value must not itself look like another flag -- otherwise
  // `--log-dir --entries-stdin` would silently read a directory literally
  // named "--entries-stdin" and treat that as the (missing) value instead
  // of rejecting it as a usage error (#248 Copilot review finding).
  function takeValue(flagName, currentIndex) {
    const v = argv[currentIndex + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new CliUsageError(`${flagName} requires a value`);
    }
    return v;
  }

  for (; i < argv.length; i++) {
    const a = argv[i];
    if (!KNOWN_FLAGS.has(a)) {
      throw new CliUsageError(`unknown option "${a}"`);
    }
    if (a === "--backend") {
      const v = takeValue("--backend", i);
      i++;
      if (!VALID_BACKENDS.has(v)) {
        throw new CliUsageError(`unsupported backend "${v}" (expected one of: ${[...VALID_BACKENDS].join(", ")})`);
      }
      args.backend = v;
    } else if (a === "--log-dir") {
      const v = takeValue("--log-dir", i);
      i++;
      args.logDir = v;
    } else if (a === "--window-days") {
      const raw = takeValue("--window-days", i);
      i++;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new CliUsageError(`--window-days must be a positive finite number, got "${raw}"`);
      }
      args.windowDays = n;
    } else if (a === "--retro-log-path") {
      const v = takeValue("--retro-log-path", i);
      i++;
      args.retroLogPath = v;
    } else if (a === "--entries-stdin" || a === "--content-stdin") {
      args.useStdin = true;
    }
  }

  if (!args.backend) throw new CliUsageError("--backend is required");

  if (args.command === "action-items" && LOCAL_BACKENDS.has(args.backend) && !args.useStdin && !args.retroLogPath) {
    throw new CliUsageError("--retro-log-path is required for action-items with a local/worktree backend (or pass --content-stdin)");
  }

  return args;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function readAllStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function printJsonResult(obj) {
  console.log(JSON.stringify(obj));
}

function runOverdueCommand(args) {
  let entries;
  if (!LOCAL_BACKENDS.has(args.backend) || args.useStdin) {
    const raw = readAllStdin();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      printJsonResult({ evaluated: false, fault: `invalid JSON on stdin: ${err.message}` });
      process.exit(3);
    }
    if (!Array.isArray(parsed.entries)) {
      printJsonResult({ evaluated: false, fault: 'stdin JSON must be {"entries": [...]} for non-local backends' });
      process.exit(3);
    }
    entries = parsed.entries;
  }

  try {
    const overdue = checkRetroOverdue({ backend: args.backend, logDir: args.logDir, entries, windowDays: args.windowDays });
    printJsonResult({ evaluated: true, backend: args.backend, overdue, windowDays: args.windowDays });
    process.exit(0);
  } catch (err) {
    printJsonResult({ evaluated: false, backend: args.backend, fault: err.message });
    process.exit(3);
  }
}

function runActionItemsCommand(args) {
  let content;
  if (!LOCAL_BACKENDS.has(args.backend) || args.useStdin) {
    const raw = readAllStdin();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      printJsonResult({ evaluated: false, fault: `invalid JSON on stdin: ${err.message}` });
      process.exit(3);
    }
    if (typeof parsed.content !== "string") {
      printJsonResult({ evaluated: false, fault: 'stdin JSON must be {"content": "..."} for non-local backends' });
      process.exit(3);
    }
    content = parsed.content;
  }

  try {
    const resolvedContent = readRetroLogContent({ backend: args.backend, retroLogPath: args.retroLogPath, content });
    const result = checkActionItemsCreated(resolvedContent);
    printJsonResult({ evaluated: true, backend: args.backend, ...result });
    process.exit(0);
  } catch (err) {
    printJsonResult({ evaluated: false, backend: args.backend, fault: err.message });
    process.exit(3);
  }
}

if (isMainModule()) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Usage error: ${err.message}`);
    console.error(
      "Usage: node check-retro-overdue.mjs <overdue|action-items> --backend <local|worktree|orphan|two-layer|git-notes> [options]",
    );
    process.exit(2);
  }

  if (args.command === "action-items") {
    runActionItemsCommand(args);
  } else {
    runOverdueCommand(args);
  }
}
