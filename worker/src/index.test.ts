import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as ed from "@noble/ed25519";
import worker, { type Env } from "./index.js";

// ── test-key setup ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let privateKey: Uint8Array;
let testEnv: Env;
let gameStateEnv: Env;

beforeAll(async () => {
  privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  testEnv = {
    DISCORD_PUBLIC_KEY: toHex(publicKey),
    GH_DISPATCH_TOKEN: "test-gh-token",
    GH_REPO: "Jamula/stfc",
  };
  gameStateEnv = {
    ...testEnv,
    ALLOWED_GUILD_IDS: "guild-789",
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
    signatureOverride?: string;
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
  if (opts.signatureOverride !== undefined) {
    sigHex = opts.signatureOverride;
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

  it("rejects odd-length signature hex with 401", async () => {
    const req = await buildRequest({ type: 1 }, { signatureOverride: "abc" });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("rejects non-hex signature values with 401", async () => {
    const req = await buildRequest(
      { type: 1 },
      { signatureOverride: "hello world there!!!!!".padEnd(128, "!") }
    );
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("rejects short signature values with 401", async () => {
    const req = await buildRequest({ type: 1 }, { signatureOverride: "deadbeef" });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("rejects long signature values with 401", async () => {
    const req = await buildRequest(
      { type: 1 },
      { signatureOverride: "ab".repeat(100) }
    );
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("returns 500 when DISCORD_PUBLIC_KEY is malformed", async () => {
    const malformedEnv: Env = {
      ...testEnv,
      DISCORD_PUBLIC_KEY: "abcd",
    };
    const req = await buildRequest({ type: 1 });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, malformedEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Server misconfiguration");
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

  it("rejects trigger-redeem outside the trusted guild allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = await buildRequest({
      type: 2,
      token: "interaction-token-abc",
      application_id: "app-id-123",
      guild_id: "attacker-guild",
      data: { name: "trigger-redeem", options: [] },
    });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: 4,
      data: { content: "This command isn't enabled in this server.", flags: 64 },
    });
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still returns deferred response when GH dispatch responds with 5xx and logs warning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const req = await buildRequest({
      type: 2,
      token: "interaction-token-xyz",
      application_id: "app-id-123",
      data: { name: "crew", options: [] },
    });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 5 });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();

    await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(warnSpy).toHaveBeenCalledWith("gh dispatch failed: 503");
    warnSpy.mockRestore();
  });

  it("unknown interaction type returns 400", async () => {
    const req = await buildRequest({ type: 99 });
    const ctx = makeMockCtx();
    const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Unsupported interaction type");
  });
});

// ── game-state command tests ───────────────────────────────────────────────

/** Builds a well-formed /game-state interaction body. All fields are override-able. */
function makeGameStateBody(opts: {
  guildId?: string;
  attachmentUrl?: string;
  note?: string;
  missingFile?: boolean;
} = {}): object {
  const attachmentId = "123456789012345678";
  const options: object[] = [];

  if (!opts.missingFile) {
    options.push({ name: "file", value: attachmentId });
  }
  if (opts.note !== undefined) {
    options.push({ name: "note", value: opts.note });
  }

  const resolved: object = opts.missingFile
    ? {}
    : {
        attachments: {
          [attachmentId]: {
            url: opts.attachmentUrl ?? "https://cdn.discordapp.com/attachments/ch-456/123456789012345678/game.png",
            proxy_url: "https://media.discordapp.net/attachments/ch-456/123456789012345678/game.png",
            filename: "game.png",
            content_type: "image/png",
            size: 12345,
          },
        },
      };

  return {
    type: 2,
    token: "gs-token",
    application_id: "app-id-123",
    channel_id: "ch-456",
    guild_id: opts.guildId ?? "guild-789",
    member: { user: { id: "user-001", username: "cyrus" } },
    data: { name: "game-state", options, resolved },
  };
}

describe("/game-state command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allowed guild + valid CDN attachment → type:5 + dispatch with full payload shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({ note: "Fleet battle" });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 5 });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();

    await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/Jamula/stfc/dispatches");

    const payload = JSON.parse(init.body as string);
    expect(payload.event_type).toBe("discord-command");
    expect(payload.client_payload).toMatchObject({
      command: "game-state",
      channel_id: "ch-456",
      guild_id: "guild-789",
      member: "user-001",
      member_handle: "cyrus",
      interaction_token: "gs-token",
      application_id: "app-id-123",
      attachment: {
        url: "https://cdn.discordapp.com/attachments/ch-456/123456789012345678/game.png",
        filename: "game.png",
        content_type: "image/png",
        size: 12345,
      },
      note: "Fleet battle",
    });
  });

  it("non-allowed guild → ephemeral error (type:4, flags:64), no dispatch fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({ guildId: "attacker-guild-999" });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const json = await res.json() as { type: number; data: { flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64); // EPHEMERAL
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no ALLOWED_GUILD_IDS env → ephemeral error (fail-closed), no dispatch fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const envNoAllowlist: Env = { ...testEnv }; // ALLOWED_GUILD_IDS omitted
    const body = makeGameStateBody();
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, envNoAllowlist, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const json = await res.json() as { type: number; data: { flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing file option → ephemeral error, no dispatch fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({ missingFile: true });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const json = await res.json() as { type: number; data: { flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-CDN attachment URL → ephemeral error, no dispatch fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({ attachmentUrl: "https://evil.example.com/payload.exe" });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const json = await res.json() as { type: number; data: { flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("note > 200 chars → note truncated to 200 in dispatch payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({ note: "A".repeat(250) });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const payload = JSON.parse(
      ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(payload.client_payload.note).toBe("A".repeat(200));
  });

  it("note with \\n and NULL chars → control characters stripped in dispatch payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    // \n (0x0A), \x00 (NUL), \t (0x09) are all stripped; printable chars survive
    const body = makeGameStateBody({ note: "line1\nline2\x00tab\there" });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    await (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const payload = JSON.parse(
      ((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(payload.client_payload.note).toBe("line1line2tabhere");
  });

  it("media.discordapp.net CDN URL is also trusted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = makeGameStateBody({
      attachmentUrl: "https://media.discordapp.net/attachments/ch-456/123456789012345678/game.png",
    });
    const req = await buildRequest(body);
    const ctx = makeMockCtx();

    const res = await worker.fetch(req, gameStateEnv, ctx as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 5 });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});
