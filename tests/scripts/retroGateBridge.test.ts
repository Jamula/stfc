// Coordinator-facing bridge tests (#248 Garak finding 4, round 3 — "add a
// coordinator-facing adapter with injectable stateList/stateRead callbacks
// and child-process runner, then test tool-call -> JSON stdin -> parsed
// overdue/action-item decision").
//
// Every test here calls scripts/retro-gate-bridge.mjs's exported functions
// with a FAKE stateList/stateRead callback (simulating squad_state_list /
// squad_state_read) and asserts the decision that comes back out the other
// side of a REAL spawned scripts/check-retro-overdue.mjs child process —
// not a reimplemented predicate, not an in-process function call standing
// in for the child boundary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkOverdueViaBridge, checkActionItemsViaBridge, runCliChild } from "../../scripts/retro-gate-bridge.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

describe("retro-gate-bridge: checkOverdueViaBridge — local/worktree (no stateList, real filesystem via the CLI)", () => {
  it("evaluates overdue:true for an empty log directory, through the real child process", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-local-"));
    try {
      const result = checkOverdueViaBridge({ backend: "local", repoRoot, logDir: dir });
      assert.equal(result.evaluated, true);
      assert.equal(result.overdue, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evaluates overdue:false when a fresh retrospective log is present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-local-"));
    try {
      const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const name = `${recent.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
      fs.writeFileSync(path.join(dir, name), "# retro\n");
      const result = checkOverdueViaBridge({ backend: "worktree", repoRoot, logDir: dir });
      assert.equal(result.evaluated, true);
      assert.equal(result.overdue, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a RELATIVE logDir against repoRoot, not the caller's own cwd (#248 Copilot review finding)", () => {
    const repoRelativeLogDir = fs.mkdtempSync(path.join(repoRoot, "tests", ".retro-gate-relative-"));
    const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-cwd-"));
    const previousCwd = process.cwd();
    try {
      const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const name = `${recent.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
      fs.writeFileSync(path.join(repoRelativeLogDir, name), "# retro\n");

      process.chdir(callerCwd);
      const result = checkOverdueViaBridge({
        backend: "local",
        repoRoot,
        logDir: path.relative(repoRoot, repoRelativeLogDir),
      });
      assert.equal(result.evaluated, true);
      assert.equal(result.overdue, false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(repoRelativeLogDir, { recursive: true, force: true });
      fs.rmSync(callerCwd, { recursive: true, force: true });
    }
  });
});

describe("retro-gate-bridge: checkOverdueViaBridge — non-local, via a fake stateList callback (squad_state_list shape)", () => {
  it("tool-call -> JSON stdin -> decision: a fake stateList returning a stale entry yields overdue:true", () => {
    const stateList = ({ dir }: { dir: string }) => {
      assert.equal(dir, "log", "the bridge must call stateList with the same shape as squad_state_list(dir: 'log')");
      return ["2020-01-01T00-00-00Z-retrospective.md"];
    };
    const result = checkOverdueViaBridge({ backend: "two-layer", repoRoot, stateList });
    assert.equal(result.evaluated, true);
    assert.equal(result.overdue, true);
  });

  it("tool-call -> JSON stdin -> decision: a fake stateList returning a fresh entry yields overdue:false", () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const name = `${recent.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
    const stateList = () => [name];
    const result = checkOverdueViaBridge({ backend: "orphan", repoRoot, stateList });
    assert.equal(result.evaluated, true);
    assert.equal(result.overdue, false);
  });

  it("evaluated:false (never fabricated) when stateList is missing for a non-local backend", () => {
    const result = checkOverdueViaBridge({ backend: "git-notes", repoRoot });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /stateList callback is required/);
  });

  it("evaluated:false when stateList itself throws", () => {
    const stateList = () => {
      throw new Error("simulated MCP tool failure");
    };
    const result = checkOverdueViaBridge({ backend: "two-layer", repoRoot, stateList });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /stateList failed/);
  });

  it("evaluated:false when stateList returns a non-array", () => {
    const stateList = () => "not-an-array" as unknown as string[];
    const result = checkOverdueViaBridge({ backend: "two-layer", repoRoot, stateList });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /must return an array/);
  });
});

describe("retro-gate-bridge: checkActionItemsViaBridge — local (real file) and non-local (fake stateRead)", () => {
  it("local backend reads a real retro log file through the CLI", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-content-"));
    try {
      const file = path.join(dir, "retro.md");
      fs.writeFileSync(file, "Fixed in #4242\n");
      const result = checkActionItemsViaBridge({ backend: "local", repoRoot, retroLogPath: file });
      assert.equal(result.evaluated, true);
      assert.equal(result.ok, true);
      assert.equal(result.issueRefCount, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a RELATIVE retroLogPath against repoRoot, not the caller's own cwd (#248 Copilot review finding)", () => {
    const relativeName = `bridge-retro-fixture-${Date.now()}.md`;
    const absolutePath = path.join(repoRoot, relativeName);
    fs.writeFileSync(absolutePath, "Fixed in #7\n");
    try {
      const result = checkActionItemsViaBridge({ backend: "local", repoRoot, retroLogPath: relativeName });
      assert.equal(result.evaluated, true, JSON.stringify(result));
      assert.equal(result.ok, true);
      assert.equal(result.issueRefCount, 1);
    } finally {
      fs.rmSync(absolutePath, { force: true });
    }
  });

  it("tool-call -> JSON stdin -> decision: a fake stateRead callback (squad_state_read shape) feeds content through the real CLI", () => {
    const stateRead = ({ key }: { key: string }) => {
      assert.equal(key, "log/2026-08-24T00-00-00Z-retrospective.md");
      return "- [ ] still open, not converted to an Issue\n";
    };
    const result = checkActionItemsViaBridge({
      backend: "two-layer",
      repoRoot,
      retroLogKey: "log/2026-08-24T00-00-00Z-retrospective.md",
      stateRead,
    });
    assert.equal(result.evaluated, true);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /checkbox/);
  });

  it("evaluated:false when stateRead is missing for a non-local backend", () => {
    const result = checkActionItemsViaBridge({ backend: "orphan", repoRoot });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /stateRead callback is required/);
  });

  it("evaluated:false when stateRead throws", () => {
    const stateRead = () => {
      throw new Error("simulated read failure");
    };
    const result = checkActionItemsViaBridge({ backend: "orphan", repoRoot, retroLogKey: "log/some-retro.md", stateRead });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /stateRead failed/);
  });

  it("evaluated:false when retroLogKey is missing for a non-local backend (#248 Copilot review: no canonical default retro log key exists)", () => {
    const stateRead = () => "irrelevant, must not be called";
    const result = checkActionItemsViaBridge({ backend: "orphan", repoRoot, stateRead });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /retroLogKey is required/);
  });

  it("evaluated:false when local backend is missing retroLogPath", () => {
    const result = checkActionItemsViaBridge({ backend: "local", repoRoot });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /retroLogPath is required/);
  });
});

describe("retro-gate-bridge: runCliChild — generic child-process runner", () => {
  it("returns ok:true and stdout for a successful invocation", () => {
    const scriptPath = path.join(repoRoot, "scripts", "check-retro-overdue.mjs");
    const result = runCliChild({ scriptPath, args: ["overdue", "--backend", "two-layer"], input: JSON.stringify({ entries: [] }) });
    assert.equal(result.ok, true);
    assert.match(result.stdout, /"evaluated":true/);
  });

  it("returns ok:false with captured stdout/status for a non-zero exit (fault), not a thrown error", () => {
    const scriptPath = path.join(repoRoot, "scripts", "check-retro-overdue.mjs");
    const result = runCliChild({ scriptPath, args: ["overdue", "--backend", "two-layer"], input: "not json" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 3);
    assert.match(result.stdout, /"evaluated":false/);
  });
});

describe("retro-gate-bridge: a nonzero child exit is never promoted to a valid decision, even with apparently-valid JSON on stdout (#248 Copilot review finding)", () => {
  it("checkOverdueViaBridge reports evaluated:false when the child exits nonzero despite printing valid-looking JSON", () => {
    const execFileSyncImpl = () => {
      const err = new Error("simulated nonzero exit");
      // @ts-expect-error -- simulating Node's execFileSync error shape
      err.status = 1;
      // @ts-expect-error
      err.stdout = JSON.stringify({ evaluated: true, backend: "two-layer", overdue: false, windowDays: 7 });
      // @ts-expect-error
      err.stderr = "";
      throw err;
    };
    const result = checkOverdueViaBridge({
      backend: "two-layer",
      repoRoot,
      stateList: () => [],
      execFileSyncImpl: execFileSyncImpl as unknown as (...a: unknown[]) => string,
    });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /exited with a fault/);
  });

  it("checkActionItemsViaBridge reports evaluated:false when the child exits nonzero despite printing valid-looking JSON", () => {
    const execFileSyncImpl = () => {
      const err = new Error("simulated nonzero exit");
      // @ts-expect-error
      err.status = 1;
      // @ts-expect-error
      err.stdout = JSON.stringify({ evaluated: true, backend: "orphan", ok: true, issueRefCount: 1, openCheckboxCount: 0 });
      // @ts-expect-error
      err.stderr = "";
      throw err;
    };
    const result = checkActionItemsViaBridge({
      backend: "orphan",
      repoRoot,
      retroLogKey: "log/some-retro.md",
      stateRead: () => "content with #123",
      execFileSyncImpl: execFileSyncImpl as unknown as (...a: unknown[]) => string,
    });
    assert.equal(result.evaluated, false);
    assert.match(result.fault ?? "", /exited with a fault/);
  });
});
