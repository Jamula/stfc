import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../../src/discord/crewCommandParser.ts";
import { handleBest } from "../../../src/crew/handlers/best.ts";
import { toRosterYaml } from "../../../src/crew/roster.ts";
import type { Officer, Roster } from "../../../src/crew/schemas.ts";

const TINY_OFFICERS_PATH = path.join(process.cwd(), "tests/crew/fixtures/tiny-officers.json");
const TINY_TASK_DIR = path.join(process.cwd(), "tests/crew/fixtures/tiny-tasks");
const TINY_ROSTER_PATH = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");

function command(args: Record<string, string>): CrewCommand {
  return {
    subcommand: "best",
    args,
    raw: "!crew best",
    message: {
      id: "1",
      guild_id: "g1",
      channel_id: "c1",
      content: "!crew best",
      timestamp: "2026-06-01T00:00:00Z",
      edited_timestamp: null,
      author: { id: "u1", username: "tester", bot: false },
      type: 0,
    },
  };
}

function createFixtureWorld(): {
  root: string;
  officersPath: string;
  rosterDir: string;
  taskDir: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-crew-best-"));
  const officersPath = path.join(root, "officers.json");
  const rosterDir = path.join(root, "roster");
  const taskDir = path.join(root, "tasks");

  fs.mkdirSync(rosterDir, { recursive: true });
  fs.cpSync(TINY_OFFICERS_PATH, officersPath);
  fs.cpSync(TINY_ROSTER_PATH, path.join(rosterDir, "tiny.yaml"));
  fs.cpSync(TINY_TASK_DIR, taskDir, { recursive: true });

  return {
    root,
    officersPath,
    rosterDir,
    taskDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function withCrewEnv<T>(
  env: { officersPath: string; rosterDir: string; taskDir: string },
  run: () => Promise<T>,
): Promise<T> {
  const previous = {
    STFC_OFFICERS_PATH: process.env.STFC_OFFICERS_PATH,
    STFC_ROSTER_DIR: process.env.STFC_ROSTER_DIR,
    STFC_TASK_DIR: process.env.STFC_TASK_DIR,
  };

  process.env.STFC_OFFICERS_PATH = env.officersPath;
  process.env.STFC_ROSTER_DIR = env.rosterDir;
  process.env.STFC_TASK_DIR = env.taskDir;

  try {
    return await run();
  } finally {
    process.env.STFC_OFFICERS_PATH = previous.STFC_OFFICERS_PATH;
    process.env.STFC_ROSTER_DIR = previous.STFC_ROSTER_DIR;
    process.env.STFC_TASK_DIR = previous.STFC_TASK_DIR;
  }
}

describe("crew handler: best", () => {
  it("renders markdown best-team output for a task", async () => {
    const world = createFixtureWorld();
    try {
      const output = await withCrewEnv(world, () =>
        handleBest(command({ _0: "hostile-grind", account: "tiny" })),
      );

      assert.match(output, /\*\*Crew best — Tiny Hostile Grind\*\*/);
      assert.match(output, /account: `tiny`/);
      assert.match(output, /### #1 — score/);
      assert.match(output, /captain/);
    } finally {
      world.cleanup();
    }
  });

  it("returns user-friendly error when task-class arg is omitted", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleBest(command({ account: "tiny" })),
          /Missing required <task-class>\. Usage: `!crew best <task-class> --account <name> \[--top N\]`\./,
        );
      });
    } finally {
      world.cleanup();
    }
  });

  it("returns user-friendly error when task-class is unknown", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleBest(command({ _0: "klingon-diplomacy", account: "tiny" })),
          /Could not read task definition .*klingon-diplomacy\.yaml: .*no such file/i,
        );
      });
    } finally {
      world.cleanup();
    }
  });

  it("throws a missing-account error listing discovered roster files", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleBest(command({ _0: "hostile-grind" })),
          /Missing required --account <name>\. Discovered roster files: tiny\.yaml\./,
        );
      });
    } finally {
      world.cleanup();
    }
  });

  it("throws a missing-flag error when --account has no value", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleBest(command({ _0: "hostile-grind", account: "true" })),
          /Flag `--account` requires a value/,
        );
      });
    } finally {
      world.cleanup();
    }
  });

  it("truncates long output to stay below Discord limits", async () => {
    const world = createFixtureWorld();
    try {
      const longText = "ability-".repeat(220);
      const officers: Officer[] = [
        {
          id: "cap",
          name: "Cap",
          faction: "federation",
          synergy_groups: ["g1"],
          captain_maneuver: { text: longText, tags: ["morale_recovery", "pvp_damage"] },
          officer_ability: { text: longText, tags: ["pvp_damage"] },
          bda_role: "captain",
          rank_curve: "linear",
          added_in_patch: "M90",
          source: "test",
        },
        ...Array.from({ length: 5 }, (_, i): Officer => ({
          id: `off-${i + 1}`,
          name: `Officer ${i + 1}`,
          faction: "federation",
          synergy_groups: ["g1"],
          captain_maneuver: { text: longText, tags: ["morale_recovery"] },
          officer_ability: { text: longText, tags: ["pvp_damage", "morale_recovery"] },
          bda_role: "officer",
          rank_curve: "linear",
          added_in_patch: "M90",
          source: "test",
        })),
      ];

      fs.writeFileSync(world.officersPath, `${JSON.stringify(officers, null, 2)}\n`, "utf8");
      const hugeRoster: Roster = {
        account: "tiny",
        last_updated: "2026-06-01T00:00:00Z",
        officers: [
          { id: "cap", owned: true, level: 60, rank: 4, promotions: 3 },
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `off-${i + 1}`,
            owned: true as const,
            level: 30,
            rank: 2,
            promotions: 1,
          })),
        ],
      };
      fs.writeFileSync(path.join(world.rosterDir, "tiny.yaml"), toRosterYaml(hugeRoster), "utf8");

      fs.writeFileSync(
        path.join(world.taskDir, "long-task.yaml"),
        [
          "id: long-task",
          "name: Long Task",
          "description: Long output fixture task.",
          "slots:",
          "  captain:",
          "    bda_role: captain",
          "  officer_a:",
          "    bda_role: officer",
          "  officer_b:",
          "    bda_role: officer",
          "tag_weights:",
          "  pvp_damage: 5",
          "  morale_recovery: 3",
          "synergy_bonus: 0",
          "constraints:",
          "  exclude_officers: []",
          "notes: long output fixture",
          "",
        ].join("\n"),
        "utf8",
      );

      const output = await withCrewEnv(world, () =>
        handleBest(command({ _0: "long-task", account: "tiny", top: "3" })),
      );

      assert.ok(output.length <= 1900, `expected <= 1900 chars, got ${output.length}`);
      assert.match(output, /output truncated to 1900 chars/);
    } finally {
      world.cleanup();
    }
  });
});
