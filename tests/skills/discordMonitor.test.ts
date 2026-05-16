// T018 [US1] — Integration test for the discord-monitor skill (T026).
// Full-run with fixture data; zero live Discord or STFC connections.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AUTO_COMMIT_PER_RUN_CAP,
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

  it("discord-monitor.yml exists and has cron `15 */4 * * *`", () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    assert.match(yaml, /cron:\s*["']15 \*\/4 \* \* \*["']/);
  });

  it("redeem.yml cron is `0 * * * *` (regression guard)", () => {
    const yaml = fs.readFileSync(redeemYamlPath, "utf8");
    assert.match(yaml, /cron:\s*["']0 \* \* \* \*["']/);
  });

  it("concurrency group is `stfc-gift-redeemer` bit-for-bit (matches redeem.yml)", () => {
    const monitor = fs.readFileSync(yamlPath, "utf8");
    const redeem = fs.readFileSync(redeemYamlPath, "utf8");
    const monitorGroup = /group:\s*(\S+)/.exec(monitor)?.[1];
    const redeemGroup = /group:\s*(\S+)/.exec(redeem)?.[1];
    assert.equal(monitorGroup, "stfc-gift-redeemer");
    assert.equal(monitorGroup, redeemGroup, "concurrency groups must match bit-for-bit");
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

  // Note: ApiClient import is kept so the test file mirrors runAll.test.ts's
  // structural pattern; the type is unused below but documents the seam.
  void ApiClient;
});
