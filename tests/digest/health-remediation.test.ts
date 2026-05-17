// T021 [US2] — Digest health-section remediation rendering (contract T6).
//
// Asserts: rendered markdown for a run with one forbidden_guild and one
// forbidden_channel entry contains both verbatim remediation strings AND
// the bot username (US3) in the digest health header.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeDigest } from "../../src/digest/index.ts";
import type { DailyDigest, RunHealth } from "../../src/discord/schemas.ts";

const DATE = "2026-05-16";
const RUN = "run-A";
const BOT_USERNAME = "stfc-monitor-bot";

const REMEDIATION_GUILD =
  "Invite the bot to the server with scope=bot and permissions=66560 (VIEW_CHANNEL + READ_MESSAGE_HISTORY). See docs/DISCORD-BOT-SETUP.md.";
const REMEDIATION_CHANNEL =
  "Grant the bot VIEW_CHANNEL and READ_MESSAGE_HISTORY in this channel's permission overrides (or in a parent category).";

function makeHealth(): RunHealth {
  return {
    runId: RUN,
    startedAt: "2026-05-16T08:00:00Z",
    finishedAt: "2026-05-16T08:05:00Z",
    channelsConfigured: 3,
    channelsRead: 1,
    channelsErrored: [
      {
        channelId: "222222222222222222",
        errorClass: "DiscordChannelAccessError",
        reason: "forbidden_guild",
        discordErrorCode: 50001,
        remediation: REMEDIATION_GUILD,
      },
      {
        channelId: "222222222222222223",
        errorClass: "DiscordChannelAccessError",
        reason: "forbidden_channel",
        discordErrorCode: 50013,
        remediation: REMEDIATION_CHANNEL,
      },
    ],
    messagesScanned: 0,
    candidatesExtracted: 0,
    candidatesSubmitted: 0,
    candidatesSuppressedDedup: 0,
    candidatesSuppressedCooldown: 0,
    candidatesDeferredCap: 0,
    tipsClassified: { tip: 0, trick: 0, hack: 0, "event-info": 0, "patch-note": 0 },
    dropped: { moderation: 0, lowConfidence: 0, chatter: 0 },
    errorsByClass: {},
    modelLoaded: { name: "heuristic-only", sha256Verified: false, loadMs: 0 },
  };
}

function makeDigest(): DailyDigest {
  return {
    date: DATE,
    generatedAt: "2026-05-16T08:05:00Z",
    windowStart: "2026-05-16T08:00:00Z",
    windowEnd: "2026-05-16T08:05:00Z",
    runIds: [RUN],
    codes: { redeemed: [], failed: [], alreadyKnown: [], deferredCap: [] },
    tips: [],
    health: makeHealth(),
    botUsername: BOT_USERNAME,
  };
}

let outDir: string;

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-remediation-"));
});

afterEach(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("digest health remediation rendering (T021 / contract T6)", () => {
  it("contains both verbatim remediation strings and bot username in health header", async () => {
    const result = await writeDigest(makeDigest(), { outputDir: outDir });
    const rendered = fs.readFileSync(result.filePath, "utf8");

    assert.ok(
      rendered.includes(REMEDIATION_GUILD),
      "rendered digest must contain verbatim forbidden_guild remediation",
    );
    assert.ok(
      rendered.includes(REMEDIATION_CHANNEL),
      "rendered digest must contain verbatim forbidden_channel remediation",
    );
    assert.ok(
      rendered.includes(BOT_USERNAME),
      "rendered digest must include bot username in health section",
    );
    // Format check per T024: `- <channelId> — <reason> (Discord code <code>): <remediation>`
    assert.match(
      rendered,
      /-\s+222222222222222222\s+—\s+forbidden_guild\s+\(Discord code 50001\):/,
    );
    assert.match(
      rendered,
      /-\s+222222222222222223\s+—\s+forbidden_channel\s+\(Discord code 50013\):/,
    );
  });

  it("omits `(Discord code …)` when discordErrorCode is undefined", async () => {
    const d = makeDigest();
    d.health.channelsErrored = [
      {
        channelId: "222222222222222224",
        errorClass: "DiscordChannelNotFoundError",
        reason: "not_found",
        remediation: "Channel ID does not exist or is no longer visible. Remove it from config/discord-allowlist.json if the channel was deleted.",
      },
    ];
    const result = await writeDigest(d, { outputDir: outDir });
    const rendered = fs.readFileSync(result.filePath, "utf8");
    assert.match(
      rendered,
      /-\s+222222222222222224\s+—\s+not_found:\s+Channel ID does not exist/,
    );
    assert.doesNotMatch(rendered, /222222222222222224.*Discord code/);
  });
});
