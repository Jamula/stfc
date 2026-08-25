// Behavioral fixtures for scripts/check-retro-overdue.mjs (issue #245; #248
// Garak finding 2 — "the state-backend branch is described, not implemented,
// and its clocks are unsafe").
//
// Exercises the actual exported functions against real fixtures: positive
// (recent retro present) and negative (missing/stale/future/malformed
// timestamp) cases, UTC boundary handling, and the local-vs-non-local
// backend adapter boundary. Registered in tests/index.test.ts per the
// project's test-registration convention.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseLogTimestamp,
  isRetroOverdue,
  listLocalRetroLogs,
  checkRetroOverdue,
  checkActionItemsCreated,
  readRetroLogContent,
} from "../../scripts/check-retro-overdue.mjs";

const FIXED_NOW = new Date("2026-08-24T12:00:00Z");

describe("check-retro-overdue: parseLogTimestamp", () => {
  it("parses the canonical ISO-8601 filename format in UTC", () => {
    const d = parseLogTimestamp("2026-08-23T19-01-46Z-retrospective.md");
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-08-23T19:01:46.000Z");
  });

  it("parses the legacy YYYYMMDD-HHMMSS filename format in UTC", () => {
    const d = parseLogTimestamp("20260823-190146-retrospective.md");
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-08-23T19:01:46.000Z");
  });

  it("returns null for a filename with no recognizable timestamp", () => {
    assert.equal(parseLogTimestamp("retrospective-notes.md"), null);
  });

  it("returns null for a calendar-invalid timestamp (month 13)", () => {
    assert.equal(parseLogTimestamp("2026-13-40T25-99-99Z-retrospective.md"), null);
  });

  it("returns null for time-field overflow that Date.UTC would otherwise normalize", () => {
    assert.equal(parseLogTimestamp("2026-08-23T19-60-00Z-retrospective.md"), null);
    assert.equal(parseLogTimestamp("2026-08-23T19-01-60Z-retrospective.md"), null);
  });

  it("handles a full path, not just a basename", () => {
    const d = parseLogTimestamp(".squad/log/2026-08-23T19-01-46Z-retrospective.md");
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-08-23T19:01:46.000Z");
  });
});

describe("check-retro-overdue: isRetroOverdue (pure decision logic)", () => {
  it("reports overdue when there are no entries at all", () => {
    assert.equal(isRetroOverdue({ entries: [], now: FIXED_NOW }), true);
  });

  it("reports overdue when entries exist but none match *retrospective*", () => {
    assert.equal(
      isRetroOverdue({ entries: ["2026-08-23T19-01-46Z-session.md"], now: FIXED_NOW }),
      true,
    );
  });

  it("reports NOT overdue when a retrospective log is within the window", () => {
    assert.equal(
      isRetroOverdue({
        entries: ["2026-08-20T00-00-00Z-retrospective.md"],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      false,
    );
  });

  it("reports overdue when the only retrospective log is outside the window", () => {
    assert.equal(
      isRetroOverdue({
        entries: ["2026-08-01T00-00-00Z-retrospective.md"],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      true,
    );
  });

  it("treats an unparseable retrospective filename as NOT recent (fail closed)", () => {
    assert.equal(
      isRetroOverdue({
        entries: ["retrospective-final-FINAL.md"],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      true,
    );
  });

  it("rejects a future-dated retrospective log — never treated as recent", () => {
    assert.equal(
      isRetroOverdue({
        entries: ["2026-08-25T00-00-00Z-retrospective.md"], // 1 day after FIXED_NOW
        windowDays: 7,
        now: FIXED_NOW,
      }),
      true,
    );
  });

  it("is not fooled by a future log when a genuinely recent one also exists", () => {
    assert.equal(
      isRetroOverdue({
        entries: [
          "2026-08-25T00-00-00Z-retrospective.md", // future — ignored
          "2026-08-22T00-00-00Z-retrospective.md", // recent — counts
        ],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      false,
    );
  });

  it("UTC boundary: a log exactly `windowDays` ago is still within the window", () => {
    // FIXED_NOW - 7 days, to the second.
    assert.equal(
      isRetroOverdue({
        entries: ["2026-08-17T12-00-00Z-retrospective.md"],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      false,
    );
  });

  it("UTC boundary: a log one second past the window is overdue", () => {
    assert.equal(
      isRetroOverdue({
        entries: ["2026-08-17T11-59-59Z-retrospective.md"],
        windowDays: 7,
        now: FIXED_NOW,
      }),
      true,
    );
  });

  it("throws a TypeError when entries is not an array", () => {
    assert.throws(() => isRetroOverdue({ entries: undefined as unknown as string[] }), TypeError);
  });
});

describe("check-retro-overdue: local/worktree filesystem adapter", () => {
  it("listLocalRetroLogs reads real retrospective files from a temp dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-log-"));
    try {
      fs.writeFileSync(path.join(dir, "2026-08-20T00-00-00Z-retrospective.md"), "# retro\n#1234\n");
      fs.writeFileSync(path.join(dir, "2026-08-20T00-00-00Z-session.md"), "# not a retro\n");
      const found = listLocalRetroLogs(dir);
      assert.deepEqual(found, ["2026-08-20T00-00-00Z-retrospective.md"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listLocalRetroLogs returns [] for a missing directory (ENOENT is treated as 'no logs yet')", () => {
    assert.deepEqual(listLocalRetroLogs(path.join(os.tmpdir(), "definitely-does-not-exist-xyz")), []);
  });

  it("listLocalRetroLogs propagates a real read fault instead of masking it as an empty directory (#248 Copilot review finding)", () => {
    // Passing a path to a FILE (not a directory) forces readdirSync to
    // fail with ENOTDIR, not ENOENT -- a genuine I/O fault distinct from
    // "the directory doesn't exist yet", which must not be silently
    // swallowed into an empty listing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-log-fault-"));
    try {
      const filePath = path.join(dir, "not-a-directory.txt");
      fs.writeFileSync(filePath, "x");
      assert.throws(() => listLocalRetroLogs(filePath), /could not read log directory/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkRetroOverdue(local) is NOT overdue when a fresh retro log exists on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-log-"));
    try {
      const recent = new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
      const name = `${recent.toISOString().slice(0, 19).replace(/:/g, "-")}Z-retrospective.md`;
      fs.writeFileSync(path.join(dir, name), "# retro\n#1234\n");
      const overdue = checkRetroOverdue({ backend: "local", logDir: dir, windowDays: 7, now: FIXED_NOW });
      assert.equal(overdue, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkRetroOverdue(worktree) with an empty directory is overdue", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-log-"));
    try {
      assert.equal(checkRetroOverdue({ backend: "worktree", logDir: dir, now: FIXED_NOW }), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkRetroOverdue does NOT silently mistake a stale filesystem snapshot for freshness (explicit entries override)", () => {
    // Simulates the two-layer case: the filesystem copy is stale, but the
    // caller has already fetched fresher entries from squad_state_list and
    // must be able to force them through regardless of `backend`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-log-"));
    try {
      fs.writeFileSync(path.join(dir, "2020-01-01T00-00-00Z-retrospective.md"), "# stale\n");
      const overdue = checkRetroOverdue({
        backend: "local",
        logDir: dir,
        entries: ["2026-08-22T00-00-00Z-retrospective.md"],
        now: FIXED_NOW,
      });
      assert.equal(overdue, false, "explicit entries must take precedence over the stale filesystem listing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-retro-overdue: non-local backend adapter boundary", () => {
  it("throws when a non-local backend is given without entries (no filesystem fallback)", () => {
    assert.throws(
      () => checkRetroOverdue({ backend: "two-layer", now: FIXED_NOW }),
      /not filesystem-backed/,
    );
  });

  it("throws for orphan backend without entries", () => {
    assert.throws(() => checkRetroOverdue({ backend: "orphan", now: FIXED_NOW }), /not filesystem-backed/);
  });

  it("throws for git-notes backend without entries", () => {
    assert.throws(() => checkRetroOverdue({ backend: "git-notes", now: FIXED_NOW }), /not filesystem-backed/);
  });

  it("computes overdue correctly for a non-local backend when entries ARE supplied (squad_state_list result)", () => {
    const overdue = checkRetroOverdue({
      backend: "two-layer",
      entries: ["2026-08-23T00-00-00Z-retrospective.md"],
      windowDays: 7,
      now: FIXED_NOW,
    });
    assert.equal(overdue, false);
  });
});

describe("check-retro-overdue: checkActionItemsCreated (Test-RetroActionItemsCreated equivalent)", () => {
  it("ok=true when Issue references exist and no open checkboxes", () => {
    const result = checkActionItemsCreated("Action items:\n- Fix the thing (#1234)\n- Follow up (issues/5678)\n");
    assert.equal(result.ok, true);
    assert.equal(result.issueRefCount, 2);
    assert.equal(result.openCheckboxCount, 0);
  });

  it("ok=false when open markdown checkboxes are present, even alongside issue refs", () => {
    const result = checkActionItemsCreated("- [ ] do the thing\n- Fixed in #1234\n");
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /markdown checkbox/);
  });

  it("ok=false for open markdown checkboxes with other valid bullet markers or indentation", () => {
    for (const content of ["* [ ] follow up\n- Fixed in #1234\n", "+ [ ] follow up\n- Fixed in #1234\n", "  - [ ] follow up\n- Fixed in #1234\n"]) {
      const result = checkActionItemsCreated(content);
      assert.equal(result.ok, false);
      assert.match(result.reason ?? "", /markdown checkbox/);
    }
  });

  it("ok=false when there are no issue references at all", () => {
    const result = checkActionItemsCreated("Just some notes, no tracked items.\n");
    assert.equal(result.ok, false);
    assert.equal(result.issueRefCount, 0);
  });

  it("recognizes short issue references (#1 or fewer than 3 digits), not just 3+ digit numbers (#248 Copilot review finding)", () => {
    const result = checkActionItemsCreated("Fixed in #1\nAlso see issues/42\n");
    assert.equal(result.ok, true);
    assert.equal(result.issueRefCount, 2);
  });

  it("does NOT recognize #0 or issues/0 as valid issue references — GitHub issue numbers are positive (#248 Copilot review finding)", () => {
    const result = checkActionItemsCreated("See #0 and issues/0 for details\n");
    assert.equal(result.ok, false);
    assert.equal(result.issueRefCount, 0);
  });

  it("recognizes a real reference even when a #0/issues/0 false reference is also present", () => {
    const result = checkActionItemsCreated("See #0 for the placeholder, real fix in #7\n");
    assert.equal(result.ok, true);
    assert.equal(result.issueRefCount, 1);
  });

  it("readRetroLogContent reads from disk for local backend", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-content-"));
    try {
      const file = path.join(dir, "retro.md");
      fs.writeFileSync(file, "content with #999\n");
      assert.equal(
        readRetroLogContent({ backend: "local", retroLogPath: file }),
        "content with #999\n",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readRetroLogContent throws for non-local backend without explicit content", () => {
    assert.throws(() => readRetroLogContent({ backend: "orphan" }), /not filesystem-backed/);
  });

  it("readRetroLogContent passes explicit content through for any backend", () => {
    assert.equal(readRetroLogContent({ backend: "orphan", content: "hello #1" }), "hello #1");
  });
});
