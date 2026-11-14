import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
