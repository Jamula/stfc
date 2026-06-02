/**
 * Cloudflare Worker: Discord interactions bridge for stfc-gift-redeemer.
 *
 * Receives Discord slash-command interactions, verifies the Ed25519 signature,
 * immediately responds with a deferred message (type 5) within Discord's 3-second
 * window, then fires a GitHub `repository_dispatch` event so the actual work
 * runs in GitHub Actions. Contains NO business logic — it is a thin bridge only.
 *
 * Discord Ed25519 verification docs:
 *   https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 *
 * Ed25519 library choice: @noble/ed25519 v2
 *   - Uses `crypto.subtle` (Web Crypto API) natively — available in the Workers
 *     runtime without any compatibility flags.
 *   - Smaller bundle than tweetnacl (~3 kB vs ~15 kB).
 *   - No Node.js shims required; tweetnacl would need `nodejs_compat` flag.
 *   - Actively maintained for browser/edge environments.
 */

import * as ed from "@noble/ed25519";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  GH_DISPATCH_TOKEN: string;
  GH_REPO: string; // "Jamula/stfc"
}

interface DiscordInteraction {
  type: number;
  token: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  member?: { user?: { id?: string } };
  data?: {
    name: string;
    options?: unknown[];
  };
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
let checkedPublicKey: string | undefined;
let checkedPublicKeyValid = false;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = req.headers.get("X-Signature-Ed25519");
    const timestamp = req.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp) {
      return new Response("Missing signature headers", { status: 401 });
    }

    // Replay protection: reject timestamps older than 5 minutes.
    // Discord's verification guide recommends this guard against replayed requests.
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) {
      return new Response("Timestamp too skewed", { status: 401 });
    }

    const body = await req.text();
    if (!isStrictHex(signature, 64)) {
      return new Response("Invalid signature", { status: 401 });
    }

    if (!isConfiguredPublicKeyValid(env.DISCORD_PUBLIC_KEY)) {
      return new Response("Server misconfiguration", { status: 500 });
    }

    let isValid = false;
    try {
      const sigBytes = hexToBytes(signature);
      const pubKeyBytes = hexToBytes(env.DISCORD_PUBLIC_KEY);
      const msgBytes = new TextEncoder().encode(timestamp + body);
      isValid = await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
    } catch {
      isValid = false;
    }
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const interaction = JSON.parse(body) as DiscordInteraction;

    // PING (type 1) → PONG (type 1).
    // Discord sends this when the operator first registers the Interactions Endpoint
    // URL in the Developer Portal. Must respond synchronously.
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // APPLICATION_COMMAND (type 2) → defer + dispatch.
    // ctx.waitUntil keeps the Worker alive after we return the Response, so the
    // GitHub dispatch fetch completes even though Discord got its answer in <3s.
    if (interaction.type === 2) {
      ctx.waitUntil(
        dispatchToGitHub(env, interaction).catch((error: unknown) => {
          const errorName = error instanceof Error ? error.name : "UnknownError";
          console.warn(`gh dispatch threw: ${errorName}`);
        }),
      );
      // type 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE — Discord shows "Bot is thinking..."
      return Response.json({ type: 5 });
    }

    return new Response("Unsupported interaction type", { status: 400 });
  },
};

async function dispatchToGitHub(env: Env, interaction: DiscordInteraction): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "stfc-discord-bridge",
    },
    body: JSON.stringify({
      event_type: "discord-command",
      client_payload: {
        command: interaction.data?.name,
        options: interaction.data?.options ?? [],
        channel_id: interaction.channel_id,
        guild_id: interaction.guild_id,
        member: interaction.member?.user?.id,
        interaction_token: interaction.token,
        application_id: interaction.application_id,
      },
    }),
  });
  if (!response.ok) {
    console.warn(`gh dispatch failed: ${response.status}`);
  }
}

function isConfiguredPublicKeyValid(publicKey: string): boolean {
  if (checkedPublicKey !== publicKey) {
    checkedPublicKey = publicKey;
    checkedPublicKeyValid = isStrictHex(publicKey, 32);
    if (!checkedPublicKeyValid) {
      console.error("DISCORD_PUBLIC_KEY misconfigured");
    }
  }
  return checkedPublicKeyValid;
}

function isStrictHex(value: string, expectedBytes: number): boolean {
  return value.length === expectedBytes * 2 && HEX_PATTERN.test(value);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new RangeError("hex string must have even length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
