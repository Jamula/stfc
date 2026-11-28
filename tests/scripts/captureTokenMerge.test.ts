// Regression tests for issue #211:
// bug(security): capture-token error may echo the raw STFC_ACCOUNTS value
//
// Verifies that parse errors from mergeIntoEnv do NOT include the raw
// STFC_ACCOUNTS line contents (which may contain live JWTs) in thrown
// error messages.  All token values used here are clearly fake fixtures.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";

import { mergeIntoEnv, mergeAfterIdentityConfirmation, captureToken, verifyAccountId, validateRecoveryBaseline, readAccountName, readExpectedAccountId, main } from "../../scripts/capture-token.ts";
import { readMaskedLine, runRecoverAuth, validateSingleLineBackup } from "../../scripts/recover-auth.ts";

// ---------------------------------------------------------------------------
// Fake fixture values — clearly not real credentials.
// ---------------------------------------------------------------------------
const FAKE_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".FAKE_PAYLOAD_NOT_A_REAL_JWT" +
  ".FAKE_SIGNATURE";

const MALFORMED_VALUE = `NOT_VALID_JSON_${FAKE_TOKEN}`;
const NON_ARRAY_VALUE = JSON.stringify({ not: "an array", token: FAKE_TOKEN });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpEnv(content: string): string {
  const dir = mkdtempSync(join(process.cwd(), ".capture-token-test-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, content, "utf8");
  return envFile;
}

function makeLoginRequest() {
  return {
    url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/login",
    method: () => "POST",
    headers: () => ({}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeIntoEnv error redaction (issue #211)", () => {
  const tmpDirs: string[] = [];

  after(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("malformed JSON error does not contain the raw STFC_ACCOUNTS value", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${MALFORMED_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    let caughtError: Error | undefined;
    try {
      await mergeIntoEnv({
        name: "test-account",
        token: "new-fake-token",
        force: false,
        _envPath: envFile,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    assert.ok(caughtError, "Expected an error to be thrown");
    assert.ok(
      !caughtError.message.includes(MALFORMED_VALUE),
      `Error message must not contain raw STFC_ACCOUNTS value.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      !caughtError.message.includes(FAKE_TOKEN),
      `Error message must not contain fake token string.\nGot: ${caughtError.message}`,
    );
    // Should still report file/line for actionability
    assert.ok(
      caughtError.message.includes("line 1"),
      `Error should report the line number.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("STFC_ACCOUNTS"),
      `Error should name the field.\nGot: ${caughtError.message}`,
    );
  });

  it("non-array JSON error does not contain the raw STFC_ACCOUNTS value", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${NON_ARRAY_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    let caughtError: Error | undefined;
    try {
      await mergeIntoEnv({
        name: "test-account",
        token: "new-fake-token",
        force: false,
        _envPath: envFile,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    assert.ok(caughtError, "Expected an error to be thrown");
    assert.ok(
      !caughtError.message.includes(NON_ARRAY_VALUE),
      `Error message must not contain raw STFC_ACCOUNTS value.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      !caughtError.message.includes(FAKE_TOKEN),
      `Error message must not contain fake token string.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("line 1"),
      `Error should report the line number.\nGot: ${caughtError.message}`,
    );
    assert.ok(
      caughtError.message.includes("STFC_ACCOUNTS"),
      `Error should name the field.\nGot: ${caughtError.message}`,
    );
  });

  it("force=true with malformed JSON overwrites without throwing", async () => {
    const envFile = makeTmpEnv(`STFC_ACCOUNTS=${MALFORMED_VALUE}\n`);
    tmpDirs.push(dirname(envFile));

    const result = await mergeIntoEnv({
      name: "test-account",
      token: "new-fake-token",
      force: true,
      _envPath: envFile,
    });

    assert.ok(Array.isArray(result), "Should return an array on force=true");
    assert.equal(result.length, 1);
    assert.equal(result[0]?.name, "test-account");
  });

  it("preserves unrelated metadata exactly, including unsafe numbers and escaped strings", async () => {
    const other = `{"name":"other","token":"old.other.token","metadata":{"id":9007199254740993,"text":"a\\\\b","items":[1,{"x":2}]}}`;
    const envFile = makeTmpEnv(`STFC_ACCOUNTS='[{"name":"main","token":"old.main.token"},${other}]'\n`);
    tmpDirs.push(dirname(envFile));
    const result = await mergeIntoEnv({ name: "main", token: "new.main.token", force: false, _envPath: envFile });
    assert.equal(result.secretJson, `[{"name":"main","token":"new.main.token"},${other}]`);
    assert.equal(readFileSync(envFile, "utf8"), `STFC_ACCOUNTS='${result.secretJson}'\n`);
    const parsed = spawnSync(process.execPath, [`--env-file=${envFile}`, "-e", "process.stdout.write(process.env.STFC_ACCOUNTS)"], { encoding: "utf8" });
    assert.equal(parsed.status, 0);
    assert.equal(parsed.stdout, result.secretJson);
  });

  it("refuses to discard selected account metadata or duplicate targets", async () => {
    for (const json of [
      `[{"name":"main","token":"old","extra":9007199254740993}]`,
      `[{"name":"main","token":"old"},{"name":"main","token":"other"}]`,
    ]) {
      const original = `STFC_ACCOUNTS='${json}'\n`;
      const envFile = makeTmpEnv(original);
      tmpDirs.push(dirname(envFile));
      await assert.rejects(mergeIntoEnv({ name: "main", token: "new", force: false, _envPath: envFile }), /refusing to discard/);
      assert.equal(readFileSync(envFile, "utf8"), original);
    }
  });

  it("verifies the captured token against the expected account before preserving the backup", async () => {
    const other = `{"name":"other","token":"old.other.token","extra":9007199254740993}`;
    const original = `STFC_ACCOUNTS='[{"name":"main","token":"old.main.token"},${other}]'\n`;
    const envFile = makeTmpEnv(original);
    tmpDirs.push(dirname(envFile));
    let matchedToken = false;
    const verify = (token: string, expected: string) => verifyAccountId(token, expected, async (_url: string, options: { headers: { Authorization: string } }) => {
      matchedToken = options.headers.Authorization === `Bearer ${token}`;
      return new Response('{"payload":{"accountId":9007199254740993}}', { status: 200 });
    });
    const result = await mergeAfterIdentityConfirmation({
      name: "main", token: "new.main.token", force: false, baseline: original, expectedId: "9007199254740993", envPath: envFile, verify,
    });
    assert.equal(matchedToken, true, "must authenticate the exact token being merged");
    assert.equal(result.secretJson, `[{"name":"main","token":"new.main.token"},${other}]`);
    assert.equal(readFileSync(envFile, "utf8"), `STFC_ACCOUNTS='${result.secretJson}'\n`);
  });

  it("refuses to merge when the captured token belongs to a different account", async () => {
    const original = `STFC_ACCOUNTS='[{"name":"main","token":"old"}]'\n`;
    const envFile = makeTmpEnv(original);
    tmpDirs.push(dirname(envFile));
    await assert.rejects(mergeAfterIdentityConfirmation({
      name: "main", token: "new.main.token", force: false, baseline: original, envPath: envFile, expectedId: "expected",
      verify: (token: string, expected: string) => verifyAccountId(token, expected, async () => new Response('{"payload":{"accountId":"different"}}')),
    }), /Token identity could not be verified/);
    assert.equal(readFileSync(envFile, "utf8"), original);
  });

  it("fails closed for missing, ambiguous, malformed, mismatched and unavailable identity responses", async () => {
    const replies = [
      '{"payload":{"accountId":"other"}}', '{"payload":{}}', '{"payload":null}',
      '{"payload":{"accountId":null}}', '{"payload":{"accountId":true}}',
      '{"payload":{"accountId":1.0}}', '{"payload":{"accountId":-1}}',
      '{"payload":{"accountId":"expected","accountId":"other"}}',
      '{"payload":{"accountId":"expected"},"payload":{"accountId":"expected"}}',
      '{"payload":{"accountId":"expected"}} trailing', '[]',
    ];
    for (const body of replies) {
      assert.equal(await verifyAccountId("one.two.three", "expected", async () => new Response(body)), false, "invalid response must not authorize recovery");
    }
    assert.equal(await verifyAccountId("one.two.three", "expected", async () => new Response('{"payload":{"accountId":"expected"}}', { status: 401 })), false);
    assert.equal(await verifyAccountId("one.two.three", "expected", async () => { throw new Error("offline"); }), false);
    assert.equal(await verifyAccountId("one.two.three", "", async () => new Response('{"payload":{"accountId":"expected"}}')), false);
    assert.equal(await verifyAccountId("not-a-token", "expected", async () => new Response('{"payload":{"accountId":"expected"}}')), false);
    assert.equal(await verifyAccountId("one.two.three", "expected", async () => new Response('{"payload":{"accountId":"expected"}}')), true);
  });

  it("requires a complete unambiguous backup and an existing named target", () => {
    const good = `STFC_ACCOUNTS='[{"name":"main","token":"old.main.token"},{"name":"other","token":"old.other.token"}]'\n`;
    assert.doesNotThrow(() => validateRecoveryBaseline(good, "main"));
    for (const invalid of [
      null, "", good + good, `${good}export STFC_ACCOUNTS='[]'\n`, good.replace("STFC_ACCOUNTS", "export STFC_ACCOUNTS"),
      good.replace('"other"', '"main"'),
      good.replace('"old.main.token"', '"not-a-jwt"'),
      good.replace('"name":"main"', '"name":"main","name":"main"'),
      good.replace('"token":"old.main.token"', '"token":"old.main.token","extra":1'),
    ]) assert.throws(() => validateRecoveryBaseline(invalid, "main"));
    assert.throws(() => validateRecoveryBaseline(good, "missing"));
  });

  it("reads the expected identifier privately and rejects non-terminal or invalid input", async () => {
    let output = "";
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true, isRaw: false,
      setRawMode(value: boolean) { this.isRaw = value; },
      resume() {}, pause() {},
    });
    const stdout = { isTTY: true, write: (value: string) => { output += value; } };
    const result = readExpectedAccountId({ stdin, stdout });
    assert.equal(stdin.isRaw, true);
    stdin.emit("data", Buffer.from("fixture-private-id\r"));
    assert.equal(await result, "fixture-private-id");
    assert.equal(stdin.isRaw, false);
    assert.doesNotMatch(output, /fixture-private-id/);
    assert.equal(stdin.listenerCount("data"), 0);
    await assert.rejects(readExpectedAccountId({ stdin: { isTTY: false }, stdout }), /private interactive terminal/);
    const invalid = readExpectedAccountId({ stdin, stdout });
    stdin.emit("data", Buffer.from("invalid value\r"));
    await assert.rejects(invalid, /cancelled or invalid/);
    assert.equal(stdin.isRaw, false);
  });

  it("reads Unicode account labels privately without relaxing account identifier validation", async () => {
    const label = "café";
    const backup = `STFC_ACCOUNTS='[{"name":"${label}","token":"old.fake.token"}]'\n`;
    assert.doesNotThrow(() => validateRecoveryBaseline(backup, label));

    let output = "";
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true, isRaw: false,
      setRawMode(value: boolean) { this.isRaw = value; },
      resume() {}, pause() {},
    });
    const stdout = { isTTY: true, write: (value: string) => { output += value; } };
    const selected = readAccountName({ stdin, stdout });
    const bytes = Buffer.from(`${label}😀\x08\r`);
    stdin.emit("data", bytes.subarray(0, 4));
    stdin.emit("data", bytes.subarray(4));
    assert.equal(await selected, label);
    assert.equal(output, "Enter the exact existing account label (hidden): \n");
    assert.equal(stdin.isRaw, false);

    const expectedId = readExpectedAccountId({ stdin, stdout });
    stdin.emit("data", Buffer.from(`${label}\r`));
    await assert.rejects(expectedId, /cancelled or invalid/);
    assert.equal(stdin.isRaw, false);
  });

  it("refuses an env changed since capture", async () => {
    const original = `STFC_ACCOUNTS='[{"name":"main","token":"old"}]'\n`;
    const changed = `${original}OTHER=value\n`;
    const envFile = makeTmpEnv(changed);
    tmpDirs.push(dirname(envFile));
    await assert.rejects(mergeIntoEnv({
      name: "main", token: "new", force: false, _expectedRaw: original, _envPath: envFile,
    }), /changed during capture/);
    assert.equal(readFileSync(envFile, "utf8"), changed);
  });

  it("keeps the original backup intact on write failure or changes during staging", async () => {
    const original = `STFC_ACCOUNTS='[{"name":"main","token":"old.main.token"}]'\n`;
    const changed = `${original}OTHER=value\n`;
    for (const scenario of ["rename-failed", "concurrent-change", "stage-exists"]) {
      const envFile = makeTmpEnv(original);
      const dir = dirname(envFile);
      tmpDirs.push(dir);
      const stage = join(dir, ".env.local");
      if (scenario === "stage-exists") writeFileSync(stage, "existing user file");
      await assert.rejects(mergeIntoEnv({
        name: "main", token: "new.main.token", force: false, _envPath: envFile, _expectedRaw: original,
        _beforeReplace: async () => { if (scenario === "concurrent-change") writeFileSync(envFile, changed); },
        _rename: scenario === "rename-failed" ? async () => { throw new Error("rename failed"); } : undefined,
      }));
      assert.equal(readFileSync(envFile, "utf8"), scenario === "concurrent-change" ? changed : original);
      if (scenario === "stage-exists") assert.equal(readFileSync(stage, "utf8"), "existing user file");
      else assert.throws(() => readFileSync(stage), /ENOENT/);
    }
  });

  it("removes listeners and clears the capture timer on success", async () => {
    const context = new EventEmitter();
    const promise = captureToken({ context, timeoutMs: 30_000 });
    context.emit("request", { url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test", headers: () => ({ authorization: "Bearer fake.token.value" }) });
    assert.deepEqual(await promise, { token: "fake.token.value", source: "request header" });
    assert.equal(context.listenerCount("request"), 0);
    assert.equal(context.listenerCount("response"), 0);
    assert.equal(context.listenerCount("requestfinished"), 0);
    assert.equal(context.listenerCount("requestfailed"), 0);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { EventEmitter } from 'node:events';
      import { captureToken } from './scripts/capture-token.ts';
      const context = new EventEmitter();
      const result = captureToken({ context, timeoutMs: 30000 });
      context.emit('request', { url: () => 'https://cdn-nv3-webstore-api.startrek.digitgaming.com/x', headers: () => ({ authorization: 'Bearer a.b.c' }) });
      await result;
    `], { cwd: process.cwd(), timeout: 15000, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr || String(child.error));
  });

  it("removes capture listeners on timeout", async () => {
    const context = new EventEmitter();
    assert.deepEqual(await captureToken({ context, timeoutMs: 1 }), { token: null, source: "timeout" });
    assert.equal(context.listenerCount("request"), 0);
    assert.equal(context.listenerCount("response"), 0);
  });

  it("fails closed when the browser token changes or a login response is ambiguous before close", async () => {
    for (const event of ["changed", "ambiguous"]) {
      const context = new EventEmitter();
      const request = (token: string) => ({ url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test", headers: () => ({ authorization: `Bearer ${token}` }) });
      const capture = captureToken({ context, timeoutMs: 30000, closeAfterCapture: async () => {} });
      context.emit("request", request("first.token.value"));
      if (event === "changed") context.emit("request", request("different.token.value"));
      else {
        const login = makeLoginRequest();
        context.emit("request", login);
        context.emit("response", {
          url: () => login.url(), request: () => login, status: () => 200,
          json: async () => { throw new Error("unreadable"); },
        });
        context.emit("requestfinished", login);
      }
      await assert.rejects(capture, /ambiguous or the browser token changed/);
      assert.equal(context.listenerCount("request"), 0);
      assert.equal(context.listenerCount("response"), 0);
      assert.equal(context.listenerCount("requestfinished"), 0);
      assert.equal(context.listenerCount("requestfailed"), 0);
    }
  });

  it("drains login response reads before closing and fails closed on a drain timeout", async () => {
    const context = new EventEmitter();
    let resolveBody!: (body: { accessToken: string }) => void;
    let closed = false;
    const capture = captureToken({
      context, timeoutMs: 30_000, responseDrainTimeoutMs: 1000,
      closeAfterCapture: async () => { closed = true; },
    });
    const token = "first.token.value";
    const login = makeLoginRequest();
    context.emit("request", {
      url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    context.emit("request", login);
    context.emit("response", {
      url: () => login.url(), request: () => login, status: () => 200,
      json: () => new Promise<{ accessToken: string }>((resolve) => { resolveBody = resolve; }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false, "browser must remain open while the login response is unread");
    resolveBody({ accessToken: token });
    context.emit("requestfinished", login);
    assert.deepEqual(await capture, { token, source: "request header" });
    assert.equal(closed, true);

    const timedOutContext = new EventEmitter();
    let timeoutClosed = false;
    const timedOut = captureToken({
      context: timedOutContext, timeoutMs: 30_000, responseDrainTimeoutMs: 10,
      closeAfterCapture: async () => { timeoutClosed = true; },
    });
    const timedOutLogin = makeLoginRequest();
    timedOutContext.emit("request", {
      url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    timedOutContext.emit("request", timedOutLogin);
    timedOutContext.emit("response", {
      url: () => timedOutLogin.url(), request: () => timedOutLogin, status: () => 200,
      json: () => new Promise(() => {}),
    });
    await assert.rejects(timedOut, /ambiguous or the browser token changed/);
    assert.equal(timeoutClosed, true);
  });

  it("fails closed when closing would cancel a login request still in flight after token capture", async () => {
    const context = new EventEmitter();
    const token = "first.token.value";
    const login = makeLoginRequest();
    let closed = false;
    const capture = captureToken({
      context, timeoutMs: 30_000, responseDrainTimeoutMs: 20,
      closeAfterCapture: async () => {
        closed = true;
        context.emit("requestfailed", login);
      },
    });
    context.emit("request", {
      url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    context.emit("request", login);

    await assert.rejects(capture, /ambiguous or the browser token changed/);
    assert.equal(closed, true, "the browser may close only after the bounded request drain");
    assert.equal(context.listenerCount("request"), 0);
    assert.equal(context.listenerCount("requestfinished"), 0);
    assert.equal(context.listenerCount("requestfailed"), 0);
  });

  it("yields for an in-flight login without a response reader and fails closed at its deadline", async () => {
    const token = "first.token.value";
    const context = new EventEmitter();
    const login = makeLoginRequest();
    let closed = false;
    const capture = captureToken({
      context, timeoutMs: 30_000, responseDrainTimeoutMs: 1000,
      closeAfterCapture: async () => { closed = true; },
    });
    context.emit("request", {
      url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    context.emit("request", login);
    setTimeout(() => {
      context.emit("response", {
        url: () => login.url(), request: () => login, status: () => 200,
        json: async () => ({ accessToken: token }),
      });
      context.emit("requestfinished", login);
    }, 10);

    assert.deepEqual(await capture, { token, source: "request header" });
    assert.equal(closed, true, "the capture should wait for the pending login lifecycle to complete");
    assert.equal(context.listenerCount("request"), 0);
    assert.equal(context.listenerCount("response"), 0);
    assert.equal(context.listenerCount("requestfinished"), 0);
    assert.equal(context.listenerCount("requestfailed"), 0);

    const unresolvedContext = new EventEmitter();
    const unresolved = captureToken({
      context: unresolvedContext, timeoutMs: 30_000, responseDrainTimeoutMs: 10,
      closeAfterCapture: async () => {},
    });
    unresolvedContext.emit("request", {
      url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    unresolvedContext.emit("request", makeLoginRequest());
    await assert.rejects(unresolved, /ambiguous or the browser token changed/);
    assert.equal(unresolvedContext.listenerCount("request"), 0);
    assert.equal(unresolvedContext.listenerCount("response"), 0);
    assert.equal(unresolvedContext.listenerCount("requestfinished"), 0);
    assert.equal(unresolvedContext.listenerCount("requestfailed"), 0);
  });

  it("drains ambiguous login responses that begin during closure without unhandled rejections", async () => {
    for (const responseKind of ["different-token", "unreadable"] as const) {
      const context = new EventEmitter();
      const token = "first.token.value";
      let unhandled: unknown;
      const onUnhandled = (reason: unknown) => { unhandled = reason; };
      process.on("unhandledRejection", onUnhandled);
      try {
        const capture = captureToken({
          context, timeoutMs: 30_000, responseDrainTimeoutMs: 1000,
          closeAfterCapture: async () => {
            const login = makeLoginRequest();
            context.emit("request", login);
            context.emit("response", {
              url: () => login.url(), request: () => login, status: () => 200,
              json: async () => {
                await new Promise((resolve) => setImmediate(resolve));
                if (responseKind === "unreadable") throw new Error("synthetic response read failure");
                return { accessToken: "second.token.value" };
              },
            });
            context.emit("requestfinished", login);
          },
        });
        context.emit("request", {
          url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test",
          headers: () => ({ authorization: `Bearer ${token}` }),
        });
        await assert.rejects(capture, /ambiguous or the browser token changed/);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(unhandled, undefined);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    }
  });

  it("detects mutations removing the identity comparison and token-change gates", () => {
    const dir = dirname(makeTmpEnv(""));
    tmpDirs.push(dir);
    mkdirSync(join(dir, "scripts"));
    const script = join(dir, "scripts", "capture-token.ts");
    const source = readFileSync(join(process.cwd(), "scripts", "capture-token.ts"), "utf8");
    const identityMutant = source.replace("actual !== null && actual === expectedId", "actual !== null");
    assert.notEqual(identityMutant, source, "identity gate must be present in the real source");
    writeFileSync(script, identityMutant);
    const identity = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { verifyAccountId } from './scripts/capture-token.ts';
      if (await verifyAccountId('one.two.three', 'expected', async () => new Response('{"payload":{"accountId":"other"}}'))) process.exit(17);
    `], { cwd: dir, encoding: "utf8", timeout: 15000 });
    assert.equal(identity.status, 17, "mismatched-identity regression must be detected");
    const tokenMutant = source.replace('if (changed || ambiguous) throw new Error("Capture was ambiguous or the browser token changed; no update was written.");', "");
    assert.notEqual(tokenMutant, source, "token-change gate must be present in the real source");
    writeFileSync(script, tokenMutant);
    const token = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { EventEmitter } from 'node:events';
      import { captureToken } from './scripts/capture-token.ts';
      const ctx = new EventEmitter();
      const req = token => ({ url: () => 'https://cdn-nv3-webstore-api.startrek.digitgaming.com/x', headers: () => ({ authorization: 'Bearer ' + token }) });
      const result = captureToken({ context: ctx, timeoutMs: 1000, closeAfterCapture: async () => ctx.emit('request', req('two.two.two')) });
      ctx.emit('request', req('one.one.one'));
      try { await result; process.exit(18); } catch {}
    `], { cwd: dir, encoding: "utf8", timeout: 15000 });
    assert.equal(token.status, 18, "changed-token regression must be detected");
  });

  it("runs the real interactive caller with a frozen browser and preserves the full backup", async () => {
    const other = `{"name":"other","token":"old.other.token","extra":9007199254740993}`;
    const accountName = "café";
    const original = `STFC_ACCOUNTS='[{"name":"${accountName}","token":"old.main.token"},${other}]'\n`;
    const cases = ["matched", "mismatched", "changed", "offline", "env-changed"] as const;
    for (const scenario of cases) {
      const envFile = makeTmpEnv(original);
      tmpDirs.push(dirname(envFile));
      const context = new EventEmitter();
      const request = (token: string) => ({ url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test", headers: () => ({ authorization: `Bearer ${token}` }) });
      const page = { goto: async () => { context.emit("request", request("new.main.token")); } };
      const fakeContext = Object.assign(context, { newPage: async () => page });
      let closed = false, uploads = 0, ghChecks = 0, correctToken = false;
      const browser = {
        newContext: async () => fakeContext,
        close: async () => {
          if (!closed && scenario === "changed") context.emit("request", request("changed.main.token"));
          closed = true;
        },
      };
      const messages: string[] = [];
      const priorExitCode = process.exitCode;
      const priorLog = console.log, priorError = console.error;
      try {
        process.exitCode = 0;
        console.log = (...parts: unknown[]) => messages.push(parts.join(" "));
        console.error = (...parts: unknown[]) => messages.push(parts.join(" "));
        await main([], {
          envPath: envFile, privateTerminal: true, ask: async () => true,
          readAccountName: async () => {
            const stdin = Object.assign(new EventEmitter(), {
              isTTY: true, isRaw: false,
              setRawMode(value: boolean) { this.isRaw = value; },
              resume() {}, pause() {},
            });
            const stdout = { isTTY: true, write: (value: string) => messages.push(value) };
            const selected = readAccountName({ stdin, stdout });
            stdin.emit("data", Buffer.from(`${accountName}\r`));
            return selected;
          },
          readExpectedAccountId: async () => "expected-fixture-id",
          launchBrowser: async () => browser,
          fetchIdentity: async (_url: string, options: { headers: { Authorization: string } }) => {
            assert.equal(closed, true, "browser must close before verifying identity");
            correctToken = options.headers.Authorization === "Bearer new.main.token";
            if (scenario === "offline") throw new Error("offline");
            if (scenario === "env-changed") writeFileSync(envFile, `${original}OTHER=value\n`);
            return new Response(scenario === "mismatched" ? '{"payload":{"accountId":"other-fixture-id"}}' : '{"payload":{"accountId":"expected-fixture-id"}}');
          },
          ghAvailable: async () => { ghChecks++; return true; },
          setSecret: async () => { uploads++; },
        });
        assert.equal(process.exitCode, scenario === "matched" ? 0 : 1, `${scenario} exit status`);
        assert.equal(ghChecks, 0, "local recovery must not check or update the hosted secret");
        assert.equal(uploads, 0, "local recovery must not upload the backup");
        if (scenario !== "changed") assert.equal(correctToken, true, `${scenario} must verify the captured token`);
        if (scenario === "matched") {
          assert.equal(readFileSync(envFile, "utf8"), `STFC_ACCOUNTS='[{"name":"${accountName}","token":"new.main.token"},${other}]'\n`);
        } else {
          assert.equal(readFileSync(envFile, "utf8"), scenario === "env-changed" ? `${original}OTHER=value\n` : original);
        }
        assert.doesNotMatch(messages.join("\n"), /expected-fixture-id|other-fixture-id|new\.main\.token|changed\.main\.token/);
      } finally {
        console.log = priorLog;
        console.error = priorError;
        process.exitCode = priorExitCode;
      }
    }
  });

  it("rejects non-CI headless and non-private interactive callers before capture", () => {
    const original = `STFC_ACCOUNTS='[{"name":"main","token":"old.fake.token"}]'\n`;
    const envFile = makeTmpEnv(original);
    const dir = dirname(envFile);
    tmpDirs.push(dir);
    mkdirSync(join(dir, "scripts"));
    const script = join(dir, "scripts", "capture-token.ts");
    copyFileSync(join(process.cwd(), "scripts", "capture-token.ts"), script);
    for (const [args, message] of [
      [[], /private identifier input is invalid/],
      [["--headless"], /requires a visible browser/],
      [["--force"], /requires a visible browser/],
      [["--name", "main"], /private account selection/],
    ] as const) {
      const result = spawnSync(process.execPath, [script, "--timeout", "1", ...args], {
        cwd: dir, input: "yes\n", encoding: "utf8", timeout: 15000,
        env: { ...process.env, STFC_EMAIL: "", STFC_PASSWORD: "", STFC_OTP: "" },
      });
      assert.equal(result.status, 1, result.stderr || String(result.error));
      assert.match(result.stderr, message);
      if (args.length === 0) assert.match(result.stderr, /no capture or update was attempted/);
      assert.doesNotMatch(result.stdout + result.stderr, /Watching network traffic|Validation OK|Updated .*STFC_ACCOUNTS/);
      assert.equal(readFileSync(envFile, "utf8"), original);
    }
    const ci = spawnSync(process.execPath, [script, "--ci", "--headless"], {
      cwd: dir, encoding: "utf8", timeout: 15000,
      env: { ...process.env, STFC_EMAIL: "", STFC_PASSWORD: "", STFC_OTP: "" },
    });
    assert.equal(ci.status, 2);
    assert.match(ci.stderr, /--ci requires STFC_EMAIL/);
    assert.equal(readFileSync(envFile, "utf8"), original);
  });

  it("rejects older Node versions before requesting or writing the backup", async () => {
    const dir = dirname(makeTmpEnv(""));
    tmpDirs.push(dir);
    rmSync(join(dir, ".env"));
    const logs: string[] = [];
    let backupRequested = false;
    const status = await runRecoverAuth({
      rootDir: dir,
      nodeVersion: "24.11.0",
      log: (line) => logs.push(line),
      readBackup: async () => {
        backupRequested = true;
        return "";
      },
    });
    assert.equal(status, 1);
    assert.equal(backupRequested, false);
    assert.match(logs.join("\n"), /Node\.js 26 or later is required/);
    assert.doesNotMatch(logs.join("\n"), /Complete backup|Paste the complete/);
    assert.throws(() => readFileSync(join(dir, ".env")), /ENOENT/);
  });

  it("checks prerequisites and backup integrity before writing .env", async () => {
    const envFile = makeTmpEnv("");
    const dir = dirname(envFile);
    tmpDirs.push(dir);
    rmSync(envFile);

    const preflightLogs: string[] = [];
    const preflightStatus = await runRecoverAuth({
      rootDir: dir,
      nodeVersion: "26.13.1",
      preflight: () => false,
      log: (line) => preflightLogs.push(line),
      readBackup: async () => {
        throw new Error("backup must not be requested");
      },
    });
    assert.equal(preflightStatus, 1);
    assert.match(preflightLogs.join("\n"), /install the project dependencies and Playwright Chromium/);
    assert.throws(() => readFileSync(envFile), /ENOENT/);

    for (const bad of [
      "",
      "{}",
      "[]",
      '[{"name":"main","token":"not-jwt"}]',
      '[{"name":"main","token":"a.b.c"},{"name":"main","token":"d.e.f"}]',
      '[{"name":"main","name":"dup","token":"a.b.c"}]',
      '[{"name":"a\'b","token":"a.b.c"}]',
      '[{"name":"a\\\\b","token":"a.b.c"}]',
      '[{"name":"   ","token":"a.b.c"}]',
    ]) {
      assert.throws(() => validateSingleLineBackup(bad));
    }
    assert.equal(validateSingleLineBackup('[{"name":"main#1","token":"aaa.bbb.ccc"}]'), 1);

    let maskedOutput = "";
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      isRaw: false,
      setRawMode(value: boolean) {
        this.isRaw = value;
      },
      resume() {},
      pause() {},
    });
    const stdout = {
      isTTY: true,
      write: (value: string) => {
        maskedOutput += value;
      },
    };
    const maskedPromise = readMaskedLine("Complete backup: ", { stdin, stdout });
    stdin.emit("data", Buffer.from('[{"name":"main","token":"secret.jwt.val"}]\r'));
    assert.equal(await maskedPromise, '[{"name":"main","token":"secret.jwt.val"}]');
    assert.doesNotMatch(maskedOutput, /secret\.jwt\.val/);
  });

  it("quotes hash values for Node and restores the caller's environment", async () => {
    const envFile = makeTmpEnv("");
    const dir = dirname(envFile);
    tmpDirs.push(dir);
    rmSync(envFile);
    const baseline = '[{"name":"main#1","token":"aaa.bbb.ccc"}]';

    for (const shouldThrow of [false, true]) {
      if (shouldThrow) rmSync(envFile, { force: true });
      const callerEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GH_REPO: "original/repo",
        GH_HOST: "original.host",
        STFC_EMAIL: "original-email",
        STFC_PASSWORD: "original-password",
        STFC_OTP: "original-otp",
        STFC_DEBUG_DIR: "original-debug",
      };

      const run = () =>
        runRecoverAuth({
          rootDir: dir,
          nodeVersion: "26.13.1",
          env: callerEnv,
          preflight: () => true,
          log: () => {},
          readBackup: async () => baseline,
          confirmConditions: async () => "YES",
          runCapture: ({ env: childEnv }) => {
            assert.equal(childEnv["GH_REPO"], "original/repo");
            assert.equal(childEnv["GH_HOST"], "original.host");
            assert.equal(childEnv["STFC_EMAIL"], undefined);
            assert.equal(childEnv["STFC_PASSWORD"], undefined);
            assert.equal(childEnv["STFC_OTP"], undefined);
            assert.equal(childEnv["STFC_DEBUG_DIR"], undefined);

            const parsed = spawnSync(
              process.execPath,
              [`--env-file=${envFile}`, "-e", "process.stdout.write(process.env.STFC_ACCOUNTS ?? '')"],
              { encoding: "utf8" },
            );
            assert.equal(parsed.status, 0);
            assert.equal(parsed.stdout, baseline);
            if (shouldThrow) throw new Error("simulated capture error");
            return 0;
          },
        });

      if (shouldThrow) {
        await assert.rejects(run(), /simulated capture error/);
      } else {
        assert.equal(await run(), 0);
      }

      assert.equal(callerEnv["GH_REPO"], "original/repo");
      assert.equal(callerEnv["GH_HOST"], "original.host");
      assert.equal(callerEnv["STFC_EMAIL"], "original-email");
      assert.equal(callerEnv["STFC_PASSWORD"], "original-password");
      assert.equal(callerEnv["STFC_OTP"], "original-otp");
      assert.equal(callerEnv["STFC_DEBUG_DIR"], "original-debug");
    }
  });
});
