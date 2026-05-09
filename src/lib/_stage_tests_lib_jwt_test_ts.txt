import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, isJwtShaped, describeExpiry, JwtParseError } from "../../src/lib/jwt.ts";

function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(payload: object, header: object = { alg: "none", typ: "JWT" }): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.signaturePartZZZ`;
}

describe("isJwtShaped", () => {
  it("accepts three non-empty base64url segments", () => {
    assert.equal(isJwtShaped("aaa.bbb.ccc"), true);
    assert.equal(isJwtShaped("aA1_-.bB2_-.cC3_-"), true);
  });

  it("rejects malformed inputs", () => {
    assert.equal(isJwtShaped(""), false);
    assert.equal(isJwtShaped("abc"), false);
    assert.equal(isJwtShaped("a.b"), false);
    assert.equal(isJwtShaped("a.b.c.d"), false);
    assert.equal(isJwtShaped(null), false);
    assert.equal(isJwtShaped(123), false);
    // '=' is not in the base64url alphabet allowed by the regex
    assert.equal(isJwtShaped("a.b.c="), false);
    // empty middle segment
    assert.equal(isJwtShaped("a..c"), false);
  });
});

describe("decodeJwt", () => {
  it("decodes header, payload, exp, iss, aud", () => {
    const token = makeJwt({
      exp: 1234567890,
      iss: "https://id.scopely.com",
      aud: "stfc",
    });
    const decoded = decodeJwt(token);
    assert.deepEqual(decoded.header, { alg: "none", typ: "JWT" });
    assert.equal(decoded.exp, 1234567890);
    assert.equal(decoded.iss, "https://id.scopely.com");
    assert.equal(decoded.aud, "stfc");
    assert.equal((decoded.payload as { iss: string }).iss, "https://id.scopely.com");
  });

  it("supports array aud", () => {
    const token = makeJwt({ aud: ["a", "b"] });
    const decoded = decodeJwt(token);
    assert.deepEqual(decoded.aud, ["a", "b"]);
  });

  it("returns undefined for absent claims", () => {
    const token = makeJwt({});
    const decoded = decodeJwt(token);
    assert.equal(decoded.exp, undefined);
    assert.equal(decoded.iss, undefined);
    assert.equal(decoded.aud, undefined);
  });

  it("throws JwtParseError on only 2 segments", () => {
    assert.throws(() => decodeJwt("a.b"), (err: unknown) => err instanceof JwtParseError);
  });

  it("throws JwtParseError on non-JSON header", () => {
    const badHeader = b64url("not-json-at-all");
    const goodPayload = b64url(JSON.stringify({}));
    assert.throws(
      () => decodeJwt(`${badHeader}.${goodPayload}.sigsigsig`),
      (err: unknown) => err instanceof JwtParseError && /header/i.test((err as Error).message),
    );
  });

  it("throws JwtParseError on non-JSON payload", () => {
    const goodHeader = b64url(JSON.stringify({ alg: "none" }));
    const badPayload = b64url("not-json");
    assert.throws(
      () => decodeJwt(`${goodHeader}.${badPayload}.sigsigsig`),
      (err: unknown) => err instanceof JwtParseError && /payload/i.test((err as Error).message),
    );
  });
});

describe("describeExpiry", () => {
  const now = new Date("2024-01-01T00:00:00Z");
  const nowSec = Math.floor(now.getTime() / 1000);

  it("future exp ~ 1 day", () => {
    const decoded = decodeJwt(makeJwt({ exp: nowSec + 86400 }));
    const e = describeExpiry(decoded, now);
    assert.equal(e.isExpired, false);
    assert.equal(e.expiresInSeconds, 86400);
    assert.match(e.human, /expires in 1 day/);
  });

  it("past exp ~ 2 days reports EXPIRED", () => {
    const decoded = decodeJwt(makeJwt({ exp: nowSec - 86400 * 2 }));
    const e = describeExpiry(decoded, now);
    assert.equal(e.isExpired, true);
    assert.match(e.human, /EXPIRED 2 days ago/);
  });

  it("no exp → 'no expiry'", () => {
    const decoded = decodeJwt(makeJwt({}));
    const e = describeExpiry(decoded, now);
    assert.equal(e.human, "no expiry");
    assert.equal(e.exp, undefined);
    assert.equal(e.expiresInSeconds, undefined);
    assert.equal(e.isExpired, false);
  });
});
