import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../../src/discord/crewCommandParser.ts";
import { handleRosterShow } from "../../../src/crew/handlers/rosterShow.ts";
import { toRosterYaml } from "../../../src/crew/roster.ts";
import type { Roster } from "../../../src/crew/schemas.ts";

const TINY_ROSTER_PATH = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");

function command(args: Record<string, string>): CrewCommand {
  return {
    subcommand: "roster",
    args,
    raw: "!crew roster show",
    message: {
      id: "1",
      guild_id: "g1",
      channel_id: "c1",
      content: "!crew roster show",
      timestamp: "2026-06-01T00:00:00Z",
      edited_timestamp: null,
      author: { id: "u1", username: "tester", bot: false },
      type: 0,
    },
  };
}

function createFixtureWorld(): {
  root: string;
  rosterDir: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-crew-roster-show-"));
  const rosterDir = path.join(root, "roster");

  fs.mkdirSync(rosterDir, { recursive: true });
  fs.cpSync(TINY_ROSTER_PATH, path.join(rosterDir, "tiny.yaml"));

  return {
    root,
    rosterDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function withCrewEnv<T>(
  env: { rosterDir: string },
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.STFC_ROSTER_DIR;
  process.env.STFC_ROSTER_DIR = env.rosterDir;

  try {
    return await run();
  } finally {
    process.env.STFC_ROSTER_DIR = previous;
  }
}

describe("crew handler: roster show", () => {
  it("renders roster markdown with a table", async () => {
    const world = createFixtureWorld();
    try {
      const output = await withCrewEnv(world, () =>
        handleRosterShow(command({ _0: "show", account: "tiny" })),
      );

      assert.match(output, /\*\*Crew roster — tiny\*\*/);
      assert.match(output, /total officers: 3/);
      assert.match(output, /```text/);
      assert.match(output, /kirk/);
    } finally {
      world.cleanup();
    }
  });

  it("throws a missing-account error listing discovered roster files", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleRosterShow(command({ _0: "show" })),
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
          () => handleRosterShow(command({ _0: "show", account: "true" })),
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
      const hugeRoster: Roster = {
        account: "huge",
        last_updated: "2026-06-01T00:00:00Z",
        officers: Array.from({ length: 500 }, (_, i) => ({
          id: `crew-${i}`,
          owned: i % 2 === 0 ? { owned: true as const, level: 25, rank: 2, promotions: 1 } : { owned: false as const },
        })).map((entry) => (entry.owned.owned ? {
          id: entry.id,
          owned: true,
          level: entry.owned.level,
          rank: entry.owned.rank,
          promotions: entry.owned.promotions,
        } : {
          id: entry.id,
          owned: false,
        })),
      };
      fs.writeFileSync(path.join(world.rosterDir, "huge.yaml"), toRosterYaml(hugeRoster), "utf8");

      const output = await withCrewEnv(world, () =>
        handleRosterShow(command({ _0: "show", account: "huge" })),
      );

      assert.ok(output.length <= 1900, `expected <= 1900 chars, got ${output.length}`);
      assert.match(output, /output truncated to 1900 chars/);
    } finally {
      world.cleanup();
    }
  });

  it("throws when the show subcommand token is missing", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleRosterShow(command({ account: "tiny" })),
          /Missing required subcommand `show`/,
        );
      });
    } finally {
      world.cleanup();
    }
  });
});
