# Skill: discord-interactions-bridge

**Owner:** Uhura  
**First used:** PR #151 (squad/146-cf-worker, 2026-06-02)  
**Reuse scope:** Any future Cloudflare Worker that handles Discord slash-command interactions

---

## What this skill does

Codifies the pattern for a stateless Cloudflare Worker that:

1. Verifies the Discord Ed25519 signature
2. Responds within 3 seconds via `{type: 5}` (deferred)
3. Fires a GitHub `repository_dispatch` via `ctx.waitUntil()`
4. Tests the whole flow in vitest/Node.js without spinning up a real Worker

---

## Key patterns

### 1. Signature verification (Discord security gate)

```typescript
import * as ed from "@noble/ed25519";

// Message = timestamp + body (concatenated, no separator)
const isValid = await ed.verifyAsync(
  hexToBytes(signature),                          // sig first
  new TextEncoder().encode(timestamp + body),     // then message
  hexToBytes(env.DISCORD_PUBLIC_KEY),             // then pubkey
);
```

Discord docs: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization

**Gotchas:**
- verifyAsync argument order: `(sig, msg, pubKey)` — NOT `(msg, sig, pubKey)`
- The raw headers are hex strings; always decode before passing to crypto
- Use `@noble/ed25519` v2 (not tweetnacl) — it uses `crypto.subtle` natively, no `nodejs_compat` flag needed

### 2. Replay protection

```typescript
const ts = parseInt(timestamp, 10);
const now = Math.floor(Date.now() / 1000);
if (Math.abs(now - ts) > 300) {          // 5-minute window
  return new Response("Timestamp too skewed", { status: 401 });
}
```

`Math.abs` handles both past-skewed and future-skewed timestamps.

### 3. Deferred response + ctx.waitUntil

```typescript
// WRONG — awaiting the dispatch before returning blocks the 3-second window:
await dispatchToGitHub(env, interaction);
return Response.json({ type: 5 });

// CORRECT — fire-and-forget; ctx keeps the Worker alive after the Response:
ctx.waitUntil(dispatchToGitHub(env, interaction));
return Response.json({ type: 5 });
```

The `ctx.waitUntil(promise)` pattern is mandatory — Discord will close the interaction if no response arrives within 3 seconds. After responding with type 5, the interaction token remains valid for 15 minutes (use it to PATCH the original message when the work completes).

### 4. GitHub repository_dispatch payload shape

```typescript
{
  event_type: "discord-command",
  client_payload: {
    command: interaction.data?.name,
    options: interaction.data?.options ?? [],
    channel_id: interaction.channel_id,
    guild_id: interaction.guild_id,
    member: interaction.member?.user?.id,
    interaction_token: interaction.token,       // needed to post the follow-up
    application_id: interaction.application_id, // needed to post the follow-up
  }
}
```

The handler workflow uses `interaction_token` + `application_id` to PATCH `/webhooks/{app_id}/{token}/messages/@original` with the final response.

### 5. PING → PONG (endpoint verification)

```typescript
if (interaction.type === 1) {
  return Response.json({ type: 1 });
}
```

Discord sends a PING synchronously when you first register the Interactions Endpoint URL. This MUST be a synchronous response — no deferred handling.

---

## Library choice decision

| | `@noble/ed25519` v2 | `tweetnacl` |
|---|---|---|
| Web Crypto API | ✅ native `crypto.subtle` | ❌ Node.js shim |
| `nodejs_compat` flag | ❌ not needed | ✅ required |
| Bundle size | ~3 kB | ~15 kB |
| Maintenance | Active | Stable/slow |

**Choose `@noble/ed25519`** for all new Workers.

---

## Testing pattern (vitest/Node.js, no unstable_dev)

```typescript
import * as ed from "@noble/ed25519";
import { vi, beforeAll } from "vitest";
import worker from "./index.js";

let privateKey: Uint8Array;
let testEnv: Env;

beforeAll(async () => {
  privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  testEnv = { DISCORD_PUBLIC_KEY: toHex(publicKey), ... };
});

// Build a properly signed request:
const timestamp = String(Math.floor(Date.now() / 1000));
const bodyStr = JSON.stringify(body);
const sig = await ed.signAsync(new TextEncoder().encode(timestamp + bodyStr), privateKey);
const req = new Request("http://localhost/", {
  method: "POST",
  headers: { "X-Signature-Ed25519": toHex(sig), "X-Signature-Timestamp": timestamp },
  body: bodyStr,
});

// Mock global fetch for the GH dispatch:
const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
vi.stubGlobal("fetch", fetchMock);

// Mock ExecutionContext:
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

// Call worker and settle ctx.waitUntil:
const res = await worker.fetch(req, testEnv, ctx as unknown as ExecutionContext);
await ctx.waitUntil.mock.calls[0][0]; // settle the dispatch promise

// Assert fetch was called with right payload:
const [url, init] = fetchMock.mock.calls[0];
const payload = JSON.parse(init.body);
```

---

## tsconfig gotcha: @cloudflare/workers-types + @types/node

vitest pulls in `@types/node`. Both packages declare the same Web globals (`URL`, `Headers`, `fetch`, etc.), producing TS2300 duplicate identifier errors.

**Fix:** add `"skipLibCheck": true` to `tsconfig.json`. Standard for Workers projects.

---

## Files created in PR #151

```
worker/
├── src/
│   ├── index.ts          # Worker source
│   └── index.test.ts     # 8 vitest tests
├── package.json          # standalone npm project
├── tsconfig.json         # skipLibCheck + @cloudflare/workers-types
├── vitest.config.ts      # environment: node
├── wrangler.toml         # name, main, GH_REPO var, secret comments
└── README.md             # deploy/secret/test reference
```
