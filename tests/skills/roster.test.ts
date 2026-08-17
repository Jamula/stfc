import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadRoster, saveRoster } from "../../src/crew/roster.ts";
import { roster as rosterSkill } from "../../src/skills/roster.ts";

interface BufferingWriter {
  log: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
  out: string[];
  err: string[];
}

const FIXED_NOW = new Date("2026-05-31T21:20:00Z");

function makeWriter(): BufferingWriter {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (...parts: unknown[]) => out.push(parts.map(String).join(" ")),
    error: (...parts: unknown[]) => err.push(parts.map(String).join(" ")),
  };
}

async function seedOfficerDb(filePath: string): Promise<void> {
  const officers = [
    {
      id: "kirk",
      name: "James T. Kirk",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "x", tags: ["morale_recovery"] },
      officer_ability: { text: "x", tags: ["pvp_damage"] },
      bda_role: "captain",
      rank_curve: "linear",
      added_in_patch: "M91",
      source: "test",
    },
    {
      id: "spock",
      name: "Spock",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "x", tags: ["pvp_mitigation"] },
      officer_ability: { text: "x", tags: ["pvp_mitigation"] },
      bda_role: "either",
      rank_curve: "linear",
      added_in_patch: "M91",
      source: "test",
    },
    {
      id: "chen",
      name: "T'Lan Chen",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "x", tags: ["hostile_crit"] },
      officer_ability: { text: "x", tags: ["hostile_crit"] },
      bda_role: "officer",
      rank_curve: "linear",
      added_in_patch: "M91",
      source: "test",
    },
  ];
  await fs.writeFile(filePath, JSON.stringify(officers, null, 2), "utf8");
}

async function seedRoster(
  rosterDir: string,
  account: string,
  yaml: string = [
    `account: ${account}`,
    "last_updated: 2026-05-20T00:00:00Z",
    "officers:",
    "  - id: kirk",
    "    owned: true",
    "    level: 10",
    "    rank: 2",
    "    promotions: 1",
    "  - id: spock",
    "    owned: false",
    "",
  ].join("\n"),
): Promise<string> {
  const rosterPath = path.join(rosterDir, `${account}.yaml`);
  await fs.writeFile(rosterPath, yaml, "utf8");
  return rosterPath;
}

async function assertByteStable(filePath: string): Promise<void> {
  const first = await fs.readFile(filePath, "utf8");
  const parsed = await loadRoster(filePath);
  await saveRoster(parsed, filePath);
  const second = await fs.readFile(filePath, "utf8");
  assert.equal(second, first);
}

describe("skill:roster status", () => {
  let dir = "";
  let rosterDir = "";
  let officersPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-roster-status-"));
    rosterDir = path.join(dir, "roster");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await seedOfficerDb(officersPath);
    await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("prints table and returns 0 when all rosters are fresh and known", async () => {
    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["status", "--all"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 0);
    assert.match(writer.out.join("\n"), /account\s+officers\s+age\(days\)\s+freshness/);
    assert.match(writer.out.join("\n"), /alpha\s+2\s+11\s+warn/);
    assert.equal(writer.err.length, 0);
  });

  it("returns 1 and emits warning line per roster with unknown officers", async () => {
    await seedRoster(
      rosterDir,
      "bravo",
      [
        "account: bravo",
        "last_updated: 2026-05-20T00:00:00Z",
        "officers:",
        "  - id: unknown-officer",
        "    owned: false",
        "",
      ].join("\n"),
    );
    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["status", "--all"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 1);
    assert.match(writer.out.join("\n"), /WARNING bravo: unknown officer\(s\): unknown-officer/);
  });

  it("returns 2 on malformed YAML", async () => {
    await fs.writeFile(path.join(rosterDir, "charlie.yaml"), "account: [broken", "utf8");
    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["status", "--all"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 2);
    assert.match(writer.err.join("\n"), /Malformed YAML in roster/);
  });
});

describe("skill:roster add", () => {
  let dir = "";
  let rosterDir = "";
  let officersPath = "";
  let alphaPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-roster-add-"));
    rosterDir = path.join(dir, "roster");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await seedOfficerDb(officersPath);
    alphaPath = await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("adds officer, bumps last_updated, and preserves stable yaml", async () => {
    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["add", "--account", "alpha", "--officer", "chen", "--level", "30", "--rank", "3", "--promotions", "2"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 0);

    const roster = await loadRoster(alphaPath);
    const added = roster.officers.find((entry) => entry.id === "chen");
    assert.ok(added && added.owned);
    if (added && added.owned) {
      assert.equal(added.level, 30);
      assert.equal(added.rank, 3);
      assert.equal(added.promotions, 2);
    }
    assert.equal(roster.last_updated, "2026-05-31T21:20:00.000Z");
    await assertByteStable(alphaPath);
  });

  it("add bootstraps a missing roster file", async () => {
    const neoPath = path.join(rosterDir, "neo.yaml");
    await assert.rejects(() => fs.access(neoPath), /ENOENT/);

    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["add", "--account", "neo", "--officer", "kirk"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(writer.out, [`Created ${neoPath} with 1 officer.`]);
    assert.equal(writer.err.length, 0);

    const roster = await loadRoster(neoPath);
    assert.equal(roster.account, "neo");
    assert.equal(roster.last_updated, "2026-05-31T21:20:00.000Z");
    assert.deepEqual(roster.officers, [
      {
        id: "kirk",
        owned: true,
        level: 1,
        rank: 1,
        promotions: 0,
      },
    ]);
    await assertByteStable(neoPath);
  });

  it("promote, rankup, and validate still ENOENT on missing file", async () => {
    const ghostPath = path.join(rosterDir, "ghost.yaml");
    const cases = [
      {
        argv: ["promote", "--account", "ghost", "--officer", "kirk", "--level", "+1"],
        exitCode: 1,
      },
      {
        argv: ["rankup", "--account", "ghost", "--officer", "kirk"],
        exitCode: 1,
      },
      {
        argv: ["validate", "--account", "ghost"],
        exitCode: 2,
      },
      {
        argv: ["status", "--account", "ghost"],
        exitCode: 2,
      },
    ];

    for (const { argv, exitCode } of cases) {
      const writer = makeWriter();
      const result = await rosterSkill({
        argv,
        rosterDir,
        officerDatabasePath: officersPath,
        now: () => FIXED_NOW,
        writer,
      });
      assert.equal(result.exitCode, exitCode, argv[0]);
      assert.match([...writer.err, JSON.stringify(result.result)].join("\n"), /ENOENT/, argv[0]);
      await assert.rejects(() => fs.access(ghostPath), /ENOENT/);
    }
  });

  it("is idempotent: second add without --force fails", async () => {
    const writerA = makeWriter();
    const first = await rosterSkill({
      argv: ["add", "--account", "alpha", "--officer", "chen"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: writerA,
    });
    assert.equal(first.exitCode, 0);

    const writerB = makeWriter();
    const second = await rosterSkill({
      argv: ["add", "--account", "alpha", "--officer", "chen"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: writerB,
    });
    assert.equal(second.exitCode, 1);
    assert.match(writerB.err.join("\n"), /already exists/);
  });
});

describe("skill:roster promote", () => {
  let dir = "";
  let rosterDir = "";
  let officersPath = "";
  let alphaPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-roster-promote-"));
    rosterDir = path.join(dir, "roster");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await seedOfficerDb(officersPath);
    alphaPath = await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("supports relative and absolute level updates", async () => {
    const rel = await rosterSkill({
      argv: ["promote", "--account", "alpha", "--officer", "kirk", "--level", "+5"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: makeWriter(),
    });
    assert.equal(rel.exitCode, 0);
    let roster = await loadRoster(alphaPath);
    const kirkAfterRel = roster.officers.find((entry) => entry.id === "kirk");
    assert.ok(kirkAfterRel && kirkAfterRel.owned);
    if (kirkAfterRel && kirkAfterRel.owned) assert.equal(kirkAfterRel.level, 15);
    assert.equal(roster.last_updated, "2026-05-31T21:20:00.000Z");

    const abs = await rosterSkill({
      argv: ["promote", "--account", "alpha", "--officer", "kirk", "--level", "60"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: makeWriter(),
    });
    assert.equal(abs.exitCode, 0);
    roster = await loadRoster(alphaPath);
    const kirkAfterAbs = roster.officers.find((entry) => entry.id === "kirk");
    assert.ok(kirkAfterAbs && kirkAfterAbs.owned);
    if (kirkAfterAbs && kirkAfterAbs.owned) assert.equal(kirkAfterAbs.level, 60);
    await assertByteStable(alphaPath);
  });

  it("fails when roster file is missing", async () => {
    const result = await rosterSkill({
      argv: ["promote", "--account", "missing", "--officer", "kirk", "--level", "+2"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: makeWriter(),
    });
    assert.equal(result.exitCode, 1);
    const message = (result.result as { error?: string }).error;
    assert.equal(message, "operation-failed");
  });
});

describe("skill:roster rankup", () => {
  let dir = "";
  let rosterDir = "";
  let officersPath = "";
  let alphaPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-roster-rankup-"));
    rosterDir = path.join(dir, "roster");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await seedOfficerDb(officersPath);
    alphaPath = await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("defaults to +1 and updates last_updated", async () => {
    const { exitCode } = await rosterSkill({
      argv: ["rankup", "--account", "alpha", "--officer", "kirk"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer: makeWriter(),
    });
    assert.equal(exitCode, 0);
    const roster = await loadRoster(alphaPath);
    const kirk = roster.officers.find((entry) => entry.id === "kirk");
    assert.ok(kirk && kirk.owned);
    if (kirk && kirk.owned) assert.equal(kirk.rank, 3);
    assert.equal(roster.last_updated, "2026-05-31T21:20:00.000Z");
    await assertByteStable(alphaPath);
  });

  it("rejects out-of-range rank", async () => {
    const writer = makeWriter();
    const { exitCode } = await rosterSkill({
      argv: ["rankup", "--account", "alpha", "--officer", "kirk", "--rank", "6"],
      rosterDir,
      officerDatabasePath: officersPath,
      now: () => FIXED_NOW,
      writer,
    });
    assert.equal(exitCode, 2);
    assert.match(writer.err.join("\n"), /range 1..5/);
  });
});

describe("skill:roster validate", () => {
  let dir = "";
  let rosterDir = "";
  let officersPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-roster-validate-"));
    rosterDir = path.join(dir, "roster");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await seedOfficerDb(officersPath);
    await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns 0 for clean roster", async () => {
    const { exitCode } = await rosterSkill({
      argv: ["validate", "--all"],
      rosterDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
    });
    assert.equal(exitCode, 0);
  });

  it("returns 1 for unknown officer and 2 for schema mismatch", async () => {
    await seedRoster(
      rosterDir,
      "unknowns",
      [
        "account: unknowns",
        "last_updated: 2026-05-31T00:00:00Z",
        "officers:",
        "  - id: not-in-db",
        "    owned: false",
        "",
      ].join("\n"),
    );
    const unknown = await rosterSkill({
      argv: ["validate", "--account", "unknowns"],
      rosterDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
    });
    assert.equal(unknown.exitCode, 1);

    await fs.writeFile(
      path.join(rosterDir, "broken.yaml"),
      ["account: broken", "last_updated: not-a-date", "officers: []", ""].join("\n"),
      "utf8",
    );
    const broken = await rosterSkill({
      argv: ["validate", "--account", "broken"],
      rosterDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
    });
    assert.equal(broken.exitCode, 2);
  });
});
