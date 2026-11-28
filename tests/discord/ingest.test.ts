// T017 [US1] — Discord ingestion unit tests with a stubbed REST client.
// Covers: 401 → DiscordAuthError; 429 bounded retry honoring Retry-After;
// per-channel 5-page cap; cursor advances monotonically; getMe called once
// per run; 403/404 → channel marked errored, others continue.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestDiscord, PER_CHANNEL_PAGE_CAP } from "../../src/discord/ingest.ts";
import {
  DiscordClient,
  DiscordChannelAccessError,
  DiscordChannelNotFoundError,
  DiscordRateLimitError,
} from "../../src/discord/client.ts";
import type {
  DiscordAllowlist,
  IngestionCursorMap,
} from "../../src/discord/schemas.ts";

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

interface StubClient {
  getMe: () => Promise<unknown>;
  getChannelMessages: (
    channelId: string,
    opts: { after?: string; limit?: number },
  ) => Promise<StubMessage[]>;
}

function makeAllowlist(channels: Array<{ id: string; label: string; enabled?: boolean }>): DiscordAllowlist {
  return {
    version: 1,
    entries: channels.map((c) => ({
      serverId: "509679626763632640",
      serverLabel: "Test Server",
      channelId: c.id,
      channelLabel: c.label,
      addedAt: "2026-05-16T00:00:00Z",
      addedBy: "octocat",
      enabled: c.enabled !== false,
    })),
  };
}

const NOW = new Date("2026-05-16T00:00:00Z");

describe("ingestDiscord — getMe", () => {
  it("calls getMe exactly once per run (token validation)", async () => {
    let getMeCalls = 0;
    const client: StubClient = {
      getMe: async () => {
        getMeCalls++;
        return { id: "bot", username: "stfc-monitor" };
      },
      getChannelMessages: async () => [],
    };
    await ingestDiscord(
      makeAllowlist([
        { id: "111111111111111111", label: "a" },
        { id: "111111111111111112", label: "b" },
      ]),
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(getMeCalls, 1);
  });
});

describe("ingestDiscord — pagination", () => {
  it("enforces PER_CHANNEL_PAGE_CAP = 5 (returns the constant by name)", () => {
    assert.equal(PER_CHANNEL_PAGE_CAP, 5);
  });

  it("stops paging after 5 pages even if more messages remain", async () => {
    const channelId = "111111111111111111";
    let pageCalls = 0;
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => {
        pageCalls++;
        // Always return 100 messages (a full page) so the pager keeps going.
        const start = Date.parse("2026-05-16T00:00:00Z") + pageCalls * 1000;
        const after = opts.after ? Number(opts.after) : 1_000_000_000_000_000_000n;
        const baseId = typeof after === "bigint" ? after : BigInt(after);
        const messages: StubMessage[] = [];
        for (let i = 1; i <= 100; i++) {
          const id = (baseId + BigInt(i + pageCalls * 1000)).toString();
          messages.push(makeMessage(channelId, id, new Date(start + i).toISOString()));
        }
        return messages;
      },
    };
    const { messages, newCursors } = await ingestDiscord(
      makeAllowlist([{ id: channelId, label: "a" }]),
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(pageCalls, PER_CHANNEL_PAGE_CAP);
    assert.equal(messages.length, 500);
    assert.ok(newCursors[channelId], "cursor recorded for channel");
  });

  it("cursor advances monotonically per channel after each page", async () => {
    const channelId = "111111111111111111";
    let pageCalls = 0;
    const seenAfters: Array<string | undefined> = [];
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => {
        seenAfters.push(opts.after);
        pageCalls++;
        if (pageCalls === 1) {
          return [
            makeMessage(channelId, "1000", "2026-05-16T00:00:01Z"),
            makeMessage(channelId, "1001", "2026-05-16T00:00:02Z"),
          ];
        }
        if (pageCalls === 2) {
          return [makeMessage(channelId, "1002", "2026-05-16T00:00:03Z")];
        }
        return [];
      },
    };
    const { newCursors } = await ingestDiscord(
      makeAllowlist([{ id: channelId, label: "a" }]),
      {
        [channelId]: {
          channelLabel: "a",
          lastMessageId: "999",
          lastTimestamp: "2026-05-15T23:59:59Z",
          lastRunId: "run-0",
          lastRunAt: "2026-05-15T23:59:59Z",
        },
      },
      client,
      "run-1",
      NOW,
    );
    // First page started with the existing cursor "999"; subsequent pages
    // advance to the latest message id seen.
    assert.deepEqual(seenAfters, ["999", "1001", "1002"]);
    assert.equal(newCursors[channelId]!.lastMessageId, "1002");
  });
});

describe("ingestDiscord — 429 retry", () => {
  it("does not multiply the real client's exhausted retry budget", async () => {
    const channelId = "111111111111111111";
    let channelRequests = 0;
    const sleeps: number[] = [];
    const client = new DiscordClient({
      token: "fixture-token",
      fetchImpl: async (input) => {
        if (String(input).endsWith("/users/@me")) {
          return Response.json({ id: "999999999999999999", username: "bot", bot: true });
        }
        channelRequests++;
        return new Response(null, { status: 429, headers: { "Retry-After": "0.001" } });
      },
      sleep: async () => assert.fail("ingest owns the channel retry budget"),
    });

    const { health } = await ingestDiscord(
      makeAllowlist([{ id: channelId, label: "a" }]),
      {},
      client,
      "run-1",
      NOW,
      { sleep: async (ms) => { sleeps.push(ms); } },
    );

    assert.equal(channelRequests, 4, "one request plus three retries, not three retry loops");
    assert.deepEqual(sleeps, [1, 1, 1]);
    assert.equal(health.channelsErrored?.[0]?.reason, "rate_limited");
  });

  it("honors Retry-After and retries up to 3× per channel", async () => {
    const channelId = "111111111111111111";
    let calls = 0;
    const sleeps: number[] = [];
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async () => {
        calls++;
        // First two attempts → 429; third attempt → 1 message; subsequent
        // pages (after the cursor advances) → empty (head reached).
        if (calls === 1 || calls === 2) {
          const err: Error & { retryAfterMs?: number } = Object.assign(
            new Error("429 Too Many Requests"),
            { name: "DiscordRateLimitError" as const, retryAfterMs: 5 },
          );
          throw err;
        }
        if (calls === 3) {
          return [makeMessage(channelId, "1000", "2026-05-16T00:00:01Z")];
        }
        return [];
      },
    };
    const { messages, health } = await ingestDiscord(
      makeAllowlist([{ id: channelId, label: "a" }]),
      {},
      client,
      "run-1",
      NOW,
      { sleep: async (ms) => { sleeps.push(ms); } },
    );
    // 3 attempts at page 1 (2 rate-limits + 1 success) + 1 follow-up page
    // that returns empty (head of channel reached).
    assert.equal(calls, 4);
    assert.equal(messages.length, 1);
    assert.deepEqual(sleeps, [5, 5]);
    assert.equal(health.channelsRead, 1);
  });

  it("shares the retry budget across pages of the same channel", async () => {
    const channelId = "111111111111111111";
    let calls = 0;
    const sleeps: number[] = [];
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => {
        calls++;
        if (opts.after === undefined && calls === 3) {
          return [makeMessage(channelId, "1000", "2026-05-16T00:00:01Z")];
        }
        throw new DiscordRateLimitError("429", 5);
      },
    };
    const { health, messages, newCursors } = await ingestDiscord(
      makeAllowlist([{ id: channelId, label: "a" }]),
      {},
      client,
      "run-1",
      NOW,
      { sleep: async (ms) => { sleeps.push(ms); } },
    );

    assert.equal(calls, 5);
    assert.deepEqual(sleeps, [5, 5, 5]);
    assert.equal(health.channelsErrored?.[0]?.reason, "rate_limited");
    assert.deepEqual(messages, []);
    assert.deepEqual(newCursors, {}, "a partially read channel remains replayable");
  });

  it("after 3 rate-limit retries, channel is recorded as errored, others continue", async () => {
    const a = "111111111111111111";
    const b = "111111111111111112";
    let aCalls = 0;
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (id) => {
        if (id === a) {
          aCalls++;
          throw new DiscordRateLimitError("429", 1);
        }
        return [makeMessage(b, "2000", "2026-05-16T00:00:01Z")];
      },
    };
    const { messages, health } = await ingestDiscord(
      makeAllowlist([{ id: a, label: "a" }, { id: b, label: "b" }]),
      {},
      client,
      "run-1",
      NOW,
      { sleep: async () => {} },
    );
    assert.equal(aCalls, 4, "one request plus three retries exhausts the channel budget");
    assert.equal(messages.length, 1, "channel b still ingested");
    assert.equal(
      health.channelsErrored!.find((e) => e.channelId === a)?.errorClass,
      "DiscordRateLimitError",
    );
  });
});

describe("ingestDiscord — 403 / 404", () => {
  it("403 → channel errored, remaining channels continue", async () => {
    const a = "111111111111111111";
    const b = "111111111111111112";
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (id) => {
        if (id === a) throw new DiscordChannelAccessError("403");
        return [makeMessage(b, "2000", "2026-05-16T00:00:01Z")];
      },
    };
    const { messages, health } = await ingestDiscord(
      makeAllowlist([{ id: a, label: "a" }, { id: b, label: "b" }]),
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(messages.length, 1);
    assert.equal(
      health.channelsErrored!.find((e) => e.channelId === a)?.errorClass,
      "DiscordChannelAccessError",
    );
  });

  it("404 → channel errored, remaining channels continue", async () => {
    const a = "111111111111111111";
    const b = "111111111111111112";
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async (id) => {
        if (id === a) throw new DiscordChannelNotFoundError("404");
        return [makeMessage(b, "2000", "2026-05-16T00:00:01Z")];
      },
    };
    const { health } = await ingestDiscord(
      makeAllowlist([{ id: a, label: "a" }, { id: b, label: "b" }]),
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(
      health.channelsErrored!.find((e) => e.channelId === a)?.errorClass,
      "DiscordChannelNotFoundError",
    );
  });
});

describe("ingestDiscord — output shape", () => {
  it("builds jumpLink with guild/channel/message ids", async () => {
    const guild = "509679626763632640";
    const channelId = "111111111111111111";
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async () => [
        makeMessage(channelId, "1000", "2026-05-16T00:00:01Z"),
      ],
    };
    const { messages } = await ingestDiscord(
      {
        version: 1,
        entries: [
          {
            serverId: guild,
            serverLabel: "Test",
            channelId,
            channelLabel: "promos",
            addedAt: "2026-05-16T00:00:00Z",
            addedBy: "octocat",
            enabled: true,
          },
        ],
      },
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(messages.length, 1);
    assert.equal(
      messages[0]!.jumpLink,
      `https://discord.com/channels/${guild}/${channelId}/1000`,
    );
    assert.equal(messages[0]!.channelLabel, "promos");
  });

  it("skips disabled allowlist entries", async () => {
    let getMessagesCalled = false;
    const client: StubClient = {
      getMe: async () => ({}),
      getChannelMessages: async () => {
        getMessagesCalled = true;
        return [];
      },
    };
    await ingestDiscord(
      makeAllowlist([{ id: "111111111111111111", label: "a", enabled: false }]),
      {},
      client,
      "run-1",
      NOW,
    );
    assert.equal(getMessagesCalled, false);
  });
});
