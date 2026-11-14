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
import { Writable } from "node:stream";

// @ts-expect-error - plain .mjs helper without type declarations
import { mergeIntoEnv, mergeAfterIdentityConfirmation, captureToken, ghSetSecret, updateGithubSecret, verifyAccountId, validateRecoveryBaseline, readAccountName, readExpectedAccountId, main } from "../../scripts/capture-token.mjs";

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
    assert.equal(result[0].name, "test-account");
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

  it("requires a current exclusive backup and refuses a changed env before GitHub", async () => {
    const envFile = makeTmpEnv("changed\n");
    tmpDirs.push(dirname(envFile));
    let calls = 0;
    const setSecret = async () => { calls++; };
    const priorExitCode = process.exitCode;
    try {
      const askNo = await updateGithubSecret({ secretJson: "fake", expectedRaw: "changed\n", envPath: envFile, ask: async () => false, setSecret });
      assert.equal(askNo, "skipped");
      assert.equal(calls, 0);
      const messages: string[] = [];
      const changed = await updateGithubSecret({ secretJson: "fake", expectedRaw: "original\n", envPath: envFile, ask: async () => true, setSecret, error: (m: string) => messages.push(m) });
      assert.equal(changed, "failed");
      assert.equal(process.exitCode, 1);
      assert.match(messages.join("\n"), /changed after capture/);
      assert.equal(calls, 0);
    } finally { process.exitCode = priorExitCode; }
  });

  it("sends the preserved JSON to GitHub and reports command failure as nonzero", async () => {
    const envFile = makeTmpEnv("current\n");
    tmpDirs.push(dirname(envFile));
    const secretJson = `[{"name":"other","id":9007199254740993}]`;
    let sent = "";
    let question = "";
    const priorExitCode = process.exitCode;
    try {
      const updated = await updateGithubSecret({ secretJson, expectedRaw: "current\n", envPath: envFile, ask: async (q: string) => { question = q; return true; }, setSecret: async (value: string) => { sent = value; } });
      assert.match(question, /backup current.*stopped all redemption workflows and other \.env and STFC_ACCOUNTS/);
      assert.equal(updated, "updated");
      assert.equal(sent, secretJson);
      const messages: string[] = [];
      const failed = await updateGithubSecret({ secretJson, expectedRaw: "current\n", envPath: envFile, ask: async () => true, setSecret: async () => { throw new Error("offline"); }, error: (m: string) => messages.push(m) });
      assert.equal(failed, "failed");
      assert.equal(process.exitCode, 1);
      assert.match(messages.join("\n"), /GitHub secret update failed/);
    } finally { process.exitCode = priorExitCode; }
  });

  it("sends the secret only through stdin to the explicit repository and rejects gh failures", async () => {
    for (const exitCode of [0, 1]) {
      let destination = "", body = "";
      const spawnProcess = (command: string, args: string[], options: { stdio: string[] }) => {
        destination = `${command} ${args.join(" ")}`;
        assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore"]);
        const process = Object.assign(new EventEmitter(), {
          stdin: new Writable({
            write(chunk, _encoding, callback) { body += chunk.toString(); callback(); },
            final(callback) { callback(); queueMicrotask(() => process.emit("exit", exitCode)); },
          }),
        });
        return process;
      };
      const upload = ghSetSecret("fixture-secret", spawnProcess);
      if (exitCode === 0) await upload;
      else await assert.rejects(upload, /gh exited with code 1/);
      assert.equal(destination, "gh secret set STFC_ACCOUNTS --repo github.com/Jamula/stfc");
      assert.equal(body, "fixture-secret");
    }
  });

  it("removes listeners and clears the capture timer on success", async () => {
    const context = new EventEmitter();
    const promise = captureToken({ context, timeoutMs: 30_000 });
    context.emit("request", { url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test", headers: () => ({ authorization: "Bearer fake.token.value" }) });
    assert.deepEqual(await promise, { token: "fake.token.value", source: "request header" });
    assert.equal(context.listenerCount("request"), 0);
    assert.equal(context.listenerCount("response"), 0);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { EventEmitter } from 'node:events';
      import { captureToken } from './scripts/capture-token.mjs';
      const context = new EventEmitter();
      const result = captureToken({ context, timeoutMs: 30000 });
      context.emit('request', { url: () => 'https://cdn-nv3-webstore-api.startrek.digitgaming.com/x', headers: () => ({ authorization: 'Bearer a.b.c' }) });
      await result;
    `], { cwd: process.cwd(), timeout: 5000, encoding: "utf8" });
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
      const capture = captureToken({ context, timeoutMs: 30000, closeAfterCapture: async () => {
        if (event === "changed") context.emit("request", request("different.token.value"));
        else context.emit("response", { url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/login", request: () => ({ method: () => "POST" }), status: () => 200, json: async () => { throw new Error("unreadable"); } });
      } });
      context.emit("request", request("first.token.value"));
      await assert.rejects(capture, /ambiguous or the browser token changed/);
      assert.equal(context.listenerCount("request"), 0);
      assert.equal(context.listenerCount("response"), 0);
    }
  });

  it("detects mutations removing the identity comparison and token-change gates", () => {
    const dir = dirname(makeTmpEnv(""));
    tmpDirs.push(dir);
    mkdirSync(join(dir, "scripts"));
    const script = join(dir, "scripts", "capture-token.mjs");
    const source = readFileSync(join(process.cwd(), "scripts", "capture-token.mjs"), "utf8");
    const identityMutant = source.replace("actual !== null && actual === expectedId", "actual !== null");
    assert.notEqual(identityMutant, source, "identity gate must be present in the real source");
    writeFileSync(script, identityMutant);
    const identity = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { verifyAccountId } from './scripts/capture-token.mjs';
      if (await verifyAccountId('one.two.three', 'expected', async () => new Response('{"payload":{"accountId":"other"}}'))) process.exit(17);
    `], { cwd: dir, encoding: "utf8", timeout: 15000 });
    assert.equal(identity.status, 17, "mismatched-identity regression must be detected");
    const tokenMutant = source.replace('if (changed || ambiguous) throw new Error("Capture was ambiguous or the browser token changed; no update was written.");', "");
    assert.notEqual(tokenMutant, source, "token-change gate must be present in the real source");
    writeFileSync(script, tokenMutant);
    const token = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { EventEmitter } from 'node:events';
      import { captureToken } from './scripts/capture-token.mjs';
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
    const cases = ["matched", "mismatched", "changed", "offline", "upload-failed", "env-changed"] as const;
    for (const scenario of cases) {
      const envFile = makeTmpEnv(original);
      tmpDirs.push(dirname(envFile));
      const context = new EventEmitter();
      const request = (token: string) => ({ url: () => "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/test", headers: () => ({ authorization: `Bearer ${token}` }) });
      const page = { goto: async () => { context.emit("request", request("new.main.token")); } };
      const fakeContext = Object.assign(context, { newPage: async () => page });
      let closed = false, uploads = 0, correctToken = false;
      const browser = {
        newContext: async () => fakeContext,
        close: async () => {
          if (!closed && scenario === "changed") context.emit("request", request("changed.main.token"));
          closed = true;
        },
      };
      let sent = "";
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
          ghAvailable: async () => true,
          setSecret: async (value: string) => {
            uploads++;
            sent = value;
            if (scenario === "upload-failed") throw new Error("offline");
          },
        });
        assert.equal(process.exitCode, scenario === "matched" ? 0 : 1, `${scenario} exit status`);
        assert.equal(uploads, scenario === "matched" || scenario === "upload-failed" ? 1 : 0, `${scenario} upload count`);
        if (scenario !== "changed") assert.equal(correctToken, true, `${scenario} must verify the captured token`);
        if (scenario === "matched" || scenario === "upload-failed") {
          assert.equal(sent, `[{"name":"${accountName}","token":"new.main.token"},${other}]`);
          assert.equal(readFileSync(envFile, "utf8"), `STFC_ACCOUNTS='${sent}'\n`);
        } else {
          assert.equal(readFileSync(envFile, "utf8"), scenario === "env-changed" ? `${original}OTHER=value\n` : original);
        }
        assert.doesNotMatch(messages.join("\n"), /expected-fixture-id|other-fixture-id|new\.main\.token|changed\.main\.token/);
        if (scenario === "upload-failed") assert.match(messages.join("\n"), /secret may have changed/);
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
    const script = join(dir, "scripts", "capture-token.mjs");
    copyFileSync(join(process.cwd(), "scripts", "capture-token.mjs"), script);
    for (const [args, message] of [
      [[], /private identifier input is invalid/],
      [["--headless"], /requires a visible browser/],
      [["--force"], /requires a visible browser/],
      [["--name", "main"], /private account selection/],
    ] as const) {
      const result = spawnSync(process.execPath, [script, "--timeout", "1", ...args], {
        cwd: dir, input: "yes\n", encoding: "utf8", timeout: 5000,
        env: { ...process.env, STFC_EMAIL: "", STFC_PASSWORD: "", STFC_OTP: "" },
      });
      assert.equal(result.status, 1, result.stderr || String(result.error));
      assert.match(result.stderr, message);
      if (args.length === 0) assert.match(result.stderr, /no capture or update was attempted/);
      assert.doesNotMatch(result.stdout + result.stderr, /Watching network traffic|Validation OK|Updated .*STFC_ACCOUNTS/);
      assert.equal(readFileSync(envFile, "utf8"), original);
    }
    const ci = spawnSync(process.execPath, [script, "--ci", "--headless"], {
      cwd: dir, encoding: "utf8", timeout: 5000,
      env: { ...process.env, STFC_EMAIL: "", STFC_PASSWORD: "", STFC_OTP: "" },
    });
    assert.equal(ci.status, 2);
    assert.match(ci.stderr, /--ci requires STFC_EMAIL/);
    assert.equal(readFileSync(envFile, "utf8"), original);
  });

  it("rejects Windows PowerShell 5 before requesting or writing the backup", (t) => {
    const dir = dirname(makeTmpEnv(""));
    tmpDirs.push(dir);
    rmSync(join(dir, ".env"));
    const script = join(dir, "recover-auth.ps1");
    copyFileSync(join(process.cwd(), "recover-auth.ps1"), script);
    let available = 0;
    for (const [command, message] of [["powershell", /PowerShell 7 or later is required.*pwsh/]] as const) {
      const probe = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
      if (probe.error || probe.status !== 0 || (command === "powershell" && Number(probe.stdout.trim()) >= 7)) continue;
      available++;
      const shellArgs = command === "powershell" ? ["-NoProfile", "-ExecutionPolicy", "Bypass"] : ["-NoProfile"];
      const result = spawnSync(command, [...shellArgs, "-File", script], {
        cwd: dir, input: "\n", encoding: "utf8", timeout: 30000,
      });
      assert.equal(result.status, 1, result.stderr || String(result.error));
      assert.match(result.stdout + result.stderr, message);
      assert.doesNotMatch(result.stdout + result.stderr, /Complete backup|Paste the complete/);
      assert.throws(() => readFileSync(join(dir, ".env")), /ENOENT/);
    }
    if (available === 0) t.skip("PowerShell not installed");
  });

  it("checks prerequisites before requesting or writing a backup", (t) => {
    const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (pwsh.error) return t.skip("PowerShell not installed");
    const envFile = makeTmpEnv("");
    const dir = dirname(envFile);
    tmpDirs.push(dir);
    rmSync(envFile);
    copyFileSync(join(process.cwd(), "recover-auth.ps1"), join(dir, "recover-auth.ps1"));
    const wrapper = join(dir, "preflight.ps1");
    writeFileSync(wrapper, `
function node { $global:LASTEXITCODE = 1 }
function gh { }
function Read-Host { throw 'backup must not be requested' }
& "$PSScriptRoot\\recover-auth.ps1"
exit $LASTEXITCODE
`, "utf8");
    const result = spawnSync("pwsh", ["-NoProfile", "-File", wrapper], { cwd: dir, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /install the project dependencies and Playwright Chromium/);
    assert.doesNotMatch(result.stdout + result.stderr, /backup must not be requested/);
    assert.throws(() => readFileSync(envFile), /ENOENT/);
  });

  it("quotes hash values for Node and restores the caller's environment", (t) => {
    const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (pwsh.error) return t.skip("PowerShell not installed");
    const envFile = makeTmpEnv("");
    const dir = dirname(envFile);
    tmpDirs.push(dir);
    rmSync(envFile);
    copyFileSync(join(process.cwd(), "recover-auth.ps1"), join(dir, "recover-auth.ps1"));
    const wrapper = join(dir, "check.ps1");
    const executable = process.execPath.replace(/'/g, "''");
    writeFileSync(wrapper, `
$ErrorActionPreference = 'Stop'
$global:step = 0
function Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  $global:step++
  if ($global:step -eq 1) { return ConvertTo-SecureString $env:CAPTURE_TEST_BASELINE -AsPlainText -Force }
  if ($global:step -eq 2) { return 'YES' }
  return 'YES'
}
function gh { }
function node {
  if ($args -contains '--input-type=module') { $global:LASTEXITCODE = 0; return }
  if ($env:GH_REPO -ne 'Jamula/stfc' -or $env:GH_HOST -ne 'github.com' -or $env:STFC_EMAIL -or $env:STFC_PASSWORD -or $env:STFC_OTP -or $env:STFC_DEBUG_DIR) { throw 'incorrect child environment' }
  $envPath = Join-Path $PSScriptRoot '.env'
  & '${executable}' "--env-file=$envPath" -e "if (process.env.STFC_ACCOUNTS !== process.env.CAPTURE_TEST_BASELINE) process.exit(3)"
  if ($LASTEXITCODE -ne 0) { throw 'invalid env value' }
  if ($env:CAPTURE_TEST_THROW -eq 'yes') { throw 'simulated capture error' }
  $global:LASTEXITCODE = 0
}
$env:GH_REPO = 'original/repo'; $env:GH_HOST = 'original.host'; $env:STFC_EMAIL = 'original-email'
$env:STFC_PASSWORD = 'original-password'; $env:STFC_OTP = 'original-otp'; $env:STFC_DEBUG_DIR = 'original-debug'
$caught = $false
try { & "$PSScriptRoot\\recover-auth.ps1" } catch { if ($env:CAPTURE_TEST_THROW -ne 'yes' -or $_.Exception.Message -ne 'simulated capture error') { throw }; $caught = $true }
if ($env:CAPTURE_TEST_THROW -eq 'yes' -and -not $caught) { throw 'expected simulated error' }
if ($env:GH_REPO -ne 'original/repo' -or $env:GH_HOST -ne 'original.host' -or $env:STFC_EMAIL -ne 'original-email' -or $env:STFC_PASSWORD -ne 'original-password' -or $env:STFC_OTP -ne 'original-otp' -or $env:STFC_DEBUG_DIR -ne 'original-debug') { throw 'environment not restored' }
`, "utf8");
    for (const shouldThrow of [false, true]) {
      if (shouldThrow) rmSync(envFile);
      const result = spawnSync("pwsh", ["-NoProfile", "-File", wrapper], {
        encoding: "utf8",
        env: { ...process.env, CAPTURE_TEST_BASELINE: `[{"name":"main#1","token":"aaa.bbb.ccc"}]`, CAPTURE_TEST_THROW: shouldThrow ? "yes" : "no" },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
  });
});
