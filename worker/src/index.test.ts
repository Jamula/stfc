import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as ed from "@noble/ed25519";
import worker, { type Env } from "./index.js";

// ── test-key setup ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let privateKey: Uint8Array;
let testEnv: Env;

beforeAll(async () => {
  privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  testEnv = {
    DISCORD_PUBLIC_KEY: toHex(publicKey),
    GH_DISPATCH_TOKEN: "test-gh-token",
    GH_REPO: "Jamula/stfc",
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeMockCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
}

async function buildRequest(
  body: unknown,
  opts: {
    skewSeconds?: number;
    corruptSig?: boolean;
    missingSignature?: boolean;
    missingTimestamp?: boolean;
    method?: string;
  } = {}
): Promise<Request> {
  const timestamp = String(
    Math.floor(Date.now() / 1000) + (opts.skewSeconds ?? 0)
  );
  const bodyStr = JSON.stringify(body);
  const message = new TextEncoder().encode(timestamp + bodyStr);
  const sigBytes = await ed.signAsync(message, privateKey);

  let sigHex = toHex(sigBytes);
  if (opts.corruptSig) {
    // Flip the first nibble to produce an invalid but parseable hex signature
    const first = parseInt(sigHex[0], 16);
    sigHex = ((first + 1) % 16).toString(16) + sigHex.slice(1);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.missingSignature) headers["X-Signature-Ed25519"] = sigHex;
  if (!opts.missingTimestamp) headers["X-Signature-Timestamp"] = timestamp;

  return new Request("http://localhost/", {
    method: opts.method ?? "POST",
    headers,
    body: bodyStr,
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("stfc-discord-bridge worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-POST requests with 405", async () => {
    const req = new Request("http://localhost/", { method: "GET" });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(405);
  });

  it("rejects missing X-Signature-Ed25519 header with 401", async () => {
    const req = await buildRequest({ type: 1 }, { missingSignature: true });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Missing signature headers");
  });

  it("rejects missing X-Signature-Timestamp header with 401", async () => {
    const req = await buildRequest({ type: 1 }, { missingTimestamp: true });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Missing signature headers");
  });

  it("rejects stale timestamp (>5 min skew) with 401", async () => {
    const req = await buildRequest({ type: 1 }, { skewSeconds: -301 });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Timestamp too skewed");
  });

  it("rejects corrupted Ed25519 signature with 401", async () => {
    const req = await buildRequest({ type: 1 }, { corruptSig: true });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("PING (type 1) returns PONG {type:1}", async () => {
    const req = await buildRequest({ type: 1 });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
    // PING must NOT trigger a GH dispatch
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("APPLICATION_COMMAND (type 2) returns deferred {type:5} and dispatches correct GH payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const interaction = {
      type: 2,
      token: "interaction-token-abc",
      application_id: "app-id-123",
      channel_id: "ch-456",
      guild_id: "guild-789",
      member: { user: { id: "user-001" } },
      data: { name: "crew", options: [{ name: "name", value: "Spock" }] },
    };
    const req = await buildRequest(interaction);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    // Must respond within the 3-second window before awaiting dispatch
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 5 });

    // waitUntil must be called with the dispatch promise
    expect(ctx.waitUntil).toHaveBeenCalledOnce();

    // Settle the dispatch promise so the fetch mock fires
    await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/Jamula/stfc/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-gh-token");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("stfc-discord-bridge");

    const payload = JSON.parse(init.body as string);
    expect(payload.event_type).toBe("discord-command");
    expect(payload.client_payload).toMatchObject({
      command: "crew",
      options: [{ name: "name", value: "Spock" }],
      channel_id: "ch-456",
      guild_id: "guild-789",
      member: "user-001",
      interaction_token: "interaction-token-abc",
      application_id: "app-id-123",
    });
  });

  it("unknown interaction type returns 400", async () => {
    const req = await buildRequest({ type: 99 });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Unsupported interaction type");
  });
});
