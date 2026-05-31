#!/usr/bin/env node
// Fetch high-signal messages from the STFC Officer Tool Discord #data-collection
// channel and write per-topic snapshot files under
// docs/stfc-knowledge/discord-channels/officer-tool-data-collection/.
//
// PREREQUISITES:
//   - DISCORD_BOT_TOKEN must be set in the environment (GitHub Actions secret
//     or a local .env file loaded before calling this script).
//   - The bot must be a member of guild 639255937869152267 (STFC Officer Tool
//     Discord). Verify with:
//         curl -sH "Authorization: Bot $DISCORD_BOT_TOKEN" \
//           "https://discord.com/api/v10/channels/1115978499400933473" | jq .id
//     Expected: "1115978499400933473". A 403 means the bot lacks access.
//
// USAGE (from repo root):
//     node scripts/fetch-discord-channel.mjs
//
// What it does:
//   1. Fetches pinned messages (GET /channels/{id}/pins) — highest-signal first.
//   2. Paginates channel history backwards (GET /channels/{id}/messages?before=)
//      stopping when it reaches messages older than HISTORY_LOOKBACK_DAYS.
//   3. Filters to knowledge-bearing messages: posts with embeds, attachments,
//      posts from known contributor handles, or high-reaction-count posts.
//   4. Writes a snapshot README and one markdown file per topic cluster.
//
// CONSTRAINTS (Discord ToS + project constitution):
//   - READ-ONLY: no messages are sent, deleted, or modified.
//   - Bot token is NEVER logged, printed, or embedded in any output file.
//   - No images are downloaded; attached images are referenced by deep-link only.
//   - Chatter, off-topic messages, and personal DMs are excluded.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Configuration ────────────────────────────────────────────────────────────

const GUILD_ID = "639255937869152267";
const CHANNEL_ID = "1115978499400933473";
const CHANNEL_NAME = "data-collection";
const GUILD_NAME = "STFC Officer Tool";
const CHANNEL_URL = `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`;
const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)";
const OUT_DIR = `docs/stfc-knowledge/discord-channels/officer-tool-data-collection`;

/** How far back to paginate channel history. Pinned messages ignore this limit. */
const HISTORY_LOOKBACK_DAYS = 180;

/** Known high-value contributor usernames (stable handles, not display names). */
const KNOWN_CONTRIBUTORS = ["JulesVern", "Quasel", "BlueMandalorian"];

/** Minimum reaction count for a message to be included regardless of author. */
const MIN_REACTION_COUNT = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getToken() {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok || tok.length === 0) {
    console.error(
      "ERROR: DISCORD_BOT_TOKEN is not set. Export it before running this script.\n" +
      "  export DISCORD_BOT_TOKEN='<your-bot-token>'\n" +
      "  node scripts/fetch-discord-channel.mjs",
    );
    process.exit(1);
  }
  return tok;
}

async function discordGet(token, path) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": USER_AGENT,
    },
  });
  if (res.status === 401) {
    console.error("ERROR: 401 Unauthorized — bot token is invalid or expired.");
    process.exit(1);
  }
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const code = body?.code ?? "unknown";
    console.error(
      `ERROR: 403 Forbidden on ${path} (Discord error code ${code}).\n` +
      "The bot is not a member of the guild, or lacks VIEW_CHANNEL / READ_MESSAGE_HISTORY.\n" +
      "Ask a guild admin to invite the bot with permissions bitmask 66560:\n" +
      `  https://discord.com/api/oauth2/authorize?client_id={CLIENT_ID}&scope=bot&permissions=66560`,
    );
    process.exit(1);
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 1);
    console.warn(`Rate limited — waiting ${retryAfter}s…`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return discordGet(token, path); // retry once
  }
  if (!res.ok) {
    console.error(`ERROR: HTTP ${res.status} on ${path}`);
    process.exit(1);
  }
  return res.json();
}

/** Message permalink for a specific message. */
function permalink(messageId) {
  return `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${messageId}`;
}

/** Return the total reaction count across all emoji on a message. */
function totalReactions(msg) {
  return (msg.reactions ?? []).reduce((sum, r) => sum + (r.count ?? 0), 0);
}

/** Return true if the message is knowledge-bearing (not chatter). */
function isKnowledge(msg) {
  if (KNOWN_CONTRIBUTORS.includes(msg.author?.username)) return true;
  if ((msg.embeds ?? []).length > 0) return true;
  if ((msg.attachments ?? []).length > 0) return true;
  if (totalReactions(msg) >= MIN_REACTION_COUNT) return true;
  return false;
}

// ── Lineage block generator ──────────────────────────────────────────────────

function lineageBlock(sourceUrl, authors, capturedOn) {
  const authorStr =
    authors.length > 0 ? authors.join("; ") : "STFC Officer Tool Discord community";
  return [
    "## Lineage",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| **Source URL** | <${sourceUrl}> |`,
    `| **Source name** | ${GUILD_NAME} Discord — \`#${CHANNEL_NAME}\` channel |`,
    `| **Author(s) / contributors** | ${authorStr} |`,
    `| **Captured on** | ${capturedOn} |`,
    "| **License / attribution requirements** | Mirrored from the STFC Officer Tool community Discord. Original authors retain credit. Do not modify mirrored content; refresh via re-ingestion. |",
    `| **Refresh strategy** | \`node scripts/fetch-discord-channel.mjs\` from the repo root (requires \`DISCORD_BOT_TOKEN\` in env). Re-fetches pins + messages newer than the captured-on date. |`,
    "",
  ].join("\n");
}

// ── Markdown renderer for a message ─────────────────────────────────────────

function renderMessage(msg) {
  const lines = [];
  const author = msg.author?.username ?? "unknown";
  const ts = msg.timestamp ? msg.timestamp.slice(0, 10) : "unknown date";
  const link = permalink(msg.id);
  lines.push(`### Message by \`${author}\` on ${ts}`);
  lines.push("");
  lines.push(`> Source: <${link}>`);
  lines.push("");
  if (msg.content) {
    lines.push(msg.content);
    lines.push("");
  }
  for (const attachment of msg.attachments ?? []) {
    lines.push(
      `📎 **Attachment:** [${attachment.filename ?? "file"}](<${attachment.url}>) *(linked in-place; not downloaded)*`,
    );
    lines.push("");
  }
  for (const embed of msg.embeds ?? []) {
    if (embed.title) lines.push(`**Embed: ${embed.title}**`);
    if (embed.description) lines.push(embed.description);
    if (embed.url) lines.push(`Embed URL: <${embed.url}>`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const token = getToken();
  const capturedOn = new Date().toISOString().slice(0, 10);
  const cutoff = Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  console.log(`Fetching pinned messages from #${CHANNEL_NAME}…`);
  const pins = await discordGet(token, `/channels/${CHANNEL_ID}/pins`);
  console.log(`  ${pins.length} pinned message(s)`);

  console.log(`Paginating channel history (last ${HISTORY_LOOKBACK_DAYS} days)…`);
  const history = [];
  let before = undefined;
  for (;;) {
    const qs = `limit=100${before ? `&before=${before}` : ""}`;
    const batch = await discordGet(token, `/channels/${CHANNEL_ID}/messages?${qs}`);
    if (!batch.length) break;
    const filtered = batch.filter((m) => {
      const ts = new Date(m.timestamp).getTime();
      return ts >= cutoff && isKnowledge(m);
    });
    history.push(...filtered);
    const oldest = new Date(batch[batch.length - 1].timestamp).getTime();
    if (oldest < cutoff) break;
    before = batch[batch.length - 1].id;
    await new Promise((r) => setTimeout(r, 500)); // polite rate-limiting
  }
  console.log(`  ${history.length} knowledge message(s) in history window`);

  await mkdir(OUT_DIR, { recursive: true });

  // ── Write pinned-messages snapshot ─────────────────────────────────────────
  if (pins.length > 0) {
    const authors = [...new Set(pins.map((m) => m.author?.username).filter(Boolean))];
    const sourceUrl =
      pins.length === 1
        ? permalink(pins[0].id)
        : CHANNEL_URL;
    const content = [
      "# #data-collection — Pinned Messages",
      "",
      lineageBlock(sourceUrl, authors, capturedOn),
      "> Read-only mirror — do not modify this file by hand. Re-run",
      "> `node scripts/fetch-discord-channel.mjs` to refresh.",
      "",
      "## Pinned Messages",
      "",
      ...pins.map(renderMessage),
    ].join("\n");
    const outPath = join(OUT_DIR, "01-pinned-messages.md");
    await writeFile(outPath, content, "utf8");
    console.log(`  Wrote ${outPath}`);
  } else {
    console.log("  No pinned messages found.");
  }

  // ── Write recent-history snapshot ──────────────────────────────────────────
  if (history.length > 0) {
    const authors = [...new Set(history.map((m) => m.author?.username).filter(Boolean))];
    const content = [
      "# #data-collection — Recent High-Signal Messages",
      "",
      lineageBlock(CHANNEL_URL, authors, capturedOn),
      "> Read-only mirror — do not modify this file by hand. Re-run",
      "> `node scripts/fetch-discord-channel.mjs` to refresh.",
      `> Window: last ${HISTORY_LOOKBACK_DAYS} days; includes posts with attachments,`,
      "> embeds, known-contributor posts, or ≥" + MIN_REACTION_COUNT + " reactions.",
      "",
      "## Messages",
      "",
      ...history.map(renderMessage),
    ].join("\n");
    const outPath = join(OUT_DIR, "02-recent-knowledge.md");
    await writeFile(outPath, content, "utf8");
    console.log(`  Wrote ${outPath}`);
  } else {
    console.log("  No knowledge messages found in history window.");
  }

  // ── Update channel index README ─────────────────────────────────────────────
  const readmePath = join(OUT_DIR, "README.md");
  const fileCount = (pins.length > 0 ? 1 : 0) + (history.length > 0 ? 1 : 0);
  console.log(`\nDone. ${fileCount} snapshot file(s) written to ${OUT_DIR}/`);
  console.log(`Update ${readmePath} to reflect the new files.`);
}

main().catch((err) => {
  // Never let the error surface the token string
  const msg = String(err?.message ?? err);
  const safeMsg = msg.replace(/[\w-]{20,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED]");
  console.error("FATAL:", safeMsg);
  process.exit(1);
});
