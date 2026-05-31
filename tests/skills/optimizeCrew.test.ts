import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { optimizeCrew } from "../../src/skills/optimizeCrew.ts";
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
    {
      id: "uhura",
      name: "Uhura",
      faction: "federation",
      synergy_groups: ["enterprise_crew"],
      captain_maneuver: { text: "Cargo", tags: ["cargo_capacity"] },
      officer_ability: { text: "Cargo assist", tags: ["cargo_capacity"] },
      bda_role: "officer",
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
    "  cargo_capacity: 3",
    "synergy_bonus: 2",
    "faction_bonus:",
    "  federation: 1",
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
      "    level: 30",
      "    rank: 2",
      "    promotions: 1",
      "  - id: spock",
      "    owned: true",
      "    level: 25",
      "    rank: 2",
      "    promotions: 1",
      "  - id: uhura",
      "    owned: true",
      "    level: 20",
      "    rank: 2",
      "    promotions: 1",
      "",
    ].join("\n");
  await fs.writeFile(path.join(rosterDir, `${account}.yaml`), yaml, "utf8");
}

describe("skill:optimize-crew", () => {
  let dir = "";
  let rosterDir = "";
  let taskDir = "";
  let docsDir = "";
  let officersPath = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), "test-optimize-crew-"));
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

    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--all", "--top", "2"],
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

  it("returns 1 for missing task id in task directory", async () => {
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--task", "does-not-exist", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 1);
    assert.match(writer.err.join("\n"), /Could not load task "does-not-exist"/);
  });

  it("returns 2 with a clear error when --task is missing", async () => {
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 2);
    assert.match(writer.err.join("\n"), /Missing required --task/);
  });

  it("returns 2 on selector conflict (--account with --all)", async () => {
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha", "--all"],
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

  it("returns 2 for invalid --top values", async () => {
    for (const badTop of ["0", "abc"]) {
      const writer = makeWriter();
      const output = await optimizeCrew({
        argv: ["--task", "mining-g3", "--account", "alpha", "--top", badTop],
        rosterDir,
        taskDir,
        docsDir,
        officerDatabasePath: officersPath,
        writer,
        now: () => FIXED_NOW,
      });
      assert.equal(output.exitCode, 2);
      assert.match(writer.err.join("\n"), /--top must be a positive integer/);
    }
  });

  it("returns 2 and degrades when the roster has no owned officers", async () => {
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
    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.equal(output.exitCode, 2);
    assert.match(writer.out.join("\n"), /Roster has no owned officers; optimization skipped/);
  });

  it("prints staleness warnings and appends workflow summary", async () => {
    const summaryPath = path.join(dir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summaryPath;

    const writer = makeWriter();
    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    assert.match(writer.out.join("\n"), /⚠️ Roster for alpha is \d+ days old/);
    const summary = await fs.readFile(summaryPath, "utf8");
    assert.match(summary, /=== optimize-crew \(task: mining-g3, top 3\) ===/);
    assert.match(summary, /Account: alpha/);
  });

  it("returns 0 for mixed account health under --all", async () => {
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
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });
    assert.equal(output.exitCode, 0);
    assert.match(writer.out.join("\n"), /Account: bravo/);
    assert.match(writer.out.join("\n"), /degraded/);
  });

  it("returns 0 when one account is malformed and another is healthy", async () => {
    await fs.writeFile(path.join(rosterDir, "broken.yaml"), "account: [broken", "utf8");
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--all"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });
    assert.equal(output.exitCode, 0);
    assert.match(writer.err.join("\n"), /Account broken:/);
    assert.match(writer.out.join("\n"), /Account: alpha/);
  });

  it("returns 2 when no eligible roster files exist", async () => {
    await fs.rm(path.join(rosterDir, "alpha.yaml"), { force: true });
    await seedRoster(rosterDir, "demo");
    const writer = makeWriter();
    const output = await optimizeCrew({
      argv: ["--task", "mining-g3", "--all"],
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

  it("writes docs only when the computed input hash changes", async () => {
    const writer = makeWriter();
    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer,
      now: () => FIXED_NOW,
    });

    const docPath = path.join(docsDir, "alpha-optimize.md");
    const first = await fs.readFile(docPath, "utf8");
    assert.match(first, /^<!-- input-hash: [a-f0-9]{64} -->/);

    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });
    const second = await fs.readFile(docPath, "utf8");
    assert.equal(second, first);

    await seedRoster(
      rosterDir,
      "alpha",
      [
        "account: alpha",
        "last_updated: 2026-05-20T00:00:00Z",
        "officers:",
        "  - id: kirk",
        "    owned: true",
        "    level: 50",
        "    rank: 4",
        "    promotions: 2",
        "",
      ].join("\n"),
    );

    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
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

  it("rewrites legacy docs without an input-hash header", async () => {
    await fs.mkdir(docsDir, { recursive: true });
    const docPath = path.join(docsDir, "alpha-optimize.md");
    await fs.writeFile(docPath, "# legacy\n", "utf8");

    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });

    const content = await fs.readFile(docPath, "utf8");
    assert.match(content, /^<!-- input-hash: [a-f0-9]{64} -->/);
    assert.match(content, /## optimize-crew/);
  });

  it("writes an optimize doc without suppressing the progression doc", async () => {
    await optimizeCrew({
      argv: ["--task", "mining-g3", "--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });

    await progression({
      argv: ["--account", "alpha"],
      rosterDir,
      taskDir,
      docsDir,
      officerDatabasePath: officersPath,
      writer: makeWriter(),
      now: () => FIXED_NOW,
    });

    const optimizeDocPath = path.join(docsDir, "alpha-optimize.md");
    const progressionDocPath = path.join(docsDir, "alpha-progression.md");
    const optimizeDoc = await fs.readFile(optimizeDocPath, "utf8");
    const progressionDoc = await fs.readFile(progressionDocPath, "utf8");

    assert.match(optimizeDoc, /^<!-- input-hash: [a-f0-9]{64} -->/);
    assert.match(optimizeDoc, /## optimize-crew/);
    assert.match(progressionDoc, /^<!-- input-hash: [a-f0-9]{64} -->/);
    assert.match(progressionDoc, /## progression/);
    await assert.rejects(fs.access(path.join(docsDir, "alpha.md")));
  });
});
