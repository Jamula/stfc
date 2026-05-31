import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadRoster,
  removeRosterOfficer,
  saveRoster,
  toRosterYaml,
  touchRoster,
  upsertRosterOfficer,
} from "../../src/crew/roster.ts";

const tinyRosterPath = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");

describe("crew roster", () => {
  it("loads roster fixture when account matches filename", async () => {
    const roster = await loadRoster(tinyRosterPath);
    assert.equal(roster.account, "tiny");
    assert.equal(roster.officers.length, 3);
  });

  it("rejects roster account that does not match filename", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-roster-"));
    try {
      const mismatchPath = path.join(dir, "example.yaml");
      fs.writeFileSync(
        mismatchPath,
        [
          "account: demo",
          "last_updated: 2026-05-31T20:25:00Z",
          "officers:",
          "  - id: kirk",
          "    owned: false",
          "",
        ].join("\n"),
        "utf8",
      );

      await assert.rejects(
        () => loadRoster(mismatchPath),
        /Roster account mismatch .* account 'demo' must match filename 'example'/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws read error for missing roster file", async () => {
    await assert.rejects(
      () => loadRoster(path.join(process.cwd(), "tests/crew/fixtures/does-not-exist.yaml")),
      /Could not read roster/,
    );
  });

  it("writes byte-stable YAML on repeated save", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-roster-"));
    try {
      const outPath = path.join(dir, "tiny.yaml");
      const roster = await loadRoster(tinyRosterPath);

      await saveRoster(roster, outPath);
      const first = fs.readFileSync(outPath, "utf8");

      const loaded = await loadRoster(outPath);
      await saveRoster(loaded, outPath);
      const second = fs.readFileSync(outPath, "utf8");

      assert.equal(first, second);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auto-bumps last_updated for mutation helper", async () => {
    const roster = await loadRoster(tinyRosterPath);
    const next = upsertRosterOfficer(
      roster,
      {
        id: "chen",
        owned: true,
        level: 30,
        rank: 3,
        promotions: 2,
      },
      new Date("2026-05-31T20:25:00Z"),
    );

    assert.equal(next.last_updated, "2026-05-31T20:25:00.000Z");
    assert.deepEqual(
      next.officers.map((officer) => officer.id),
      ["chen", "kirk", "spock"],
    );
    const chen = next.officers.find((officer) => officer.id === "chen");
    assert.ok(chen && chen.owned);
    if (chen.owned) {
      assert.equal(chen.level, 30);
      assert.equal(chen.rank, 3);
      assert.equal(chen.promotions, 2);
    }
  });

  it("inserts a new officer via upsert and preserves sorted order", async () => {
    const roster = await loadRoster(tinyRosterPath);
    const next = upsertRosterOfficer(
      roster,
      {
        id: "barot",
        owned: true,
        level: 20,
        rank: 2,
        promotions: 1,
      },
      new Date("2026-05-31T20:25:00Z"),
    );
    assert.deepEqual(
      next.officers.map((officer) => officer.id),
      ["barot", "chen", "kirk", "spock"],
    );
  });

  it("rejects malformed roster schema", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-roster-"));
    try {
      const badPath = path.join(dir, "broken.yaml");
      fs.writeFileSync(
        badPath,
        [
          "account: demo",
          "last_updated: 2026-05-31T20:25:00Z",
          "officers:",
          "  - id: kirk",
          "    owned: true",
          "",
        ].join("\n"),
        "utf8",
      );

      await assert.rejects(() => loadRoster(badPath), /Roster schema mismatch/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed roster YAML", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-roster-"));
    try {
      const badPath = path.join(dir, "broken.yaml");
      fs.writeFileSync(badPath, "account: [not-closed", "utf8");

      await assert.rejects(() => loadRoster(badPath), /Malformed YAML in roster/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes officer and bumps last_updated", async () => {
    const roster = await loadRoster(tinyRosterPath);
    const next = removeRosterOfficer(roster, "chen", new Date("2026-05-31T20:25:00Z"));
    assert.equal(next.last_updated, "2026-05-31T20:25:00.000Z");
    assert.deepEqual(
      next.officers.map((officer) => officer.id),
      ["kirk", "spock"],
    );
  });

  it("touches roster without changing officers", async () => {
    const roster = await loadRoster(tinyRosterPath);
    const touched = touchRoster(roster, new Date("2026-05-31T20:25:00Z"));
    assert.equal(touched.last_updated, "2026-05-31T20:25:00.000Z");
    assert.deepEqual(
      touched.officers.map((officer) => officer.id),
      roster.officers.map((officer) => officer.id),
    );
  });

  it("rejects saving invalid roster objects", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-roster-"));
    try {
      await assert.rejects(
        // cast to unknown first to exercise runtime validation path
        () => saveRoster({ account: "demo" } as unknown as Parameters<typeof saveRoster>[0], path.join(dir, "x.yaml")),
        /Refusing to write invalid roster/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serializes root keys deterministically and omits staleness_overrides when absent", () => {
    const yaml = toRosterYaml({
      account: "demo",
      last_updated: "2026-05-31T20:25:00Z",
      officers: [{ id: "kirk", owned: false }],
    });
    assert.equal(yaml.includes("staleness_overrides:"), false);
    assert.ok(yaml.indexOf("account:") < yaml.indexOf("last_updated:"));
    assert.ok(yaml.indexOf("last_updated:") < yaml.indexOf("officers:"));
  });
});
