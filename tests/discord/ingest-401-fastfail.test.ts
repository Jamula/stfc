// T011 [US3] — ingestDiscord must fast-fail on 401 from getMe() and make
// ZERO getChannelMessages calls (contract T5, FR-004, US3 AS#2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestDiscord } from "../../src/discord/ingest.ts";
import { DiscordAuthError } from "../../src/discord/client.ts";
import type {
  DiscordAllowlist,
  IngestionCursorMap,
} from "../../src/discord/schemas.ts";

const NOW = new Date("2026-05-16T00:00:00Z");

function makeAllowlist(): DiscordAllowlist {
  return {
    version: 1,
    entries: [
      {
        serverId: "509679626763632640",
        serverLabel: "Test",
        channelId: "111111111111111111",
        channelLabel: "a",
        addedAt: "2026-05-16T00:00:00Z",
        addedBy: "octocat",
        enabled: true,
      },
      {
        serverId: "509679626763632640",
        serverLabel: "Test",
        channelId: "111111111111111112",
        channelLabel: "b",
        addedAt: "2026-05-16T00:00:00Z",
        addedBy: "octocat",
        enabled: true,
      },
    ],
  };
}

describe("ingestDiscord — 401 fast-fail (T011 / FR-004, US3 AS#2)", () => {
  it("rejects with DiscordAuthError and calls getChannelMessages zero times", async () => {
    let getChannelMessagesCalls = 0;
    const client = {
      getMe: async () => {
        throw new DiscordAuthError(
          "Authentication rejected (401) on GET /users/@me",
        );
      },
      getChannelMessages: async () => {
        getChannelMessagesCalls++;
        return [];
      },
    };

    await assert.rejects(
      () =>
        ingestDiscord(
          makeAllowlist(),
          {} as IngestionCursorMap,
          client,
          "run-test",
          NOW,
        ),
      DiscordAuthError,
    );

    assert.equal(
      getChannelMessagesCalls,
      0,
      "no per-channel reads must occur after a 401 from getMe()",
    );
  });
});
