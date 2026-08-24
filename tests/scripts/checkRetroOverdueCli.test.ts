// Process-boundary behavioral tests for scripts/check-retro-overdue.mjs's
// CLI (issue #245; #248 Garak finding 2 — "the generic backend path is not
// callable by the coordinator" / "reserve nonzero exits for faults or
// document/test domain-result semantics").
//
// These tests spawn the actual script file as a child process (not just
// calling the exported JS functions in-process) — this is the concrete,
// documented JSON stdin/stdout bridge a coordinator with only MCP tools and
// a shell (no in-process JS import surface) would actually use.
//
// Covers: local backend (reads .squad/log/-style fixture dir directly),
// non-local backend via the {"entries": [...]}/{"content": "..."} stdin
// protocol, the 0/2/3 exit-code contract (0 = evaluated, 2 = usage error,
// 3 = fault — never conflated with the overdue/not-overdue domain result),
// UTC boundary, future-dated, and unparseable-filename cases, and the
// action-items subcommand end to end.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "check-retro-overdue.mjs");

function runCli(args: string[], { input }: { input?: string } = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    input: input ?? "",
  });
  let json: unknown = null;
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  try {
    json = JSON.parse(lastLine);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

describe("check-retro-overdue CLI — local backend, spawned as a real process", () => {
  it("exits 0 and reports overdue:true for an empty log directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cli-"));
    try {
      const { status, json } = runCli(["overdue", "--backend", "local", "--log-dir", dir]);
      assert.equal(status, 0, "evaluation success must exit 0, even when the domain result is 'overdue'");
      assert.deepEqual(json, { evaluated: true, backend: "local", overdue: true, windowDays: 7 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 and reports overdue:false when a fresh retrospective log is on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cli-"));
    try {
      const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const name = `${recent.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
      fs.writeFileSync(path.join(dir, name), "# retro\n#1234\n");
      const { status, json } = runCli(["overdue", "--backend", "local", "--log-dir", dir]);
      assert.equal(status, 0);
      assert.equal((json as { overdue: boolean }).overdue, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("worktree backend behaves identically to local", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cli-"));
    try {
      const { status, json } = runCli(["overdue", "--backend", "worktree", "--log-dir", dir]);
      assert.equal(status, 0);
      assert.equal((json as { backend: string }).backend, "worktree");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-retro-overdue CLI — non-local backend via documented JSON stdin bridge", () => {
  it("exits 0 with overdue:false when stdin supplies a recent entry (simulating squad_state_list output)", () => {
    const { status, json } = runCli(["overdue", "--backend", "two-layer"], {
      input: JSON.stringify({ entries: ["2026-08-22T00-00-00Z-retrospective.md"] }),
    });
    assert.equal(status, 0);
    assert.deepEqual(json, { evaluated: true, backend: "two-layer", overdue: false, windowDays: 7 });
  });

  it("exits 0 with overdue:true when stdin supplies only a stale entry", () => {
    const { status, json } = runCli(["overdue", "--backend", "orphan", "--window-days", "7"], {
      input: JSON.stringify({ entries: ["2020-01-01T00-00-00Z-retrospective.md"] }),
    });
    assert.equal(status, 0);
    assert.equal((json as { overdue: boolean }).overdue, true);
  });

  it("exits 3 (fault) — never 0 or the overdue value — when stdin JSON is malformed", () => {
    const { status, json } = runCli(["overdue", "--backend", "git-notes"], { input: "not json" });
    assert.equal(status, 3);
    assert.equal((json as { evaluated: boolean }).evaluated, false);
    assert.match((json as { fault: string }).fault, /invalid JSON/);
  });

  it("exits 3 (fault) when stdin JSON is missing the entries field", () => {
    const { status, json } = runCli(["overdue", "--backend", "two-layer"], { input: "{}" });
    assert.equal(status, 3);
    assert.match((json as { fault: string }).fault, /entries/);
  });

  it("exits 2 (usage error) when --backend is omitted entirely", () => {
    const { status } = runCli(["overdue"]);
    assert.equal(status, 2);
  });
});

describe("check-retro-overdue CLI — strict usage-error contract (#248 Garak round-3 finding 2)", () => {
  it("exits 2 for an unknown subcommand instead of silently defaulting to overdue", () => {
    const { status } = runCli(["overdu", "--backend", "local"]);
    assert.equal(status, 2, "a typo'd subcommand must not silently become the default overdue command");
  });

  it("exits 2 for an unknown option", () => {
    const { status } = runCli(["overdue", "--backend", "local", "--bogus-flag"]);
    assert.equal(status, 2);
  });

  it("exits 2 when --backend is given but its value is missing", () => {
    const { status } = runCli(["overdue", "--backend"]);
    assert.equal(status, 2);
  });

  it("exits 2 for an unsupported --backend value", () => {
    const { status } = runCli(["overdue", "--backend", "some-made-up-backend"]);
    assert.equal(status, 2);
  });

  it("exits 2 for a non-finite --window-days (NaN)", () => {
    const { status } = runCli(["overdue", "--backend", "local", "--window-days", "not-a-number"]);
    assert.equal(status, 2);
  });

  it("exits 2 for a zero --window-days", () => {
    const { status } = runCli(["overdue", "--backend", "local", "--window-days", "0"]);
    assert.equal(status, 2);
  });

  it("exits 2 for a negative --window-days", () => {
    const { status } = runCli(["overdue", "--backend", "local", "--window-days", "-3"]);
    assert.equal(status, 2);
  });

  it("exits 2 for local action-items with no --retro-log-path and no --content-stdin (a usage mistake, not a runtime fault)", () => {
    const { status } = runCli(["action-items", "--backend", "local"]);
    assert.equal(status, 2, "missing required arguments must be a usage error (2), not a runtime fault (3)");
  });

  it("still exits 3 (fault) for a local action-items path that legitimately cannot be read", () => {
    const { status, json } = runCli(["action-items", "--backend", "local", "--retro-log-path", "/definitely/does/not/exist.md"]);
    assert.equal(status, 3, "an unreadable file, once the arguments themselves are valid, is a runtime fault");
    assert.equal((json as { evaluated: boolean }).evaluated, false);
  });
});

describe("check-retro-overdue CLI — UTC boundary / future / unparseable, through the real process", () => {
  it("a future-dated retrospective log is rejected (never counted as recent) via the CLI", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const name = `${future.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
    const { status, json } = runCli(["overdue", "--backend", "two-layer"], {
      input: JSON.stringify({ entries: [name] }),
    });
    assert.equal(status, 0);
    assert.equal((json as { overdue: boolean }).overdue, true, "a future-dated log must never suppress the overdue gate");
  });

  it("an unparseable retrospective filename is treated as not-recent (fail closed) via the CLI", () => {
    const { status, json } = runCli(["overdue", "--backend", "two-layer"], {
      input: JSON.stringify({ entries: ["retrospective-final-FINAL.md"] }),
    });
    assert.equal(status, 0);
    assert.equal((json as { overdue: boolean }).overdue, true);
  });

  it("near-cutoff behavior via the CLI: a log safely within --window-days is not overdue, one safely outside it is (#248 Garak: spawned suite must cover the cutoff too)", () => {
    // A literal to-the-second boundary test against the CLI's real
    // wall-clock `Date.now()` would be flaky (test setup and the spawned
    // process observe slightly different "now" instants) — the exact,
    // deterministic to-the-second boundary is covered with a fixed `now`
    // in the pure-function suite (tests/scripts/checkRetroOverdue.test.ts).
    // This test instead proves the CLI process applies the same window
    // logic correctly near the edge, with enough margin (1 hour) to be
    // immune to process-spawn timing jitter.
    const windowDays = 7;
    const now = Date.now();
    const safelyWithinWindow = new Date(now - (windowDays * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)); // 1h inside
    const safelyOutsideWindow = new Date(now - (windowDays * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)); // 1h outside

    const withinName = `${safelyWithinWindow.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
    const outsideName = `${safelyOutsideWindow.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;

    const within = runCli(["overdue", "--backend", "two-layer", "--window-days", String(windowDays)], {
      input: JSON.stringify({ entries: [withinName] }),
    });
    const outside = runCli(["overdue", "--backend", "two-layer", "--window-days", String(windowDays)], {
      input: JSON.stringify({ entries: [outsideName] }),
    });

    assert.equal(within.status, 0);
    assert.equal(outside.status, 0);
    assert.equal((within.json as { overdue: boolean }).overdue, false, "a log 1h inside the window must not be overdue");
    assert.equal((outside.json as { overdue: boolean }).overdue, true, "a log 1h outside the window must be overdue");
  });
});

describe("check-retro-overdue CLI — action-items subcommand, spawned", () => {
  it("local backend reads content from a real file on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-cli-content-"));
    try {
      const file = path.join(dir, "retro.md");
      fs.writeFileSync(file, "Action items:\n- Fixed in #1234\n");
      const { status, json } = runCli(["action-items", "--backend", "local", "--retro-log-path", file]);
      assert.equal(status, 0);
      assert.equal((json as { ok: boolean }).ok, true);
      assert.equal((json as { issueRefCount: number }).issueRefCount, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("non-local backend reads content via the {\"content\": ...} stdin bridge", () => {
    const { status, json } = runCli(["action-items", "--backend", "two-layer"], {
      input: JSON.stringify({ content: "- [ ] not converted yet\n" }),
    });
    assert.equal(status, 0);
    assert.equal((json as { ok: boolean }).ok, false);
    assert.match((json as { reason: string }).reason, /checkbox/);
  });

  it("exits 3 when non-local action-items is called without content on stdin", () => {
    const { status, json } = runCli(["action-items", "--backend", "orphan"], { input: "{}" });
    assert.equal(status, 3);
    assert.match((json as { fault: string }).fault, /content/);
  });
});
