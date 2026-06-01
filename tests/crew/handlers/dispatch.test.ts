import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleCrewCommand,
  processCrewCommands,
  type CrewCommandHandlerMap,
} from "../../../src/discord/crewCommandParser.ts";
import { commandAllowlist, makeCommand, makeMessage } from "./helpers.ts";

function fakeHandlers(overrides: Partial<CrewCommandHandlerMap> = {}): CrewCommandHandlerMap {
  const base: CrewCommandHandlerMap = {
    best: async () => "best routed",
    status: async () => "status routed",
    progression: async () => "progression routed",
    explain: async () => "explain routed",
    synergy: async () => "synergy routed",
    tasks: async () => "tasks routed",
    officers: async () => "officers routed",
    rosterShow: async () => "roster show routed",
  };
  return { ...base, ...overrides };
}

describe("crew command dispatcher", () => {
  it("routes all 8 read-only verbs and posts the handler output", async () => {
    const cases = [
      ["!crew best mining-g3 --account tiny", "best routed"],
      ["!crew status --account tiny", "status routed"],
      ["!crew progression --account tiny", "progression routed"],
      ["!crew explain kirk --account tiny", "explain routed"],
      ["!crew synergy enterprise_crew --account tiny", "synergy routed"],
      ["!crew tasks --account tiny", "tasks routed"],
      ["!crew officers --account tiny", "officers routed"],
      ["!crew roster show --account tiny", "roster show routed"],
    ] as const;

    for (const [content, expected] of cases) {
      const posted: Array<{ channelId: string; content: string }> = [];
      const stats = await processCrewCommands(
        [makeMessage(content)],
        commandAllowlist,
        { postMessage: async (channelId, response) => { posted.push({ channelId, content: response }); } },
        { handlers: fakeHandlers() },
      );

      assert.equal(stats.processed, 1);
      assert.equal(posted[0]?.content, expected);
      assert.equal(posted[0]?.channelId, makeMessage(content).channel_id);
    }
  });

  it("wraps handler errors for Discord output", async () => {
    const output = await handleCrewCommand(
      makeCommand("explain", { _: "kirk", _0: "kirk", account: "tiny" }),
      fakeHandlers({ explain: async () => { throw new Error("boom"); } }),
    );

    assert.equal(output, "Error: boom");
  });

  it("falls back for unknown commands", async () => {
    const output = await handleCrewCommand(makeCommand("nope"), fakeHandlers());

    assert.equal(output, "Unknown command. Try !crew help.");
  });
});
