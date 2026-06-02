import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAll } from "../../src/skills/runAll.ts";
import { createSummaryWriter } from "../../src/lib/summary.ts";
import { Outcomes } from "../../src/lib/outcomes.ts";
// Note: the api/client module exports these; the orchestrator may need them too.
import {
  ApiClient,
  ApiError,
  TokenExpiredError,
  SchemaMismatchError,
} from "../../src/api/client.ts";

// ----------------------------------------------------------------------------
// Test-contract assumptions for the orchestrator (documented here for the
// skills implementer):
//
//   runAll({
//     accounts:        Account[],
//     clientFactory:   (account: Account) => ApiClient,
//     summary:         SummaryWriter,
//     promoCodesPath:  string,
//     now?:            Date,
//   }): Promise<{ result: RunReport, exitCode: number }>
//
//   RunReport.accounts: Array<{
//     name: string,
//     tokenStatus: Outcome,        // TOKEN_VALID | TOKEN_EXPIRED | UNKNOWN_RESULT
//     items: Array<{ kind: "gift" | "code", id: string, outcome: Outcome }>,
//     promoCodes?: Array<{ code: string, outcome: Outcome }>,
//   }>
//   RunReport.errors: Array<{ account?: string, message: string }>
//
//   exitCode is 0 unless an infrastructure-class error was raised (schema
//   mismatch, malformed accounts, uncaught crash) — in which case 1. If every
//   configured account returns TOKEN_EXPIRED and there are no infra errors, it
//   returns 2 so the workflow loudly signals secret rotation is needed.
//
// The fake client below is treated as ApiClient-shaped via a cast. The real
// ApiClient just needs methods that look like these (the orchestrator should
// use thin wrappers like `getMe`, `listGifts`, `claimGift`, `redeemCode`).
// ----------------------------------------------------------------------------

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
  return `${h}.${p}.signaturePartZZZ`;
}

interface FakeGift {
  bundleId: number;
  title: string;
  isClaimable?: boolean;
  isClaimed?: boolean;
  isSpecial?: boolean;
  hasCost?: boolean;
  isAtMax?: boolean;
}

interface FakeClient {
  getMe(): Promise<{ id: number; level: number }>;
  listGifts(): Promise<{ items: FakeGift[] }>;
  claimGift(bundleId: number): Promise<{ success: boolean; bundleId?: number; error?: string }>;
  redeemCode(code: string): Promise<{ code?: number; message?: string }>;
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    getMe: overrides.getMe ?? (async () => ({ id: 1, level: 50 })),
    listGifts: overrides.listGifts ?? (async () => ({ items: [] })),
    claimGift: overrides.claimGift ?? (async (id) => ({ success: true, bundleId: id })),
    redeemCode: overrides.redeemCode ?? (async () => ({ code: 0, message: "redeem_success" })),
  };
}

describe("runAll", () => {
  let dir: string;
  let savedSummaryEnv: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-runall-"));
    savedSummaryEnv = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedSummaryEnv === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = savedSummaryEnv;
  });

  function emptyPromoFile(): string {
    const file = path.join(dir, "promo.txt");
    fs.writeFileSync(file, "", "utf8");
    return file;
  }

  it("happy path: 1 account, 3 gifts (1 claimable), claim succeeds → exitCode 0", async () => {
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 100, title: "Daily Officer Pack", isClaimable: true },
          { bundleId: 101, title: "Premium Crystal Bundle", isClaimable: false, hasCost: true },
          { bundleId: 102, title: "Yesterday's Gift", isClaimed: true },
        ],
      }),
    });

    const summary = createSummaryWriter(undefined);
    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary,
      promoCodesPath: emptyPromoFile(),
    });

    assert.equal(exitCode, 0);
    assert.equal(result.accounts.length, 1);
    const items = result.accounts[0]!.items;
    const outcomes = items.map((i: { outcome: string }) => i.outcome).sort();
    assert.ok(outcomes.includes(Outcomes.CLAIMED), `expected CLAIMED in ${outcomes.join(",")}`);
    assert.ok(
      outcomes.includes(Outcomes.HAS_COST),
      `expected HAS_COST in ${outcomes.join(",")}`,
    );
    assert.ok(
      outcomes.includes(Outcomes.ALREADY_CLAIMED),
      `expected ALREADY_CLAIMED in ${outcomes.join(",")}`,
    );
  });

  it("multi-account: one OK, one TokenExpired → both reported, exitCode 0", async () => {
    const goodFake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 1, title: "Free pack", isClaimable: true }],
      }),
    });
    const badFake = makeFakeClient({
      getMe: async () => {
        throw new TokenExpiredError("expired");
      },
    });

    const accounts = [
      { name: "good", token: makeJwt({ exp: 9999999999 }) },
      { name: "bad", token: makeJwt({ exp: 9999999999 }) },
    ];

    const { result, exitCode } = await runAll({
      accounts,
      clientFactory: (a) => (a.name === "good" ? goodFake : badFake) as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
    });

    assert.equal(exitCode, 0);
    assert.equal(result.accounts.length, 2);

    const good = result.accounts.find((a: { name: string }) => a.name === "good")!;
    const bad = result.accounts.find((a: { name: string }) => a.name === "bad")!;

    assert.ok(
      good.items.some((i: { outcome: string }) => i.outcome === Outcomes.CLAIMED),
      "good account should have CLAIMED",
    );
    assert.equal(bad.tokenStatus, Outcomes.TOKEN_EXPIRED);
  });

  it("multi-account: all TokenExpired → exitCode 2 and summary flags secret rotation", async () => {
    const expiredFake = makeFakeClient({
      getMe: async () => {
        throw new TokenExpiredError("expired");
      },
    });
    const summaryFile = path.join(dir, "summary-all-expired.md");

    const { result, exitCode } = await runAll({
      accounts: [
        { name: "main", token: makeJwt({ exp: 9999999999 }) },
        { name: "alt", token: makeJwt({ exp: 9999999999 }) },
      ],
      clientFactory: () => expiredFake as unknown as ApiClient,
      summary: createSummaryWriter(summaryFile),
      promoCodesPath: emptyPromoFile(),
    });

    assert.equal(exitCode, 2);
    assert.equal(result.errors.length, 0);
    assert.ok(result.accounts.every((a) => a.tokenStatus === Outcomes.TOKEN_EXPIRED));

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.match(summary, /all accounts/i);
    assert.match(summary, /TOKEN_EXPIRED/);
    assert.match(summary, /secret rotation/i);
  });

  it("promo codes mix: success / used / invalid / unknown classified correctly", async () => {
    const codeFile = path.join(dir, "promo.txt");
    fs.writeFileSync(
      codeFile,
      "TESTCODE1\nUSEDCODE\nOLDCODE\nWEIRDCODE\n",
      "utf8",
    );

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async (code: string) => {
        switch (code) {
          case "TESTCODE1":
            return { code: 0, message: "redeem_success" };
          case "USEDCODE":
            return { message: "redeem_error_code_used_before" };
          case "OLDCODE":
            return { code: 1, message: "redeem_error_code_expired" };
          case "WEIRDCODE":
            return { message: "something_unrecognized" };
          default:
            return { message: "unknown" };
        }
      },
    });

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: codeFile,
      deadCodesPath: path.join(dir, "promo-code-dead.json"),
    });

    assert.equal(exitCode, 0);
    const promo = result.accounts[0]!.promoCodes ?? [];
    const byCode = new Map(
      promo.map((p: { code: string; outcome: string }) => [p.code, p.outcome] as const),
    );
    assert.equal(byCode.get("TESTCODE1"), Outcomes.CODE_REDEEMED);
    assert.equal(byCode.get("USEDCODE"), Outcomes.CODE_ALREADY_USED);
    assert.equal(byCode.get("OLDCODE"), Outcomes.CODE_INVALID_OR_EXPIRED);
    assert.equal(byCode.get("WEIRDCODE"), Outcomes.UNKNOWN_RESULT);
  });

  it("marks CODE_INVALID_OR_EXPIRED as dead and skips it on subsequent runs", async () => {
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "DEADCODE\n", "utf8");

    let redeemCalls = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        redeemCalls += 1;
        return { code: 1, message: "redeem_error_code_expired" };
      },
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: codeFile,
      deadCodesPath,
    });

    const deadCodes = JSON.parse(fs.readFileSync(deadCodesPath, "utf8")) as Record<string, unknown>;
    assert.ok(deadCodes.DEADCODE, "dead code should be persisted after first invalid outcome");

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: codeFile,
      deadCodesPath,
    });

    assert.equal(redeemCalls, 1, "second run should skip dead code without API call");
  });

  it("operator reset: deleting dead-code cache re-attempts previously dead code", async () => {
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "DEADCODE\n", "utf8");

    let redeemCalls = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        redeemCalls += 1;
        return { code: 1, message: "redeem_error_code_expired" };
      },
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
    });
    fs.unlinkSync(deadCodesPath);

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
    });

    assert.equal(redeemCalls, 2, "deleting cache should force re-attempt on next run");
  });

  it("retries transient network failure and succeeds on second attempt", async () => {
    const codeFile = path.join(dir, "promo.txt");
    fs.writeFileSync(codeFile, "RETRYME\n", "utf8");
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error("socket reset") as Error & { code: string };
          err.code = "ECONNRESET";
          throw err;
        }
        return { code: 0, message: "redeem_success" };
      },
    });

    const { result } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(sleepCalls, [1000]);
    assert.equal(result.accounts[0]?.promoCodes[0]?.outcome, Outcomes.CODE_REDEEMED);
  });

  it("retries transient network failure 3x then records TRANSIENT failure (not dead)", async () => {
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "FLAKY\n", "utf8");
    let attempts = 0;

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        attempts += 1;
        const err = new Error("timeout") as Error & { code: string };
        err.code = "ETIMEDOUT";
        throw err;
      },
    });

    const { result } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
      sleep: async () => undefined,
    });

    assert.equal(attempts, 3, "transient errors should be attempted 3 total times");
    assert.equal(result.accounts[0]?.promoCodes[0]?.outcome, Outcomes.TRANSIENT);
    assert.equal(fs.existsSync(deadCodesPath), false, "transient exhaustion must not mark code dead");
  });

  it("honors Retry-After on HTTP 429 before retrying", async () => {
    const codeFile = path.join(dir, "promo.txt");
    fs.writeFileSync(codeFile, "RATECODE\n", "utf8");
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ApiError("HTTP 429", 429, { retryAfterMs: 1500 });
        }
        return { code: 0, message: "redeem_success" };
      },
    });

    const { result } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(sleepCalls, [1500]);
    assert.equal(result.accounts[0]?.promoCodes[0]?.outcome, Outcomes.CODE_REDEEMED);
  });

  it("dead-code cache write is atomic (tmp renamed, no leftover tmp file)", async () => {
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "DEADCODE\n", "utf8");

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => ({ code: 1, message: "redeem_error_code_expired" }),
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
    });

    assert.equal(fs.existsSync(deadCodesPath), true);
    assert.equal(fs.existsSync(`${deadCodesPath}.tmp`), false);
  });

  it("schema mismatch in auth/me → recorded in errors, exitCode 1", async () => {
    const badFake = makeFakeClient({
      getMe: async () => {
        throw new SchemaMismatchError("unexpected /me payload");
      },
    });

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => badFake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
    });

    assert.equal(exitCode, 1);
    assert.ok(
      Array.isArray(result.errors) && result.errors.length > 0,
      "expected at least one error entry",
    );
  });

  // SKIPPED: promo file read error case — readPromoCodes treats ENOENT as
  // empty, so a "missing path" doesn't error. Triggering a real read failure
  // would require mocking fs or pointing at a directory (platform-specific).
  // We accept this gap rather than introduce flaky platform-dependent tests.

  it("summary writer is populated with account name, expiry, and item table", async () => {
    const summaryFile = path.join(dir, "summary.md");
    const summary = createSummaryWriter(summaryFile);

    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 100, title: "Daily Officer Pack", isClaimable: true }],
      }),
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary,
      promoCodesPath: emptyPromoFile(),
    });

    const contents = fs.readFileSync(summaryFile, "utf8");
    assert.match(contents, /main/, "summary should mention account name");
    assert.match(contents, /\|/, "summary should contain a Markdown table");
    assert.match(contents, /CLAIMED|expires|expiry|EXPIRED/i, "summary should mention expiry/outcome");
  });

  it("history file: inserts new rows under the table header (newest first)", async () => {
    const historyPath = path.join(dir, "history.md");
    fs.writeFileSync(
      historyPath,
      "# Header\n\n| Date | Time | Account | Gifts |\n| --- | --- | --- | --- |\n" +
        "| 2026-05-08 | 23:00 | main | Old Gift |\n",
      "utf8",
    );

    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 100, title: "Daily Officer Pack", isClaimable: true },
          { bundleId: 101, title: "Premium Bundle", hasCost: true }, // skipped
          { bundleId: 102, title: "Weekly Chest", isClaimable: true },
        ],
      }),
    });

    const fixedNow = new Date("2026-05-09T08:30:00Z");
    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: emptyPromoFile(),
      historyPath,
      now: () => fixedNow,
    });

    const contents = fs.readFileSync(historyPath, "utf8");
    const newRow = "| 2026-05-09 | 08:30 | main | Daily Officer Pack, Weekly Chest |";
    const oldRow = "| 2026-05-08 | 23:00 | main | Old Gift |";
    assert.ok(contents.includes(newRow), `expected new row ${newRow} in history`);
    assert.ok(contents.includes(oldRow), "old row must be preserved");
    // Newest-first: the new row's index must be BEFORE the old row's index.
    assert.ok(
      contents.indexOf(newRow) < contents.indexOf(oldRow),
      "new rows must appear above older rows (inserted under header)",
    );
    assert.doesNotMatch(contents, /Premium Bundle/, "skipped gifts should not appear in history");
  });

  it("history file: does NOT append when nothing was claimed (avoids hourly empties)", async () => {
    const historyPath = path.join(dir, "history.md");
    const initial = "# Header\n\n| D | T | A | Gifts |\n| --- | --- | --- | --- |\n";
    fs.writeFileSync(historyPath, initial, "utf8");

    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 200, title: "Already had it", isClaimed: true }, // ALREADY_CLAIMED, no claim attempted
        ],
      }),
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: emptyPromoFile(),
      historyPath,
    });

    assert.equal(fs.readFileSync(historyPath, "utf8"), initial,
      "history file must be unchanged when nothing was newly claimed");
  });

  it("history file: creates header + row when file is missing", async () => {
    const historyPath = path.join(dir, "missing-history.md");
    // Note: we deliberately do NOT create the file beforehand.

    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 100, title: "Daily Officer Pack", isClaimable: true }],
      }),
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: emptyPromoFile(),
      historyPath,
      now: () => new Date("2026-05-09T08:30:00Z"),
    });

    const contents = fs.readFileSync(historyPath, "utf8");
    assert.match(contents, /^# Redeem history/m, "header should be written");
    assert.match(contents, /\| 2026-05-09 \| 08:30 \| main \| Daily Officer Pack \|/);
  });

  it("happy path does not write dead-code cache when no invalid codes are seen", async () => {
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "GOODCODE\n", "utf8");

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => ({ code: 0, message: "redeem_success" }),
    });

    await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
    });

    assert.equal(fs.existsSync(deadCodesPath), false);
  });
});
