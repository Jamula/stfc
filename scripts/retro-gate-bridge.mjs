/**
 * Coordinator-facing bridge for the retro-enforcement gate (#248 Garak
 * finding 4, round 3 — "add a coordinator-facing adapter with injectable
 * stateList/stateRead callbacks and child-process runner, then test tool-
 * call → JSON stdin → parsed overdue/action-item decision").
 *
 * This is the concrete shape an LLM coordinator with `squad_state_list`/
 * `squad_state_read` MCP tools and a shell — but no in-process JS import
 * surface — actually uses: call the injected tool callback, serialize its
 * result as JSON, pipe it on stdin to the real `check-retro-overdue.mjs`
 * child process, and parse the single line of JSON it prints to stdout.
 * `.squad/templates/ralph-triage.js`'s `evaluateRetroGate` is one concrete
 * consumer of this same pattern (specialized for its own CI-observable
 * `retro-action` GitHub issue signal); this module is the reusable,
 * directly-testable version of the pattern itself, decoupled from any one
 * caller.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync as defaultExecFileSync } from "node:child_process";

const CHECK_RETRO_OVERDUE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-retro-overdue.mjs");

const LOCAL_BACKENDS = new Set(["local", "worktree"]);

/** Generic child-process runner: spawn `node <scriptPath> <args>`, feeding `input` on stdin. */
export function runCliChild({ scriptPath, args, input, execFileSyncImpl = defaultExecFileSync }) {
  try {
    const stdout = execFileSyncImpl(process.execPath, [scriptPath, ...args], {
      encoding: "utf8",
      input: input ?? "",
    });
    return { ok: true, stdout };
  } catch (err) {
    // execFileSync throws on nonzero exit; recover stdout/stderr/status so
    // callers can distinguish "ran and returned a JSON fault" (status 3)
    // from "could not run at all" (e.g. ENOENT).
    return {
      ok: false,
      stdout: typeof err.stdout === "string" ? err.stdout : "",
      stderr: typeof err.stderr === "string" ? err.stderr : "",
      status: typeof err.status === "number" ? err.status : null,
      error: err,
    };
  }
}

function parseLastJsonLine(stdout) {
  const lastLine = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
  try {
    return JSON.parse(lastLine);
  } catch (err) {
    return null;
  }
}

/**
 * Tool-call → JSON stdin → parsed overdue decision, for ANY backend.
 *
 * - `local`/`worktree`: `stateList` is not called; the CLI reads
 *   `--log-dir` directly (this still goes through the real child process).
 * - Any other backend: `stateList({ dir: "log" })` is called (this is
 *   exactly the shape of the real `squad_state_list` MCP tool) and its
 *   returned entries are piped to the CLI as `{"entries": [...]}` on
 *   stdin — never assumed, never read from disk.
 *
 * Returns the coordinator's evaluation of the gate: `{ evaluated, backend,
 * overdue, windowDays? , fault? }`. A malformed/unparseable child result or
 * a stateList failure yields `evaluated: false`, never a fabricated
 * overdue/not-overdue value.
 */
export function checkOverdueViaBridge({
  backend,
  repoRoot,
  logDir,
  windowDays = 7,
  stateList,
  execFileSyncImpl = defaultExecFileSync,
}) {
  const scriptPath = repoRoot ? path.join(repoRoot, "scripts", "check-retro-overdue.mjs") : CHECK_RETRO_OVERDUE_SCRIPT;
  // A relative logDir must resolve against repoRoot, not the caller's own
  // cwd — otherwise a coordinator invoking this bridge from a different
  // working directory can spawn the intended repository's checker while
  // inspecting an unrelated directory's log (#248 Copilot review finding).
  const resolvedLogDir = repoRoot ? path.resolve(repoRoot, logDir ?? ".squad/log") : (logDir ?? ".squad/log");

  let input;
  const args = ["overdue", "--backend", backend, "--window-days", String(windowDays)];

  if (LOCAL_BACKENDS.has(backend)) {
    args.push("--log-dir", resolvedLogDir);
  } else {
    if (typeof stateList !== "function") {
      return { evaluated: false, backend, overdue: false, fault: "stateList callback is required for non-local backends" };
    }
    let entries;
    try {
      entries = stateList({ dir: "log" });
    } catch (err) {
      return { evaluated: false, backend, overdue: false, fault: `stateList failed: ${err.message}` };
    }
    if (!Array.isArray(entries)) {
      return { evaluated: false, backend, overdue: false, fault: "stateList must return an array of entry filenames" };
    }
    input = JSON.stringify({ entries });
  }

  const result = runCliChild({ scriptPath, args, input, execFileSyncImpl });
  if (!result.ok) {
    // A nonzero exit is a fault regardless of what the child printed
    // before exiting — parsing its stdout anyway would let a crashed or
    // killed child process still be promoted to a valid evaluated result
    // (#248 Copilot review finding: "the bridge ignores result.ok").
    return {
      evaluated: false,
      backend,
      overdue: false,
      fault: `check-retro-overdue.mjs exited with a fault (status ${result.status ?? "unknown"}): ${result.stderr || result.error?.message || "no stderr captured"}`,
    };
  }
  const parsed = parseLastJsonLine(result.stdout);

  if (!parsed || parsed.evaluated !== true || typeof parsed.overdue !== "boolean" || parsed.backend !== backend) {
    return {
      evaluated: false,
      backend,
      overdue: false,
      fault: parsed && parsed.fault ? parsed.fault : "check-retro-overdue.mjs did not return a valid evaluated result",
    };
  }

  return { evaluated: true, backend, overdue: parsed.overdue, windowDays };
}

/**
 * Tool-call → JSON stdin → parsed action-items decision, for ANY backend.
 * Mirrors `checkOverdueViaBridge`, using `stateRead({ key })` (the real
 * `squad_state_read` MCP tool's shape) instead of `stateList`.
 */
export function checkActionItemsViaBridge({
  backend,
  repoRoot,
  retroLogPath,
  retroLogKey,
  stateRead,
  execFileSyncImpl = defaultExecFileSync,
}) {
  const scriptPath = repoRoot ? path.join(repoRoot, "scripts", "check-retro-overdue.mjs") : CHECK_RETRO_OVERDUE_SCRIPT;

  let input;
  const args = ["action-items", "--backend", backend];

  if (LOCAL_BACKENDS.has(backend)) {
    if (!retroLogPath) {
      return { evaluated: false, backend, ok: false, fault: "retroLogPath is required for local/worktree backends" };
    }
    // As with logDir in checkOverdueViaBridge: a relative path must
    // resolve against repoRoot, not the caller's own cwd, or invoking this
    // bridge from a different working directory can verify an unrelated
    // file while spawning the intended repository's checker (#248 Copilot
    // review finding).
    const resolvedRetroLogPath = repoRoot ? path.resolve(repoRoot, retroLogPath) : retroLogPath;
    args.push("--retro-log-path", resolvedRetroLogPath);
  } else {
    if (typeof stateRead !== "function") {
      return { evaluated: false, backend, ok: false, fault: "stateRead callback is required for non-local backends" };
    }
    // For a governed backend there is no canonical "the retro log" key --
    // logs are timestamped, and only the caller knows which retro is
    // actually being verified. Silently substituting an invented default
    // key can read an unrelated object and misreport ok:true (#248
    // Copilot review finding), so retroLogKey is required here, not
    // defaulted.
    if (typeof retroLogKey !== "string" || retroLogKey.length === 0) {
      return { evaluated: false, backend, ok: false, fault: "retroLogKey is required for non-local backends (no canonical default retro log key exists)" };
    }
    let content;
    try {
      content = stateRead({ key: retroLogKey });
    } catch (err) {
      return { evaluated: false, backend, ok: false, fault: `stateRead failed: ${err.message}` };
    }
    if (typeof content !== "string") {
      return { evaluated: false, backend, ok: false, fault: "stateRead must return a string" };
    }
    input = JSON.stringify({ content });
  }

  const result = runCliChild({ scriptPath, args, input, execFileSyncImpl });
  if (!result.ok) {
    // As in checkOverdueViaBridge: a failed child must never be promoted
    // to a valid action-item decision merely because it produced JSON
    // before exiting nonzero (#248 Copilot review finding).
    return {
      evaluated: false,
      backend,
      ok: false,
      fault: `check-retro-overdue.mjs exited with a fault (status ${result.status ?? "unknown"}): ${result.stderr || result.error?.message || "no stderr captured"}`,
    };
  }
  const parsed = parseLastJsonLine(result.stdout);

  if (!parsed || parsed.evaluated !== true || typeof parsed.ok !== "boolean" || parsed.backend !== backend) {
    return {
      evaluated: false,
      backend,
      ok: false,
      fault: parsed && parsed.fault ? parsed.fault : "check-retro-overdue.mjs did not return a valid evaluated result",
    };
  }

  return {
    evaluated: true,
    backend,
    ok: parsed.ok,
    reason: parsed.reason ?? null,
    issueRefCount: parsed.issueRefCount,
    openCheckboxCount: parsed.openCheckboxCount,
  };
}
