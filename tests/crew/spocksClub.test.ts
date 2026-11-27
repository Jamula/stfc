import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { loadOfficerDatabase } from "../../src/crew/database.ts";
import { exportSpocksClubRoster, importSpocksClubRoster } from "../../src/crew/spocksClub.ts";
import { roster } from "../../src/skills/roster.ts";

describe("spocksClub — JSON roster import/export compatibility (#472)", () => {
  it("matches officers by id or display name, converts tier -> promotions, and surfaces unmatched names", async () => {
    const db = await loadOfficerDatabase();
    const fixedNow = new Date("2026-11-26T20:00:00.000Z");

    const rawJson = JSON.stringify({
      officers: [
        { name: "James T. Kirk", owned: true, level: 45, rank: 4, tier: 4 },
        { id: "chen", unlocked: true, level: 30, rank: 5, tier: 5 },
        { id: "gorkon", owned: false, level: 0, rank: 0 },
        { name: "Future Unreleased Admiral", owned: true, level: 10, rank: 1, tier: 1 },
      ],
    });

    const imported = importSpocksClubRoster({
      rawJson,
      account: "main",
      database: db,
      now: fixedNow,
    });

    assert.equal(imported.importedCount, 3);
    assert.deepEqual(imported.unmatchedOfficers, ["Future Unreleased Admiral"]);

    const kirk = imported.roster.officers.find((o) => o.id === "kirk");
    assert.deepEqual(kirk, {
      id: "kirk",
      owned: true,
      level: 45,
      rank: 4,
      promotions: 3,
    });

    const gorkon = imported.roster.officers.find((o) => o.id === "gorkon");
    assert.deepEqual(gorkon, { id: "gorkon", owned: false });

    const exported = exportSpocksClubRoster({
      roster: imported.roster,
      database: db,
      now: fixedNow,
    });
    assert.equal(exported.format, "spocks.club-compatible/v1");
    assert.equal(exported.account, "main");
    const exportedKirk = exported.officers.find((o) => o.id === "kirk");
    assert.equal(exportedKirk?.tier, 4);
    assert.equal(exportedKirk?.promotions, 3);
  });

  it("accepts tier: 0 unowned exports, round-trips high promotions, and blocks path traversal in --account", async () => {
    const db = await loadOfficerDatabase();
    const imported = importSpocksClubRoster({
      rawJson: JSON.stringify([
        { id: "gorkon", tier: 0, level: 0, rank: 0 },
        { id: "kirk", owned: true, level: 60, rank: 5, promotions: 12 },
      ]),
      account: "main",
      database: db,
    });
    assert.deepEqual(
      imported.roster.officers.find((o) => o.id === "gorkon"),
      { id: "gorkon", owned: false },
    );
    const reimported = importSpocksClubRoster({
      rawJson: JSON.stringify(exportSpocksClubRoster({ roster: imported.roster, database: db })),
      account: "main",
      database: db,
    });
    assert.equal(reimported.roster.officers.find((o) => o.id === "kirk")?.owned, true);

    const dir = await fs.mkdtemp(path.join(tmpdir(), "stfc-roster-traversal-"));
    try {
      const dummyInput = path.join(dir, "in.json");
      await fs.writeFile(dummyInput, "[]", "utf8");
      const writer = { log: () => {}, error: () => {} };
      for (const unsafe of ["../outside", "sub/nested", "main:stream"]) {
        const imp = await roster({
          argv: ["import-json", "--account", unsafe, "--file", dummyInput],
          rosterDir: dir,
          writer,
        });
        assert.equal(imp.exitCode, 2, `import-json must reject unsafe --account ${unsafe}`);
        const exp = await roster({
          argv: ["export-json", "--account", unsafe],
          rosterDir: dir,
          writer,
        });
        assert.equal(exp.exitCode, 2, `export-json must reject unsafe --account ${unsafe}`);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("supports CLI round-trip via `roster import-json` and `roster export-json`", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "stfc-spocks-club-"));
    try {
      const rosterDir = path.join(dir, "roster");
      const inputJson = path.join(dir, "input.json");
      const outputJson = path.join(dir, "output.json");
      await fs.mkdir(rosterDir, { recursive: true });
      await fs.writeFile(
        inputJson,
        JSON.stringify([{ id: "spock", owned: true, level: 40, rank: 4, tier: 4 }]),
        "utf8",
      );

      const logs: string[] = [];
      const errors: string[] = [];
      const writer = {
        log: (...parts: unknown[]) => logs.push(parts.join(" ")),
        error: (...parts: unknown[]) => errors.push(parts.join(" ")),
      };

      const imp = await roster({
        argv: ["import-json", "--account", "main", "--file", inputJson],
        rosterDir,
        now: () => new Date("2026-11-26T20:00:00.000Z"),
        writer,
      });
      assert.equal(imp.exitCode, 0, errors.join("\n"));

      const exp = await roster({
        argv: ["export-json", "--account", "main", "--out", outputJson],
        rosterDir,
        now: () => new Date("2026-11-26T20:05:00.000Z"),
        writer,
      });
      assert.equal(exp.exitCode, 0, errors.join("\n"));

      const parsedOut = JSON.parse(await fs.readFile(outputJson, "utf8")) as {
        account: string;
        officers: Array<{ id: string; tier?: number; level?: number }>;
      };
      assert.equal(parsedOut.account, "main");
      assert.equal(parsedOut.officers.length, 1);
      assert.equal(parsedOut.officers[0]?.id, "spock");
      assert.equal(parsedOut.officers[0]?.tier, 4);
      assert.equal(parsedOut.officers[0]?.level, 40);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
