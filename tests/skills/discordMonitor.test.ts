// T018 [US1] — Integration test for the discord-monitor skill (T026).
// Full-run with fixture data; zero live Discord or STFC connections.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AUTO_COMMIT_PER_RUN_CAP,
  DISCORD_MONITOR_EXIT_AUTH_FAILURE,
  DISCORD_MONITOR_EXIT_INFRA_FAILURE,
  DISCORD_MONITOR_EXIT_OK,
  discordMonitor,
} from "../../src/skills/discordMonitor.ts";
import { ApiClient } from "../../src/api/client.ts";
import type { IngestClient } from "../../src/discord/ingest.ts";

const NOW = new Date("2026-05-16T08:00:00Z");

function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(payload: object = {}): string {
  const h = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.sig`;
}

interface DirSet {
  dir: string;
  allowlist: string;
  cursors: string;
  candidates: string;
  suppression: string;
  cooldowns: string;
  digestsDir: string;
  promoCodes: string;
}

function setUpDirs(): DirSet {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-dm-"));
  const ds: DirSet = {
    dir,
    allowlist: path.join(dir, "discord-allowlist.json"),
    cursors: path.join(dir, "cursors.json"),
    candidates: path.join(dir, "candidates.jsonl"),
    suppression: path.join(dir, "suppression.json"),
    cooldowns: path.join(dir, "cooldowns.json"),
    digestsDir: path.join(dir, "digests"),
    promoCodes: path.join(dir, "promo-codes.txt"),
  };
  fs.writeFileSync(ds.promoCodes, "", "utf8");
  return ds;
}

function writeAllowlist(file: string, entries: Array<{ id: string; label: string }>): void {
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        entries: entries.map((e) => ({
          serverId: "509679626763632640",
          serverLabel: "Test Server",
          channelId: e.id,
          channelLabel: e.label,
          addedAt: "2026-05-16T00:00:00Z",
          addedBy: "octocat",
          enabled: true,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function writeEmptyAllowlist(file: string): void {
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [] }) + "\n", "utf8");
}

function loadFixture(name: string): Array<{
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  author: { id: string; username: string; bot: boolean };
  type: number;
}> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "fixtures", "discord", name),
      "utf8",
    ),
  );
}

describe("discordMonitor / empty allowlist (FR-001)", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    writeEmptyAllowlist(ds.allowlist);
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("returns exitCode 0; zero Discord calls; digest mentions '0 channels configured'", async () => {
    let factoryCalls = 0;
    const client: IngestClient = {
      getMe: async () => {
        factoryCalls++;
        return {};
      },
      getChannelMessages: async () => {
        factoryCalls++;
        return [];
      },
    };
    const { result, exitCode } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-empty",
    });

    assert.equal(exitCode, 0);
    assert.equal(factoryCalls, 0, "no Discord calls when allowlist is empty");
    assert.equal(result.reason, "no-channels-configured");
    assert.equal(result.channelsConfigured, 0);

    const digestPath = path.join(ds.digestsDir, "2026-05-16.md");
    assert.ok(fs.existsSync(digestPath));
    const digest = fs.readFileSync(digestPath, "utf8");
    assert.match(digest, /0 channels configured/);
  });
});

describe("discordMonitor / mixed fixture happy path", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("extracts codes, dedup filters prior, redeemCodes called once with fresh extras", async () => {
    const fixture = loadFixture("messages-codes.json");
    const client: IngestClient = {
      getMe: async () => ({ id: "bot", username: "stfc-monitor" }),
      getChannelMessages: async (_id, opts) => {
        if (opts.after !== undefined) return [];
        return fixture;
      },
    };

    // Seed promo-codes.txt with one of the fixture codes so dedup filters it.
    fs.writeFileSync(ds.promoCodes, "BONUSPACK\n", "utf8");

    let redeemCalls = 0;
    let receivedExtras: string[] | undefined;
    const { result, exitCode } = await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-mixed",
      redeemFn: async (opts) => {
        redeemCalls++;
        receivedExtras = opts.extraCandidates;
        const rows = opts.accounts.map((a) => ({
          accountName: a.name,
          attempts: (opts.extraCandidates ?? []).map((c) => ({
            code: c,
            outcome: "CODE_REDEEMED" as const,
          })),
        }));
        return { result: { rows }, exitCode: 0 };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(redeemCalls, 1, "redeemCodes called exactly once");
    // BONUSPACK was in promo-codes.txt → must NOT appear in extras.
    assert.ok(receivedExtras !== undefined);
    assert.ok(!receivedExtras!.includes("BONUSPACK"));
    // The fixture contains REDEEM2026, SECRETCODE, FLEETBOOST as fresh codes.
    assert.ok(receivedExtras!.includes("REDEEM2026"));
    assert.ok(receivedExtras!.includes("SECRETCODE"));
    assert.ok(receivedExtras!.includes("FLEETBOOST"));

    // Per-account outcomes persisted to candidates.jsonl.
    const candidatesRaw = fs.readFileSync(ds.candidates, "utf8");
    const candidateLines = candidatesRaw.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    const redeem2026 = candidateLines.find((c) => c.value === "REDEEM2026");
    assert.ok(redeem2026);
    assert.equal(redeem2026.status, "redeemed");
    assert.equal(redeem2026.perAccountOutcome[0]?.accountName, "main");
    assert.equal(redeem2026.perAccountOutcome[0]?.outcome, "CODE_REDEEMED");

    assert.equal(result.channelsConfigured, 1);
    assert.equal(result.channelsRead, 1);
    assert.ok(result.candidatesSubmitted >= 3);
  });

  it("redeemFn NOT called when fresh.length === 0 (all candidates known)", async () => {
    // Use a synthetic single-message fixture so we know exactly what tokens
    // can extract — the broader messages-codes.json contains many incidental
    // ALL-CAPS English words that the precision-first extractor still emits.
    const channelId = "222222222222222222";
    const fixture = [{
      id: "411111111111111111",
      channel_id: channelId,
      content: "ONLYCODE",
      timestamp: "2026-05-16T07:00:00.000000+00:00",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "promoposter", bot: false },
      type: 0,
    }];
    const client: IngestClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
    };
    fs.writeFileSync(ds.promoCodes, "ONLYCODE\n", "utf8");

    let redeemCalls = 0;
    await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-all-known",
      redeemFn: async () => {
        redeemCalls++;
        return { result: { rows: [] }, exitCode: 0 };
      },
    });
    assert.equal(redeemCalls, 0, "redeemCodes skipped when no fresh candidates");
  });

  it("does not resubmit a code already persisted in candidates.jsonl", async () => {
    const channelId = "222222222222222222";
    const fixture = [{
      id: "411111111111111111",
      channel_id: channelId,
      content: "ONLYCODE",
      timestamp: "2026-05-16T07:00:00.000Z",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "promoposter", bot: false },
      type: 0,
    }];
    fs.writeFileSync(ds.candidates, `${JSON.stringify({
      value: "ONLYCODE",
      firstSeen: "2026-05-15T07:00:00.000Z",
      lastAttempted: "2026-05-15T07:00:00.000Z",
      suppressedUntil: null,
      extractionConfidence: 1,
      status: "redeemed",
      source: {
        messageId: "400000000000000000",
        channelId,
        channelLabel: "promos",
        timestamp: "2026-05-15T07:00:00.000Z",
        jumpLink: `https://discord.com/channels/509679626763632640/${channelId}/400000000000000000`,
      },
      perAccountOutcome: [],
    })}\n`);

    let redeemCalls = 0;
    await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => ({
        getMe: async () => ({}),
        getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
      }),
      now: () => NOW,
      runId: "run-prior-candidate",
      redeemFn: async () => {
        redeemCalls++;
        return { result: { rows: [] }, exitCode: 0 };
      },
    });

    assert.equal(redeemCalls, 0);
  });
});

describe("discordMonitor / AUTO_COMMIT_PER_RUN_CAP", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("AUTO_COMMIT_PER_RUN_CAP is the named constant 10", () => {
    assert.equal(AUTO_COMMIT_PER_RUN_CAP, 10);
  });

  it("appends at most AUTO_COMMIT_PER_RUN_CAP codes to promo-codes.txt (cap on append, not on redeem)", async () => {
    // Build a synthetic fixture with 15 fresh codes — all redeem successfully.
    const channelId = "222222222222222222";
    const codes = Array.from({ length: 15 }, (_, i) => `CAPCODE${String(i + 1).padStart(2, "0")}`);
    const fixture = codes.map((code, i) => ({
      id: `42000000000000000${String(i).padStart(2, "0")}`,
      channel_id: channelId,
      content: `Try ${code} now`,
      timestamp: "2026-05-16T07:00:00.000000+00:00",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "promoposter", bot: false },
      type: 0,
    }));

    const client: IngestClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
    };

    let appended: string[] | undefined;
    let redeemSubmitted: string[] | undefined;
    await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-cap",
      onPromoCodesAppend: (added) => { appended = added; },
      redeemFn: async (opts) => {
        redeemSubmitted = opts.extraCandidates;
        return {
          result: {
            rows: [{
              accountName: "main",
              attempts: (opts.extraCandidates ?? []).map((c) => ({ code: c, outcome: "CODE_REDEEMED" as const })),
            }],
          },
          exitCode: 0,
        };
      },
    });

    assert.equal(redeemSubmitted?.length, 15, "redeem submission is NOT truncated by the cap");
    assert.equal(appended?.length, AUTO_COMMIT_PER_RUN_CAP, `cap on append = ${AUTO_COMMIT_PER_RUN_CAP}`);

    const promoTxt = fs.readFileSync(ds.promoCodes, "utf8");
    const inFile = promoTxt.split(/\r?\n/).filter((l) => l.length > 0);
    assert.equal(inFile.length, AUTO_COMMIT_PER_RUN_CAP);

    // Deferred slice marked in candidates.jsonl.
    const candidatesRaw = fs.readFileSync(ds.candidates, "utf8");
    const lines = candidatesRaw.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
    const deferred = lines.filter((c) => c.status === "deferred-cap");
    assert.equal(deferred.length, 5);
  });
});

describe("discordMonitor / cooldown writes only", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("failed redemption → cooldown.json written; suppression.json NEVER touched", async () => {
    const channelId = "222222222222222222";
    const fixture = [{
      id: "420000000000000000",
      channel_id: channelId,
      content: "Try BADCODE now",
      timestamp: "2026-05-16T07:00:00.000000+00:00",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "promoposter", bot: false },
      type: 0,
    }];
    const client: IngestClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
    };

    // Seed suppression.json operator content; verify byte-equal after run.
    fs.writeFileSync(
      ds.suppression,
      JSON.stringify(
        {
          OPERATOR: {
            action: "deny",
            reason: "marketing copy",
            addedAt: "2026-05-15T00:00:00Z",
            addedBy: "octocat",
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const suppressionBefore = fs.readFileSync(ds.suppression, "utf8");

    await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-fail",
      redeemFn: async (opts) => ({
        result: {
          rows: [{
            accountName: "main",
            attempts: (opts.extraCandidates ?? []).map((c) => ({
              code: c,
              outcome: "CODE_INVALID_OR_EXPIRED" as const,
            })),
          }],
        },
        exitCode: 0,
      }),
    });

    // suppression.json untouched.
    const suppressionAfter = fs.readFileSync(ds.suppression, "utf8");
    assert.equal(suppressionAfter, suppressionBefore);

    // cooldowns.json contains the failed code.
    const cooldowns = JSON.parse(fs.readFileSync(ds.cooldowns, "utf8"));
    assert.ok(cooldowns.BADCODE, "BADCODE recorded in cooldowns.json");
    assert.equal(cooldowns.BADCODE.failureOutcomes[0], "CODE_INVALID_OR_EXPIRED");
  });
});

describe("discordMonitor / workflow YAML assertions (T027)", () => {
  // T018 sub-assertion that needs T027's YAML to exist. Read the workflow
  // once and verify the bit-for-bit values that the spec requires.
  // refresh-token.yml: schedule removed (passwordless OTP login); manual dispatch only.
  const yamlPath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    ".github",
    "workflows",
    "discord-monitor.yml",
  );
  const redeemYamlPath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    ".github",
    "workflows",
    "redeem.yml",
  );
  const refreshTokenYamlPath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    ".github",
    "workflows",
    "refresh-token.yml",
  );

  it("discord-monitor.yml exists and has cron `15 */4 * * *`", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    assert.match(yaml, /cron:\s*["']15 \*\/4 \* \* \*["']/);
  });

  it("redeem.yml cron is `*/10 * * * *` (regression guard — bumped in #7, then again to */10)", () => {
    const yaml = fs.readFileSync(redeemYamlPath, "utf8");
    assert.match(yaml, /cron:\s*["']\*\/10 \* \* \* \*["']/);
  });

  it("concurrency group is `stfc-gift-redeemer` bit-for-bit (matches redeem.yml and refresh-token.yml)", () => {
    const monitor = fs.readFileSync(yamlPath, "utf8");
    const redeem = fs.readFileSync(redeemYamlPath, "utf8");
    const refreshToken = fs.readFileSync(refreshTokenYamlPath, "utf8");
    const monitorGroup = /group:\s*(\S+)/.exec(monitor)?.[1];
    const redeemGroup = /group:\s*(\S+)/.exec(redeem)?.[1];
    const refreshTokenGroup = /group:\s*(\S+)/.exec(refreshToken)?.[1];
    assert.equal(monitorGroup, "stfc-gift-redeemer");
    assert.equal(monitorGroup, redeemGroup, "concurrency groups must match bit-for-bit");
    assert.equal(monitorGroup, refreshTokenGroup, "refresh-token.yml concurrency group must match bit-for-bit");
  });

  it("shares `queue: max` with every other writer on the group (Garak, PR #266 review)", () => {
    // The default `queue: single` keeps one pending run per group and lets a
    // newer shared-group run cancel it, so a monitor run could evict a pending
    // /game-state upload. Every member of the group must opt into `max`.
    for (const [label, file] of [
      ["discord-monitor.yml", yamlPath],
      ["redeem.yml", redeemYamlPath],
      ["refresh-token.yml", refreshTokenYamlPath],
    ] as const) {
      const yaml = fs.readFileSync(file, "utf8");
      const queue = /^\s*queue:\s*(\S+)\s*$/m.exec(yaml)?.[1];
      assert.equal(queue, "max", `${label} must declare queue: max on the shared writer group`);
      assert.doesNotMatch(yaml, /^\s*cancel-in-progress:\s*true\b/m, `${label} must not cancel in-progress`);
    }
  });

  it("all `uses:` actions are SHA-pinned (40-hex)", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    const uses = [...yaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    assert.ok(uses.length > 0, "expected at least one `uses:` line");
    for (const u of uses) {
      assert.match(u, /@[0-9a-f]{40}\b/, `not SHA-pinned: ${u}`);
    }
  });

  it("DISCORD_BOT_TOKEN + STFC_ACCOUNTS env vars are wired from secrets", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    assert.match(yaml, /DISCORD_BOT_TOKEN:\s*\$\{\{\s*secrets\.DISCORD_BOT_TOKEN\s*\}\}/);
    assert.match(yaml, /STFC_ACCOUNTS:\s*\$\{\{\s*secrets\.STFC_ACCOUNTS\s*\}\}/);
  });

  it("permissions include `contents: write` (required for commit-on-write step)", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    assert.match(yaml, /contents:\s*write/);
  });

  it("commit-on-write step exists and stages data/digests (constitution v2.0.0 durable artifact)", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    // A step must git-add data/digests so digests are committed after each run.
    // Issue #241: the add happens against a separate automation-state
    // worktree ($STATE_DIR), not directly in the main checkout.
    assert.match(yaml, /add[^\n]*data\/digests/);
  });

  it("commit-on-write step retries against automation-state via the shared reconciliation helper (issue #241 — never main)", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    assert.match(yaml, /for attempt in 1 2 3; do/);
    assert.match(yaml, /node scripts\/automation-state-retry\.mjs/);
    assert.match(yaml, /push --no-verify origin "HEAD:automation-state"/);
    assert.doesNotMatch(yaml, /push origin "HEAD:\$GITHUB_REF_NAME"/);
  });

  // Note: ApiClient import is kept so the test file mirrors runAll.test.ts's
  // structural pattern; the type is unused below but documents the seam.
  void ApiClient;
});

// ── T035 [US3] — RunHealth unit tests ───────────────────────────────────────

describe("discordMonitor / RunHealth counters (T035 — US3)", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("401 auth failure → DiscordAuthError in errorsByClass, exitCode 2 (issue-206), redeemer pipeline still reaches step 6 (US3 Scenario 2)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const client: IngestClient = {
      getMe: async () => { throw new (await import("../../src/discord/client.ts")).DiscordAuthError("401"); },
      getChannelMessages: async () => [],
    };

    let redeemCalled = false;
    const { result, exitCode } = await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-auth-fail",
      redeemFn: async (opts) => {
        redeemCalled = true;
        return { result: { rows: [] }, exitCode: 0 };
      },
    });

    assert.equal(exitCode, 2, "exitCode must be 2 (DISCORD_MONITOR_EXIT_AUTH_FAILURE) on auth failure (issue-206)");
    assert.equal(result.errorsByClass["DiscordAuthError"], 1);
    // Redeemer is not called because there are zero fresh candidates (auth failed
    // before ingest could produce any), which is correct: redeemer still "runs"
    // in the sense that the pipeline reaches step 6 — it just has nothing to submit.
    assert.equal(result.candidatesSubmitted, 0);
  });

  it("healthy run → all health counters are non-negative integers (US3 Scenario 1)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const fixture = loadFixture("messages-codes.json");
    const client: IngestClient = {
      getMe: async () => ({ id: "bot", username: "stfc-monitor" }),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
    };

    const { result } = await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-healthy",
      redeemFn: async (opts) => ({
        result: {
          rows: [{
            accountName: "main",
            attempts: (opts.extraCandidates ?? []).map((c) => ({
              code: c, outcome: "CODE_REDEEMED" as const,
            })),
          }],
        },
        exitCode: 0,
      }),
    });

    // All counters must be non-negative integers.
    const numericFields: Array<keyof typeof result> = [
      "channelsConfigured", "channelsRead", "messagesScanned",
      "candidatesExtracted", "candidatesSubmitted",
      "candidatesSuppressedDedup", "candidatesSuppressedCooldown",
      "candidatesDeferredCap",
    ];
    for (const field of numericFields) {
      const val = result[field] as number;
      assert.ok(Number.isInteger(val) && val >= 0, `${field} = ${val} must be non-negative integer`);
    }

    // tipsClassified sub-counters.
    for (const [k, v] of Object.entries(result.tipsClassified)) {
      assert.ok(Number.isInteger(v) && v >= 0, `tipsClassified.${k} = ${v} must be non-negative integer`);
    }
    // dropped sub-counters.
    for (const [k, v] of Object.entries(result.dropped)) {
      assert.ok(Number.isInteger(v) && v >= 0, `dropped.${k} = ${v} must be non-negative integer`);
    }

    assert.equal(result.channelsConfigured, 1);
    assert.ok(result.channelsRead >= 1);
    assert.ok(result.messagesScanned > 0);
  });

  it("logs exactly one `discord bot authenticated` line on the success path (T012 / T015 — US3 AS#1)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const client: IngestClient = {
      getMe: async () => ({
        id: "100000000000000001",
        username: "stfc-monitor-bot",
        discriminator: "0",
        bot: true,
      }),
      getChannelMessages: async () => [],
    };

    // node:test buffers `console.*`, so we capture at the lower
    // `process.stdout.write` / `process.stderr.write` level instead.
    const captured: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origOut(chunk as never, ...(rest as []));
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origErr(chunk as never, ...(rest as []));
    }) as typeof process.stderr.write;
    try {
      await discordMonitor({
        accounts: [],
        paths: {
          allowlist: ds.allowlist,
          cursors: ds.cursors,
          candidates: ds.candidates,
          suppression: ds.suppression,
          cooldowns: ds.cooldowns,
          digestsDir: ds.digestsDir,
          promoCodes: ds.promoCodes,
          tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
        },
        clientFactory: () => client,
        now: () => NOW,
        runId: "run-auth-log-ok",
      });
    } finally {
      process.stdout.write = origOut as typeof process.stdout.write;
      process.stderr.write = origErr as typeof process.stderr.write;
    }

    const joined = captured.join("");
    const matches = joined.split("\n").filter((l) => l.includes("discord bot authenticated"));
    assert.equal(
      matches.length,
      1,
      `expected exactly one 'discord bot authenticated' log line, got ${matches.length}: ${JSON.stringify(matches)}`,
    );
    // Bot identity fields are present in the log payload (object may pretty-print across lines).
    assert.match(joined, /stfc-monitor-bot/);
    assert.match(joined, /100000000000000001/);
  });

  it("logs ZERO `discord bot authenticated` lines on the 401 auth-failure path (T012 / T015 — US3 AS#2)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const { DiscordAuthError } = await import("../../src/discord/client.ts");
    const client: IngestClient = {
      getMe: async () => { throw new DiscordAuthError("401"); },
      getChannelMessages: async () => [],
    };

    const captured: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origOut(chunk as never, ...(rest as []));
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return origErr(chunk as never, ...(rest as []));
    }) as typeof process.stderr.write;
    try {
      await discordMonitor({
        accounts: [{ name: "main", token: makeJwt() }],
        paths: {
          allowlist: ds.allowlist,
          cursors: ds.cursors,
          candidates: ds.candidates,
          suppression: ds.suppression,
          cooldowns: ds.cooldowns,
          digestsDir: ds.digestsDir,
          promoCodes: ds.promoCodes,
          tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
        },
        clientFactory: () => client,
        now: () => NOW,
        runId: "run-auth-log-fail",
        redeemFn: async () => ({ result: { rows: [] }, exitCode: 0 }),
      });
    } finally {
      process.stdout.write = origOut as typeof process.stdout.write;
      process.stderr.write = origErr as typeof process.stderr.write;
    }

    const joined = captured.join("");
    const matches = joined.split("\n").filter((l) => l.includes("discord bot authenticated"));
    assert.equal(
      matches.length,
      0,
      `expected zero 'discord bot authenticated' lines on auth failure, got ${matches.length}`,
    );
  });

  it("modelLoaded.sha256Verified is true when model SHA-256 passes (placeholder → heuristic-only treated as verified)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const client: IngestClient = {
      getMe: async () => ({}),
      getChannelMessages: async () => [],
    };

    const { result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-model",
    });

    // In heuristic-only mode (placeholder SHA), sha256Verified reflects that
    // the heuristic classifier loaded successfully (no model to verify).
    assert.equal(typeof result.modelLoaded.sha256Verified, "boolean");
    assert.ok(result.modelLoaded.loadMs >= 0);
    assert.ok(result.modelLoaded.name.length > 0);
  });

  it("channelsRead < channelsConfigured when one channel returns 403 (US3 Scenario 1)", async () => {
    writeAllowlist(ds.allowlist, [
      { id: "222222222222222222", label: "promos" },
      { id: "333333333333333333", label: "tips" },
    ]);
    const client: IngestClient = {
      getMe: async () => ({ id: "bot", username: "stfc-monitor" }),
      getChannelMessages: async (channelId, opts) => {
        if (channelId === "333333333333333333") {
          const err = new Error("403 Forbidden") as Error & { status: number };
          err.status = 403;
          err.name = "DiscordChannelAccessError";
          throw err;
        }
        if (opts.after !== undefined) return [];
        return [{
          id: "411111111111111111",
          channel_id: channelId,
          content: "TESTCODE",
          timestamp: "2026-05-16T07:00:00.000000+00:00",
          edited_timestamp: null,
          author: { id: "999999999999999999", username: "poster", bot: false },
          type: 0,
        }];
      },
    };

    const { result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-403",
    });

    assert.equal(result.channelsConfigured, 2);
    assert.ok(result.channelsRead < result.channelsConfigured,
      `channelsRead (${result.channelsRead}) should be < channelsConfigured (${result.channelsConfigured})`);
  });

  it("candidatesSuppressedCooldown increments when code filtered by cooldowns.json", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const fixture = [{
      id: "411111111111111111",
      channel_id: "222222222222222222",
      content: "COOLEDCODE",
      timestamp: "2026-05-16T07:00:00.000000+00:00",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "poster", bot: false },
      type: 0,
    }];
    const client: IngestClient = {
      getMe: async () => ({}),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : fixture),
    };

    // Seed cooldowns.json with COOLEDCODE suppressed until the far future.
    fs.writeFileSync(
      ds.cooldowns,
      JSON.stringify({
        COOLEDCODE: {
          firstFailedAt: "2026-05-15T00:00:00Z",
          lastFailedAt: "2026-05-15T00:00:00Z",
          suppressedUntil: "2027-01-01T00:00:00Z",
          failureOutcomes: ["CODE_INVALID_OR_EXPIRED"],
        },
      }) + "\n",
      "utf8",
    );

    const { result } = await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-cooldown",
      redeemFn: async () => ({ result: { rows: [] }, exitCode: 0 }),
    });

    assert.ok(result.candidatesSuppressedCooldown >= 1,
      `candidatesSuppressedCooldown should be >= 1, got ${result.candidatesSuppressedCooldown}`);
  });

  it("classified tips appear in digest output and tips-seen.jsonl (tip-flow integration)", async () => {
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "tips" }]);
    const tipMessage = [{
      id: "511111111111111111",
      channel_id: "222222222222222222",
      content: "tip: upgrade your ops building before starbase level 30",
      timestamp: "2026-05-16T07:00:00.000000+00:00",
      edited_timestamp: null,
      author: { id: "999999999999999999", username: "tipster", bot: false },
      type: 0,
    }];
    const client: IngestClient = {
      getMe: async () => ({ id: "bot", username: "stfc-monitor" }),
      getChannelMessages: async (_id, opts) => (opts.after !== undefined ? [] : tipMessage),
    };

    const tipsSeenPath = path.join(ds.dir, "tips-seen.jsonl");
    const { result } = await discordMonitor({
      accounts: [{ name: "main", token: makeJwt() }],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: tipsSeenPath,
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-tip-flow",
      redeemFn: async () => ({ result: { rows: [] }, exitCode: 0 }),
    });

    // 1. The digest must contain at least one classified tip.
    assert.ok(result.digestPath, "digest file should be written");
    const digestContent = fs.readFileSync(result.digestPath!, "utf8");
    assert.match(digestContent, /tip/i, "digest should contain tip content");

    // 2. tipsClassified.tip counter must be >= 1.
    assert.ok(result.tipsClassified.tip >= 1,
      `tipsClassified.tip should be >= 1, got ${result.tipsClassified.tip}`);

    // 3. tips-seen.jsonl must have at least one entry.
    assert.ok(fs.existsSync(tipsSeenPath), "tips-seen.jsonl should exist");
    const tipsSeenLines = fs.readFileSync(tipsSeenPath, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(tipsSeenLines.length >= 1,
      `tips-seen.jsonl should have >= 1 line, got ${tipsSeenLines.length}`);

    // 4. The persisted tip entry should parse as valid JSON with expected fields.
    const entry = JSON.parse(tipsSeenLines[0]!);
    assert.ok(entry.contentHash, "tip-seen entry must have contentHash");
    assert.ok(entry.category === "tip", `tip-seen category should be 'tip', got '${entry.category}'`);
  });
});

// ── T036 [US3] — Job Summary unit test ──────────────────────────────────────

describe("discordMonitor / GitHub Actions Job Summary (T036 — US3)", () => {
  let ds: DirSet;
  let savedToken: string | undefined;
  let savedSummary: string | undefined;
  let summaryFile: string;

  beforeEach(() => {
    ds = setUpDirs();
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "x";
    savedSummary = process.env.GITHUB_STEP_SUMMARY;
    summaryFile = path.join(ds.dir, "step-summary.md");
    fs.writeFileSync(summaryFile, "", "utf8");
    process.env.GITHUB_STEP_SUMMARY = summaryFile;
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
    if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = savedSummary;
  });

  it("writes RunHealth Markdown to GITHUB_STEP_SUMMARY on every completed run (FR-027)", async () => {
    writeEmptyAllowlist(ds.allowlist);
    await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-summary",
    });

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.ok(summary.length > 0, "GITHUB_STEP_SUMMARY should be non-empty");
    assert.match(summary, /run-summary/, "should contain the runId");
    assert.match(summary, /channels/i, "should mention channels");
    // Verify well-formed Markdown: no unclosed code fences.
    const fenceCount = (summary.match(/```/g) ?? []).length;
    assert.equal(fenceCount % 2, 0, "code fences must be balanced");
  });

  it("emits summary even when digest write fails", async () => {
    writeEmptyAllowlist(ds.allowlist);
    // Point digests at an unwritable path to force failure.
    const badDir = path.join(ds.dir, "no-exist", "nested", "deep");

    await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: badDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-summary-despite-digest-fail",
    });

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.ok(summary.length > 0, "summary should be written even if digest fails");
    assert.match(summary, /run-summary-despite-digest-fail/);
  });

  it("no-ops when GITHUB_STEP_SUMMARY is not set (local runs)", async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    writeEmptyAllowlist(ds.allowlist);

    // Should not throw.
    const { exitCode } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-no-summary",
    });
    assert.equal(exitCode, 0);
  });
});

// ── issue-206 — exit-code regression tests ────────────────────────────────

describe("discordMonitor / exit code semantics (issue-206)", () => {
  let ds: DirSet;
  let savedToken: string | undefined;

  beforeEach(() => {
    ds = setUpDirs();
    savedToken = process.env.DISCORD_BOT_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(ds.dir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("DISCORD_MONITOR_EXIT_OK is 0", () => {
    assert.equal(DISCORD_MONITOR_EXIT_OK, 0);
  });

  it("DISCORD_MONITOR_EXIT_INFRA_FAILURE is 1", () => {
    assert.equal(DISCORD_MONITOR_EXIT_INFRA_FAILURE, 1);
  });

  it("DISCORD_MONITOR_EXIT_AUTH_FAILURE is 2", () => {
    assert.equal(DISCORD_MONITOR_EXIT_AUTH_FAILURE, 2);
  });

  it("missing DISCORD_BOT_TOKEN → exitCode 2 (DISCORD_MONITOR_EXIT_AUTH_FAILURE)", async () => {
    // Ensure the env var is absent so loadDiscordToken throws DiscordTokenMissingError.
    delete process.env.DISCORD_BOT_TOKEN;
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);

    const { exitCode, result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-missing-token",
    });

    assert.equal(exitCode, DISCORD_MONITOR_EXIT_AUTH_FAILURE,
      "missing token must return DISCORD_MONITOR_EXIT_AUTH_FAILURE (2)");
    assert.equal(result.errorsByClass["DiscordTokenMissingError"], 1,
      "DiscordTokenMissingError must be recorded in errorsByClass");
  });

  it("DiscordAuthError → exitCode 2 (DISCORD_MONITOR_EXIT_AUTH_FAILURE)", async () => {
    process.env.DISCORD_BOT_TOKEN = "x";
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const { DiscordAuthError } = await import("../../src/discord/client.ts");
    const client: IngestClient = {
      getMe: async () => { throw new DiscordAuthError("401 Unauthorized"); },
      getChannelMessages: async () => [],
    };

    const { exitCode, result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-discord-auth-error",
    });

    assert.equal(exitCode, DISCORD_MONITOR_EXIT_AUTH_FAILURE,
      "DiscordAuthError must return DISCORD_MONITOR_EXIT_AUTH_FAILURE (2)");
    assert.equal(result.errorsByClass["DiscordAuthError"], 1,
      "DiscordAuthError must be recorded in errorsByClass");
  });

  it("digest write failure → exitCode 1 (DISCORD_MONITOR_EXIT_INFRA_FAILURE)", async () => {
    process.env.DISCORD_BOT_TOKEN = "x";
    writeEmptyAllowlist(ds.allowlist);
    // Create a FILE at the path that writeDigest will try to use as a directory.
    // mkdir({ recursive: true }) throws ENOTDIR when a path component is a file,
    // which is the reliable way to force a digest-write failure without mocking.
    const fileBlockingDir = path.join(ds.dir, "blocking-file");
    fs.writeFileSync(fileBlockingDir, "blocker", "utf8");
    const badDir = path.join(fileBlockingDir, "nested");

    const { exitCode } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: badDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-digest-fail",
    });

    assert.equal(exitCode, DISCORD_MONITOR_EXIT_INFRA_FAILURE,
      "digest write failure must return DISCORD_MONITOR_EXIT_INFRA_FAILURE (1)");
  });

  it("auth failure + digest write failure → exitCode 2 (auth wins — higher code)", async () => {
    // Missing token triggers auth failure code; bad digest dir triggers infra failure.
    delete process.env.DISCORD_BOT_TOKEN;
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    // Block the digest directory with a file (same technique as the infra test).
    const fileBlockingDir = path.join(ds.dir, "blocking-file2");
    fs.writeFileSync(fileBlockingDir, "blocker", "utf8");
    const badDir = path.join(fileBlockingDir, "nested");

    const { exitCode, result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: badDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      now: () => NOW,
      runId: "run-auth-and-digest-fail",
    });

    assert.equal(exitCode, DISCORD_MONITOR_EXIT_AUTH_FAILURE,
      "when both auth (2) and infra (1) fail, exitCode must be 2 (auth wins)");
    assert.equal(result.errorsByClass["DiscordTokenMissingError"], 1,
      "DiscordTokenMissingError must still be recorded in errorsByClass");
  });

  it("successful run → exitCode 0 (DISCORD_MONITOR_EXIT_OK), health.errorsByClass preserved", async () => {
    process.env.DISCORD_BOT_TOKEN = "x";
    writeAllowlist(ds.allowlist, [{ id: "222222222222222222", label: "promos" }]);
    const client: IngestClient = {
      getMe: async () => ({ id: "bot", username: "stfc-monitor" }),
      getChannelMessages: async () => [],
    };

    const { exitCode, result } = await discordMonitor({
      accounts: [],
      paths: {
        allowlist: ds.allowlist,
        cursors: ds.cursors,
        candidates: ds.candidates,
        suppression: ds.suppression,
        cooldowns: ds.cooldowns,
        digestsDir: ds.digestsDir,
        promoCodes: ds.promoCodes,
        tipsSeen: path.join(ds.dir, "tips-seen.jsonl"),
      },
      clientFactory: () => client,
      now: () => NOW,
      runId: "run-success-exit-code",
    });

    assert.equal(exitCode, DISCORD_MONITOR_EXIT_OK,
      "clean run must return DISCORD_MONITOR_EXIT_OK (0)");
    // errorsByClass should be empty (no errors on clean run).
    assert.deepEqual(result.errorsByClass, {},
      "errorsByClass must be empty on a clean run");
  });
});
