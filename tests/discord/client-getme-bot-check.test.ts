// T009 [US3] — DiscordClient.getMe() bot-check + schema + redaction tests.
//
// Asserts per spec 003 discord-bot.contract.md §4.1 / §4.2:
//   - GET /users/@me returning { bot: false } throws DiscordAuthError
//     with message "token is not a bot token".
//   - { bot: true, ... } returns the parsed BotIdentity (zod-validated).
//   - Malformed body (e.g. missing id) throws SchemaMismatchError.
//   - The planted bot-token-shaped value NEVER appears in any thrown
//     err.message — covers the redactString defence-in-depth pass.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DiscordAuthError,
  DiscordClient,
  SchemaMismatchError,
} from "../../src/discord/client.ts";

// JWT-shaped planted token: three base64url segments. redactString matches
// `\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b` so this
// shape will be caught by the JWT regex even if the call site forgets.
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

function jsonResponse(body: unknown, status = 200): Response {
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

describe("DiscordClient.getMe — bot:true happy path (T009 / contract §4.1)", () => {
  it("returns the parsed BotIdentity when the fixture has bot:true", async () => {
    const fixture = loadFixture("users-me.json") as {
      id: string;
      username: string;
      discriminator: string;
      bot: true;
    };
    const client = makeClient(async () => jsonResponse(fixture));
    const ident = await client.getMe();
    assert.equal(ident.bot, true);
    assert.equal(ident.id, fixture.id);
    assert.equal(ident.username, fixture.username);
    assert.equal(ident.discriminator, fixture.discriminator);
  });
});

describe("DiscordClient.getMe — bot:false rejects (T009 / contract §4.2)", () => {
  it("throws DiscordAuthError when bot === false", async () => {
    const client = makeClient(async () =>
      jsonResponse({
        id: "100000000000000001",
        username: "human-account",
        discriminator: "0",
        bot: false,
      }),
    );
    await assert.rejects(
      () => client.getMe(),
      (err: unknown) => {
        assert.ok(err instanceof DiscordAuthError, "expected DiscordAuthError");
        assert.match((err as Error).message, /token is not a bot token/);
        return true;
      },
    );
  });

  it("planted bot-token value NEVER appears in the thrown err.message", async () => {
    const client = makeClient(async () =>
      jsonResponse({
        id: "100000000000000001",
        username: "human-account",
        discriminator: "0",
        bot: false,
      }),
    );
    try {
      await client.getMe();
      assert.fail("expected throw");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      assert.doesNotMatch(msg, /abcdefghijklmnop/);
      assert.doesNotMatch(msg, /qrstuvwxyz012345/);
      assert.doesNotMatch(msg, /6789ABCDEFGHIJKL/);
    }
  });
});

describe("DiscordClient.getMe — malformed body (T009 / contract §4.1)", () => {
  it("throws SchemaMismatchError when required fields are missing", async () => {
    // Missing `id` snowflake — BotIdentitySchema requires it.
    const client = makeClient(async () =>
      jsonResponse({ username: "x", discriminator: "0", bot: true }),
    );
    await assert.rejects(() => client.getMe(), SchemaMismatchError);
  });

  it("planted token NEVER appears in SchemaMismatchError.message", async () => {
    const client = makeClient(async () =>
      jsonResponse({ username: "x", discriminator: "0", bot: true }),
    );
    try {
      await client.getMe();
      assert.fail("expected throw");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      assert.doesNotMatch(msg, /abcdefghijklmnop/);
      assert.doesNotMatch(msg, /qrstuvwxyz012345/);
    }
  });
});

describe("DiscordClient.getMe — 401 fast-fail (T009 / contract §4.2)", () => {
  it("throws DiscordAuthError on HTTP 401 without leaking the token", async () => {
    const auth401 = loadFixture("auth-401.json");
    const client = makeClient(async () => jsonResponse(auth401, 401));
    try {
      await client.getMe();
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof DiscordAuthError);
      const msg = (err as Error).message ?? "";
      assert.doesNotMatch(msg, /abcdefghijklmnop/);
    }
  });
});
