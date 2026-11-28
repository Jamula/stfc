// Tests for src/discord/state.ts (T010). Covers round-trip for every state
// file type; missing-file behavior for suppression + cooldowns; cooldowns
// eviction at the 7-day boundary; and a structural assertion that the module
// exports NO save* / write* function for suppression (operator-only invariant
// per state-files.contract.md cross-file invariant #4).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AllowlistFileError,
  StateFileError,
  appendCandidate,
  appendTipSeen,
  loadAllowlist,
  loadCooldowns,
  loadCursors,
  loadSuppression,
  readCandidates,
  readTipsSeen,
  saveCooldowns,
  saveCursors,
  stringifyDeterministic,
} from "../../src/discord/state.ts";
import type {
  CandidateCode,
  CooldownMap,
  IngestionCursorMap,
  TipsSeenLine,
} from "../../src/discord/schemas.ts";
import * as stateModule from "../../src/discord/state.ts";

const OKAY_ALLOWLIST = {
  version: 1 as const,
  entries: [
    {
      serverId: "509679626763632640",
      serverLabel: "Test Server",
      channelId: "509685530108362773",
      channelLabel: "general",
      addedAt: "2026-05-13T00:00:00Z",
      addedBy: "octocat",
      enabled: true,
    },
  ],
};

const OKAY_CURSORS: IngestionCursorMap = {
  "222222222222222222": {
    channelLabel: "general",
    lastMessageId: "411111111111111150",
    lastTimestamp: "2026-05-13T13:49:00Z",
    lastRunId: "run-1",
    lastRunAt: "2026-05-13T13:49:30Z",
  },
};

function makeCandidate(value: string, status: CandidateCode["status"]): CandidateCode {
  return {
    value,
    firstSeen: "2026-05-13T10:00:00Z",
    lastAttempted: null,
    suppressedUntil: null,
    extractionConfidence: 0.9,
    status,
    source: {
      messageId: "111111111111111111",
      channelId: "222222222222222222",
      channelLabel: "promos",
      timestamp: "2026-05-13T10:00:00Z",
      jumpLink:
        "https://discord.com/channels/509679626763632640/222222222222222222/111111111111111111",
    },
    perAccountOutcome: [],
  };
}

describe("stringifyDeterministic", () => {
  it("sorts object keys alphabetically at every level + trailing newline", () => {
    const out = stringifyDeterministic({ b: 1, a: { d: 2, c: 3 } });
    assert.equal(out, '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
  });

  it("preserves array order (only object keys are sorted)", () => {
    const out = stringifyDeterministic({ list: [3, 1, 2] });
    assert.equal(out, '{\n  "list": [\n    3,\n    1,\n    2\n  ]\n}\n');
  });
});

describe("state I/O", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-state-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── Allowlist ─────────────────────────────────────────────────────────────

  describe("loadAllowlist", () => {
    it("round-trips a well-formed allowlist", async () => {
      const file = path.join(dir, "allowlist.json");
      fs.writeFileSync(file, stringifyDeterministic(OKAY_ALLOWLIST), "utf8");
      const got = await loadAllowlist(file);
      assert.deepEqual(got, OKAY_ALLOWLIST);
    });

    it("throws AllowlistFileError when the file is missing (hard requirement)", async () => {
      const file = path.join(dir, "does-not-exist.json");
      await assert.rejects(() => loadAllowlist(file), AllowlistFileError);
    });

    it("throws AllowlistFileError on malformed JSON", async () => {
      const file = path.join(dir, "bad.json");
      fs.writeFileSync(file, "{ this is not JSON", "utf8");
      await assert.rejects(() => loadAllowlist(file), AllowlistFileError);
    });

    it("throws AllowlistFileError when schema validation fails", async () => {
      const file = path.join(dir, "bad-shape.json");
      fs.writeFileSync(file, JSON.stringify({ version: 2, entries: [] }), "utf8");
      await assert.rejects(() => loadAllowlist(file), AllowlistFileError);
    });
  });

  // ── Cursors ───────────────────────────────────────────────────────────────

  describe("cursors", () => {
    it("round-trips a non-empty cursor map", async () => {
      const file = path.join(dir, "cursors.json");
      await saveCursors(OKAY_CURSORS, file);
      const got = await loadCursors(file);
      assert.deepEqual(got, OKAY_CURSORS);
    });

    it("preserves the previous cursor if atomic replacement fails", async (t) => {
      const file = path.join(dir, "cursors.json");
      await saveCursors(OKAY_CURSORS, file);
      const before = fs.readFileSync(file, "utf8");
      t.mock.method(fs.promises, "rename", async () => {
        throw new Error("simulated rename failure");
      });

      await assert.rejects(() => saveCursors({}, file), /simulated rename failure/);
      assert.equal(fs.readFileSync(file, "utf8"), before);
      assert.deepEqual(fs.readdirSync(dir), ["cursors.json"]);
    });

    it("missing file → {} (skill creates on first successful run)", async () => {
      const file = path.join(dir, "missing.json");
      assert.deepEqual(await loadCursors(file), {});
    });

    it("write produces deterministic JSON (sorted keys, 2-space, trailing newline)", async () => {
      const file = path.join(dir, "cursors.json");
      await saveCursors(OKAY_CURSORS, file);
      const raw = fs.readFileSync(file, "utf8");
      assert.match(raw, /\n$/, "trailing newline");
      // Expected layout — channelId key, then alphabetized child keys.
      assert.equal(
        raw,
        '{\n' +
          '  "222222222222222222": {\n' +
          '    "channelLabel": "general",\n' +
          '    "lastMessageId": "411111111111111150",\n' +
          '    "lastRunAt": "2026-05-13T13:49:30Z",\n' +
          '    "lastRunId": "run-1",\n' +
          '    "lastTimestamp": "2026-05-13T13:49:00Z"\n' +
          '  }\n' +
          '}\n',
      );
    });

    it("refuses to write a malformed cursor map", async () => {
      const file = path.join(dir, "cursors.json");
      const bad = { foo: { channelLabel: "x" } } as unknown as IngestionCursorMap;
      await assert.rejects(() => saveCursors(bad, file), StateFileError);
    });
  });

  // ── Candidates JSONL ─────────────────────────────────────────────────────

  describe("candidates JSONL", () => {
    it("append + read returns latest-line-wins per value", async () => {
      const file = path.join(dir, "candidates.jsonl");
      await appendCandidate(makeCandidate("ALPHA", "pending"), file);
      await appendCandidate(makeCandidate("BETA", "pending"), file);
      await appendCandidate(makeCandidate("ALPHA", "redeemed"), file);
      const got = await readCandidates(file);
      assert.equal(got.size, 2);
      assert.equal(got.get("ALPHA")?.status, "redeemed");
      assert.equal(got.get("BETA")?.status, "pending");
    });

    it("missing file → empty map", async () => {
      const got = await readCandidates(path.join(dir, "absent.jsonl"));
      assert.equal(got.size, 0);
    });

    it("refuses to append a malformed candidate", async () => {
      const file = path.join(dir, "candidates.jsonl");
      const bad = { ...makeCandidate("ALPHA", "pending"), value: "lowercase" };
      await assert.rejects(() => appendCandidate(bad as CandidateCode, file), StateFileError);
    });
  });

  // ── Tips-seen JSONL ──────────────────────────────────────────────────────

  describe("tips-seen JSONL", () => {
    const line = (hash: string): TipsSeenLine => ({
      contentHash: hash,
      firstSeenAt: "2026-05-13T11:00:00Z",
      category: "tip",
    });

    it("append + read returns latest-line-wins per contentHash", async () => {
      const file = path.join(dir, "tips-seen.jsonl");
      await appendTipSeen(line("aaaaaaaaaaaaaaaa"), file);
      await appendTipSeen(line("bbbbbbbbbbbbbbbb"), file);
      // Re-append same hash with different category to confirm last-wins.
      await appendTipSeen(
        { ...line("aaaaaaaaaaaaaaaa"), category: "trick" },
        file,
      );
      const got = await readTipsSeen(file);
      assert.equal(got.size, 2);
      assert.equal(got.get("aaaaaaaaaaaaaaaa")?.category, "trick");
    });

    it("missing file → empty map", async () => {
      const got = await readTipsSeen(path.join(dir, "absent.jsonl"));
      assert.equal(got.size, 0);
    });
  });

  // ── Suppression (read-only) ──────────────────────────────────────────────

  describe("suppression", () => {
    it("missing file → {} (treated as 'no operator rules')", async () => {
      const got = await loadSuppression(path.join(dir, "absent.json"));
      assert.deepEqual(got, {});
    });

    it("round-trips a populated suppression map (operator wrote it)", async () => {
      const file = path.join(dir, "suppression.json");
      const operatorWritten = {
        DENYME: {
          action: "deny" as const,
          reason: "false positive — marketing copy",
          addedAt: "2026-05-13T00:00:00Z",
          addedBy: "octocat",
        },
      };
      // Operator wrote it by hand (not via this module).
      fs.writeFileSync(file, stringifyDeterministic(operatorWritten), "utf8");
      const got = await loadSuppression(file);
      assert.deepEqual(got, operatorWritten);
    });

    it("throws StateFileError on schema mismatch", async () => {
      const file = path.join(dir, "bad.json");
      fs.writeFileSync(file, JSON.stringify({ X: { action: "maybe" } }), "utf8");
      await assert.rejects(() => loadSuppression(file), StateFileError);
    });

    it("state module exports NO save/write function for suppression (operator-only invariant)", () => {
      const names = Object.keys(stateModule);
      const forbidden = names.filter(
        (n) =>
          /suppression/i.test(n) &&
          (n.startsWith("save") || n.startsWith("write")),
      );
      assert.deepEqual(
        forbidden,
        [],
        `state.ts MUST NOT export any save*/write* function for suppression; found: ${forbidden.join(", ")}`,
      );
    });
  });

  // ── Cooldowns ────────────────────────────────────────────────────────────

  describe("cooldowns", () => {
    const now = new Date("2026-06-01T00:00:00Z");

    function entry(failedAt: string, suppressedUntil: string): CooldownMap[string] {
      return {
        firstFailedAt: failedAt,
        lastFailedAt: failedAt,
        suppressedUntil,
        failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
      };
    }

    it("missing file → {}", async () => {
      const got = await loadCooldowns(path.join(dir, "absent.json"));
      assert.deepEqual(got, {});
    });

    it("round-trips a populated cooldown map", async () => {
      const file = path.join(dir, "cooldowns.json");
      const map: CooldownMap = {
        FRESHFAIL: entry("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      };
      await saveCooldowns(map, now, file);
      assert.deepEqual(await loadCooldowns(file), map);
    });

    it("evicts entries whose suppressedUntil < now - 7d on every write", async () => {
      const file = path.join(dir, "cooldowns.json");
      const map: CooldownMap = {
        // Expired well over a week ago → evicted.
        STALE: entry("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"),
        // suppressedUntil exactly 7 days ago → AT the boundary, kept
        // (eviction cutoff is strict `<`).
        EDGE: entry("2026-04-25T00:00:00Z", "2026-05-25T00:00:00Z"),
        // Future suppression — kept.
        ACTIVE: entry("2026-05-30T00:00:00Z", "2026-06-29T00:00:00Z"),
      };
      await saveCooldowns(map, now, file);
      const got = await loadCooldowns(file);
      assert.deepEqual(Object.keys(got).sort(), ["ACTIVE", "EDGE"]);
    });

    it("writes deterministic sorted JSON with trailing newline", async () => {
      const file = path.join(dir, "cooldowns.json");
      const map: CooldownMap = {
        ZZZ: entry("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
        AAA: entry("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      };
      await saveCooldowns(map, now, file);
      const raw = fs.readFileSync(file, "utf8");
      assert.match(raw, /\n$/);
      const aaaIdx = raw.indexOf('"AAA"');
      const zzzIdx = raw.indexOf('"ZZZ"');
      assert.ok(aaaIdx > 0 && aaaIdx < zzzIdx, "top-level keys sorted A→Z");
    });

    it("refuses to write a malformed entry", async () => {
      const file = path.join(dir, "cooldowns.json");
      const bad = {
        FOO: { firstFailedAt: "nope", lastFailedAt: "nope", suppressedUntil: "nope", failureOutcomes: [] },
      } as unknown as CooldownMap;
      await assert.rejects(() => saveCooldowns(bad, now, file), StateFileError);
    });
  });
});
