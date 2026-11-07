// Tests for src/discord/client.ts (T011). Validates:
//   - missing/empty env → DiscordTokenMissingError
//   - present env → loader returns the value verbatim
//   - error message NEVER contains a planted token value (defence-in-depth)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  DiscordTokenMissingError,
  loadDiscordToken,
} from "../../src/discord/client.ts";

const ENV_VAR = "DISCORD_BOT_TOKEN";

describe("loadDiscordToken", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = saved;
  });

  it("throws DiscordTokenMissingError when the env var is unset", () => {
    assert.throws(() => loadDiscordToken(), DiscordTokenMissingError);
  });

  it("throws DiscordTokenMissingError when the env var is empty", () => {
    process.env[ENV_VAR] = "";
    assert.throws(() => loadDiscordToken(), DiscordTokenMissingError);
  });

  it("returns the value verbatim when present", () => {
    process.env[ENV_VAR] = "bot-token-xyz";
    assert.equal(loadDiscordToken(), "bot-token-xyz");
  });

  it("returns long bot-token-shaped values without alteration", () => {
    // Realistic shape: 3 base64url segments separated by '.'.
    const v = "abcdefghijklmnop.qrstuvwxyz012345.6789ABCDEFGHIJKL";
    process.env[ENV_VAR] = v;
    assert.equal(loadDiscordToken(), v);
  });

  it("error message NEVER contains the planted token, even if the env was set then unset", () => {
    // Simulate a caller that captured the token, then for some reason wants
    // to surface a missing-env error after clearing it. The thrown message
    // MUST NOT echo any previously-known token value — we cannot strictly
    // prove that from this layer alone, but we can prove the missing-env
    // error message contains no JWT/Bearer fragments.
    const planted = "supersecret.JWTish-token.AAAAAAAA";
    process.env[ENV_VAR] = planted;
    delete process.env[ENV_VAR];
    assert.throws(
      () => loadDiscordToken(),
      (err: unknown) => {
        const msg = (err as Error).message ?? "";
        assert.doesNotMatch(msg, /supersecret/);
        assert.doesNotMatch(msg, /JWTish/);
        assert.doesNotMatch(msg, /Bearer/);
        return true;
      },
    );
  });
});
