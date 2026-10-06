/**
 * Tests for pre-commit enforcement checks (#9, #10, #11).
 *
 * The check functions are pure-ish: they read staged file lists, env vars,
 * and the filesystem. We use node:test mocking to isolate them.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────

/** Capture process.exit calls instead of actually exiting. */
function captureExit(): { code: number | null } {
  const state = { code: null as number | null };
  mock.method(process, "exit", ((c: number) => {
    state.code = c;
    throw new Error(`process.exit(${c})`);
  }) as any);
  return state;
}

// ── #9 — Squad boundary ─────────────────────────────────────────────

describe("checkSquadBoundary", () => {
  let checkSquadBoundary: (staged: string[], deleted?: string[], renamedFrom?: string[]) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkSquadBoundary = mod.checkSquadBoundary;
    delete process.env.SQUAD_SCRIBE;
  });

  afterEach(() => {
    delete process.env.SQUAD_SCRIBE;
    mock.restoreAll();
  });

  it("passes for non-.squad/ files", () => {
    checkSquadBoundary(["src/index.ts", "package.json"]);
    assert.equal(exitState.code, null);
  });

  it("passes for normal .squad/ static config", () => {
    checkSquadBoundary([
      ".squad/team.md",
      ".squad/routing.md",
      ".squad/ceremonies.md",
      ".squad/casting/policy.json",
      ".squad/casting/registry.json",
      ".squad/agents/bashir/charter.md",
      ".squad/templates/history.md",
      ".squad/rai/policy.md",
      ".squad/plugins/marketplaces.json",
    ]);
    assert.equal(exitState.code, null);
  });

  it("rejects .squad/agents/*/history.md", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/agents/scotty/history.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects the canonical decisions ledger", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/decisions/decisions.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  // ── Deletion handling via parseNameStatus (PR #314 reviewer finding) ─
  //
  // The reviewer flagged that `checkSquadBoundary(deleted, deleted)` — i.e.
  // passing the SAME array for both the `staged` and `deleted` parameters —
  // is a shape `parseNameStatus` never actually produces: a `D` entry is
  // recorded in `deleted`, and the deletion allowlist only has any effect
  // when that same path is also present in `staged` (see `checkSquadBoundary`
  // doc comment). Driving these tests through the real `parseNameStatus`
  // output exercises the actual wiring instead of an impossible hand-built
  // shape, so a parser regression that stops forwarding deleted paths into
  // `staged` fails here instead of being masked.
  describe("deletion handling (driven by the real parseNameStatus output)", () => {
    let parseNameStatus: (raw: string) => {
      staged: string[];
      deleted: string[];
      renamedFrom: string[];
    };
    let MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST: Set<string>;

    beforeEach(async () => {
      const mod = await import("../../scripts/pre-commit-checks.mjs");
      parseNameStatus = mod.parseNameStatus;
      MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST = mod.MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST;
    });

    /** Build `git diff --name-status -z` raw output for a list of `D` paths. */
    function deletionDiff(paths: string[]): string {
      return paths.flatMap((p) => ["D", p]).concat("").join("\0");
    }

    it("parses a deleted mutable path into both staged (changed paths) and deleted", () => {
      // A `D` status means the path leaves the tree, but it must still be
      // considered among the "changed paths" the boundary check inspects —
      // otherwise the allowlist membership test in checkSquadBoundary
      // (`deletedPaths.has(f) && ALLOWLIST.has(f)`) can never be reached for
      // a real diff, because `f` is drawn from `staged`.
      const mutablePath = ".squad/agents/scotty/history.md";
      const { staged, deleted } = parseNameStatus(deletionDiff([mutablePath]));
      assert.ok(staged.includes(mutablePath), "expected the deleted path to appear in staged");
      assert.ok(deleted.includes(mutablePath), "expected the deleted path to appear in deleted");
    });

    it("allows a real staged deletion of the canonical decisions ledger", () => {
      const { staged, deleted, renamedFrom } = parseNameStatus(
        deletionDiff([".squad/decisions/decisions.md"]),
      );
      checkSquadBoundary(staged, deleted, renamedFrom);
      assert.equal(exitState.code, null);
    });

    it("allows real staged deletions of every enumerated migration allowlist entry", () => {
      // Exercise the full allowlist at once (rather than a single sample
      // entry) so an entry added to the Set without end-to-end coverage
      // still gets exercised here.
      const allowlisted = [...MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST];
      const { staged, deleted, renamedFrom } = parseNameStatus(deletionDiff(allowlisted));
      checkSquadBoundary(staged, deleted, renamedFrom);
      assert.equal(exitState.code, null);
    });

    it("rejects real staged deletions of non-allowlisted mutable state paths", () => {
      // NOTE: paths here must stay OUTSIDE MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST
      // (the one-time migration allowlist) so this test keeps validating that
      // non-allowlisted mutable-state deletions are still rejected.
      const deletedPaths = [
        ".squad/agents/scotty/history.md",
        ".squad/sessions/2026-05-16.json",
        ".squad/log/2026-05-16.md",
        ".squad/fact-checker/audit-trail.md",
      ];
      for (const path of deletedPaths) {
        assert.ok(
          !MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(path),
          `fixture bug: ${path} must not be in the deletion allowlist`,
        );
      }
      const errors: string[] = [];
      mock.method(console, "error", (msg: string) => errors.push(msg));
      const { staged, deleted, renamedFrom } = parseNameStatus(deletionDiff(deletedPaths));

      assert.throws(
        () => checkSquadBoundary(staged, deleted, renamedFrom),
        /process\.exit\(1\)/,
      );
      assert.equal(exitState.code, 1);
      for (const file of deletedPaths) {
        assert.ok(errors.join("\n").includes(`- ${file}`), `expected ${file} to be rejected`);
      }
    });

    it("still rejects staged mutable-state content alongside an allowlisted deletion", () => {
      const errors: string[] = [];
      mock.method(console, "error", (msg: string) => errors.push(msg));
      const raw = [
        "D",
        ".squad/decisions/decisions.md",
        "A",
        ".squad/log/2026-05-16.md",
        "",
      ].join("\0");
      const { staged, deleted, renamedFrom } = parseNameStatus(raw);

      assert.throws(
        () => checkSquadBoundary(staged, deleted, renamedFrom),
        /process\.exit\(1\)/,
      );
      assert.equal(exitState.code, 1);
      assert.match(errors.join("\n"), /\.squad\/log\/2026-05-16\.md/);
      assert.doesNotMatch(errors.join("\n"), /\.squad\/decisions\/decisions\.md/);
    });

    // ── .squad/memory/ migration entries (PR #314 reviewer finding) ───
    //
    // `.squad/memory/config.json` is the static policy file and must never
    // be treated as mutable state (see MUTABLE_SQUAD_STATE_PATTERNS' negative
    // lookahead); every other `.squad/memory/` path, including the two
    // index/audit files migrated off direct tracking here, remains guarded
    // and must be explicitly allowlisted to be deleted.
    it("allows real staged deletions of .squad/memory/index.json and .squad/memory/audit.jsonl", () => {
      for (const path of [".squad/memory/index.json", ".squad/memory/audit.jsonl"]) {
        assert.ok(
          MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(path),
          `expected ${path} to be in the migration deletion allowlist`,
        );
      }
      const { staged, deleted, renamedFrom } = parseNameStatus(
        deletionDiff([".squad/memory/index.json", ".squad/memory/audit.jsonl"]),
      );
      checkSquadBoundary(staged, deleted, renamedFrom);
      assert.equal(exitState.code, null);
    });

    it("never guards .squad/memory/config.json, so its real staged deletion is always allowed", () => {
      // config.json is excluded from MUTABLE_SQUAD_STATE_PATTERNS entirely,
      // so it is not guarded at all (deleting it is an ordinary, allowed
      // change) — confirm that remains true and it needs no allowlist entry.
      const { staged, deleted, renamedFrom } = parseNameStatus(
        deletionDiff([".squad/memory/config.json"]),
      );
      checkSquadBoundary(staged, deleted, renamedFrom);
      assert.equal(exitState.code, null);
      assert.ok(
        !MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(".squad/memory/config.json"),
        "config.json should not need a deletion allowlist entry — it is never guarded",
      );
    });
  });

  it("rejects the legacy .squad/decisions.md path", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/decisions.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects .squad/decisions/inbox/*", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/decisions/inbox/001.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects .squad/log/*", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/log/2026-05-16.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects .squad/orchestration-log/*", () => {
    assert.throws(
      () => checkSquadBoundary([".squad/orchestration-log/session.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects .squad/worktree-inbox/*", () => {
    // The two-layer/orphan backend's worktree-inbox shuttles worktree-local
    // writes back to the owning branch; it is backend-owned runtime state
    // and must never be committed from a worktree checkout directly.
    assert.throws(
      () => checkSquadBoundary([".squad/worktree-inbox/2026-06-02T000000Z-obrien.md"]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects mutable state paths even when SQUAD_SCRIBE=1 is set", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));
    process.env.SQUAD_SCRIBE = "1";

    const mutableStatePaths = [
      ".squad/agents/scotty/history.md",
      ".squad/agents/scotty/history-archive.md",
      ".squad/casting/history.json",
      ".squad/decisions/decisions.md",
      ".squad/decisions.md",
      ".squad/decisions/inbox/001.md",
      ".squad/identity/now.md",
      ".squad/log/2026-05-16.md",
      ".squad/memory/index.json",
      ".squad/orchestration-log/session.md",
      ".squad/worktree-inbox/2026-06-02T000000Z-obrien.md",
      ".squad/sessions/session-001.md",
      ".squad/.scratch/output.json",
      ".squad/.cache/index.json",
      ".squad/.watch-pids",
      ".squad/ralph-circuit-breaker.json",
      ".squad/rai/audit-trail.md",
      ".squad/fact-checker/audit-trail.md",
    ];

    assert.throws(
      () => checkSquadBoundary(mutableStatePaths),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);

    const output = errors.join("\n");
    for (const file of mutableStatePaths) {
      assert.ok(output.includes(`- ${file}`), `expected ${file} to be rejected`);
    }
    assert.match(output, /configured state backend/i);
    assert.match(output, /not staged or committed/i);
    assert.doesNotMatch(output, /SQUAD_SCRIBE=1|\[scribe\]|only scribe can commit/i);
  });

  // ── Rename/copy bypass (PR #314 review) ─────────────────────────────
  //
  // `git diff --name-status` rename detection reports only the destination
  // path for a rename; `--diff-filter=D` excludes renames entirely. Without
  // checking the rename's *source* path too, mutable Squad state could be
  // renamed onto an ordinary tracked path and slip past the guard — the
  // destination doesn't match a mutable pattern, and the source never
  // appears in a plain `--name-only`/`--diff-filter=D` staged list.

  it("rejects a rename whose source is mutable state, even onto an ordinary path", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkSquadBoundary(
          ["docs/ordinary.md"],
          [],
          [".squad/agents/scotty/history.md"],
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /\.squad\/agents\/scotty\/history\.md/);
  });

  it("rejects a renamed-away mutable source even when it is in the deletion allowlist", () => {
    // The deletion allowlist is reserved for genuine `git rm --cached`
    // untracking (no replacement content). A rename still commits new
    // content under the destination name, so the allowlist must not apply.
    assert.throws(
      () =>
        checkSquadBoundary(
          ["docs/renamed-ledger.md"],
          [".squad/decisions/decisions.md"],
          [".squad/decisions/decisions.md"],
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("passes for an ordinary rename whose source was never mutable state", () => {
    checkSquadBoundary(["docs/renamed.md"], [], ["docs/original.md"]);
    assert.equal(exitState.code, null);
  });

  it("passes for a rename-within-ordinary-paths alongside an unrelated staged file", () => {
    checkSquadBoundary(
      ["src/index.ts", "docs/renamed.md"],
      [],
      ["docs/original.md"],
    );
    assert.equal(exitState.code, null);
  });
});

// ── parseNameStatus ────────────────────────────────────────────────────

describe("parseNameStatus", () => {
  let parseNameStatus: (raw: string) => {
    staged: string[];
    deleted: string[];
    renamedFrom: string[];
  };

  beforeEach(async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    parseNameStatus = mod.parseNameStatus;
  });

  it("parses added/modified/deleted entries, including the deleted path in staged", () => {
    // A `D` entry must land in BOTH `staged` and `deleted`: `staged` is every
    // path the boundary check inspects, and the deletion allowlist is keyed
    // on a path being present in both (see checkSquadBoundary's doc comment
    // and PR #314 review — without this, the allowlist membership check
    // is unreachable for any real `git diff` output).
    const raw = ["A", "src/new.ts", "M", "src/existing.ts", "D", "src/old.ts", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["src/new.ts", "src/existing.ts", "src/old.ts"],
      deleted: ["src/old.ts"],
      renamedFrom: [],
    });
  });

  it("parses a rename into both staged (destination) and renamedFrom (source)", () => {
    const raw = ["R100", ".squad/agents/scotty/history.md", "docs/ordinary.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/ordinary.md"],
      deleted: [],
      renamedFrom: [".squad/agents/scotty/history.md"],
    });
  });

  it("parses a copy the same way as a rename (destination staged, source tracked)", () => {
    const raw = ["C100", "docs/template.md", "docs/copy.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/copy.md"],
      deleted: [],
      renamedFrom: ["docs/template.md"],
    });
  });

  it("handles a mix of statuses in one diff, including the deleted path in staged", () => {
    const raw = [
      "A",
      "src/new.ts",
      "R087",
      ".squad/identity/now.md",
      "docs/moved.md",
      "D",
      "src/old.ts",
      "",
    ].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["src/new.ts", "docs/moved.md", "src/old.ts"],
      deleted: ["src/old.ts"],
      renamedFrom: [".squad/identity/now.md"],
    });
  });

  it("returns empty lists for empty input", () => {
    assert.deepEqual(parseNameStatus(""), { staged: [], deleted: [], renamedFrom: [] });
  });
});

// ── #13 — Untracked/ignored mutable-state copy detection ────────────
//
// `-C --find-copies-harder` only searches for copy sources among blobs
// that are part of the diff (tracked content). An ignored/untracked
// mutable-state file was never part of any diff, so Git's own copy
// detection can never report it as a source. These tests exercise the
// content-hash-based check that closes that gap.

describe("parseRawDiffDestHashes", () => {
  let parseRawDiffDestHashes: (raw: string) => Map<string, string>;

  beforeEach(async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    parseRawDiffDestHashes = mod.parseRawDiffDestHashes;
  });

  it("maps an added file to its post-image blob hash", () => {
    const sha = "b".repeat(40);
    const raw = [`:000000 100644 ${"0".repeat(40)} ${sha} A`, "docs/new.md", ""].join("\0");
    assert.deepEqual(parseRawDiffDestHashes(raw), new Map([["docs/new.md", sha]]));
  });

  it("maps a modified file to its post-image blob hash", () => {
    const sha = "c".repeat(40);
    const raw = [`:100644 100644 ${"a".repeat(40)} ${sha} M`, "docs/existing.md", ""].join("\0");
    assert.deepEqual(parseRawDiffDestHashes(raw), new Map([["docs/existing.md", sha]]));
  });

  it("maps a rename/copy to the destination path and post-image hash, ignoring the source", () => {
    const sha = "d".repeat(40);
    const raw = [
      `:100644 100644 ${"a".repeat(40)} ${sha} R100`,
      "docs/old.md",
      "docs/new.md",
      "",
    ].join("\0");
    assert.deepEqual(parseRawDiffDestHashes(raw), new Map([["docs/new.md", sha]]));
  });

  it("excludes deletions (no post-image to compare)", () => {
    const raw = [
      `:100644 000000 ${"a".repeat(40)} ${"0".repeat(40)} D`,
      "docs/removed.md",
      "",
    ].join("\0");
    assert.deepEqual(parseRawDiffDestHashes(raw), new Map());
  });

  it("returns an empty map for empty input", () => {
    assert.deepEqual(parseRawDiffDestHashes(""), new Map());
  });
});

describe("checkNoUntrackedMutableStateCopies", () => {
  let checkNoUntrackedMutableStateCopies: (
    destHashes: Map<string, string>,
    ignoredMutableFiles: string[],
    hashFn?: (filePath: string) => string | null,
  ) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkNoUntrackedMutableStateCopies = mod.checkNoUntrackedMutableStateCopies;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("passes when no staged destination matches an ignored source's hash", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const hashFn = () => "b".repeat(40);
    checkNoUntrackedMutableStateCopies(destHashes, [".squad/agents/scotty/history.md"], hashFn);
    assert.equal(exitState.code, null);
  });

  it("passes when there are no untracked mutable-state files to compare against", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    checkNoUntrackedMutableStateCopies(destHashes, [], () => "unused");
    assert.equal(exitState.code, null);
  });

  it("rejects a staged file whose hash matches an ignored mutable-state source", () => {
    const sha = "e".repeat(40);
    const destHashes = new Map([["docs/laundered.md", sha]]);
    const hashFn = () => sha;
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          [".squad/agents/scotty/history.md"],
          hashFn,
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    const output = errors.join("\n");
    assert.match(output, /docs\/laundered\.md/);
    assert.match(output, /\.squad\/agents\/scotty\/history\.md/);
  });

  it("does not flag a source matched against its own unchanged path", () => {
    // Guard against a degenerate self-match: an ignored path should never
    // be compared against itself even if it somehow appeared as a staged
    // destination (e.g. a stale/forced entry already caught elsewhere).
    const sha = "f".repeat(40);
    const mutablePath = ".squad/agents/scotty/history.md";
    const destHashes = new Map([[mutablePath, sha]]);
    const hashFn = () => sha;
    checkNoUntrackedMutableStateCopies(destHashes, [mutablePath], hashFn);
    assert.equal(exitState.code, null);
  });

  it("ignores a source file whose hash cannot be computed (missing/unreadable)", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const hashFn = () => null;
    checkNoUntrackedMutableStateCopies(destHashes, [".squad/agents/scotty/history.md"], hashFn);
    assert.equal(exitState.code, null);
  });
});

// ── #11 — Portable filenames ─────────────────────────────────────────

describe("checkPortableFilenames", () => {
  let checkPortableFilenames: (staged: string[], exists?: (path: string) => boolean) => void;
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkPortableFilenames = mod.checkPortableFilenames;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("passes for ordinary paths", () => {
    checkPortableFilenames(["src/index.ts", ".github/workflows/redeem.yml"]);
    assert.equal(exitState.code, null);
  });

  it("passes for the safe timestamp form", () => {
    checkPortableFilenames([".squad/log/2026-08-13T04-38-00Z-session.md"]);
    assert.equal(exitState.code, null);
  });

  it("fails for colons in a filename (the #186 regression)", () => {
    assert.throws(
      () => checkPortableFilenames([".squad/log/2026-05-12T05:16:11Z-clarify.md"], () => true),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("allows deleting legacy files with non-portable names", () => {
    checkPortableFilenames([".squad/log/2026-05-12T05:16:11Z-clarify.md"], () => false);
    assert.equal(exitState.code, null);
  });

  it("fails for other Windows-illegal characters", () => {
    for (const bad of ["docs/what?.md", 'docs/a"b.md', "docs/a*b.md", "docs/a|b.md"]) {
      exitState = captureExit();
      assert.throws(() => checkPortableFilenames([bad], () => true), /process\.exit\(1\)/);
      assert.equal(exitState.code, 1, `expected ${bad} to be rejected`);
    }
  });

  it("does not flag forward slashes as path separators", () => {
    checkPortableFilenames(["a/b/c/d.md"]);
    assert.equal(exitState.code, null);
  });

  it("error message suggests the safe timestamp format", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkPortableFilenames([".squad/log/2026-05-12T05:16:11Z-x.md"], () => true),
      /process\.exit\(1\)/,
    );
    assert.match(errors.join("\n"), /2026-08-13T04-38-00Z/);
  });
});

// ── #10 — Workflow pinning tests ─────────────────────────────────────

describe("checkWorkflowPinningTests", () => {
  let checkWorkflowPinningTests: (staged: string[], grep?: (basename: string) => string[]) => void;
  let grepTestsForWorkflow: (basename: string) => string[];
  let exitState: { code: number | null };

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkWorkflowPinningTests = mod.checkWorkflowPinningTests;
    grepTestsForWorkflow = mod.grepTestsForWorkflow;
  });

  describe("pre-commit runner", () => {
    it("scans staged artifacts for secrets before running tests", () => {
      const source = readFileSync("scripts/pre-commit.mjs", "utf8");
      const scanAt = source.indexOf("check-artifact-hygiene.mjs --staged");
      const testAt = source.indexOf("npm test");
      assert.ok(scanAt >= 0, "artifact hygiene scanner must be enabled");
      assert.ok(testAt > scanAt, "artifact hygiene scanner must run before tests");
    });

    it("clears hook-only Git environment before running tests in nested repositories", () => {
      const source = readFileSync("scripts/pre-commit.mjs", "utf8");
      const envSetupAt = source.indexOf("const testEnv = { ...process.env };");
      const envClearAt = source.indexOf(
        "if (key.startsWith('GIT_')) delete testEnv[key];",
      );
      const testCallAt = source.indexOf("execSync('npm test'");

      assert.ok(envSetupAt >= 0, "the test runner must copy the process env");
      assert.ok(
        envClearAt > envSetupAt && envClearAt < testCallAt,
        "Git hook variables must be cleared before running the suite",
      );
      assert.ok(
        source.includes("env: testEnv"),
        "npm test must receive the sanitized environment",
      );
    });

    it("artifact hygiene scans index content rather than the working tree", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-hygiene-index-"));
      const scanner = resolve("scripts/check-artifact-hygiene.mjs");
      const artifact = join(dir, "docs", "capture.md");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }
      try {
        mkdirSync(join(dir, "docs"));
        execFileSync("git", ["init", "--quiet"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        const stagedSecret = [
          `eyJ${"a".repeat(10)}`,
          "b".repeat(10),
          "c".repeat(10),
        ].join(".");
        writeFileSync(artifact, stagedSecret);
        execFileSync("git", ["add", "docs/capture.md"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        writeFileSync(artifact, "<REDACTED>");

        const result = spawnSync(process.execPath, [scanner, "--staged"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /\[JWT\]/);
        assert.doesNotMatch(result.stderr, new RegExp(stagedSecret.replaceAll(".", "\\.")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("allows an intentional staged untracking of the canonical decisions ledger", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untrack-"));
      const scriptsDir = join(dir, "scripts");
      const binDir = join(dir, "bin");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(binDir);
        writeFileSync(
          join(scriptsDir, "pre-commit.mjs"),
          readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
        );
        writeFileSync(
          join(scriptsDir, "pre-commit-checks.mjs"),
          readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
        );
        writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

        const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
        const pathSeparator = process.platform === "win32" ? ";" : ":";
        isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
        if (process.platform === "win32") {
          writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
        } else {
          writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }

        const decisionsLedger = ".squad/decisions/decisions.md";
        mkdirSync(join(dir, ".squad", "decisions"), { recursive: true });
        writeFileSync(join(dir, decisionsLedger), "tracked ledger\n");
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", decisionsLedger], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add decisions ledger"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["rm", "--cached", decisionsLedger], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const stagedStatus = execFileSync("git", ["diff", "--cached", "--name-status"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(stagedStatus.trim(), `D\t${decisionsLedger}`);

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          0,
          `expected staged untracking to pass the pre-commit boundary check:\n${result.stderr}`,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("blocks a real staged deletion (git rm --cached) of a non-allowlisted mutable-state path", () => {
      // Regression test for the reviewer finding on PR #314: the previous
      // tests only called checkSquadBoundary(deleted, deleted) directly,
      // which is a shape the real hook can never produce — parseNameStatus
      // only ever recorded a `D` entry in `deleted`, never in `staged`, so
      // the allowlist membership check in checkSquadBoundary was dead code
      // and EVERY `git rm --cached` deletion silently passed, allowlisted
      // or not. This drives `git diff --cached --name-status -z -M -C`
      // through the real `pre-commit.mjs` entry point for a path that is
      // deliberately NOT in MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST, and must
      // fail the boundary check.
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-reject-untrack-"));
      const scriptsDir = join(dir, "scripts");
      const binDir = join(dir, "bin");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(binDir);
        writeFileSync(
          join(scriptsDir, "pre-commit.mjs"),
          readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
        );
        writeFileSync(
          join(scriptsDir, "pre-commit-checks.mjs"),
          readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
        );
        writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

        const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
        const pathSeparator = process.platform === "win32" ? ";" : ":";
        isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
        if (process.platform === "win32") {
          writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
        } else {
          writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }

        // NOTE: must stay OUTSIDE MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.
        const nonAllowlisted = ".squad/log/2026-05-16-real-repo-untrack.md";
        mkdirSync(join(dir, ".squad", "log"), { recursive: true });
        writeFileSync(join(dir, nonAllowlisted), "tracked log entry\n");
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", nonAllowlisted], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add non-allowlisted log entry"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["rm", "--cached", nonAllowlisted], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const stagedStatus = execFileSync("git", ["diff", "--cached", "--name-status"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(stagedStatus.trim(), `D\t${nonAllowlisted}`);

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected a non-allowlisted mutable-state deletion to be rejected:\n${result.stdout}${result.stderr}`,
        );
        assert.match(result.stderr + result.stdout, /\.squad\/log\/2026-05-16-real-repo-untrack\.md/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("blocks a real staged rename of mutable state onto an ordinary tracked path", () => {
      // Regression test for the rename bypass (PR #314 review): git's rename
      // detection reports only the destination for `--name-status`, and
      // `--diff-filter=D` excludes renames entirely, so a naive implementation
      // never sees the mutable-state source path at all.
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-rename-"));
      const scriptsDir = join(dir, "scripts");
      const binDir = join(dir, "bin");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(binDir);
        writeFileSync(
          join(scriptsDir, "pre-commit.mjs"),
          readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
        );
        writeFileSync(
          join(scriptsDir, "pre-commit-checks.mjs"),
          readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
        );
        writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

        const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
        const pathSeparator = process.platform === "win32" ? ";" : ":";
        isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
        if (process.platform === "win32") {
          writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
        } else {
          writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }

        const mutableSource = ".squad/agents/scotty/history.md";
        // Large-ish, mostly-identical-after-rename content so Git's default
        // 50% similarity threshold still detects this as a rename.
        const body = "line\n".repeat(200);
        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", mutableSource], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add mutable history file"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const ordinaryDestination = "docs/laundered-history.md";
        mkdirSync(join(dir, "docs"), { recursive: true });
        execFileSync("git", ["mv", mutableSource, ordinaryDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const stagedStatus = execFileSync(
          "git",
          ["diff", "--cached", "--name-status", "-M"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.match(
          stagedStatus,
          /^R\d+\t/,
          `expected git to detect this as a rename, got:\n${stagedStatus}`,
        );

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected renaming mutable state onto an ordinary path to be rejected:\n${result.stdout}`,
        );
        assert.match(
          result.stderr + result.stdout,
          new RegExp(mutableSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("blocks a real staged copy of an unchanged mutable-state file onto an ordinary tracked path", () => {
      // Regression test for the copy-laundering gap flagged in PR #314
      // review: `git diff --cached --name-status -M -C` (without
      // `--find-copies-harder`) only searches for copy *sources* among
      // files that were themselves modified in the same diff. Copying an
      // UNCHANGED mutable-state file to an ordinary path — leaving the
      // source untouched on disk and unstaged — is reported as a plain
      // `A`dd for the destination and never surfaces the source path
      // unless `--find-copies-harder` is passed.
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-copy-"));
      const scriptsDir = join(dir, "scripts");
      const binDir = join(dir, "bin");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(binDir);
        writeFileSync(
          join(scriptsDir, "pre-commit.mjs"),
          readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
        );
        writeFileSync(
          join(scriptsDir, "pre-commit-checks.mjs"),
          readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
        );
        writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

        const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
        const pathSeparator = process.platform === "win32" ? ";" : ":";
        isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
        if (process.platform === "win32") {
          writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
        } else {
          writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }

        const mutableSource = ".squad/agents/scotty/history.md";
        // Large-ish, identical content so Git's default 50% similarity
        // threshold still detects this as a copy once --find-copies-harder
        // is in play.
        const body = "line\n".repeat(200);
        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", mutableSource], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add mutable history file"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        // Copy (not move) the source: it remains on disk, unchanged and
        // unstaged, while only the destination is staged.
        const ordinaryDestination = "docs/laundered-history.md";
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, ordinaryDestination), body);
        execFileSync("git", ["add", ordinaryDestination], { cwd: dir, env: isolatedGitEnv });

        const stagedStatusWithoutFlag = execFileSync(
          "git",
          ["diff", "--cached", "--name-status", "-M", "-C"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.match(
          stagedStatusWithoutFlag,
          /^A\t/,
          `expected git to report a plain add without --find-copies-harder, got:\n${stagedStatusWithoutFlag}`,
        );

        const stagedStatusWithFlag = execFileSync(
          "git",
          ["diff", "--cached", "--name-status", "-M", "-C", "--find-copies-harder"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.match(
          stagedStatusWithFlag,
          /^C\d+\t/,
          `expected --find-copies-harder to detect this as a copy, got:\n${stagedStatusWithFlag}`,
        );

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected copying mutable state onto an ordinary path to be rejected:\n${result.stdout}`,
        );
        assert.match(
          result.stderr + result.stdout,
          new RegExp(mutableSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("blocks a real staged copy of an UNTRACKED/IGNORED mutable-state file onto an ordinary tracked path", () => {
      // Regression test for the follow-up copy-laundering gap (new Copilot
      // review on e626f36): `--find-copies-harder` still only searches for
      // copy sources among blobs that are part of the diff — i.e. TRACKED
      // content. A mutable-state file excluded from tracking entirely by
      // `.gitignore` (the normal, intended state for e.g.
      // `.squad/agents/*/history.md`) was never part of any diff, so no
      // combination of `-M -C --find-copies-harder` can ever report it as a
      // copy source. This exercises the content-hash-based check
      // (`parseRawDiffDestHashes` + `listUntrackedMutableStateFiles` +
      // `checkNoUntrackedMutableStateCopies`) that closes that gap
      // independently of Git's rename/copy detection.
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-"));
      const scriptsDir = join(dir, "scripts");
      const binDir = join(dir, "bin");
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        mkdirSync(scriptsDir, { recursive: true });
        mkdirSync(binDir);
        writeFileSync(
          join(scriptsDir, "pre-commit.mjs"),
          readFileSync(resolve("scripts/pre-commit.mjs"), "utf8"),
        );
        writeFileSync(
          join(scriptsDir, "pre-commit-checks.mjs"),
          readFileSync(resolve("scripts/pre-commit-checks.mjs"), "utf8"),
        );
        writeFileSync(join(scriptsDir, "check-artifact-hygiene.mjs"), "process.exit(0);\n");

        const pathKey = Object.keys(isolatedGitEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
        const pathSeparator = process.platform === "win32" ? ";" : ":";
        isolatedGitEnv[pathKey] = `${binDir}${pathSeparator}${isolatedGitEnv[pathKey] ?? ""}`;
        if (process.platform === "win32") {
          writeFileSync(join(binDir, "npm.cmd"), "@echo off\r\nexit /b 0\r\n");
        } else {
          writeFileSync(join(binDir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }

        // Minimal `.gitignore` so the mutable-state source is genuinely
        // untracked AND ignored — the exact condition `git ls-files
        // --others --ignored --exclude-standard` is designed to surface,
        // and the one Git's copy detection can never see into.
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");

        const body = "line\n".repeat(200);
        const mutableSource = ".squad/agents/scotty/history.md";
        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);

        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", ".gitignore"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add .gitignore"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        // Sanity-check the premise: the source is untracked and ignored,
        // never staged, and git status confirms Git does not track it.
        const statusBeforeCopy = execFileSync("git", ["status", "--porcelain", "--ignored"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.match(
          statusBeforeCopy,
          /!! \.squad\//,
          `expected the mutable source to show as ignored before copying, got:\n${statusBeforeCopy}`,
        );

        // Copy (not move) identical bytes into an ordinary path and stage
        // ONLY the destination — the source stays on disk, untracked,
        // unstaged, exactly as `.gitignore` intends.
        const ordinaryDestination = "docs/laundered-from-ignored.md";
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, ordinaryDestination), body);
        execFileSync("git", ["add", ordinaryDestination], { cwd: dir, env: isolatedGitEnv });

        const stagedStatus = execFileSync(
          "git",
          ["diff", "--cached", "--name-status", "-M", "-C", "--find-copies-harder"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.match(
          stagedStatus,
          /^A\t/,
          `expected git to report a plain add even with --find-copies-harder, since the source ` +
            `was never tracked, got:\n${stagedStatus}`,
        );

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected copying an untracked/ignored mutable-state file onto an ordinary path to be ` +
            `rejected:\n${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.match(output, new RegExp(ordinaryDestination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(output, new RegExp(mutableSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ── Real-repository mutable-state invariant ───────────────────────
  //
  // Regression test for the migration deadlock fixed alongside PR #314's
  // revision: the guard patterns must not match any path that is both
  // tracked in HEAD *and* absent from the deletion allowlist. Unlike the
  // other tests in this file, this one runs against the real working-tree
  // repo (via `git ls-files`) rather than a synthetic temp repo, because
  // the bug it guards against is specifically a mismatch between the
  // guard's patterns/allowlist and the *actual* tracked file set.
  describe("mutable-state guard invariants (real repository)", () => {
    let MUTABLE_SQUAD_STATE_PATTERNS: RegExp[];
    let MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST: Set<string>;

    beforeEach(async () => {
      const mod = await import("../../scripts/pre-commit-checks.mjs");
      MUTABLE_SQUAD_STATE_PATTERNS = mod.MUTABLE_SQUAD_STATE_PATTERNS;
      MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST = mod.MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST;
    });

    it("has no tracked path matching the guard patterns outside the deletion allowlist", () => {
      const tracked = execFileSync("git", ["ls-files", ".squad"], { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const unexpected = tracked.filter((path) => {
        const matchesGuard = MUTABLE_SQUAD_STATE_PATTERNS.some((pattern) => pattern.test(path));
        if (!matchesGuard) return false;
        return !MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(path);
      });

      assert.deepEqual(
        unexpected,
        [],
        "found tracked .squad paths matched by the mutable-state guard but missing from the " +
          "deletion allowlist; add them to MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST or untrack them",
      );
    });

    it("has no tracked file left under .squad/log/ or .squad/orchestration-log/ (PR #314 migration)", () => {
      // The Scribe audit completed and the coordinator authorized migrating
      // all 109 previously-tracked log/orchestration-log paths out of the
      // index. Only static config and durable artifacts (e.g.
      // .squad/decisions-archive.md) should remain tracked under .squad/.
      const tracked = execFileSync("git", ["ls-files", ".squad/log", ".squad/orchestration-log"], {
        encoding: "utf8",
      })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      assert.deepEqual(
        tracked,
        [],
        "expected no tracked files under .squad/log/ or .squad/orchestration-log/ after the " +
          "PR #314 migration",
      );
    });

    it("preserves the Scribe-classified durable entries in the tracked decisions archive", () => {
      // Before untracking .squad/log/** and .squad/orchestration-log/**,
      // Scribe classified three durable items whose substantive content
      // must already exist in the tracked .squad/decisions-archive.md:
      // Rules 6/7 + Rule 5 extension, Chronicle tips, and per-agent model
      // overrides. This asserts they are present so the migration cannot
      // silently drop durable history.
      const archive = readFileSync(resolve(".squad/decisions-archive.md"), "utf8");
      assert.match(archive, /Rules 6 & 7 \+ Rule 5/i, "expected the Rule 5/6/7 entry to be archived");
      assert.match(archive, /Chronicle tips/i, "expected the Chronicle tips entry to be archived");
      assert.match(
        archive,
        /model overrides/i,
        "expected the per-agent model overrides entry to be archived",
      );
    });

    it("never matches the static memory policy file .squad/memory/config.json", () => {
      assert.equal(
        MUTABLE_SQUAD_STATE_PATTERNS.some((pattern) => pattern.test(".squad/memory/config.json")),
        false,
      );
    });

    it("still matches other files under .squad/memory/", () => {
      assert.equal(
        MUTABLE_SQUAD_STATE_PATTERNS.some((pattern) => pattern.test(".squad/memory/index.json")),
        true,
      );
    });

    it("matches both bare and timestamped history-archive filenames (PR #314 review)", () => {
      for (const path of [
        ".squad/agents/scotty/history-archive.md",
        ".squad/agents/uhura/history-archive-2026-06-02.md",
        ".squad/agents/uhura/history-archive-20260602T044144Z.md",
      ]) {
        assert.ok(
          MUTABLE_SQUAD_STATE_PATTERNS.some((pattern) => pattern.test(path)),
          `expected ${path} to match a mutable-state guard pattern`,
        );
        assert.ok(
          MUTABLE_SQUAD_STATE_DELETION_ALLOWLIST.has(path),
          `expected ${path} to be in the migration deletion allowlist`,
        );
      }
    });

    it("gitignores both bare and timestamped history-archive filenames", () => {
      for (const path of [
        ".squad/agents/scotty/history-archive.md",
        ".squad/agents/uhura/history-archive-2026-06-02.md",
        ".squad/agents/uhura/history-archive-20260602T044144Z.md",
      ]) {
        const result = spawnSync("git", ["check-ignore", "--quiet", path], { encoding: "utf8" });
        assert.equal(result.status, 0, `expected \`git check-ignore\` to report ${path} as ignored`);
      }
    });

    it("matches and gitignores .squad/worktree-inbox/ snapshots", () => {
      const path = ".squad/worktree-inbox/2026-06-02T000000Z-obrien/manifest.json";
      assert.ok(
        MUTABLE_SQUAD_STATE_PATTERNS.some((pattern) => pattern.test(path)),
        `expected ${path} to match a mutable-state guard pattern`,
      );
      const result = spawnSync("git", ["check-ignore", "--quiet", path], { encoding: "utf8" });
      assert.equal(result.status, 0, `expected \`git check-ignore\` to report ${path} as ignored`);
    });

    it("rejects `git add` of a backend-owned worktree-inbox snapshot (real repository)", () => {
      // Real-repo invariant for the worktree-inbox bypass (PR #314 review):
      // `git add` on an ignored path must fail outright (without -f), so a
      // backend-owned snapshot can never be staged by accident even before
      // the pre-commit boundary check runs.
      const dir = mkdtempSync(join(tmpdir(), "stfc-worktree-inbox-"));
      const isolatedGitEnv = { ...process.env };
      for (const key of Object.keys(isolatedGitEnv)) {
        if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
      }

      try {
        writeFileSync(join(dir, ".gitignore"), readFileSync(resolve(".gitignore"), "utf8"));
        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", ".gitignore"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add .gitignore"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const snapshotDir = join(dir, ".squad", "worktree-inbox", "2026-06-02T000000Z-obrien");
        mkdirSync(snapshotDir, { recursive: true });
        const snapshotPath = join(snapshotDir, "manifest.json");
        writeFileSync(snapshotPath, JSON.stringify({ backend: "two-layer" }));

        const addResult = spawnSync(
          "git",
          ["add", ".squad/worktree-inbox/2026-06-02T000000Z-obrien/manifest.json"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.notEqual(
          addResult.status,
          0,
          `expected \`git add\` of an ignored worktree-inbox snapshot to fail:\n${addResult.stdout}${addResult.stderr}`,
        );

        const stagedStatus = execFileSync("git", ["diff", "--cached", "--name-only"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          stagedStatus.trim(),
          "",
          `expected nothing to be staged after the rejected \`git add\`, got:\n${stagedStatus}`,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("has no .gitattributes merge=union rule for a backend-owned mutable Squad state path", () => {
      // Backend-owned mutable state (agent histories/archives, logs,
      // orchestration logs, RAI/Fact Checker audit trails) is no longer
      // tracked, so a `merge=union` driver for it would be a dead rule that
      // misleadingly implies Git still reconciles it across branches. This
      // guards against reintroducing such a rule. A `merge=union` rule for a
      // *verified tracked durable archive* (e.g. a future append-only file
      // that is NOT matched by MUTABLE_SQUAD_STATE_PATTERNS) remains allowed.
      const attributes = readFileSync(resolve(".gitattributes"), "utf8");
      const unionLines = attributes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && /merge=union/.test(line));

      const offending = unionLines.filter((line) => {
        const pattern = line.split(/\s+/)[0] ?? "";
        // Turn a `.gitattributes` glob (e.g. `.squad/log/**`) into a
        // representative path to test against the guard patterns.
        const representative = pattern.replace(/\*\*/g, "x").replace(/\*/g, "x");
        return MUTABLE_SQUAD_STATE_PATTERNS.some((re) => re.test(representative));
      });

      assert.deepEqual(
        offending,
        [],
        "found a merge=union .gitattributes rule for a backend-owned mutable Squad state path " +
          `(agent histories, logs, orchestration logs, RAI/Fact Checker audit trails): ${offending.join(", ")}`,
      );
    });

    it("does not gitignore the static memory policy file .squad/memory/config.json", () => {
      const result = spawnSync("git", ["check-ignore", "--quiet", ".squad/memory/config.json"], {
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        1,
        "expected `git check-ignore` to report .squad/memory/config.json as NOT ignored (exit 1)",
      );
    });

    it("still gitignores other files under .squad/memory/", () => {
      const result = spawnSync("git", ["check-ignore", "--quiet", ".squad/memory/index.json"], {
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        0,
        "expected `git check-ignore` to report .squad/memory/index.json as ignored (exit 0)",
      );
    });
  });

  it("passes when no workflow files are staged", () => {
    checkWorkflowPinningTests(["src/index.ts"]);
    assert.equal(exitState.code, null);
  });

  it("passes when workflow staged but no tests reference it", () => {
    const grep = () => [] as string[];
    checkWorkflowPinningTests([".github/workflows/ci.yml"], grep);
    assert.equal(exitState.code, null);
  });

  it("passes when workflow staged and referencing tests are also staged", () => {
    const grep = () => ["tests/skills/discordMonitor.test.ts"];
    checkWorkflowPinningTests(
      [".github/workflows/discord-monitor.yml", "tests/skills/discordMonitor.test.ts"],
      grep,
    );
    assert.equal(exitState.code, null);
  });

  it("fails when workflow staged but referencing test is NOT staged", () => {
    const grep = () => ["tests/skills/discordMonitor.test.ts"];
    assert.throws(
      () => checkWorkflowPinningTests([".github/workflows/discord-monitor.yml"], grep),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("error message names the workflow and test file", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));
    const grep = () => ["tests/skills/redeemCodes.test.ts"];

    assert.throws(
      () => checkWorkflowPinningTests([".github/workflows/redeem.yml"], grep),
      /process\.exit\(1\)/,
    );
    const output = errors.join("\n");
    assert.match(output, /redeem\.yml/);
    assert.match(output, /tests\/skills\/redeemCodes\.test\.ts/);
  });

  it("handles multiple workflows with mixed pass/fail", () => {
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));
    const grep = (basename: string) => {
      if (basename === "redeem.yml") return ["tests/skills/redeemCodes.test.ts"];
      return [];
    };

    assert.throws(
      () =>
        checkWorkflowPinningTests(
          [".github/workflows/redeem.yml", ".github/workflows/ci.yml"],
          grep,
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("ignores self-referential matches in tests/scripts/pre-commit.test.ts", () => {
    // This file references workflow filenames only as fixture strings to
    // exercise the hook — they are not real pinning regression guards, so
    // they must NOT force the test file to be re-staged with every
    // workflow edit.
    const grep = () => ["tests/scripts/pre-commit.test.ts"];
    checkWorkflowPinningTests([".github/workflows/redeem.yml"], grep);
    assert.equal(exitState.code, null);
  });

  it("treats workflow names as text instead of shell commands", () => {
    assert.deepEqual(
      grepTestsForWorkflow("$(printf redeem).yml"),
      ["tests/scripts/pre-commit.test.ts"],
    );
  });
});
