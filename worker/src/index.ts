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
 * Ed25519 library choice: @noble/ed25519 v3
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
  /** Comma-separated guild snowflakes allowed to use /game-state. Set via `wrangler secret put ALLOWED_GUILD_IDS`. Fail-closed: unset = deny all. */
  ALLOWED_GUILD_IDS?: string;
}

interface DiscordOption {
  name: string;
  value?: unknown;
}

interface DiscordAttachment {
  url: string;
  proxy_url?: string;
  filename: string;
  content_type?: string;
  size: number;
}

interface DiscordInteraction {
  type: number;
  token: string;
  application_id: string;
  channel_id?: string;
  guild_id?: string;
  member?: { user?: { id?: string; username?: string } };
  data?: {
    name: string;
    options?: DiscordOption[];
    resolved?: {
      attachments?: Record<string, DiscordAttachment>;
    };
  };
}

/**
 * Trusted Discord CDN prefixes for attachment URLs.
 * Defense in depth: attacker-controlled resolved.attachments cannot redirect
 * to arbitrary URLs even if Discord's payload were tampered with in transit.
 * Ref: https://discord.com/developers/docs/reference#cdn-formatting
 */
const TRUSTED_CDN_PREFIXES = [
  "https://cdn.discordapp.com/",
  "https://media.discordapp.net/",
] as const;

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
      const commandName = interaction.data?.name;

      if (commandName === "trigger-redeem" &&
          !isGuildAllowed(interaction.guild_id, env.ALLOWED_GUILD_IDS)) {
        return ephemeralError("This command isn't enabled in this server.");
      }

      if (commandName === "game-state") {
        // Guild allowlist check (fail-closed).
        // Prevents /game-state from working in any server the bot happens to join.
        // ALLOWED_GUILD_IDS must be set via `wrangler secret put ALLOWED_GUILD_IDS`.
        if (!isGuildAllowed(interaction.guild_id, env.ALLOWED_GUILD_IDS)) {
          return ephemeralError("This command isn't enabled in this server.");
        }

        // Attachment extraction: Discord passes the file option value as a snowflake
        // referencing interaction.data.resolved.attachments[id].
        const fileOption = interaction.data?.options?.find(o => o.name === "file");
        if (!fileOption || typeof fileOption.value !== "string") {
          return ephemeralError("A file attachment is required for /game-state.");
        }
        const attachmentId = fileOption.value;
        const attachmentData = interaction.data?.resolved?.attachments?.[attachmentId];
        if (!attachmentData) {
          return ephemeralError("Could not resolve the file attachment.");
        }

        // CDN trust check: reject any URL not hosted on Discord CDN.
        // Defends against attacker-controlled resolved.attachments pointing to
        // arbitrary hosts and turning the runner into an SSRF relay.
        if (!TRUSTED_CDN_PREFIXES.some(prefix => attachmentData.url.startsWith(prefix))) {
          return ephemeralError("Attachment must be hosted on Discord CDN.");
        }

        // Note extraction and sanitization.
        // The note transits via repository_dispatch into GHA ${{ }} interpolation.
        // Strip control characters (NUL, newline, tab, etc.) to prevent injection
        // and payload bloat. Cap at 200 chars — this is a human caption, not a log.
        const noteOption = interaction.data?.options?.find(o => o.name === "note");
        const rawNote = typeof noteOption?.value === "string" ? noteOption.value : "";
        const sanitizedNote = sanitizeNote(rawNote);

        ctx.waitUntil(
          dispatchGameStateToGitHub(env, interaction, attachmentData, sanitizedNote).catch(
            (error: unknown) => {
              const errorName = error instanceof Error ? error.name : "UnknownError";
              console.warn(`gh dispatch threw: ${errorName}`);
            },
          ),
        );
        return Response.json({ type: 5 });
      }

      // Generic command dispatch (redeem-status, trigger-redeem, etc.)
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

/** Respond with an ephemeral error message (flags: 64 = EPHEMERAL — only visible to the invoker). */
function ephemeralError(message: string): Response {
  return Response.json({ type: 4, data: { content: message, flags: 64 } });
}

/**
 * Returns true iff guild_id is listed in the comma-separated ALLOWED_GUILD_IDS env var.
 * Fails closed: if ALLOWED_GUILD_IDS is unset or empty, every guild is denied.
 * Ref: guild allowlist design — .squad/decisions/inbox/kirk-game-state-arch.md:107-108
 */
function isGuildAllowed(guildId: string | undefined, allowedGuildIds: string | undefined): boolean {
  if (!guildId) return false;
  const allowlist = (allowedGuildIds ?? "")
    .split(",")
    .map(g => g.trim())
    .filter(Boolean);
  return allowlist.length > 0 && allowlist.includes(guildId);
}

/**
 * Sanitizes a user-supplied note for safe transit through repository_dispatch
 * into GitHub Actions ${{ github.event.client_payload.note }} interpolation.
 *
 * - Caps at 200 chars (human caption; prevents payload bloat + long commit messages)
 * - Strips U+0000–U+001F and U+007F (NUL, newlines, tabs, other control chars)
 *
 * Ref: Garak hostile fact-check #165, "note sanitization in transit" finding
 */
function sanitizeNote(note: string): string {
  // eslint-disable-next-line no-control-regex
  return note.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, "");
}

async function dispatchGameStateToGitHub(
  env: Env,
  interaction: DiscordInteraction,
  attachment: DiscordAttachment,
  note: string,
): Promise<void> {
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
        command: "game-state",
        options: interaction.data?.options ?? [],
        channel_id: interaction.channel_id,
        guild_id: interaction.guild_id,
        member: interaction.member?.user?.id,
        member_handle: interaction.member?.user?.username,
        interaction_token: interaction.token,
        application_id: interaction.application_id,
        attachment: {
          url: attachment.url,
          filename: attachment.filename,
          content_type: attachment.content_type,
          size: attachment.size,
        },
        note,
      },
    }),
  });
  if (!response.ok) {
    console.warn(`gh dispatch failed: ${response.status}`);
  }
}

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
