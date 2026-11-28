// T030 [US2] — Daily digest writer tests (write FIRST per Principle IX).
//
// Maps to digest-writer.contract.md + spec.md § US2 Scenarios 1–3.
// Tests use a tempdir for output so live data/digests/ is untouched.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  DigestForbiddenContentError,
  writeDigest,
} from "../../src/digest/index.ts";
import type { DailyDigest, RunHealth, Tip } from "../../src/discord/schemas.ts";

const DATE = "2026-05-16";
const RUN_A = "run-A";
const RUN_B = "run-B";

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function emptyHealth(runId: string, startedAt: string, finishedAt: string): RunHealth {
  return {
    runId,
    startedAt,
    finishedAt,
    channelsConfigured: 1,
    channelsRead: 1,
    channelsErrored: [],
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

function tip(
  category: Tip["category"],
  excerpt: string,
  channelLabel: string,
  messageId: string,
  ts: string,
): Tip {
  return {
    category,
    confidence: 0.9,
    excerpt,
    source: [{
      messageId,
      channelId: "222222222222222222",
      channelLabel,
      timestamp: ts,
      jumpLink: `https://discord.com/channels/509679626763632640/222222222222222222/${messageId}`,
    }],
    contentHash: shortHash(excerpt),
    classifierMethod: "heuristic",
  };
}

function baseDigest(opts: {
  runId: string;
  tips?: Tip[];
  codes?: Partial<DailyDigest["codes"]>;
}): DailyDigest {
  const startedAt = "2026-05-16T08:00:00Z";
  const finishedAt = "2026-05-16T08:05:00Z";
  return {
    date: DATE,
    generatedAt: finishedAt,
    windowStart: startedAt,
    windowEnd: finishedAt,
    runIds: [opts.runId],
    codes: {
      redeemed: opts.codes?.redeemed ?? [],
      failed: opts.codes?.failed ?? [],
      alreadyKnown: opts.codes?.alreadyKnown ?? [],
      deferredCap: opts.codes?.deferredCap ?? [],
    },
    tips: opts.tips ?? [],
    health: emptyHealth(opts.runId, startedAt, finishedAt),
  };
}

let outDir: string;

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-test-"));
});

afterEach(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("digest / idempotency on identical re-run (US2 Scenario 1, Picard C5)", () => {
  it("second call with identical input → mode merged-idempotent, bytesWritten 0, byte-identical file", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip: always assign your highest-tier officer to the bridge before mining.", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    const r1 = await writeDigest(input, { outputDir: outDir });
    assert.equal(r1.mode, "created");
    assert.ok(r1.bytesWritten > 0);
    const bytes1 = fs.readFileSync(r1.filePath);

    const r2 = await writeDigest(input, { outputDir: outDir });
    assert.equal(r2.mode, "merged-idempotent");
    assert.equal(r2.bytesWritten, 0);
    const bytes2 = fs.readFileSync(r2.filePath);
    assert.deepEqual(bytes1, bytes2, "file bytes must be identical on no-change re-run");
  });
});

describe("digest / merge with new content on same-day re-run", () => {
  it("reports the latest scan status after a dead-cache failure is repaired", async () => {
    const failed = baseDigest({ runId: RUN_A });
    failed.health.promoChannelsConfigured = 1;
    failed.health.promoChannelsRead = 1;
    failed.health.deadCodeCacheUnavailable = true;
    failed.health.errorsByClass.DeadCodeCacheError = 1;
    const first = await writeDigest(failed, { outputDir: outDir });
    assert.match(fs.readFileSync(first.filePath, "utf8"), /Promo-code scan: FAILED.*dead-code cache unavailable/);

    const recovered = baseDigest({ runId: RUN_B });
    recovered.health.promoChannelsConfigured = 1;
    recovered.health.promoChannelsRead = 1;
    const second = await writeDigest(recovered, { outputDir: outDir });
    const text = fs.readFileSync(second.filePath, "utf8");
    assert.match(text, /Promo-code scan: COMPLETE/);
    assert.match(text, /DeadCodeCacheError=1/);
  });

  it("new tips added → mode merged-idempotent, bytesWritten > 0, runIds union, counters summed", async () => {
    const a = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip A: park survey ships before refinery upgrades.", "stfc-strategy", "411111111111111110", "2026-05-16T08:00:00Z")],
    });
    a.health.messagesScanned = 100;
    a.health.tipsClassified.tip = 1;
    await writeDigest(a, { outputDir: outDir });

    const b = baseDigest({
      runId: RUN_B,
      tips: [tip("trick", "Trick B: stagger deploy times.", "stfc-strategy", "411111111111111111", "2026-05-16T12:00:00Z")],
    });
    b.health.messagesScanned = 250;
    b.health.tipsClassified.trick = 1;

    const r2 = await writeDigest(b, { outputDir: outDir });
    assert.equal(r2.mode, "merged-idempotent");
    assert.ok(r2.bytesWritten > 0, "merging new content must write bytes");

    const txt = fs.readFileSync(r2.filePath, "utf8");
    assert.match(txt, /Tip A: park survey ships/, "prior tip preserved");
    assert.match(txt, /Trick B: stagger deploy times/, "new tip merged");

    // State block: runIds union (sorted), counters summed.
    const state = parseStateBlock(txt);
    assert.deepEqual([...state.runIds].sort(), [RUN_A, RUN_B]);
    assert.equal(state.health.messagesScanned, 350);
    assert.equal(state.health.tipsClassified.tip, 1);
    assert.equal(state.health.tipsClassified.trick, 1);
  });
});

describe("digest / excerpt truncation (FR-019)", () => {
  it("excerpts > 600 chars truncated with …", async () => {
    const long = "Tip: " + "a".repeat(700);
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", long, "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    const r = await writeDigest(input, { outputDir: outDir });
    const txt = fs.readFileSync(r.filePath, "utf8");
    // The rendered excerpt body must end with the ellipsis truncation marker.
    const m = /^> (.+)$/m.exec(txt);
    assert.ok(m, "expected a quoted excerpt line");
    const renderedLen = m![1]!.length;
    // 600-char body + 1-char "…" = 601; allow exact match.
    assert.ok(renderedLen <= 601, `excerpt rendered ${renderedLen} chars; expected ≤ 601`);
    assert.ok(m![1]!.endsWith("…"), "truncated excerpt must end with …");
  });
});

describe("digest / forbidden-content guard (FR-025, Principle VII)", () => {
  it("JWT-shaped excerpt → throws DigestForbiddenContentError", async () => {
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiJ4In0",
      "abcdefghij",
    ].join(".");
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", `Tip including ${jwt} which must be blocked.`, "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    await assert.rejects(
      () => writeDigest(input, { outputDir: outDir }),
      DigestForbiddenContentError,
    );
  });

  it("literal DISCORD_BOT_TOKEN → throws DigestForbiddenContentError", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip: do not leak the DISCORD_BOT_TOKEN variable.", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    await assert.rejects(
      () => writeDigest(input, { outputDir: outDir }),
      DigestForbiddenContentError,
    );
  });

  it("literal STFC_ACCOUNTS → throws DigestForbiddenContentError", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip: STFC_ACCOUNTS env var holds creds.", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    await assert.rejects(
      () => writeDigest(input, { outputDir: outDir }),
      DigestForbiddenContentError,
    );
  });

  it("raw access_token body shape → throws DigestForbiddenContentError", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", `Saw response {"access_token":"abc123def"} in the wild.`, "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    await assert.rejects(
      () => writeDigest(input, { outputDir: outDir }),
      DigestForbiddenContentError,
    );
  });
});

describe("digest / state block round-trip", () => {
  it("contains DIGEST_STATE_V1 minified single-line JSON; parseable; byte-stable on re-render", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip: alpha", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    const r1 = await writeDigest(input, { outputDir: outDir });
    const txt = fs.readFileSync(r1.filePath, "utf8");
    assert.match(txt, /<!--\s*\nDIGEST_STATE_V1/, "must contain DIGEST_STATE_V1 token");
    const state = parseStateBlock(txt);
    assert.equal(state.date, DATE);
    assert.equal(state.tips.length, 1);

    // Re-render with identical input → byte-identical (idempotency).
    const r2 = await writeDigest(input, { outputDir: outDir });
    assert.equal(r2.bytesWritten, 0);
    const txt2 = fs.readFileSync(r2.filePath, "utf8");
    assert.equal(txt, txt2);
  });
});

describe("digest / duplicate tip across channels (US2 Scenario 3, FR-018)", () => {
  it("same contentHash from two channels → one entry, two source locations", async () => {
    const sharedExcerpt = "Tip: research the navigation tree first if you're under ops 30.";
    const a = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", sharedExcerpt, "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    const b = baseDigest({
      runId: RUN_B,
      tips: [tip("tip", sharedExcerpt, "stfc-tips", "411111111111111201", "2026-05-16T09:00:00Z")],
    });
    await writeDigest(a, { outputDir: outDir });
    const r = await writeDigest(b, { outputDir: outDir });
    const txt = fs.readFileSync(r.filePath, "utf8");

    // Only one body line; both source labels present.
    const bodyMatches = txt.match(/^> Tip: research the navigation tree first/gm) ?? [];
    assert.equal(bodyMatches.length, 1, "duplicate tip must appear exactly once in body");
    assert.match(txt, /stfc-strategy/);
    assert.match(txt, /stfc-tips/);

    const state = parseStateBlock(txt);
    const merged = state.tips.find((t: Tip) => t.excerpt === sharedExcerpt);
    assert.ok(merged, "merged tip present in state");
    assert.equal(merged!.source.length, 2, "two source entries collapsed onto one tip");
  });
});

describe("digest / each tip entry has a jump-link", () => {
  it("rendered body includes [jump](https://discord.com/...) per tip", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [tip("tip", "Tip: alpha excerpt", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z")],
    });
    const r = await writeDigest(input, { outputDir: outDir });
    const txt = fs.readFileSync(r.filePath, "utf8");
    assert.match(txt, /\[jump\]\(https:\/\/discord\.com\/channels\/[^)]+\)/);
  });
});

describe("digest / chatter & unclassified filtered (caller contract)", () => {
  it("tips with category=chatter or unclassified are dropped before rendering", async () => {
    const input = baseDigest({
      runId: RUN_A,
      tips: [
        tip("tip", "Tip: visible useful tip", "stfc-strategy", "411111111111111101", "2026-05-16T08:00:00Z"),
        tip("chatter", "should be filtered", "stfc-chat", "411111111111111102", "2026-05-16T08:01:00Z"),
        tip("unclassified", "should also be filtered", "stfc-chat", "411111111111111103", "2026-05-16T08:02:00Z"),
      ],
    });
    const r = await writeDigest(input, { outputDir: outDir });
    const txt = fs.readFileSync(r.filePath, "utf8");
    assert.match(txt, /visible useful tip/);
    assert.doesNotMatch(txt, /should be filtered/);
    assert.doesNotMatch(txt, /should also be filtered/);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function parseStateBlock(markdown: string): {
  date: string;
  runIds: string[];
  tips: Tip[];
  codes: DailyDigest["codes"];
  health: RunHealth;
} {
  // The state block is fenced inside an HTML comment with a leading
  // "DIGEST_STATE_V1" line and a following single-line minified JSON.
  const m = /<!--\s*\nDIGEST_STATE_V1\b[^\n]*\n([^\n]+)\n-->/m.exec(markdown);
  assert.ok(m, "state block missing or malformed");
  return JSON.parse(m![1]!);
}
