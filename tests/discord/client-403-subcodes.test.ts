// T019 [US2] — DiscordClient 403 subcode extraction (contract T1).
//
// Asserts per spec 003 contract §3.2 + data-model.md §RunHealth:
//   - 403 body { code: 50001 } → DiscordChannelAccessError.discordErrorCode === 50001
//   - 403 body { code: 50013 } → discordErrorCode === 50013
//   - 403 with no `code` field → discordErrorCode === undefined
//   - planted bot-token-shaped value NEVER appears in err.message
//     (redactString defence-in-depth pass).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DiscordChannelAccessError,
  DiscordClient,
} from "../../src/discord/client.ts";

const PLANTED_TOKEN =
  "abcdefghijklmnop.qrstuvwxyz012345.6789ABCDEFGHIJKL";

function loadFixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "fixtures", "discord", name),
      "utf8",
    ),
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch): DiscordClient {
  return new DiscordClient({
    token: PLANTED_TOKEN,
    fetchImpl,
    sleep: async () => {},
  });
}

const CHANNEL_ID = "222222222222222222";

describe("DiscordClient 403 subcodes (T019 / contract T1)", () => {
  it("403 + code:50001 → DiscordChannelAccessError with discordErrorCode 50001", async () => {
    const body = loadFixture("forbidden-50001.json");
    const client = makeClient(async () => jsonResponse(body, 403));
    await assert.rejects(
      () => client.getChannelMessages(CHANNEL_ID),
      (err: unknown) => {
        assert.ok(err instanceof DiscordChannelAccessError);
        assert.equal(err.discordErrorCode, 50001);
        assert.doesNotMatch(err.message, /abcdefghijklmnop/);
        assert.doesNotMatch(err.message, /qrstuvwxyz012345/);
        return true;
      },
    );
  });

  it("403 + code:50013 → DiscordChannelAccessError with discordErrorCode 50013", async () => {
    const body = loadFixture("forbidden-50013.json");
    const client = makeClient(async () => jsonResponse(body, 403));
    await assert.rejects(
      () => client.getChannelMessages(CHANNEL_ID),
      (err: unknown) => {
        assert.ok(err instanceof DiscordChannelAccessError);
        assert.equal(err.discordErrorCode, 50013);
        assert.doesNotMatch(err.message, /abcdefghijklmnop/);
        return true;
      },
    );
  });

  it("403 with no `code` field → discordErrorCode is undefined", async () => {
    const client = makeClient(async () =>
      jsonResponse({ message: "Forbidden" }, 403),
    );
    await assert.rejects(
      () => client.getChannelMessages(CHANNEL_ID),
      (err: unknown) => {
        assert.ok(err instanceof DiscordChannelAccessError);
        assert.equal(err.discordErrorCode, undefined);
        assert.doesNotMatch(err.message, /abcdefghijklmnop/);
        return true;
      },
    );
  });

  it("403 with non-JSON body → discordErrorCode is undefined", async () => {
    const client = makeClient(async () =>
      new Response("not json at all", {
        status: 403,
        headers: { "content-type": "text/plain" },
      }),
    );
    await assert.rejects(
      () => client.getChannelMessages(CHANNEL_ID),
      (err: unknown) => {
        assert.ok(err instanceof DiscordChannelAccessError);
        assert.equal(err.discordErrorCode, undefined);
        assert.doesNotMatch(err.message, /abcdefghijklmnop/);
        return true;
      },
    );
  });
});
