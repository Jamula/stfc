import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CREW_COMMAND_HELP,
  CrewCommandRateLimiter,
  handleCrewCommand,
  parseCrewCommand,
  processCrewCommands,
} from "../../src/discord/crewCommandParser.ts";
import type { CommandChannelAllowlistEntry, DiscordMessage } from "../../src/discord/schemas.ts";

const GUILD_ID = "509679626763632640";
const CHANNEL_ID = "111111111111111111";
const OTHER_CHANNEL_ID = "222222222222222222";
const USER_ID = "333333333333333333";

const allowlist: CommandChannelAllowlistEntry[] = [
  { guild_id: GUILD_ID, channel_id: CHANNEL_ID, account: "main", notes: "test" },
];

function message(
  content: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    id: overrides.id ?? "444444444444444444",
    guild_id: overrides.guild_id ?? GUILD_ID,
    channel_id: overrides.channel_id ?? CHANNEL_ID,
    content,
    timestamp: overrides.timestamp ?? "2026-05-31T23:10:00Z",
    edited_timestamp: null,
    author: overrides.author ?? {
      id: USER_ID,
      username: "tester",
      bot: false,
    },
    type: 0,
  };
}

describe("parseCrewCommand", () => {
  it("detects only the case-sensitive !crew prefix with a word boundary", () => {
    assert.equal(parseCrewCommand(message("!crew"), allowlist)?.subcommand, "help");
    assert.equal(parseCrewCommand(message("!crew "), allowlist)?.subcommand, "help");
    assert.equal(parseCrewCommand(message("!crewbest"), allowlist), undefined);
    assert.equal(parseCrewCommand(message("crew best"), allowlist), undefined);
    assert.equal(parseCrewCommand(message("!Crew best"), allowlist), undefined);
  });

  it("ignores commands outside the command-channel allowlist", () => {
    assert.equal(
      parseCrewCommand(message("!crew help", { channel_id: OTHER_CHANNEL_ID }), allowlist),
      undefined,
    );
  });

  it("no-ops when the command-channel allowlist is empty", () => {
    assert.equal(parseCrewCommand(message("!crew help"), []), undefined);
  });

  it("preserves quoted args and parses named flags", () => {
    const parsed = parseCrewCommand(
      message('!crew best "mining-g3" --account "my main"'),
      allowlist,
    );
    assert.ok(parsed);
    assert.equal(parsed.subcommand, "best");
    assert.equal(parsed.args._, "mining-g3");
    assert.equal(parsed.args._0, "mining-g3");
    assert.equal(parsed.args.account, "my main");
    assert.equal(parsed.raw, '!crew best "mining-g3" --account "my main"');
    assert.equal(parsed.message.channel_id, CHANNEL_ID);
  });
});

describe("processCrewCommands", () => {
  it("silently drops the 11th command in a per-channel 60s window", async () => {
    const posted: string[] = [];
    const messages = Array.from({ length: 11 }, (_, index) =>
      message("!crew best mining", {
        id: String(444444444444444444n + BigInt(index)),
        author: {
          id: String(333333333333333333n + BigInt(index)),
          username: `tester-${index}`,
          bot: false,
        },
      }),
    );

    const stats = await processCrewCommands(messages, allowlist, {
      postMessage: async (_channelId, content) => { posted.push(content); },
    }, {
      now: new Date("2026-05-31T23:10:00Z"),
      rateLimiter: new CrewCommandRateLimiter(),
    });

    assert.equal(posted.length, 10);
    assert.equal(stats.processed, 10);
    assert.equal(stats.rateLimited, 1);
  });

  it("silently drops the 6th command from one user in a 60s window", async () => {
    const posted: string[] = [];
    const messages = Array.from({ length: 6 }, (_, index) =>
      message("!crew status", { id: String(555555555555555555n + BigInt(index)) }),
    );

    const stats = await processCrewCommands(messages, allowlist, {
      postMessage: async (_channelId, content) => { posted.push(content); },
    }, {
      now: new Date("2026-05-31T23:10:00Z"),
      rateLimiter: new CrewCommandRateLimiter(),
    });

    assert.equal(posted.length, 5);
    assert.equal(stats.processed, 5);
    assert.equal(stats.rateLimited, 1);
  });

  it("returns !crew help with every planned v2 verb", () => {
    const parsed = parseCrewCommand(message("!crew help"), allowlist);
    assert.ok(parsed);
    const reply = handleCrewCommand(parsed);
    assert.equal(reply, CREW_COMMAND_HELP);
    for (const expected of [
      "!crew best <task> [--account X]",
      "!crew status [--account X]",
      "!crew progression [--account X]",
      "!crew explain <officer>",
      "!crew synergy <group>",
      "!crew tasks",
      "!crew officers [--owned]",
      "!crew roster show [--account X]",
      "!crew knowledge <q>",
      "!crew help",
      "docs/CREW-OPTIMIZER.md",
    ]) {
      assert.match(reply, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("returns the not-yet-implemented stub for non-help subcommands", () => {
    const parsed = parseCrewCommand(message("!crew best mining"), allowlist);
    assert.ok(parsed);
    assert.equal(
      handleCrewCommand(parsed),
      "Subcommand 'best' not yet implemented. See `!crew help` for what's coming.",
    );
  });
});
