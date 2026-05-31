import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { progression } from "../../src/skills/progression.ts";

interface BufferingWriter {
  out: string[];
  err: string[];
  log: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
}

const FIXED_NOW = new Date("2026-05-31T22:20:00Z");

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
      captain_maneuver: { text: "Morale boost", tags: ["morale_recovery"] },
      officer_ability: { text: "Damage boost", tags: ["pvp_damage"] },
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
      captain_maneuver: { text: "Mitigation", tags: ["pvp_mitigation"] },
      officer_ability: { text: "Mining assist", tags: ["mining_rate"] },
      bda_role: "either",
      rank_curve: "linear",
      added_in_patch: "M91",
      source: "test",
    },
  ];
  await fs.writeFile(filePath, JSON.stringify(officers, null, 2), "utf8");
}

async function seedTask(taskDir: string): Promise<void> {
  const yaml = [
    "id: mining-g3",
    "name: Mining G3",
    "description: Mining crew for G3 nodes",
    "slots:",
    "  captain:",
    "    bda_role: captain",
    "  officer_a:",
    "    bda_role: officer",
    "  officer_b:",
    "    bda_role: officer",
    "tag_weights:",
    "  mining_rate: 5",
    "synergy_bonus: 2",
    "",
  ].join("\n");
  await fs.writeFile(path.join(taskDir, "mining-g3.yaml"), yaml, "utf8");
}

async function seedRoster(rosterDir: string, account: string, content?: string): Promise<void> {
  const yaml =
    content ??
    [
      `account: ${account}`,
      "last_updated: 2026-05-20T00:00:00Z",
      "officers:",
      "  - id: kirk",
      "    owned: true",
      "    level: 10",
      "    rank: 1",
      "    promotions: 0",
      "  - id: spock",
      "    owned: true",
      "    level: 25",
      "    rank: 2",
      "    promotions: 1",
      "",
    ].join("\n");
  await fs.writeFile(path.join(rosterDir, `${account}.yaml`), yaml, "utf8");
}

describe("skill:progression", () => {
  let dir = "";
  let rosterDir = "";
  let taskDir = "";
  let docsDir = "";
  let officersPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-progression-"));
    rosterDir = path.join(dir, "roster");
    taskDir = path.join(dir, "tasks");
    docsDir = path.join(dir, "docs");
    officersPath = path.join(dir, "officers.json");
    await fs.mkdir(rosterDir, { recursive: true });
    await fs.mkdir(taskDir, { recursive: true });
    await seedOfficerDb(officersPath);
    await seedTask(taskDir);
    await seedRoster(rosterDir, "alpha");
  });

  afterEach(async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("iterates --all accounts while skipping demo.yaml", async () => {
    await seedRoster(rosterDir, "bravo");
    await seedRoster(rosterDir, "demo");
    const writer = makeWriter();
    const output = await progression({
      argv: ["--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 0);
    const rendered = writer.out.join("\n");
    assert.match(rendered, /Account: alpha/);
    assert.match(rendered, /Account: bravo/);
    assert.doesNotMatch(rendered, /Account: demo/);
  });

  it("returns 1 when officer database cannot be loaded", async () => {
    const writer = makeWriter();
    const output = await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: path.join(dir, "missing-officers.json"),
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 1);
    assert.match(writer.err.join("\n"), /Could not load officer database/);
  });

  it("returns 2 on selector conflict (--account with --all)", async () => {
    const writer = makeWriter();
    const output = await progression({
      argv: ["--account", "alpha", "--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });
    assert.equal(output.exitCode, 2);
    assert.match(writer.err.join("\n"), /Use either --account X or --all/);
  });

  it("returns 2 and degraded output for empty owned roster", async () => {
    await seedRoster(
      rosterDir,
      "alpha",
      [
        "account: alpha",
        "last_updated: 2026-05-20T00:00:00Z",
        "officers:",
        "  - id: kirk",
        "    owned: false",
        "",
      ].join("\n"),
    );
    const writer = makeWriter();
    const output = await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 2);
    assert.match(writer.out.join("\n"), /Roster has no owned officers; progression report is limited/);
    assert.match(writer.out.join("\n"), /No progression actions/);
  });

  it("surfaces staleness warnings and still succeeds", async () => {
    const writer = makeWriter();
    const output = await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 0);
    assert.match(writer.out.join("\n"), /⚠️ Roster for alpha is \d+ days old/);
  });

  it("appends workflow summary output when GITHUB_STEP_SUMMARY is set", async () => {
    const summaryPath = path.join(dir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });

    const summary = await fs.readFile(summaryPath, "utf8");
    assert.match(summary, /=== progression ===/);
    assert.match(summary, /Account: alpha/);
  });

  it("writes docs only when the computed input hash changes", async () => {
    const docPath = path.join(docsDir, "alpha-progression.md");
    await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });

    const first = await fs.readFile(docPath, "utf8");
    assert.match(first, /^<!-- input-hash: [a-f0-9]{64} -->/);

    await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });
    const second = await fs.readFile(docPath, "utf8");
    assert.equal(second, first);

    await seedOfficerDb(officersPath);
    const augmented = JSON.parse(await fs.readFile(officersPath, "utf8")) as Array<Record<string, unknown>>;
    augmented.push({
      id: "sulu",
      name: "Sulu",
      faction: "federation",
      synergy_groups: [],
      captain_maneuver: { text: "x", tags: ["dispatch_speed"] },
      officer_ability: { text: "x", tags: ["dispatch_speed"] },
      bda_role: "officer",
      rank_curve: "linear",
      added_in_patch: "M91",
      source: "test",
    });
    await fs.writeFile(officersPath, JSON.stringify(augmented, null, 2), "utf8");

    await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });
    const third = await fs.readFile(docPath, "utf8");
    assert.notEqual(third, second);
  });

  it("returns 0 for mixed account health and isolates malformed roster errors", async () => {
    await seedRoster(
      rosterDir,
      "bravo",
      [
        "account: bravo",
        "last_updated: 2026-05-20T00:00:00Z",
        "officers:",
        "  - id: kirk",
        "    owned: false",
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(rosterDir, "broken.yaml"), "account: [broken", "utf8");

    const writer = makeWriter();
    const output = await progression({
      argv: ["--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 0);
    const rendered = writer.out.join("\n");
    assert.match(rendered, /Account: alpha/);
    assert.match(rendered, /Account: bravo/);
    assert.match(rendered, /degraded/);
    assert.match(writer.err.join("\n"), /Account broken:/);
  });

  it("returns 2 when no eligible roster files exist", async () => {
    await fs.rm(path.join(rosterDir, "alpha.yaml"), { force: true });
    await seedRoster(rosterDir, "demo");
    const writer = makeWriter();
    const output = await progression({
      argv: ["--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });
    assert.equal(output.exitCode, 2);
    assert.match(writer.err.join("\n"), /No roster files found/);
  });
});
