// T025 [US1] — Discord message ingestion pager.
//
// Per enabled allow-list entry, pages
// `GET /channels/{id}/messages?after=<cursor>&limit=100` up to 5 pages
// (PER_CHANNEL_PAGE_CAP). Advances the cursor in memory; the orchestrator
// flushes the returned cursor map at step 8 of the plan sequence.
//
// Rate-limit + permission posture per discord-bot.contract.md:
//   - 401 (auth) → re-throw DiscordAuthError; orchestrator records
//     `auth_failed` health and skips the Discord half (redeemer still runs).
//   - 429 (rate limit) → bounded retry inside the client (≤ 3× per request);
//     if the client gives up, the channel is marked errored and we move on.
//   - 403 / 404 → channel marked errored, remaining channels continue.
//   - 5xx → wrapped as DiscordTransientError; one retry already happens in
//     the client; here we mark the channel errored.
//
// Calls `client.getMe()` exactly once per run as a token-validity check
// (per discord-bot.contract.md: "Once per workflow run").

import {
  DiscordAuthError,
  DiscordChannelAccessError,
  DiscordChannelNotFoundError,
  DiscordRateLimitError,
  DiscordTransientError,
  SchemaMismatchError,
  type DiscordClient,
} from "./client.ts";
import type {
  BotIdentity,
  ChannelErrorReason,
  DiscordAllowlist,
  DiscordMessage,
  IngestedMessage,
  IngestionCursorMap,
  RunHealth,
} from "./schemas.ts";

/** Verbatim remediation strings — authoritative source is
 *  specs/003-discord-oauth/data-model.md §RunHealth.channelsErrored[]. */
const REMEDIATION: Record<ChannelErrorReason, string> = {
  forbidden_guild:
    "Invite the bot to the server with scope=bot and permissions=66560 (VIEW_CHANNEL + READ_MESSAGE_HISTORY). See docs/DISCORD-BOT-SETUP.md.",
  forbidden_channel:
    "Grant the bot VIEW_CHANNEL and READ_MESSAGE_HISTORY in this channel's permission overrides (or in a parent category).",
  forbidden_other:
    "Discord returned 403 with an unrecognised error code. Re-check the bot's server-level role assignments.",
  not_found:
    "Channel ID does not exist or is no longer visible. Remove it from config/discord-allowlist.json if the channel was deleted.",
  rate_limited:
    "Rate-limited after retry budget exhausted. Reduce channel count or increase scrape interval.",
  transient:
    "Discord upstream transient error; safe to ignore if it does not recur next run.",
  schema_mismatch:
    "Upstream response shape changed. Capture the response, open an issue, and update src/discord/schemas.ts.",
  unknown: "Unclassified error; see logs.",
};

/** Map a caught per-channel error to its taxonomy reason + remediation
 *  string. `DiscordAuthError` is intentionally NOT mapped — it propagates
 *  upward (fail-fast, per Phase 3 / US3). */
function classifyChannelError(err: unknown): {
  reason: ChannelErrorReason;
  discordErrorCode?: number;
} {
  if (err instanceof DiscordChannelAccessError) {
    if (err.discordErrorCode === 50001) {
      return { reason: "forbidden_guild", discordErrorCode: 50001 };
    }
    if (err.discordErrorCode === 50013) {
      return { reason: "forbidden_channel", discordErrorCode: 50013 };
    }
    const out: { reason: ChannelErrorReason; discordErrorCode?: number } = {
      reason: "forbidden_other",
    };
    if (err.discordErrorCode !== undefined) out.discordErrorCode = err.discordErrorCode;
    return out;
  }
  if (err instanceof DiscordChannelNotFoundError) return { reason: "not_found" };
  if (err instanceof DiscordRateLimitError) return { reason: "rate_limited" };
  if (err instanceof DiscordTransientError) return { reason: "transient" };
  if (err instanceof SchemaMismatchError) return { reason: "schema_mismatch" };
  return { reason: "unknown" };
}

export const PER_CHANNEL_PAGE_CAP = 5;
const PAGE_LIMIT = 100;

/** Minimal client surface ingest needs. Real implementation: DiscordClient;
 *  tests inject a structural stub. */
export interface IngestDiscordMessage {
  id: string;
  guild_id?: string;
  channel_id: string;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  author: { id: string; username: string; bot?: boolean };
  type?: number;
}

export interface IngestClient {
  getMe(): Promise<unknown>;
  getChannelMessages(
    channelId: string,
    opts: { after?: string; limit?: number },
  ): Promise<IngestDiscordMessage[]>;
}

export interface IngestOptions {
  /** Sleep injection for tests (e.g. retry-after backoff). */
  sleep?: (ms: number) => Promise<void>;
}

export interface IngestOutput {
  messages: IngestedMessage[];
  discordMessages: DiscordMessage[];
  newCursors: IngestionCursorMap;
  health: Partial<RunHealth>;
  /** Feature 003 (T014/T015): validated bot identity from GET /users/@me.
   *  Consumed by `src/skills/discordMonitor.ts` to emit exactly one
   *  `"discord bot authenticated"` log line on the success path. */
  botIdentity: BotIdentity;
}

export async function ingestDiscord(
  allowlist: DiscordAllowlist,
  cursors: IngestionCursorMap,
  client: IngestClient,
  runId: string,
  now: Date,
  options: IngestOptions = {},
): Promise<IngestOutput> {
  const sleep = options.sleep ?? defaultSleep;

  // Step 0: token validation. Exactly once per run.
  // DiscordAuthError propagates to the caller — the orchestrator decides
  // whether to skip the Discord half and continue.
  // The return value is structurally trusted: when `client` is a real
  // `DiscordClient`, `getMe()` is already zod-validated against
  // `BotIdentitySchema`; test stubs are responsible for supplying a
  // BotIdentity-shaped value (or accept an unsafe cast in test scope).
  const botIdentity = (await client.getMe()) as BotIdentity;

  const enabled = allowlist.entries.filter((e) => e.enabled);

  const messages: IngestedMessage[] = [];
  const discordMessages: DiscordMessage[] = [];
  const newCursors: IngestionCursorMap = { ...cursors };
  const channelsErrored: RunHealth["channelsErrored"] = [];
  let channelsRead = 0;

  for (const entry of enabled) {
    try {
      const { msgs, lastMessageId, lastTimestamp } = await pageChannel(
        client,
        entry.channelId,
        cursors[entry.channelId]?.lastMessageId,
        sleep,
      );

      for (const m of msgs) {
        const enriched = { ...m, guild_id: entry.serverId };
        discordMessages.push(enriched as DiscordMessage);
        messages.push(toIngested(enriched, entry.serverId, entry.channelLabel));
      }

      if (lastMessageId !== undefined) {
        newCursors[entry.channelId] = {
          channelLabel: entry.channelLabel,
          lastMessageId,
          lastTimestamp: lastTimestamp ? normaliseUtc(lastTimestamp) : now.toISOString(),
          lastRunId: runId,
          lastRunAt: now.toISOString(),
        };
      }
      channelsRead++;
    } catch (err) {
      if (err instanceof DiscordAuthError) throw err;
      const { reason, discordErrorCode } = classifyChannelError(err);
      const channelEntry: RunHealth["channelsErrored"][number] = {
        channelId: entry.channelId,
        errorClass: (err as Error).name ?? "Error",
        reason,
        remediation: REMEDIATION[reason],
      };
      if (discordErrorCode !== undefined) {
        channelEntry.discordErrorCode = discordErrorCode;
      }
      channelsErrored.push(channelEntry);
    }
  }
  return {
    messages,
    discordMessages,
    newCursors,
    botIdentity,
    health: {
      channelsConfigured: allowlist.entries.length,
      channelsRead,
      channelsErrored,
      messagesScanned: messages.length,
    },
  };
}

interface PageResult {
  msgs: Awaited<ReturnType<IngestClient["getChannelMessages"]>>;
  lastMessageId: string | undefined;
  lastTimestamp: string | undefined;
}

const RATE_LIMIT_RETRY_CAP = 3;

async function pageChannel(
  client: IngestClient,
  channelId: string,
  startAfter: string | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<PageResult> {
  const all: PageResult["msgs"] = [];
  let after = startAfter;
  let lastMessageId: string | undefined = startAfter;
  let lastTimestamp: string | undefined;

  for (let page = 0; page < PER_CHANNEL_PAGE_CAP; page++) {
    const opts: { after?: string; limit?: number } = { limit: PAGE_LIMIT };
    if (after !== undefined) opts.after = after;

    const msgs = await fetchPageWithRateLimitRetry(
      client,
      channelId,
      opts,
      sleep,
    );
    if (msgs.length === 0) break;

    // Discord returns ascending order (oldest first) when `after` is set; we
    // advance the cursor to the largest snowflake we saw on this page so the
    // next page picks up where we left off. We compare snowflakes (64-bit
    // decimal strings) lex-on-length-then-string, which matches numeric order.
    let maxId = lastMessageId;
    let maxTs = lastTimestamp;
    let madeProgress = false;
    for (const m of msgs) {
      if (maxId === undefined || compareSnowflakes(m.id, maxId) > 0) {
        maxId = m.id;
        maxTs = m.timestamp;
        madeProgress = true;
      }
    }
    if (!madeProgress) break;

    // Only push messages whose ID is strictly greater than the previous cursor,
    // so a server returning a re-played page doesn't double-count.
    const cursorBefore = lastMessageId;
    for (const m of msgs) {
      if (cursorBefore === undefined || compareSnowflakes(m.id, cursorBefore) > 0) {
        all.push(m);
      }
    }

    lastMessageId = maxId;
    lastTimestamp = maxTs;
    after = maxId;
  }

  return { msgs: all, lastMessageId, lastTimestamp };
}

/** Retry on 429 up to 3× total attempts, honoring `retryAfterMs` on the error. */
async function fetchPageWithRateLimitRetry(
  client: IngestClient,
  channelId: string,
  opts: { after?: string; limit?: number },
  sleep: (ms: number) => Promise<void>,
): Promise<Awaited<ReturnType<IngestClient["getChannelMessages"]>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.getChannelMessages(channelId, opts);
    } catch (err) {
      const isRateLimit =
        (err as Error).name === "DiscordRateLimitError";
      if (isRateLimit && attempt < RATE_LIMIT_RETRY_CAP) {
        const retryAfterMs =
          (err as { retryAfterMs?: number }).retryAfterMs ?? 1000;
        await sleep(retryAfterMs);
        continue;
      }
      throw err;
    }
  }
}

function compareSnowflakes(a: string, b: string): number {
  // Discord snowflakes are 64-bit ints encoded as decimal strings.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function toIngested(
  m: IngestDiscordMessage,
  guildId: string,
  channelLabel: string,
): IngestedMessage {
  return {
    channelId: m.channel_id,
    channelLabel,
    messageId: m.id,
    timestamp: normaliseUtc(m.timestamp),
    editedTimestamp:
      m.edited_timestamp === undefined || m.edited_timestamp === null
        ? null
        : normaliseUtc(m.edited_timestamp),
    authorDisplay: m.author.username,
    contentRaw: m.content,
    contentNormalized: m.content.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim(),
    jumpLink: `https://discord.com/channels/${guildId}/${m.channel_id}/${m.id}`,
  };
}

function normaliseUtc(ts: string): string {
  // Discord returns ISO timestamps with `+00:00` offsets and microsecond
  // precision; the candidate schema requires the `Z` suffix. Best-effort
  // normalize but don't fail — schema validation happens at the state-write
  // boundary, not here.
  return ts.replace(/\+00:00$/, "Z");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
