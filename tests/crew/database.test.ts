import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  OfficerDatabaseError,
  formatUnknownOfficerError,
  loadOfficerDatabase,
} from "../../src/crew/database.ts";

const tinyOfficersPath = path.join(process.cwd(), "tests/crew/fixtures/tiny-officers.json");

describe("crew database", () => {
  it("loads and indexes officers from JSON", async () => {
    const db = await loadOfficerDatabase(tinyOfficersPath);
    assert.equal(db.officers.length, 3);
    assert.equal(db.getOfficerById("kirk").name, "James T. Kirk");
  });

  it("throws precise schema error with file and path", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-db-"));
    try {
      const badPath = path.join(dir, "officers.json");
      fs.writeFileSync(
        badPath,
        JSON.stringify([
          {
            id: "bad-id",
            faction: "federation",
            synergy_groups: [],
            captain_maneuver: { text: "x", tags: ["morale_recovery"] },
            officer_ability: { text: "x", tags: ["morale_recovery"] },
            bda_role: "captain",
            rank_curve: "linear",
            added_in_patch: "M90",
            source: "x",
          },
        ]),
        "utf8",
      );

      await assert.rejects(
        () => loadOfficerDatabase(badPath),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /officers\.json/);
          assert.match(err.message, /0\.name/);
          return true;
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws read error for missing file", async () => {
    await assert.rejects(
      () => loadOfficerDatabase(path.join(process.cwd(), "tests/crew/fixtures/does-not-exist.json")),
      (err: unknown) => {
        assert.ok(err instanceof OfficerDatabaseError);
        assert.match(err.message, /Could not read officer database/);
        return true;
      },
    );
  });

  it("throws malformed JSON error", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-db-"));
    try {
      const badPath = path.join(dir, "officers.json");
      fs.writeFileSync(badPath, "{not json", "utf8");

      await assert.rejects(
        () => loadOfficerDatabase(badPath),
        (err: unknown) => {
          assert.ok(err instanceof OfficerDatabaseError);
          assert.match(err.message, /Malformed JSON in officer database/);
          return true;
        },
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits the exact unknown-officer message", async () => {
    const db = await loadOfficerDatabase(tinyOfficersPath);
    const missingId = "tomalak";
    const expected = formatUnknownOfficerError(missingId);

    assert.throws(
      () => db.getOfficerById(missingId),
      (err: unknown) => err instanceof OfficerDatabaseError && err.message === expected,
    );
  });
});
