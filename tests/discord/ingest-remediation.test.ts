// T020 [US2] — ingestDiscord per-channel remediation mapping (contract T4).
//
// Asserts per data-model.md §RunHealth.channelsErrored[] + remediation table:
//   - DiscordChannelAccessError(50001) → reason "forbidden_guild" + verbatim remediation
//   - DiscordChannelAccessError(50013) → reason "forbidden_channel" + verbatim remediation
//   - DiscordChannelNotFoundError      → reason "not_found"
//   - DiscordTransientError (5xx)      → reason "transient"
//   - multi-channel run continues past a failing channel
//   - successful channels still advance their cursor

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestDiscord } from "../../src/discord/ingest.ts";
import {
  DiscordChannelAccessError,
  DiscordChannelNotFoundError,
  DiscordTransientError,
} from "../../src/discord/client.ts";
import type {
  DiscordAllowlist,
  IngestionCursorMap,
} from "../../src/discord/schemas.ts";

// Verbatim remediation strings — must match data-model.md table.
const REMEDIATION = {
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
} as const;

interface StubMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  author: { id: string; username: string; bot: boolean };
  type: number;
}

function makeMessage(channelId: string, id: string, ts: string): StubMessage {
  return {
    id,
    channel_id: channelId,
    content: `msg ${id}`,
    timestamp: ts,
    edited_timestamp: null,
    author: { id: "999999999999999999", username: "user", bot: false },
    type: 0,
  };
}

function makeAllowlist(channels: Array<{ id: string; label: string }>): DiscordAllowlist {
  return {
    version: 1,
    entries: channels.map((c) => ({
      serverId: "509679626763632640",
      serverLabel: "Test Server",
      channelId: c.id,
      channelLabel: c.label,
      addedAt: "2026-05-16T00:00:00Z",
      addedBy: "octocat",
      enabled: true,
    })),
  };
}

const NOW = new Date("2026-05-16T00:00:00Z");
const A = "111111111111111111";
const B = "111111111111111112";

describe("ingestDiscord remediation mapping (T020 / contract T4)", () => {
  it("403 + 50001 → forbidden_guild with verbatim remediation; other channels continue", async () => {
    const client = {
      getMe: async () => ({ id: "100000000000000001", username: "bot", bot: true }),
      getChannelMessages: async (id: string) => {
        if (id === A) {
          throw new DiscordChannelAccessError("403", { discordErrorCode: 50001 });
        }
        return [makeMessage(B, "2000", "2026-05-16T00:00:01Z")];
      },
    };
    const { messages, health, newCursors } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }, { id: B, label: "b" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );

    assert.equal(messages.length, 1, "channel B still ingested");
    const entry = health.channelsErrored!.find((e) => e.channelId === A);
    assert.ok(entry, "channel A recorded as errored");
    assert.equal(entry!.reason, "forbidden_guild");
    assert.equal(entry!.discordErrorCode, 50001);
    assert.equal(entry!.remediation, REMEDIATION.forbidden_guild);
    // successful channel advanced cursor
    assert.ok(newCursors[B], "channel B advanced cursor");
    assert.equal(newCursors[B]!.lastMessageId, "2000");
    // failing channel did NOT advance cursor
    assert.equal(newCursors[A], undefined);
  });

  it("403 + 50013 → forbidden_channel", async () => {
    const client = {
      getMe: async () => ({ id: "1", username: "bot", bot: true }),
      getChannelMessages: async () => {
        throw new DiscordChannelAccessError("403", { discordErrorCode: 50013 });
      },
    };
    const { health } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );
    const entry = health.channelsErrored![0]!;
    assert.equal(entry.reason, "forbidden_channel");
    assert.equal(entry.discordErrorCode, 50013);
    assert.equal(entry.remediation, REMEDIATION.forbidden_channel);
  });

  it("403 with no code → forbidden_other", async () => {
    const client = {
      getMe: async () => ({ id: "1", username: "bot", bot: true }),
      getChannelMessages: async () => {
        throw new DiscordChannelAccessError("403");
      },
    };
    const { health } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );
    const entry = health.channelsErrored![0]!;
    assert.equal(entry.reason, "forbidden_other");
    assert.equal(entry.discordErrorCode, undefined);
    assert.equal(entry.remediation, REMEDIATION.forbidden_other);
  });

  it("404 → not_found", async () => {
    const client = {
      getMe: async () => ({ id: "1", username: "bot", bot: true }),
      getChannelMessages: async () => {
        throw new DiscordChannelNotFoundError("404");
      },
    };
    const { health } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );
    const entry = health.channelsErrored![0]!;
    assert.equal(entry.reason, "not_found");
    assert.equal(entry.remediation, REMEDIATION.not_found);
  });

  it("5xx → transient", async () => {
    const client = {
      getMe: async () => ({ id: "1", username: "bot", bot: true }),
      getChannelMessages: async () => {
        throw new DiscordTransientError("500", 500);
      },
    };
    const { health } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );
    const entry = health.channelsErrored![0]!;
    assert.equal(entry.reason, "transient");
    assert.equal(entry.remediation, REMEDIATION.transient);
  });

  it("multi-channel run: A fails (50001), B succeeds and advances cursor", async () => {
    const client = {
      getMe: async () => ({ id: "1", username: "bot", bot: true }),
      getChannelMessages: async (id: string) => {
        if (id === A) {
          throw new DiscordChannelAccessError("403", { discordErrorCode: 50001 });
        }
        return [
          makeMessage(B, "3000", "2026-05-16T00:00:02Z"),
          makeMessage(B, "3001", "2026-05-16T00:00:03Z"),
        ];
      },
    };
    const { messages, health, newCursors } = await ingestDiscord(
      makeAllowlist([{ id: A, label: "a" }, { id: B, label: "b" }]),
      {} as IngestionCursorMap,
      client,
      "run-1",
      NOW,
    );
    assert.equal(messages.length, 2);
    assert.equal(health.channelsRead, 1);
    assert.equal(health.channelsErrored!.length, 1);
    assert.equal(newCursors[B]!.lastMessageId, "3001");
  });
});
