import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "node:http";
import {
  LoginSessionError,
  LoginSessionManager,
  type BrowserLoginSession,
} from "../../pwa-browser/src/login-sessions.js";
import {
  createTokenApiServer,
  validateStfcToken,
} from "../../pwa-token-api/src/http-server.js";
import { getTokenBlobName } from "../../pwa-token-api/src/azure-account-blob.js";

const API_KEY = "<REDACTED>";
const BROWSER_KEY = "<REDACTED>";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function loginSession(overrides: Partial<BrowserLoginSession> = {}): BrowserLoginSession {
  return {
    screenshot: async () => Buffer.from("png"),
    submitOtp: async () => "header.payload.signature",
    close: async () => {},
    ...overrides,
  };
}

describe("PWA browser login sessions", () => {
  it("closes a browser that finishes starting after the caller disconnects", async () => {
    const opening = deferred<BrowserLoginSession>();
    let closes = 0;
    const manager = new LoginSessionManager({
      open: async () => opening.promise,
    });
    const controller = new AbortController();
    const starting = manager.start("main", "owner@example.com", controller.signal);
    controller.abort();
    opening.resolve(loginSession({ close: async () => { closes++; } }));

    await assert.rejects(
      starting,
      (error: unknown) => error instanceof LoginSessionError && error.status === 410,
    );
    assert.equal(closes, 1);
    const next = await manager.start("alt", "owner@example.com");
    await manager.cancel(next.id);
  });

  it("reserves the single session slot while Chromium is starting", async () => {
    const opening = deferred<BrowserLoginSession>();
    let openCalls = 0;
    const manager = new LoginSessionManager({
      open: async () => {
        openCalls++;
        return opening.promise;
      },
    });

    const first = manager.start("main", "owner@example.com");
    await assert.rejects(
      manager.start("alt", "owner@example.com"),
      (error: unknown) => error instanceof LoginSessionError && error.status === 429,
    );
    assert.equal(openCalls, 1);
    opening.resolve(loginSession());
    const started = await first;
    await manager.cancel(started.id);
  });

  it("rejects overlapping OTP submissions and closes after three rejected codes", async () => {
    const submitting = deferred<string>();
    let submits = 0;
    let closes = 0;
    const manager = new LoginSessionManager({
      open: async () => loginSession({
        submitOtp: async () => {
          submits++;
          if (submits === 1) return submitting.promise;
          throw new LoginSessionError("The verification code was not accepted.", 422);
        },
        close: async () => { closes++; },
      }),
    });
    const started = await manager.start("main", "owner@example.com");

    const firstVerify = manager.verify(started.id, "123456");
    await assert.rejects(
      manager.verify(started.id, "123456"),
      (error: unknown) => error instanceof LoginSessionError && error.status === 409,
    );
    submitting.resolve("header.payload.signature");
    assert.deepEqual(await firstVerify, {
      accountName: "main",
      token: "header.payload.signature",
    });
    assert.equal(closes, 1);

    const retryManager = new LoginSessionManager({
      open: async () => loginSession({
        submitOtp: async () => {
          throw new LoginSessionError("The verification code was not accepted.", 422);
        },
        close: async () => { closes++; },
      }),
    });
    const retrySession = await retryManager.start("alt", "owner@example.com");
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(retryManager.verify(retrySession.id, "000000"), /verification code was not accepted/);
    }
    await assert.rejects(
      retryManager.verify(retrySession.id, "000000"),
      (error: unknown) => error instanceof LoginSessionError && error.status === 429,
    );
    await assert.rejects(
      retryManager.verify(retrySession.id, "000000"),
      (error: unknown) => error instanceof LoginSessionError && error.status === 404,
    );
    assert.equal(closes, 2);
  });
});

async function withTokenApi(
  browserResponse: (path: string, body: Record<string, unknown>) => unknown,
  validateToken: (token: string) => Promise<boolean>,
  run: (origin: string, stored: string[]) => Promise<void>,
): Promise<void> {
  const stored: string[] = [];
  const server = createTokenApiServer({
    apiKey: API_KEY,
    browserKey: BROWSER_KEY,
    browserUrl: "https://browser.internal/",
    fetcher: async (input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"),
        `Bearer ${BROWSER_KEY}`);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(browserResponse(new URL(String(input)).pathname, body));
    },
    store: {
      listNames: async () => ["main"],
      replace: async (name, token) => {
        stored.push(token);
        return { accountName: name, added: false, updatedAt: "2026-11-14T00:00:00.000Z" };
      },
    },
    validateToken,
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`, stored);
  } finally {
    await new Promise<void>((resolve, reject) => {
      (server as Server).close((error) => error ? reject(error) : resolve());
    });
  }
}

describe("PWA token API", () => {
  it("uses the same configured Blob name as scheduled token readers", () => {
    assert.equal(getTokenBlobName({ AZURE_TOKEN_BLOB: "production-token-store.json" }), "production-token-store.json");
    assert.equal(getTokenBlobName({}), "accounts.json");
  });

  it("emits the schema and loads the built entry point without service configuration", () => {
    const build = spawnSync(process.execPath, [
      resolve("pwa-token-api/node_modules/typescript/bin/tsc"),
      "-p", "pwa-token-api/tsconfig.json", "--listEmittedFiles",
    ], { encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.match(build.stdout.replaceAll("\\", "/"), /TSFILE: .*\/dist\/shared\/token-account-schema\.mjs/);

    const env = { ...process.env };
    delete env["PWA_TOKEN_API_KEY"];
    delete env["PWA_BROWSER_KEY"];
    delete env["PWA_BROWSER_URL"];
    const load = spawnSync(process.execPath, [
      "--input-type=module", "-e",
      `import assert from "node:assert/strict";
       const { TokenAccountStore } = await import("./pwa-token-api/dist/shared/token-accounts.js");
       const store = new TokenAccountStore({ read: async () => ({
         content: JSON.stringify([{ name: "main", token: "header.payload.signature" }]), etag: "1"
       }) });
       assert.deepEqual(await store.listNames(), ["main"]);
       await assert.rejects(import("./pwa-token-api/dist/pwa-token-api/src/main.js"),
         { message: "Token API configuration is incomplete." });`,
    ], { encoding: "utf8", env });
    assert.equal(load.status, 0, load.stderr || load.stdout);
  });

  it("copies both shared schema files into the token API container build", () => {
    const dockerfile = readFileSync("pwa-token-api/Dockerfile", "utf8").replaceAll("\r\n", "\n");
    assert.match(dockerfile, /^COPY shared\/token-account-schema\.mjs shared\/token-account-schema\.d\.mts \.\/shared\/$/m);
  });

  it("validates tokens against the non-destructive endpoint redemption relies on", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestMethod = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestMethod = init?.method ?? "GET";
      return new Response(null, { status: 200 });
    };

    assert.equal(await validateStfcToken("header.payload.signature", fetcher), true);
    assert.equal(
      requestUrl,
      "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/offers/gifts?available=true",
    );
    assert.equal(requestMethod, "GET");
    assert.equal(requestHeaders?.get("authorization"), "Bearer header.payload.signature");
    assert.equal(requestHeaders?.get("accept"), "application/json");

    const rejected: typeof fetch = async () => new Response(null, { status: 401 });
    assert.equal(await validateStfcToken("header.payload.signature", rejected), false);
  });

  it("requires its service key and returns only a receipt after token validation", async () => {
    const token = "header.payload.signature";
    let validated = "";
    await withTokenApi(
      (path, body) => path === "/sessions/start"
        ? { id: "0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ", screenshot: Buffer.from("png").toString("base64") }
        : { accountName: "main", token: body.otp === "123456" ? token : "not-a-token" },
      async (value) => { validated = value; return true; },
      async (origin, stored) => {
        const denied = await fetch(`${origin}/accounts`);
        assert.equal(denied.status, 401);

        const headers = {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        };
        const start = await fetch(`${origin}/sessions/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({ accountName: "main", email: "owner@example.com" }),
        });
        const session = await start.json() as { id: string; screenshot: string };
        const verify = await fetch(`${origin}/sessions/verify`, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: session.id, otp: "123456" }),
        });
        const receipt = await verify.json() as Record<string, unknown>;
        assert.equal(verify.status, 200);
        assert.deepEqual(receipt, {
          accountName: "main",
          added: false,
          updatedAt: "2026-11-14T00:00:00.000Z",
        });
        assert.equal(JSON.stringify(receipt).includes(token), false);
        assert.equal(validated, token);
        assert.deepEqual(stored, [token]);
      },
    );
  });

  it("does not persist a captured value rejected by STFC validation", async () => {
    await withTokenApi(
      () => ({ accountName: "main", token: "header.payload.signature" }),
      async () => false,
      async (origin, stored) => {
        const response = await fetch(`${origin}/sessions/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: "session-id", otp: "123456" }),
        });
        assert.equal(response.status, 422);
        assert.deepEqual(stored, []);
      },
    );
  });
});
