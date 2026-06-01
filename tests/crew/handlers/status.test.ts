import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CrewCommand } from "../../../src/discord/crewCommandParser.ts";
import { handleStatus } from "../../../src/crew/handlers/status.ts";
import { toRosterYaml } from "../../../src/crew/roster.ts";
import type { Roster } from "../../../src/crew/schemas.ts";

const TINY_OFFICERS_PATH = path.join(process.cwd(), "tests/crew/fixtures/tiny-officers.json");
const TINY_ROSTER_PATH = path.join(process.cwd(), "tests/crew/fixtures/tiny.yaml");

function command(args: Record<string, string>): CrewCommand {
  return {
    subcommand: "status",
    args,
    raw: "!crew status",
    message: {
      id: "1",
      guild_id: "g1",
      channel_id: "c1",
      content: "!crew status",
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
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(process.cwd(), "test-tmp-crew-status-"));
  const officersPath = path.join(root, "officers.json");
  const rosterDir = path.join(root, "roster");

  fs.mkdirSync(rosterDir, { recursive: true });
  fs.cpSync(TINY_OFFICERS_PATH, officersPath);
  fs.cpSync(TINY_ROSTER_PATH, path.join(rosterDir, "tiny.yaml"));

  return {
    root,
    officersPath,
    rosterDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function withCrewEnv<T>(
  env: { officersPath: string; rosterDir: string },
  run: () => Promise<T>,
): Promise<T> {
  const previous = {
    STFC_OFFICERS_PATH: process.env.STFC_OFFICERS_PATH,
    STFC_ROSTER_DIR: process.env.STFC_ROSTER_DIR,
  };

  process.env.STFC_OFFICERS_PATH = env.officersPath;
  process.env.STFC_ROSTER_DIR = env.rosterDir;

  try {
    return await run();
  } finally {
    process.env.STFC_OFFICERS_PATH = previous.STFC_OFFICERS_PATH;
    process.env.STFC_ROSTER_DIR = previous.STFC_ROSTER_DIR;
  }
}

describe("crew handler: status", () => {
  it("renders roster health markdown", async () => {
    const world = createFixtureWorld();
    try {
      const output = await withCrewEnv(world, () => handleStatus(command({ account: "tiny" })));

      assert.match(output, /\*\*Crew status — tiny\*\*/);
      assert.match(output, /officers: total 3 \(owned 2, unowned 1\)/);
      assert.match(output, /staleness:/);
      assert.match(output, /```text/);
    } finally {
      world.cleanup();
    }
  });

  it("throws a missing-account error listing discovered roster files", async () => {
    const world = createFixtureWorld();
    try {
      await withCrewEnv(world, async () => {
        await assert.rejects(
          () => handleStatus(command({})),
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
          () => handleStatus(command({ account: "true" })),
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
        officers: Array.from({ length: 420 }, (_, i) => ({
          id: `ghost-${i}`,
          owned: false as const,
        })),
      };
      fs.writeFileSync(path.join(world.rosterDir, "huge.yaml"), toRosterYaml(hugeRoster), "utf8");

      const output = await withCrewEnv(world, () => handleStatus(command({ account: "huge" })));

      assert.ok(output.length <= 1900, `expected <= 1900 chars, got ${output.length}`);
      assert.match(output, /output truncated to 1900 chars/);
    } finally {
      world.cleanup();
    }
  });
});
