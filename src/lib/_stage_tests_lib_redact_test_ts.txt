import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactString, redactValue, redactForLog } from "../../src/lib/redact.ts";

// JWT_RE requires each of the three segments to be at least 8 base64url chars.
// Use long-enough placeholders so the regex actually matches.
const LONG_JWT = "abcdefgh.ijklmnop.qrstuvwx";

describe("redactString", () => {
  it("redacts a JWT-shaped token to [REDACTED-JWT]", () => {
    const out = redactString(`Bearer ${LONG_JWT}`);
    assert.match(out, /\[REDACTED-JWT\]/);
    assert.doesNotMatch(out, /abcdefgh/);
  });

  it("redacts an Authorization header value", () => {
    const out = redactString(`Authorization: Bearer ${LONG_JWT}`);
    assert.match(out, /\[REDACTED\]/);
    assert.doesNotMatch(out, /Bearer .{3,}/);
  });

  it("redacts a JSON-style authorization field value", () => {
    const out = redactString(`"authorization":"Bearer ${LONG_JWT}"`);
    assert.match(out, /\[REDACTED\]/);
    assert.doesNotMatch(out, /abcdefgh/);
  });

  it("leaves benign strings alone", () => {
    assert.equal(redactString("plain string with no secrets"), "plain string with no secrets");
  });
});

describe("redactValue", () => {
  it("redacts Authorization and *token* keys recursively", () => {
    const input = {
      Authorization: `Bearer ${LONG_JWT}`,
      nested: { token: "x", refreshToken: "y", harmless: 1 },
      keep: "ok",
    };
    const out = redactValue(input) as {
      Authorization: string;
      nested: { token: string; refreshToken: string; harmless: number };
      keep: string;
    };
    assert.equal(out.Authorization, "[REDACTED]");
    assert.equal(out.nested.token, "[REDACTED]");
    assert.equal(out.nested.refreshToken, "[REDACTED]");
    assert.equal(out.nested.harmless, 1);
    assert.equal(out.keep, "ok");
  });

  it("returns the same string when no JWT pattern present", () => {
    assert.equal(redactValue("plain string"), "plain string");
  });

  it("returns null unchanged", () => {
    assert.equal(redactValue(null), null);
  });

  it("returns numbers unchanged", () => {
    assert.equal(redactValue(123), 123);
  });

  it("redacts JWT-shaped strings inside arrays", () => {
    const out = redactValue([`Bearer ${LONG_JWT}`, "ok"]) as string[];
    assert.match(out[0]!, /\[REDACTED-JWT\]/);
    assert.equal(out[1], "ok");
  });
});

describe("redactForLog", () => {
  it("redacts JWT in Error message", () => {
    const out = redactForLog(new Error(`Bearer ${LONG_JWT}`));
    assert.match(out, /^Error: Bearer /);
    assert.match(out, /\[REDACTED-JWT\]/);
    assert.doesNotMatch(out, /abcdefgh/);
  });

  it("JSON-stringifies and redacts objects", () => {
    const out = redactForLog({ token: "x", note: "hello" });
    // token field should be redacted
    assert.match(out, /\[REDACTED\]/);
    assert.match(out, /hello/);
  });

  it("returns plain string redacted", () => {
    const out = redactForLog(`hi ${LONG_JWT}`);
    assert.match(out, /\[REDACTED-JWT\]/);
  });
});
