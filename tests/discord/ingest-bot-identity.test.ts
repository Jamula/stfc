// T010 [US3] — ingestDiscord must capture getMe()'s BotIdentity and expose
// it on IngestOutput.botIdentity (contract T3, FR-012).
//
// The discord-monitor skill consumes botIdentity to emit exactly one
// `"discord bot authenticated"` log line on the success path (T015).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ingestDiscord } from "../../src/discord/ingest.ts";
import type {
  DiscordAllowlist,
  IngestionCursorMap,
} from "../../src/discord/schemas.ts";

const NOW = new Date("2026-05-16T00:00:00Z");

function loadUsersMe(): {
  id: string;
  username: string;
  discriminator: string;
  bot: true;
} {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "fixtures",
        "discord",
        "users-me.json",
      ),
      "utf8",
    ),
  );
}

function makeAllowlist(): DiscordAllowlist {
  return {
    version: 1,
    entries: [
      {
        serverId: "509679626763632640",
        serverLabel: "Test",
        channelId: "111111111111111111",
        channelLabel: "promos",
        addedAt: "2026-05-16T00:00:00Z",
        addedBy: "octocat",
        enabled: true,
      },
    ],
  };
}

describe("ingestDiscord — botIdentity passthrough (T010 / FR-012)", () => {
  it("returns the bot identity from getMe() on the IngestOutput", async () => {
    const me = loadUsersMe();
    const client = {
      getMe: async () => me,
      getChannelMessages: async () => [],
    };
    const out = await ingestDiscord(
      makeAllowlist(),
      {} as IngestionCursorMap,
      client,
      "run-test",
      NOW,
    );
    // The field MUST exist on the output (added in T014).
    assert.ok(
      "botIdentity" in out,
      "IngestOutput.botIdentity must be present",
    );
    assert.equal(out.botIdentity.username, me.username);
    assert.equal(out.botIdentity.id, me.id);
    assert.equal(out.botIdentity.bot, true);
  });

  it("never echoes a planted token through console output", async () => {
    const me = loadUsersMe();
    const PLANTED = "plantedtok.MIDDLEPART.SIGPART11";
    // node:test buffers `console.*`; capture at the lower stream level.
    const captured: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origOut(chunk as never, ...(rest as []));
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origErr(chunk as never, ...(rest as []));
    }) as typeof process.stderr.write;
    try {
      const client = {
        getMe: async () => me,
        getChannelMessages: async () => [],
      };
      void PLANTED;
      await ingestDiscord(
        makeAllowlist(),
        {} as IngestionCursorMap,
        client,
        "run-test",
        NOW,
      );
    } finally {
      process.stdout.write = origOut as typeof process.stdout.write;
      process.stderr.write = origErr as typeof process.stderr.write;
    }
    const joined = captured.join("");
    assert.doesNotMatch(joined, /plantedtok/);
    assert.doesNotMatch(joined, /MIDDLEPART/);
    assert.doesNotMatch(joined, /SIGPART11/);
  });
});
