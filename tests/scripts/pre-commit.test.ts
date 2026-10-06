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
import { dirname, join, resolve } from "node:path";

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

type AttrSignature = {
  signature: string;
  pathIndependent: boolean;
  hasCustomFilter: boolean;
  matchesIndex: boolean;
};

type StagedRename = {
  status: string;
  source: string;
  destination: string;
};

function setupPreCommitTestRepo(dir: string): NodeJS.ProcessEnv {
  const scriptsDir = join(dir, "scripts");
  const binDir = join(dir, "bin");
  const isolatedGitEnv = { ...process.env };
  for (const key of Object.keys(isolatedGitEnv)) {
    if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
  }

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

  execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
  execFileSync("git", ["config", "user.name", "Pre-commit test"], {
    cwd: dir,
    env: isolatedGitEnv,
  });
  execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
    cwd: dir,
    env: isolatedGitEnv,
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, env: isolatedGitEnv });
  return isolatedGitEnv;
}

function getGitAttributeValues(
  dir: string,
  env: NodeJS.ProcessEnv,
  paths: string[],
  cached: boolean,
  attributes = ["text", "eol", "filter"],
): Map<string, Record<string, string>> {
  const args = ["check-attr", ...(cached ? ["--cached"] : []), "-z", ...attributes, "--", ...paths];
  const raw = execFileSync("git", args, { cwd: dir, encoding: "utf8", env });
  const tokens = raw.split("\0");
  const valuesByPath = new Map<string, Record<string, string>>();
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const path = tokens[i];
    const attr = tokens[i + 1];
    const value = tokens[i + 2];
    if (path === undefined || attr === undefined || value === undefined) continue;
    const values = valuesByPath.get(path) ?? {};
    values[attr] = value;
    valuesByPath.set(path, values);
  }
  return valuesByPath;
}

function assertPathAwareMutableCopyRejected(
  dir: string,
  env: NodeJS.ProcessEnv,
  source: string,
  representative: string,
  copiedDestination: string,
): void {
  const stagedHash = execFileSync("git", ["rev-parse", `:${copiedDestination}`], {
    cwd: dir,
    encoding: "utf8",
    env,
  }).trim();
  const hashUnderCopiedPath = execFileSync(
    "git",
    ["hash-object", "--filters", `--path=${copiedDestination}`, "--", source],
    { cwd: dir, encoding: "utf8", env },
  ).trim();
  const hashUnderRepresentativePath = execFileSync(
    "git",
    ["hash-object", "--filters", `--path=${representative}`, "--", source],
    { cwd: dir, encoding: "utf8", env },
  ).trim();

  assert.equal(hashUnderCopiedPath, stagedHash, "fixture bug: destination path must reproduce git add");
  assert.notEqual(
    hashUnderRepresentativePath,
    stagedHash,
    "fixture bug: the representative path must produce a different blob hash",
  );

  const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  assert.equal(
    result.status,
    1,
    `expected the real pre-commit entry point to reject the mutable-state copy:\n` +
      `${result.stderr}${result.stdout}`,
  );
  const output = result.stderr + result.stdout;
  assert.ok(output.includes(copiedDestination), `expected copied destination in output:\n${output}`);
  assert.ok(output.includes(source), `expected mutable source in output:\n${output}`);
}

// ── #9 — Squad boundary ─────────────────────────────────────────────

describe("checkSquadBoundary", () => {
  let checkSquadBoundary: (
    staged: string[],
    deleted?: string[],
    renamedFrom?: string[],
    renames?: StagedRename[],
    destHashes?: Map<string, string>,
  ) => void;
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
      renames: StagedRename[];
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

  it("allows only the exact R100 casting-history migration rename with the approved blob", () => {
    const source = ".squad/casting/history.json";
    const destination = ".squad/templates/casting-history-migration.json";
    const blob = "d8f0154c77053e1cb4894277d4ee3630f6c86952";

    checkSquadBoundary(
      [destination],
      [],
      [source],
      [{ status: "R100", source, destination }],
      new Map([[destination, blob]]),
    );
    assert.equal(exitState.code, null);
  });

  it("rejects wrong destinations, altered blobs, copies, and other mutable rename sources", () => {
    const source = ".squad/casting/history.json";
    const destination = ".squad/templates/casting-history-migration.json";
    const approvedBlob = "d8f0154c77053e1cb4894277d4ee3630f6c86952";
    const cases: Array<{
      status: string;
      source: string;
      destination: string;
      blob: string;
    }> = [
      {
        status: "R100",
        source,
        destination: ".squad/templates/other-history.json",
        blob: approvedBlob,
      },
      {
        status: "R100",
        source,
        destination,
        blob: "f".repeat(40),
      },
      {
        status: "R099",
        source,
        destination,
        blob: approvedBlob,
      },
      {
        status: "C100",
        source,
        destination,
        blob: approvedBlob,
      },
      {
        status: "R100",
        source: ".squad/agents/scotty/history.md",
        destination,
        blob: approvedBlob,
      },
    ];

    for (const rename of cases) {
      exitState.code = null;
      assert.throws(
        () =>
          checkSquadBoundary(
            [rename.destination],
            [],
            [rename.source],
            [rename],
            new Map([[rename.destination, rename.blob]]),
          ),
        /process\.exit\(1\)/,
        `expected ${rename.status} from ${rename.source} to ${rename.destination} to be rejected`,
      );
      assert.equal(exitState.code, 1);
    }
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
    renames: StagedRename[];
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
      renames: [],
    });
  });

  it("parses a rename into both staged (destination) and renamedFrom (source)", () => {
    const raw = ["R100", ".squad/agents/scotty/history.md", "docs/ordinary.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/ordinary.md"],
      deleted: [],
      renamedFrom: [".squad/agents/scotty/history.md"],
      renames: [
        {
          status: "R100",
          source: ".squad/agents/scotty/history.md",
          destination: "docs/ordinary.md",
        },
      ],
    });
  });

  it("parses a copy the same way as a rename (destination staged, source tracked)", () => {
    const raw = ["C100", "docs/template.md", "docs/copy.md", ""].join("\0");
    assert.deepEqual(parseNameStatus(raw), {
      staged: ["docs/copy.md"],
      deleted: [],
      renamedFrom: ["docs/template.md"],
      renames: [
        {
          status: "C100",
          source: "docs/template.md",
          destination: "docs/copy.md",
        },
      ],
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
      renames: [
        {
          status: "R087",
          source: ".squad/identity/now.md",
          destination: "docs/moved.md",
        },
      ],
    });
  });

  it("returns empty lists for empty input", () => {
    assert.deepEqual(parseNameStatus(""), {
      staged: [],
      deleted: [],
      renamedFrom: [],
      renames: [],
    });
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

describe("hashObjectForPath", () => {
  let hashObjectForPath: (
    sourcePath: string,
    destinationPath: string,
    exec?: (cmd: string, args: string[], options: Record<string, unknown>) => string,
  ) => string;

  beforeEach(async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    hashObjectForPath = mod.hashObjectForPath;
  });

  it("invokes `git hash-object` with --filters and --path=<destination>, not the source's own path", () => {
    // This is the load-bearing fix (follow-up review on commit 441ecac):
    // without `--path=<destination>`, git derives clean-filter rules from
    // the hashed file's OWN path, which can disagree with the destination's
    // .gitattributes and silently miss an exact copy. See the real-Git
    // regression test below for an end-to-end reproduction.
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return "abc123\n";
    };
    const result = hashObjectForPath(".squad/agents/scotty/history.md", "docs/copy.md", exec);
    assert.equal(result, "abc123");
    assert.deepEqual(calls, [
      {
        cmd: "git",
        args: [
          "hash-object",
          "--filters",
          "--path=docs/copy.md",
          "--",
          ".squad/agents/scotty/history.md",
        ],
      },
    ]);
  });

  it("propagates (does not swallow) an exec failure", () => {
    const exec = () => {
      throw new Error("boom");
    };
    assert.throws(
      () => hashObjectForPath(".squad/agents/scotty/history.md", "docs/copy.md", exec),
      /boom/,
    );
  });

  it("hashObjectsForPath: batches every source into one invocation under a single --path", async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return "aaa\nbbb\nccc\n";
    };
    const result = mod.hashObjectsForPath(
      [".squad/a/history.md", ".squad/b/history.md", ".squad/c/history.md"],
      "docs/copy.md",
      exec,
    );

    assert.deepEqual(result, ["aaa", "bbb", "ccc"]);
    assert.equal(calls.length, 1, "all sources must share one git hash-object subprocess");
    const [firstCall] = calls;
    assert.ok(firstCall);
    assert.deepEqual(firstCall.args, [
      "hash-object",
      "--filters",
      "--path=docs/copy.md",
      "--",
      ".squad/a/history.md",
      ".squad/b/history.md",
      ".squad/c/history.md",
    ]);
  });

  it("hashObjectsForPath: throws when git returns fewer hashes than paths", async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    assert.throws(
      () =>
        mod.hashObjectsForPath([".squad/a/history.md", ".squad/b/history.md"], "docs/copy.md", () => "aaa\n"),
      /returned 1 hash\(es\) for 2 path\(s\)/,
    );
  });

  it("hashObjectsForPath: chunks so a huge source list cannot blow the command-line limit", async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    const sources = Array.from({ length: 2000 }, (_, i) => `.squad/agents/member${i}/history.md`);
    const calls: string[][] = [];
    const exec = (_cmd: string, args: string[]) => {
      const operands = args.slice(args.indexOf("--") + 1);
      calls.push(operands);
      return operands.map(() => "a".repeat(40)).join("\n") + "\n";
    };

    const result = mod.hashObjectsForPath(sources, "docs/copy.md", exec);

    assert.equal(result.length, sources.length);
    assert.ok(calls.length > 1, "expected the oversized list to be split across invocations");
    assert.deepEqual(calls.flat(), sources, "chunking must preserve every path, in order");
    for (const operands of calls) {
      const commandLineLength = operands.reduce((sum, p) => sum + p.length + 1, 0);
      assert.ok(commandLineLength <= 24000 || operands.length === 1);
    }
  });

  it("hashObjectsForPath: returns an empty result without spawning git", async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    let called = false;
    const result = mod.hashObjectsForPath([], "docs/copy.md", () => {
      called = true;
      return "";
    });
    assert.deepEqual(result, []);
    assert.equal(called, false);
  });

  it("real git: batched hashes equal the per-source hashes for the same destination", async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    const dir = mkdtempSync(join(tmpdir(), "stfc-hashobject-batch-"));
    const isolatedGitEnv = { ...process.env };
    for (const key of Object.keys(isolatedGitEnv)) {
      if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
    }

    try {
      execFileSync("git", ["init", "-q"], { cwd: dir, env: isolatedGitEnv });
      const names = ["one.md", "two.md", "three.md"];
      for (const [i, name] of names.entries()) {
        writeFileSync(join(dir, name), `content ${i}\r\nsecond line\r\n`);
      }
      writeFileSync(join(dir, ".gitattributes"), "*.md text eol=lf\n");

      const exec = (cmd: string, args: string[]) =>
        execFileSync(cmd, args, { cwd: dir, env: isolatedGitEnv, encoding: "utf8" });

      const individually = names.map((n) => mod.hashObjectForPath(n, "dest.md", exec));
      const batched = mod.hashObjectsForPath(names, "dest.md", exec);

      assert.deepEqual(batched, individually);
      assert.equal(new Set(batched).size, names.length, "distinct content must hash distinctly");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("real git: hashing under the destination's clean-filter rules matches what git actually stages there", () => {
    // Regression test for the follow-up review on commit 441ecac: a source
    // marked `-text` (preserve bytes exactly) and a destination marked
    // `text eol=lf` (normalize CRLF -> LF on add) produce DIFFERENT blob
    // hashes for byte-identical CRLF content, depending on which path's
    // attributes govern the hash. Using the source's own path (the old,
    // buggy default) must NOT match what git actually staged; using
    // `--path=<destination>` (the fix) must match exactly.
    const dir = mkdtempSync(join(tmpdir(), "stfc-hashobject-filters-"));
    const isolatedGitEnv = { ...process.env };
    for (const key of Object.keys(isolatedGitEnv)) {
      if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
    }

    try {
      execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
      execFileSync("git", ["config", "user.name", "Pre-commit test"], {
        cwd: dir,
        env: isolatedGitEnv,
      });
      execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
        cwd: dir,
        env: isolatedGitEnv,
      });
      execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, env: isolatedGitEnv });

      writeFileSync(
        join(dir, ".gitattributes"),
        [
          ".squad/agents/*/history.md -text",
          "docs/*.md text eol=lf",
          "",
        ].join("\n"),
      );
      execFileSync("git", ["add", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });
      execFileSync("git", ["commit", "--quiet", "-m", "Add .gitattributes"], {
        cwd: dir,
        env: isolatedGitEnv,
      });

      const mutableSource = ".squad/agents/scotty/history.md";
      mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
      const crlfBody = Buffer.from("line\r\n".repeat(50), "ascii");
      writeFileSync(join(dir, mutableSource), crlfBody);

      const destination = "docs/copy.md";
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, destination), crlfBody);
      execFileSync("git", ["add", destination], { cwd: dir, env: isolatedGitEnv });

      const actualStagedHash = execFileSync(
        "git",
        ["diff", "--cached", "--raw", "--abbrev=40"],
        { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
      )
        .trim()
        .split(/\s+/)[3] as string;
      assert.match(actualStagedHash, /^[0-9a-f]{40}$/, "expected to parse a full staged blob hash");

      const exec = (cmd: string, args: string[], options: Record<string, unknown>) =>
        execFileSync(cmd, args, { cwd: dir, env: isolatedGitEnv, ...options }) as unknown as string;

      const hashUnderOwnPath = hashObjectForPath(mutableSource, mutableSource, exec);
      const hashUnderDestinationPath = hashObjectForPath(mutableSource, destination, exec);

      assert.notEqual(
        hashUnderOwnPath,
        actualStagedHash,
        "expected hashing under the SOURCE's own path to diverge from the real staged hash " +
          "(demonstrating the bug the --path=<destination> fix addresses)",
      );
      assert.equal(
        hashUnderDestinationPath,
        actualStagedHash,
        "expected hashing under the DESTINATION's path to match the real staged hash exactly",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkAttrSignatures", () => {
  let checkAttrSignatures: (
    paths: string[],
    exec?: (cmd: string, args: string[], options: Record<string, unknown>) => string,
  ) => Map<string, AttrSignature>;

  beforeEach(async () => {
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkAttrSignatures = mod.checkAttrSignatures;
  });

  it("returns an empty map for empty input without invoking git", () => {
    const exec = () => {
      throw new Error("should never be called for empty input");
    };
    assert.deepEqual(checkAttrSignatures([], exec), new Map());
  });

  it("parses batched git check-attr --all -z output into one signature per path", () => {
    const raw = [
      "docs/a.md",
      "text",
      "set",
      "docs/a.md",
      "eol",
      "lf",
      "docs/b.md",
      "text",
      "unset",
      "",
    ].join("\0");
    const exec = (_cmd: string, args: string[]) => (args[0] === "config" ? "" : raw);

    const signatures = checkAttrSignatures(["docs/a.md", "docs/b.md"], exec);
    assert.deepEqual(signatures.get("docs/a.md"), {
      signature: JSON.stringify(["set", "lf", "unspecified", "unspecified", "unspecified", "unspecified"]),
      pathIndependent: true,
      hasCustomFilter: false,
      matchesIndex: true,
    });
    assert.deepEqual(signatures.get("docs/b.md"), {
      signature: JSON.stringify(["unset", "unspecified", "unspecified", "unspecified", "unspecified", "unspecified"]),
      pathIndependent: true,
      hasCustomFilter: false,
      matchesIndex: true,
    });
    assert.notEqual(signatures.get("docs/a.md")?.signature, signatures.get("docs/b.md")?.signature);
  });

  it("never treats a custom filter value as path-independent, including a sentinel-like driver name", () => {
    const raw = ["docs/a.md", "filter", "unspecified", ""].join("\0");
    const signature = checkAttrSignatures(["docs/a.md"], () => raw).get("docs/a.md");
    assert.equal(signature?.pathIndependent, false);
    assert.equal(signature?.hasCustomFilter, true);
  });

  it("gives identical signatures to paths with identical attribute values", () => {
    const raw = [
      "docs/a.md",
      "text",
      "set",
      "docs/a.md",
      "eol",
      "lf",
      "docs/c.md",
      "text",
      "set",
      "docs/c.md",
      "eol",
      "lf",
      "",
    ].join("\0");
    const exec = (_cmd: string, args: string[]) => (args[0] === "config" ? "" : raw);

    const signatures = checkAttrSignatures(["docs/a.md", "docs/c.md"], exec);
    assert.deepEqual(signatures.get("docs/a.md"), signatures.get("docs/c.md"));
  });

  it("batches index/worktree attributes and checks ambiguous sentinel filter drivers", () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return "";
    };
    checkAttrSignatures(["docs/a.md", "docs/b.md", "src/c.txt"], exec);
    assert.equal(
      calls.length,
      3,
      "expected batched worktree and index attribute lookups plus a sentinel-driver lookup",
    );
    assert.deepEqual(calls[0], {
      cmd: "git",
      args: [
        "check-attr",
        "--all",
        "-z",
        "--",
        "docs/a.md",
        "docs/b.md",
        "src/c.txt",
      ],
    });
    assert.deepEqual(calls[1], {
      cmd: "git",
      args: [
        "check-attr",
        "--cached",
        "--all",
        "-z",
        "--",
        "docs/a.md",
        "docs/b.md",
        "src/c.txt",
      ],
    });
    assert.deepEqual(calls[2], {
      cmd: "git",
      args: ["config", "--null", "--get-regexp", "^filter\\.unspecified\\.(clean|process)$"],
    });
  });

  it("propagates (does not swallow) an exec failure", () => {
    const exec = () => {
      throw new Error("boom");
    };
    assert.throws(() => checkAttrSignatures(["docs/a.md"], exec), /boom/);
  });

  it("real git: assigns different signatures to paths governed by different .gitattributes rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "stfc-checkattr-real-"));
    const isolatedGitEnv = { ...process.env };
    for (const key of Object.keys(isolatedGitEnv)) {
      if (key.startsWith("GIT_")) delete isolatedGitEnv[key];
    }

    try {
      execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
      writeFileSync(
        join(dir, ".gitattributes"),
        [
          ".squad/agents/*/history.md -text",
          "docs/*.md text eol=lf",
          "docs/filter.md filter=unspecified",
          "",
        ].join("\n"),
      );
      execFileSync("git", ["add", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });
      execFileSync("git", ["config", "filter.unspecified.clean", "unused clean command"], {
        cwd: dir,
        env: isolatedGitEnv,
      });

      const exec = (cmd: string, args: string[], options: Record<string, unknown>) =>
        execFileSync(cmd, args, { cwd: dir, env: isolatedGitEnv, ...options }) as unknown as string;

      const signatures = checkAttrSignatures(
        [
          "docs/a.md",
          "docs/b.md",
          "docs/filter.md",
          ".squad/agents/scotty/history.md",
        ],
        exec,
      );
      assert.equal(
        signatures.get("docs/a.md")?.signature,
        signatures.get("docs/b.md")?.signature,
      );
      assert.notEqual(
        signatures.get("docs/a.md")?.signature,
        signatures.get(".squad/agents/scotty/history.md")?.signature,
      );
      assert.equal(
        signatures.get("docs/filter.md")?.pathIndependent,
        false,
        "a configured driver named 'unspecified' must not be grouped as an absent filter",
      );
      assert.equal(signatures.get("docs/filter.md")?.hasCustomFilter, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkNoUntrackedMutableStateCopies", () => {
  let checkNoUntrackedMutableStateCopies: (
    destHashes: Map<string, string>,
    listIgnoredFn?: () => string[],
    hashFn?: (sourcePaths: string[], destinationPath: string) => string[],
    attrFn?: (paths: string[]) => Map<string, AttrSignature>,
    statFn?: (sourcePath: string) => { size: number },
  ) => void;
  let listUntrackedMutableStateFiles: (
    exec?: (cmd: string, args: string[], options: Record<string, unknown>) => string,
  ) => string[];
  let exitState: { code: number | null };
  let mutableSourceDir: string;
  let mutableSourcePath: string;

  /** Stub attrFn for tests that aren't exercising the grouping behavior. */
  const noAttrs = (paths: string[]) =>
    new Map(
      paths.map((path) => [
        path,
        {
          signature: "no-attributes",
          pathIndependent: true,
          hasCustomFilter: false,
          matchesIndex: true,
        },
      ]),
    );

  beforeEach(async () => {
    exitState = captureExit();
    mock.method(console, "error", () => {});
    const mod = await import("../../scripts/pre-commit-checks.mjs");
    checkNoUntrackedMutableStateCopies = (
      destHashes,
      listIgnoredFn,
      hashFn,
      attrFn,
      statFn,
    ) =>
      mod.checkNoUntrackedMutableStateCopies(
        destHashes,
        listIgnoredFn,
        hashFn,
        attrFn,
        () => false,
        statFn,
      );
    listUntrackedMutableStateFiles = mod.listUntrackedMutableStateFiles;
    mutableSourceDir = mkdtempSync(join(tmpdir(), "stfc-mutable-source-fixture-"));
    mutableSourcePath = join(mutableSourceDir, ".squad", "agents", "scotty", "history.md");
    mkdirSync(join(mutableSourceDir, ".squad", "agents", "scotty"), { recursive: true });
    writeFileSync(mutableSourcePath, "mutable state fixture\n");
  });

  afterEach(() => {
    mock.restoreAll();
    rmSync(mutableSourceDir, { recursive: true, force: true });
  });

  it("passes when no staged destination matches an ignored source's hash", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const hashFn = () => ["b".repeat(40)];
    checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, noAttrs);
    assert.equal(exitState.code, null);
  });

  it("passes when there are no untracked mutable-state files to compare against", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    checkNoUntrackedMutableStateCopies(
      destHashes,
      () => [],
      () => {
        throw new Error("should never be called when there is nothing to check");
      },
      () => {
        throw new Error("attrFn should never be called when there is nothing to check");
      },
    );
    assert.equal(exitState.code, null);
  });

  it("rejects an added migration seed when the legacy casting history source remains", () => {
    const mutableSource = ".squad/casting/history.json";
    const destination = ".squad/templates/casting-history-migration.json";
    const matchingHash = "d8f0154c77053e1cb4894277d4ee3630f6c86952";
    const destHashes = new Map([[destination, matchingHash]]);
    let hashCalls = 0;

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          () => [mutableSource],
          (sourcePaths, destPath) => {
            hashCalls += 1;
            assert.deepEqual(sourcePaths, [mutableSource]);
            assert.equal(destPath, destination);
            return [matchingHash];
          },
          noAttrs,
          (sourcePath) => {
            assert.equal(sourcePath, mutableSource);
            return { size: 1 };
          },
        ),
      /process\.exit\(1\)/,
    );

    assert.equal(exitState.code, 1);
    assert.equal(hashCalls, 1);
  });

  it("continues blocking casting-history copies with any other staged blob", () => {
    const stagedHash = "f".repeat(40);
    const destHashes = new Map([
      [".squad/templates/casting-history-migration.json", stagedHash],
    ]);

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          () => [".squad/casting/history.json"],
          () => [stagedHash],
          noAttrs,
          () => ({ size: 1 }),
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
  });

  it("rejects a staged file whose hash matches an ignored mutable-state source", () => {
    const sha = "e".repeat(40);
    const destHashes = new Map([["docs/laundered.md", sha]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const hashFn = () => [sha];
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, noAttrs),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    const output = errors.join("\n");
    assert.match(output, /docs\/laundered\.md/);
    assert.ok(output.includes(mutableSourcePath));
  });

  it("passes the staged destination path to hashFn so filters are resolved from it, not the source", () => {
    const sha = "e".repeat(40);
    const destHashes = new Map([["docs/laundered.md", sha]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const calls: Array<[string[], string]> = [];
    const hashFn = (sourcePaths: string[], destinationPath: string) => {
      calls.push([sourcePaths, destinationPath]);
      return sourcePaths.map(() => sha);
    };

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, noAttrs),
      /process\.exit\(1\)/,
    );
    assert.deepEqual(calls, [[[mutableSourcePath], "docs/laundered.md"]]);
  });

  it("groups identical built-in conversions without a custom filter", () => {
    const sha = "a".repeat(40);
    const otherSha = "b".repeat(40);
    const destHashes = new Map([
      ["docs/one.md", sha],
      ["docs/two.md", otherSha],
      ["docs/three.md", "c".repeat(40)],
      ["docs/four.md", "d".repeat(40)],
      ["docs/five.md", "e".repeat(40)],
    ]);
    const listIgnoredFn = () => [mutableSourcePath];
    let hashCalls = 0;
    const hashFn = () => {
      hashCalls += 1;
      return [sha]; // matches docs/one.md only
    };
    const attrFn = (paths: string[]) =>
      new Map(
        paths.map((path) => [
          path,
          {
            signature: "text=set|eol=lf|filter=unspecified",
            pathIndependent: true,
            hasCustomFilter: false,
            matchesIndex: true,
          },
        ]),
      );

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, attrFn),
      /process\.exit\(1\)/,
    );
    assert.equal(hashCalls, 1, "expected one hash per source for a shared built-in conversion group");
  });

  it("calls hashFn once per distinct path-independent conversion signature", () => {
    const shaGroupA = "a".repeat(40);
    const shaGroupB = "b".repeat(40);
    const destHashes = new Map([
      ["docs/a1.md", shaGroupA],
      ["docs/a2.md", shaGroupA],
      [".squad/other/b1.md", shaGroupB],
    ]);
    const listIgnoredFn = () => [mutableSourcePath];
    const hashCallsPerDest: string[] = [];
    const hashFn = (sourcePaths: string[], destinationPath: string) => {
      hashCallsPerDest.push(destinationPath);
      return sourcePaths.map(() => "no-match");
    };
    const attrFn = (paths: string[]) =>
      new Map(
        paths.map((path) => [
          path,
          {
            signature: path.startsWith(".squad/")
              ? "text=unspecified|filter=unspecified"
              : "text=set|eol=lf|filter=unspecified",
            pathIndependent: true,
            hasCustomFilter: false,
            matchesIndex: true,
          },
        ]),
      );

    checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, attrFn);
    assert.equal(exitState.code, null);
    // Exactly 2 hashFn calls total (one per distinct signature group), and
    // the representative for each group is the first destination path
    // encountered with that signature.
    assert.equal(hashCallsPerDest.length, 2);
    assert.ok(hashCallsPerDest.includes("docs/a1.md"));
    assert.ok(hashCallsPerDest.includes(".squad/other/b1.md"));
  });

  it("fails before hashing a mutable source for a staged destination with a custom filter", () => {
    const destHashes = new Map([["docs/custom.md", "a".repeat(40)]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const errors: string[] = [];
    let hashCalls = 0;
    mock.method(console, "error", (msg: string) => errors.push(msg));
    const attrFn = (paths: string[]) =>
      new Map(
        paths.map((path) => [
          path,
          {
            signature: "filter=path-sensitive",
            pathIndependent: false,
            hasCustomFilter: true,
            matchesIndex: true,
          },
        ]),
      );

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          listIgnoredFn,
          () => {
            hashCalls += 1;
            return ["a".repeat(40)];
          },
          attrFn,
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.equal(hashCalls, 0, "a custom filter must never receive mutable-state source bytes");
    assert.match(errors.join("\n"), /Refusing to execute custom filters/);
    assert.match(errors.join("\n"), /docs\/custom\.md/);
    assert.doesNotMatch(errors.join("\n"), /\.squad\/agents\/scotty\/history\.md/);
  });

  it("hashes every source for a group in a single batched hashFn call", () => {
    // Regression guard for the pre-commit cost reported on PR #314: the
    // check previously spawned one `git hash-object` per ignored
    // mutable-state file on every commit (~9.7s in this repo). Sources
    // sharing one conversion group must now be hashed together.
    const sources = Array.from(
      { length: 50 },
      (_, i) => `.squad/agents/member${i}/history.md`,
    );
    const destHashes = new Map([
      ["docs/one.md", "a".repeat(40)],
      ["docs/two.md", "b".repeat(40)],
    ]);
    const calls: string[][] = [];
    const hashFn = (sourcePaths: string[]) => {
      calls.push(sourcePaths);
      return sourcePaths.map(() => "no-match");
    };

    checkNoUntrackedMutableStateCopies(
      destHashes,
      () => sources,
      hashFn,
      noAttrs,
      () => ({ size: 1 }),
    );

    assert.equal(exitState.code, null);
    assert.equal(calls.length, 1, "one batched call per conversion group, not one per source");
    assert.deepEqual(calls[0], sources);
  });

  it("maps batched hashes back to their own source so violations name the right file", () => {
    const sources = [
      ".squad/agents/one/history.md",
      ".squad/agents/two/history.md",
      ".squad/agents/three/history.md",
    ];
    const matching = "c".repeat(40);
    const destHashes = new Map([["docs/laundered.md", matching]]);
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          () => sources,
          // Only the middle source matches the staged blob.
          (sourcePaths: string[]) =>
            sourcePaths.map((p) => (p === sources[1] ? matching : "no-match")),
          noAttrs,
          () => ({ size: 1 }),
        ),
      /process\.exit\(1\)/,
    );

    const output = errors.join("\n");
    assert.match(output, /docs\/laundered\.md \(matches ignored source \.squad\/agents\/two\/history\.md\)/);
    assert.doesNotMatch(output, /agents\/one\/history\.md/);
    assert.doesNotMatch(output, /agents\/three\/history\.md/);
  });

  it("fails closed when a batch returns fewer hashes than sources", () => {
    const sources = [".squad/agents/one/history.md", ".squad/agents/two/history.md"];
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          () => sources,
          // Truncated result must never be compared positionally.
          () => ["a".repeat(40)],
          noAttrs,
          () => ({ size: 1 }),
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /fail(ing)? closed/i);
  });

  it("names the offending source when only one file in a batch cannot be hashed", () => {
    const goodSource = ".squad/agents/one/history.md";
    const failingSource = ".squad/agents/two/history.md";
    const sources = [goodSource, failingSource];
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          () => sources,
          (sourcePaths: string[]) => {
            if (sourcePaths.includes(failingSource)) {
              throw new Error("git hash-object exploded");
            }
            return sourcePaths.map(() => "no-match");
          },
          noAttrs,
          () => ({ size: 1 }),
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    const output = errors.join("\n");
    assert.match(output, /fail(ing)? closed/i);
    assert.match(output, /\.squad\/agents\/two\/history\.md/);
  });

  it("does not flag a source matched against its own unchanged path", () => {
    // Guard against a degenerate self-match: an ignored path should never
    // be compared against itself even if it somehow appeared as a staged
    // destination (e.g. a stale/forced entry already caught elsewhere).
    const sha = "f".repeat(40);
    const mutablePath = mutableSourcePath;
    const destHashes = new Map([[mutablePath, sha]]);
    const hashFn = () => {
      throw new Error("should never be called for a self-match");
    };
    checkNoUntrackedMutableStateCopies(destHashes, () => [mutablePath], hashFn, noAttrs);
    assert.equal(exitState.code, null);
  });

  // ── Fail-closed behavior (follow-up review on commit 441ecac) ───────
  //
  // Silently treating "the check itself errored" as "no violation found"
  // would make this guard trivially disableable by anything that breaks
  // the listing or hashing step. Both must abort the commit instead.

  it("fails closed (aborts the commit) when enumerating ignored files errors, instead of silently passing", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const listIgnoredFn = () => {
      throw new Error("git ls-files exploded");
    };
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /fail(ing)? closed/i);
    assert.match(errors.join("\n"), /git ls-files exploded/);
  });

  it("fails closed (aborts the commit) when hashing a candidate source errors, instead of silently skipping it", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const hashFn = () => {
      throw new Error("git hash-object exploded");
    };
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, listIgnoredFn, hashFn, noAttrs),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /fail(ing)? closed/i);
    assert.match(errors.join("\n"), /git hash-object exploded/);
  });

  it("fails closed when an enumerated mutable-state source cannot be inspected", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const sourcePath = `.squad/agents/missing-pre-commit-source-${process.pid}/history.md`;
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () => checkNoUntrackedMutableStateCopies(destHashes, () => [sourcePath]),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /fail(ing)? closed/i);
    assert.match(errors.join("\n"), new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("fails closed (aborts the commit) when resolving clean-filter attributes errors, instead of silently skipping it", () => {
    const destHashes = new Map([["docs/new.md", "a".repeat(40)]]);
    const listIgnoredFn = () => [mutableSourcePath];
    const attrFn = () => {
      throw new Error("git check-attr exploded");
    };
    const errors: string[] = [];
    mock.method(console, "error", (msg: string) => errors.push(msg));

    assert.throws(
      () =>
        checkNoUntrackedMutableStateCopies(
          destHashes,
          listIgnoredFn,
          () => {
            throw new Error("hashFn should never run when attribute resolution already failed");
          },
          attrFn,
        ),
      /process\.exit\(1\)/,
    );
    assert.equal(exitState.code, 1);
    assert.match(errors.join("\n"), /fail(ing)? closed/i);
    assert.match(errors.join("\n"), /git check-attr exploded/);
  });

  it("real git: listUntrackedMutableStateFiles propagates (does not swallow) a real git failure", () => {
    // Regression test for the follow-up review on commit 441ecac: the
    // listing function must propagate a genuine git failure rather than
    // catching and returning []. Running `git ls-files` with a cwd that is
    // not inside any Git repository (and GIT_CEILING_DIRECTORIES capping
    // discovery there) reliably reproduces that failure.
    const dir = mkdtempSync(join(tmpdir(), "stfc-untracked-copy-failclosed-"));
    const isolatedGitEnv: Record<string, string> = { GIT_CEILING_DIRECTORIES: dir };
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("GIT_") && value !== undefined) isolatedGitEnv[key] = value;
    }

    try {
      const exec = (cmd: string, args: string[], options: Record<string, unknown>) =>
        execFileSync(cmd, args, { cwd: dir, env: isolatedGitEnv, ...options }) as unknown as string;

      assert.throws(() => listUntrackedMutableStateFiles(exec));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

    it("blocks a staged copy of an untracked, no-longer-ignored mutable file when the commit removes its ignore rule", () => {
      // `git ls-files --others --ignored --exclude-standard` only reports
      // ignored paths. When a commit removes an ignore rule, the mutable
      // source becomes ordinary untracked content, so the copy guard must
      // still enumerate it independently of Git's rename/copy detection.
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

        // Initially ignore the mutable source so the staged .gitignore
        // edit below reproduces removing that rule in the same commit.
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

        // Sanity-check the initial premise: the source is untracked and
        // ignored, never staged.
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

        // Remove and stage the ignore rule. The mutable file is now
        // untracked but not ignored, even though it was ignored at HEAD.
        writeFileSync(join(dir, ".gitignore"), "");
        execFileSync("git", ["add", ".gitignore"], { cwd: dir, env: isolatedGitEnv });
        const notIgnored = spawnSync(
          "git",
          ["check-ignore", "--quiet", "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.equal(notIgnored.status, 1, "fixture bug: the source should no longer be ignored");
        const untrackedListing = execFileSync(
          "git",
          ["ls-files", "--others", "-z", "--", ".squad"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.ok(
          untrackedListing.split("\0").includes(mutableSource),
          "the unignored mutable source should be enumerated as untracked",
        );
        const ignoredOnlyListing = execFileSync(
          "git",
          ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".squad"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.ok(
          !ignoredOnlyListing.split("\0").includes(mutableSource),
          "fixture bug: the old ignored-only enumeration should miss the unignored source",
        );

        // Copy (not move) identical bytes into an ordinary path and stage
        // only the destination alongside the ignore-rule removal.
        const ordinaryDestination = "docs/laundered-from-unignored.md";
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
          /^A\tdocs\/laundered-from-unignored\.md$/m,
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
          `expected copying an untracked, unignored mutable-state file onto an ordinary path to be ` +
            `rejected:\n${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.match(output, new RegExp(ordinaryDestination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(output, new RegExp(mutableSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.ok(!output.includes(body), "the guard must not log mutable source contents");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("allows an unrelated empty staged file when an ignored mutable-state source is empty", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-empty-mutable-source-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/memory/audit.jsonl";
      const ordinaryDestination = "docs/empty.md";

      try {
        writeFileSync(join(dir, ".gitignore"), `${mutableSource}\n`);
        execFileSync("git", ["add", ".gitignore"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Ignore runtime audit state"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "memory"), { recursive: true });
        writeFileSync(join(dir, mutableSource), Buffer.alloc(0));
        const ignoredStatus = spawnSync("git", ["check-ignore", "--quiet", "--", mutableSource], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(ignoredStatus.status, 0, "fixture bug: the empty mutable source must be ignored");
        const untrackedPaths = execFileSync("git", ["ls-files", "--others", "-z", "--", ".squad"], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        }).split("\0");
        assert.ok(
          untrackedPaths.includes(mutableSource),
          "fixture bug: the empty mutable source must be enumerated",
        );

        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, ordinaryDestination), Buffer.alloc(0));
        execFileSync("git", ["add", ordinaryDestination], { cwd: dir, env: isolatedGitEnv });
        const stagedHash = execFileSync("git", ["rev-parse", `:${ordinaryDestination}`], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        }).trim();
        const sourceHash = execFileSync("git", ["hash-object", "--", mutableSource], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        }).trim();
        assert.equal(stagedHash, sourceHash, "fixture bug: empty source and destination share the empty blob");

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          0,
          `expected an unrelated empty ordinary file to pass the real pre-commit entry point:\n` +
            `${result.stderr}${result.stdout}`,
        );
        assert.doesNotMatch(result.stderr + result.stdout, /byte-identical to an untracked\/ignored/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rejects an added casting migration seed while its ignored source remains", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-casting-seed-copy-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/casting/history.json";
      const approvedSeed = ".squad/templates/casting-history-migration.json";
      const approvedSeedBody = readFileSync(resolve(approvedSeed));

      try {
        writeFileSync(join(dir, ".gitignore"), `${mutableSource}\n`);
        writeFileSync(join(dir, ".gitattributes"), "*.json text eol=lf\n");
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Ignore legacy casting history"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "casting"), { recursive: true });
        writeFileSync(join(dir, mutableSource), approvedSeedBody);
        mkdirSync(join(dir, ".squad", "templates"), { recursive: true });
        writeFileSync(join(dir, approvedSeed), approvedSeedBody);
        execFileSync("git", ["add", approvedSeed], { cwd: dir, env: isolatedGitEnv });

        const mutableSourceStatus = execFileSync(
          "git",
          ["status", "--short", "--ignored", "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        );
        assert.match(
          mutableSourceStatus,
          /!! \.squad\/casting\/history\.json/,
          "fixture bug: the legacy mutable source must remain ignored in the worktree",
        );
        const stagedNameStatus = execFileSync(
          "git",
          ["diff", "--cached", "--name-status", "-z", "-M", "-C", "--find-copies-harder"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        )
          .split("\0")
          .filter(Boolean);
        assert.deepEqual(
          stagedNameStatus,
          ["A", approvedSeed],
          "fixture bug: the seed must be a plain add, not a detected migration rename",
        );
        assert.equal(
          execFileSync("git", ["rev-parse", `:${approvedSeed}`], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          }).trim(),
          "d8f0154c77053e1cb4894277d4ee3630f6c86952",
          "fixture bug: the staged migration seed must use the approved blob",
        );

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected the real pre-commit entry point to reject the added migration seed:\n` +
            `${result.stderr}${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.ok(output.includes(approvedSeed), `expected destination in output:\n${output}`);
        assert.ok(output.includes(mutableSource), `expected source in output:\n${output}`);
        assert.ok(!output.includes(approvedSeedBody.toString()), "the guard must not log history contents");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("allows only the exact R100 casting-history migration rename through the real hook", () => {
      const mutableSource = ".squad/casting/history.json";
      const approvedDestination = ".squad/templates/casting-history-migration.json";
      const expectedBlob = "d8f0154c77053e1cb4894277d4ee3630f6c86952";
      const approvedSeedBody = readFileSync(resolve(approvedDestination));
      const scenarios = [
        {
          name: "approved rename",
          destination: approvedDestination,
          operation: "rename",
          expectedStatus: "R100",
          expectedExit: 0,
        },
        {
          name: "wrong destination",
          destination: ".squad/templates/other-casting-history.json",
          operation: "rename",
          expectedStatus: "R100",
          expectedExit: 1,
        },
        {
          name: "altered blob",
          destination: approvedDestination,
          operation: "altered-rename",
          expectedStatus: "R",
          expectedExit: 1,
        },
        {
          name: "copy rather than rename",
          destination: approvedDestination,
          operation: "copy",
          expectedStatus: "C100",
          expectedExit: 1,
        },
      ] as const;

      for (const scenario of scenarios) {
        const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-casting-history-rename-"));
        const isolatedGitEnv = setupPreCommitTestRepo(dir);

        try {
          writeFileSync(join(dir, ".gitattributes"), "*.json text eol=lf\n");
          execFileSync("git", ["add", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });
          mkdirSync(join(dir, ".squad", "casting"), { recursive: true });
          writeFileSync(join(dir, mutableSource), approvedSeedBody);
          execFileSync("git", ["add", mutableSource], { cwd: dir, env: isolatedGitEnv });
          execFileSync("git", ["commit", "--quiet", "-m", "Track legacy casting history"], {
            cwd: dir,
            env: isolatedGitEnv,
          });

          mkdirSync(join(dir, dirname(scenario.destination)), { recursive: true });
          if (scenario.operation === "copy") {
            writeFileSync(join(dir, scenario.destination), approvedSeedBody);
            execFileSync("git", ["add", scenario.destination], { cwd: dir, env: isolatedGitEnv });
          } else {
            execFileSync("git", ["mv", mutableSource, scenario.destination], {
              cwd: dir,
              env: isolatedGitEnv,
            });
            if (scenario.operation === "altered-rename") {
              const alteredBody = Buffer.from(approvedSeedBody);
              alteredBody[0] = alteredBody[0]! ^ 1;
              writeFileSync(join(dir, scenario.destination), alteredBody);
              execFileSync("git", ["add", scenario.destination], {
                cwd: dir,
                env: isolatedGitEnv,
              });
            }
          }

          const nameStatus = execFileSync(
            "git",
            ["diff", "--cached", "--name-status", "-z", "-M", "-C", "--find-copies-harder"],
            { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
          )
            .split("\0")
            .filter(Boolean);
          const actualStatus = nameStatus[0] ?? "";
          if (scenario.expectedStatus === "R") {
            assert.match(actualStatus, /^R\d+$/, `${scenario.name} fixture should be a rename`);
            assert.notEqual(actualStatus, "R100", "fixture bug: altered content must not be R100");
          } else {
            assert.equal(
              actualStatus,
              scenario.expectedStatus,
              `${scenario.name} fixture should have the expected rename/copy status`,
            );
          }
          assert.equal(
            nameStatus[1],
            mutableSource,
            `${scenario.name} fixture should report the legacy source path`,
          );
          assert.equal(
            nameStatus[2],
            scenario.destination,
            `${scenario.name} fixture should report the intended destination`,
          );

          const stagedBlob = execFileSync("git", ["rev-parse", `:${scenario.destination}`], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          }).trim();
          if (scenario.name === "approved rename") {
            assert.equal(stagedBlob, expectedBlob, "fixture bug: approved blob SHA must be staged");
          } else if (scenario.name === "altered blob") {
            assert.notEqual(stagedBlob, expectedBlob, "fixture bug: altered rename must change the blob");
          }

          const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          });
          assert.equal(
            result.status,
            scenario.expectedExit,
            `${scenario.name} should ${scenario.expectedExit === 0 ? "pass" : "fail"} the real hook:\n` +
              `${result.stderr}${result.stdout}`,
          );
          if (scenario.expectedExit === 1) {
            assert.match(
              result.stderr + result.stdout,
              /\.squad\/casting\/history\.json/,
              `${scenario.name} should remain blocked by the mutable-source boundary`,
            );
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    it("blocks a real staged copy of an untracked/ignored source even when source and destination have different clean-filter rules", () => {
      // Regression test for the follow-up review on commit 441ecac: a
      // naive implementation that hashes the source under its OWN path's
      // `.gitattributes` (rather than the destination's) can miss this
      // exact scenario — the source is marked `-text` (store as-is) and
      // the destination is marked `text eol=lf` (normalize CRLF -> LF on
      // add), so byte-identical CRLF content hashes differently depending
      // on whose attributes apply. Only hashing under
      // `--path=<destination>` reproduces the real staged blob hash.
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-filters-"));
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

        execFileSync("git", ["init", "--quiet"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["config", "user.name", "Pre-commit test"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "user.email", "pre-commit-test@example.invalid"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, env: isolatedGitEnv });

        writeFileSync(
          join(dir, ".gitignore"),
          ".squad/agents/*/history.md\n",
        );
        writeFileSync(
          join(dir, ".gitattributes"),
          [".squad/agents/*/history.md -text", "docs/*.md text eol=lf", ""].join("\n"),
        );
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Add .gitignore and .gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const mutableSource = ".squad/agents/scotty/history.md";
        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        const crlfBody = Buffer.from("line\r\n".repeat(50), "ascii");
        writeFileSync(join(dir, mutableSource), crlfBody);

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

        const ordinaryDestination = "docs/laundered-crlf.md";
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, ordinaryDestination), crlfBody);
        execFileSync("git", ["add", ordinaryDestination], { cwd: dir, env: isolatedGitEnv });

        // Confirm the premise that makes this a meaningful regression test:
        // hashing the source under its OWN path diverges from what Git
        // actually staged for the destination.
        const actualStagedHash = execFileSync(
          "git",
          ["diff", "--cached", "--raw", "--abbrev=40"],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        )
          .trim()
          .split(/\s+/)[3];
        const hashUnderSourceOwnPath = execFileSync(
          "git",
          ["hash-object", "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        ).trim();
        assert.notEqual(
          hashUnderSourceOwnPath,
          actualStagedHash,
          "fixture bug: expected the source's own-path hash to diverge from the real staged " +
            "hash for this test to be a meaningful regression of the --path=<destination> fix",
        );

        const result = spawnSync(process.execPath, [join(scriptsDir, "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected copying an untracked/ignored mutable-state file with differing clean-filter ` +
            `rules onto an ordinary path to be rejected:\n${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.match(output, new RegExp(ordinaryDestination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(output, new RegExp(mutableSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("fails closed for a %f clean filter without running it on mutable-state bytes", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-path-filter-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const firstDestination = "docs/one.md";
      const copiedDestination = "docs/two.md";
      const body = Buffer.from("mutable state copied byte-for-byte\n");

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(join(dir, ".gitattributes"), "docs/*.md filter=path-sensitive\n");
        writeFileSync(
          join(dir, ".git", "clean-filter.cjs"),
          [
            "const fs = require('node:fs');",
            "const chunks = [];",
            "process.stdin.on('data', (chunk) => chunks.push(chunk));",
            "process.stdin.on('end', () => {",
            "  const filterPath = process.argv[2].replace(/^'(.*)'$/, '$1');",
            "  fs.appendFileSync('.git/filter-invocations.log', `${filterPath}\\n`);",
            "  process.stdout.write(Buffer.concat([Buffer.from(`${filterPath}\\n`), ...chunks]));",
            "});",
            "",
          ].join("\n"),
        );
        execFileSync("git", ["config", "filter.path-sensitive.clean", 'node .git/clean-filter.cjs "%f"'], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and filter rules"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, firstDestination), "unrelated staged document\n");
        writeFileSync(join(dir, copiedDestination), body);

        const attributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [firstDestination, copiedDestination],
          true,
        );
        assert.deepEqual(
          attributes.get(firstDestination),
          attributes.get(copiedDestination),
          "fixture bug: destinations must share the same indexed text/eol/filter attributes",
        );

        execFileSync("git", ["add", firstDestination, copiedDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        const stagedFilterInvocations = readFileSync(
          join(dir, ".git", "filter-invocations.log"),
          "utf8",
        )
          .trim()
          .split(/\r?\n/)
          .sort();
        assert.deepEqual(
          stagedFilterInvocations,
          [firstDestination, copiedDestination].sort(),
          "fixture bug: staging should invoke the pathname-aware filter only for ordinary destinations",
        );

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected the real pre-commit entry point to fail closed for a custom clean filter:\n` +
            `${result.stderr}${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.match(output, /custom clean\/process filter/i);
        assert.ok(output.includes(copiedDestination), `expected destination in output:\n${output}`);
        assert.ok(!output.includes(body.toString()), "the guard must not log mutable source contents");
        const filterInvocationsAfterHook = readFileSync(
          join(dir, ".git", "filter-invocations.log"),
          "utf8",
        )
          .trim()
          .split(/\r?\n/)
          .sort();
        assert.deepEqual(
          filterInvocationsAfterHook,
          stagedFilterInvocations,
          "pre-commit must not execute the clean filter against mutable-state source bytes",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("fails closed when .gitattributes changes after the mutable copy was staged", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-attr-divergence-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const firstDestination = "docs/one.md";
      const copiedDestination = "docs/two.md";

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(join(dir, ".gitattributes"), "docs/*.md -ident\n");
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and baseline ident rules"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        const identBody = Buffer.from(`$Id: ${"b".repeat(40)} $\n`);
        writeFileSync(join(dir, mutableSource), identBody);
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, firstDestination), "unrelated staged document\n");
        writeFileSync(join(dir, copiedDestination), identBody);
        execFileSync("git", ["add", firstDestination, copiedDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        const stagedCopyHash = execFileSync("git", ["rev-parse", `:${copiedDestination}`], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        }).trim();
        const hashUnderOriginalAttributes = execFileSync(
          "git",
          ["hash-object", "--stdin"],
          { cwd: dir, encoding: "utf8", input: identBody, env: isolatedGitEnv },
        ).trim();
        assert.equal(
          stagedCopyHash,
          hashUnderOriginalAttributes,
          "fixture bug: git add must stage the copy before the attribute change",
        );

        writeFileSync(
          join(dir, ".gitattributes"),
          ["docs/*.md -ident", "docs/two.md ident", ""].join("\n"),
        );
        assert.notEqual(
          execFileSync("git", ["diff", "--", ".gitattributes"], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          }),
          "",
          "fixture bug: .gitattributes must differ in the worktree",
        );
        assert.equal(
          execFileSync("git", ["diff", "--cached", "--", ".gitattributes"], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          }),
          "",
          "fixture bug: divergent .gitattributes must not be staged",
        );

        const indexedAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [firstDestination, copiedDestination],
          true,
          ["ident"],
        );
        const worktreeAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [firstDestination, copiedDestination],
          false,
          ["ident"],
        );
        assert.equal(
          indexedAttributes.get(firstDestination)?.ident,
          indexedAttributes.get(copiedDestination)?.ident,
          "fixture bug: cached attributes must group both destinations under the same ident value",
        );
        assert.notEqual(
          worktreeAttributes.get(firstDestination)?.ident,
          worktreeAttributes.get(copiedDestination)?.ident,
          "fixture bug: worktree attributes must diverge after staging the copy",
        );

        const hashUnderCurrentWorktreeAttributes = execFileSync(
          "git",
          ["hash-object", "--filters", `--path=${copiedDestination}`, "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        ).trim();
        assert.notEqual(
          hashUnderCurrentWorktreeAttributes,
          stagedCopyHash,
          "fixture bug: post-stage worktree attributes must hash the mutable source differently",
        );

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected the real pre-commit entry point to reject ambiguous staged attributes:\n` +
            `${result.stderr}${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.match(output, /differ between the index and worktree/i);
        assert.ok(output.includes(copiedDestination), `expected destination in output:\n${output}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("blocks a staged copy when matching index/worktree attributes were changed after the copy was staged", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-staged-attrs-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const copiedDestination = "docs/copied.md";

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(join(dir, ".gitattributes"), "docs/*.md -ident\n");
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and baseline attributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        const identBody = Buffer.from(`$Id: ${"c".repeat(40)} $\n`);
        writeFileSync(join(dir, mutableSource), identBody);
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, copiedDestination), identBody);
        execFileSync("git", ["add", copiedDestination], { cwd: dir, env: isolatedGitEnv });

        const stagedCopyHash = execFileSync("git", ["rev-parse", `:${copiedDestination}`], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        }).trim();
        const hashUnderOriginalAttributes = execFileSync(
          "git",
          ["hash-object", "--filters", `--path=${copiedDestination}`, "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        ).trim();
        assert.equal(
          stagedCopyHash,
          hashUnderOriginalAttributes,
          "fixture bug: the copy must first be staged with the original -ident rule",
        );

        writeFileSync(join(dir, ".gitattributes"), "docs/*.md ident\n");
        execFileSync("git", ["add", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });

        const indexedAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [copiedDestination],
          true,
          ["ident"],
        );
        const worktreeAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [copiedDestination],
          false,
          ["ident"],
        );
        assert.equal(
          indexedAttributes.get(copiedDestination)?.ident,
          "set",
          "fixture bug: index attributes should contain the newly staged ident rule",
        );
        assert.equal(
          worktreeAttributes.get(copiedDestination)?.ident,
          "set",
          "fixture bug: worktree attributes should match the index",
        );

        const hashUnderCurrentAttributes = execFileSync(
          "git",
          ["hash-object", "--filters", `--path=${copiedDestination}`, "--", mutableSource],
          { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
        ).trim();
        assert.notEqual(
          hashUnderCurrentAttributes,
          stagedCopyHash,
          "fixture bug: current ident conversion must differ from the previously staged blob",
        );
        const hashUnderHeadAttributes = execFileSync(
          "git",
          ["hash-object", "--filters", `--path=${copiedDestination}`, "--", mutableSource],
          {
            cwd: dir,
            encoding: "utf8",
            env: { ...isolatedGitEnv, GIT_ATTR_SOURCE: "HEAD" },
          },
        ).trim();
        assert.equal(
          hashUnderHeadAttributes,
          stagedCopyHash,
          "fixture bug: GIT_ATTR_SOURCE=HEAD must reproduce the filter rules used by the first git add",
        );

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          1,
          `expected the guard to reject the copy staged under superseded attributes:\n` +
            `${result.stderr}${result.stdout}`,
        );
        const output = result.stderr + result.stdout;
        assert.ok(output.includes(copiedDestination), `expected destination in output:\n${output}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("allows partial staging when a staged attribute change does not affect the destination", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-unrelated-staged-attrs-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const partiallyStagedDestination = "docs/partial.md";

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(
          join(dir, ".gitattributes"),
          ["docs/*.md -ident", "assets/*.md -ident", ""].join("\n"),
        );
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and baseline attributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), "private mutable state\n");
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, partiallyStagedDestination), "staged version\n");
        execFileSync("git", ["add", partiallyStagedDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        writeFileSync(join(dir, partiallyStagedDestination), "unstaged follow-up edit\n");

        writeFileSync(
          join(dir, ".gitattributes"),
          ["docs/*.md -ident", "assets/*.md ident", ""].join("\n"),
        );
        execFileSync("git", ["add", ".gitattributes"], { cwd: dir, env: isolatedGitEnv });

        const indexedAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [partiallyStagedDestination],
          true,
          ["ident"],
        );
        const worktreeAttributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [partiallyStagedDestination],
          false,
          ["ident"],
        );
        assert.equal(
          indexedAttributes.get(partiallyStagedDestination)?.ident,
          worktreeAttributes.get(partiallyStagedDestination)?.ident,
          "fixture bug: the unrelated attribute change must leave the destination's rules unchanged",
        );
        assert.notEqual(
          execFileSync("git", ["rev-parse", `:${partiallyStagedDestination}`], {
            cwd: dir,
            encoding: "utf8",
            env: isolatedGitEnv,
          }).trim(),
          execFileSync(
            "git",
            [
              "hash-object",
              "--filters",
              `--path=${partiallyStagedDestination}`,
              "--",
              partiallyStagedDestination,
            ],
            { cwd: dir, encoding: "utf8", env: isolatedGitEnv },
          ).trim(),
          "fixture bug: the destination must retain a valid staged/working-tree content difference",
        );

        const result = spawnSync(process.execPath, [join(dir, "scripts", "pre-commit.mjs")], {
          cwd: dir,
          encoding: "utf8",
          env: isolatedGitEnv,
        });
        assert.equal(
          result.status,
          0,
          `expected unrelated attribute changes not to block partial staging:\n` +
            `${result.stderr}${result.stdout}`,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps ident differences in grouping signatures and blocks the normalized copy", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-ident-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const firstDestination = "docs/one.md";
      const copiedDestination = "docs/two.md";
      const body = Buffer.from(`$Id: ${"a".repeat(40)} $\n`);

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(
          join(dir, ".gitattributes"),
          ["docs/*.md -ident", "docs/two.md ident", ""].join("\n"),
        );
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and ident rules"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, firstDestination), "unrelated staged document\n");
        writeFileSync(join(dir, copiedDestination), body);

        const attributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [firstDestination, copiedDestination],
          true,
          ["ident"],
        );
        assert.notEqual(
          attributes.get(firstDestination)?.ident,
          attributes.get(copiedDestination)?.ident,
          "fixture bug: destinations must differ on ident",
        );

        execFileSync("git", ["add", firstDestination, copiedDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        assertPathAwareMutableCopyRejected(
          dir,
          isolatedGitEnv,
          mutableSource,
          firstDestination,
          copiedDestination,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps working-tree-encoding differences in grouping signatures and blocks the converted copy", () => {
      const dir = mkdtempSync(join(tmpdir(), "stfc-pre-commit-untracked-copy-encoding-"));
      const isolatedGitEnv = setupPreCommitTestRepo(dir);
      const mutableSource = ".squad/agents/scotty/history.md";
      const firstDestination = "docs/one.md";
      const copiedDestination = "docs/two.md";
      const body = Buffer.from("mutable state encoded as UTF-16LE\n", "utf16le");

      try {
        writeFileSync(join(dir, ".gitignore"), ".squad/agents/*/history.md\n");
        writeFileSync(
          join(dir, ".gitattributes"),
          ["docs/*.md -working-tree-encoding", "docs/two.md working-tree-encoding=UTF-16LE", ""].join(
            "\n",
          ),
        );
        execFileSync("git", ["add", ".gitignore", ".gitattributes"], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        execFileSync("git", ["commit", "--quiet", "-m", "Add ignore and encoding rules"], {
          cwd: dir,
          env: isolatedGitEnv,
        });

        mkdirSync(join(dir, ".squad", "agents", "scotty"), { recursive: true });
        writeFileSync(join(dir, mutableSource), body);
        mkdirSync(join(dir, "docs"), { recursive: true });
        writeFileSync(join(dir, firstDestination), "unrelated staged document\n");
        writeFileSync(join(dir, copiedDestination), body);

        const attributes = getGitAttributeValues(
          dir,
          isolatedGitEnv,
          [firstDestination, copiedDestination],
          true,
          ["working-tree-encoding"],
        );
        assert.notEqual(
          attributes.get(firstDestination)?.["working-tree-encoding"],
          attributes.get(copiedDestination)?.["working-tree-encoding"],
          "fixture bug: destinations must differ on working-tree-encoding",
        );

        execFileSync("git", ["add", firstDestination, copiedDestination], {
          cwd: dir,
          env: isolatedGitEnv,
        });
        assertPathAwareMutableCopyRejected(
          dir,
          isolatedGitEnv,
          mutableSource,
          firstDestination,
          copiedDestination,
        );
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
