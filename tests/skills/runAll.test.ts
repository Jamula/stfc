import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { runAll } from "../../src/skills/runAll.ts";
import { createSummaryWriter } from "../../src/lib/summary.ts";
import { Outcomes } from "../../src/lib/outcomes.ts";
import { DEGRADED_ALERT_LABELS, DEGRADED_ALERT_TITLE, syncDegradedGiftAlert } from "../../scripts/degraded-gift-alert.ts";
// Note: the api/client module exports these; the orchestrator may need them too.
import {
  ApiClient,
  ApiError,
  TokenExpiredError,
  SchemaMismatchError,
  TransientError,
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

function mockStoreFetch(giftStatuses: number[]): {
  fetchImpl: typeof fetch;
  calls: { auth: number; gifts: number };
} {
  const calls = { auth: 0, gifts: 0 };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      calls.auth += 1;
      return new Response(JSON.stringify({ id: 1, level: 50 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/offers/gifts?available=true")) {
      const status = giftStatuses[Math.min(calls.gifts, giftStatuses.length - 1)]!;
      calls.gifts += 1;
      return new Response(
        JSON.stringify(status === 200 ? { items: [] } : { error: `HTTP ${status}` }),
        { status, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected store request: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/**
 * Store mock that serves a claimable gift and rejects the claim POST, to
 * exercise the side-effecting replay policy end to end (#243 / #204).
 */
function mockClaimFetch(claimStatus: number): {
  fetchImpl: typeof fetch;
  calls: { auth: number; gifts: number; claim: number };
} {
  const calls = { auth: 0, gifts: 0, claim: 0 };
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      calls.auth += 1;
      return json({ id: 1, level: 50 }, 200);
    }
    if (url.includes("/offers/gifts/claim")) {
      calls.claim += 1;
      return json(claimStatus === 200 ? { ok: true } : { error: `HTTP ${claimStatus}` }, claimStatus);
    }
    if (url.includes("/offers/gifts?available=true")) {
      calls.gifts += 1;
      return json({ items: [{ bundleId: 4242, title: "Daily Gift" }] }, 200);
    }
    throw new Error(`Unexpected store request: ${url}`);
  }) as typeof fetch;

  return { fetchImpl, calls };
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

    const summaryFile = path.join(dir, "summary-happy.md");
    const summary = createSummaryWriter(summaryFile);
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
    const rendered = fs.readFileSync(summaryFile, "utf8");
    assert.match(rendered, /^# ✅ STFC Gift Redeemer/m);
    assert.match(rendered, /Gift claims: 1\/3/);
    assert.doesNotMatch(rendered, /DEGRADED/);
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

    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    let output: Awaited<ReturnType<typeof runAll>>;
    try {
      output = await runAll({
        accounts,
        clientFactory: (a) => (a.name === "good" ? goodFake : badFake) as unknown as ApiClient,
        summary: createSummaryWriter(undefined),
        promoCodesPath: emptyPromoFile(),
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.equal(output.exitCode, 0);
    assert.equal(output.result.accounts.length, 2);

    const good = output.result.accounts.find((a: { name: string }) => a.name === "good")!;
    const bad = output.result.accounts.find((a: { name: string }) => a.name === "bad")!;

    assert.ok(
      good.items.some((i: { outcome: string }) => i.outcome === Outcomes.CLAIMED),
      "good account should have CLAIMED",
    );
    assert.equal(bad.tokenStatus, Outcomes.TOKEN_EXPIRED);
    assert.match(stdout.join(""), /::warning::.*claimed=unavailable/);
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

  it("auth/me 200 and gifts/list 401 then 200 remains TOKEN_VALID with exitCode 0", async () => {
    const store = mockStoreFetch([401, 200]);

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      fetchImpl: store.fetchImpl,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
      deadCodesPath: path.join(dir, "dead-store-recovered.json"),
    });

    const account = result.accounts[0]!;
    assert.equal(account.tokenStatus, Outcomes.TOKEN_VALID);
    assert.equal(account.ok, true);
    assert.equal(exitCode, 0);
    assert.equal(store.calls.auth, 1);
    assert.equal(store.calls.gifts, 2);
    assert.ok(account.items.every((item) => item.outcome !== Outcomes.TOKEN_EXPIRED));
  });

  it("a rejected gift claim is sent once, stays visible, and never triggers exit 2", async () => {
    // An auth response on a mutating request is not proof the
    // server applied nothing first (#204). The claim must therefore be sent
    // exactly once, reported as TRANSIENT (degraded, visible), and must NOT
    // promote the account to TOKEN_EXPIRED / secret rotation on that single
    // uncorroborated response.
    const store = mockClaimFetch(401);
    const summaryFile = path.join(dir, "summary-claim-401.md");
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    let output: Awaited<ReturnType<typeof runAll>>;
    try {
      output = await runAll({
        accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
        fetchImpl: store.fetchImpl,
        summary: createSummaryWriter(summaryFile),
        promoCodesPath: emptyPromoFile(),
        deadCodesPath: path.join(dir, "dead-claim-401.json"),
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const { result, exitCode } = output;
    const account = result.accounts[0]!;
    assert.equal(store.calls.claim, 1, "a side-effecting claim must never be replayed");
    assert.equal(account.tokenStatus, Outcomes.TOKEN_VALID);
    assert.equal(exitCode, 0, "one uncorroborated claim rejection is not secret-rotation evidence");
    assert.deepEqual(
      account.items.map((item) => item.outcome),
      [Outcomes.TRANSIENT],
    );
    assert.equal(account.ok, false, "the account must be reported DEGRADED, not silently green");

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.match(summary, /TRANSIENT/, "the failure must be visible in the step summary");
    assert.match(summary, /^# ⚠️ STFC Gift Redeemer — DEGRADED/m);
    assert.match(summary, /Gift claims: 0\/1/);
    assert.doesNotMatch(summary, /secret rotation/i);
    assert.match(stdout.join(""), /::warning::.*claimed=0\/1/);
  });

  it("reports 0/0 when an observed run has no gifts to claim", async () => {
    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        throw new TransientError("temporary promo redemption failure", 500);
      },
    });
    const promoCodesPath = path.join(dir, "promo-transient.txt");
    fs.writeFileSync(promoCodesPath, "TRANSIENTCODE\n", "utf8");
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    let output: Awaited<ReturnType<typeof runAll>>;
    try {
      output = await runAll({
        accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
        clientFactory: () => fake as unknown as ApiClient,
        summary: createSummaryWriter(undefined),
        promoCodesPath,
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.equal(output.exitCode, 0);
    assert.equal(output.result.accounts[0]!.items[0]!.outcome, Outcomes.NO_GIFTS_AVAILABLE);
    assert.match(stdout.join(""), /::warning::.*claimed=0\/0/);
  });

  it("tracks consecutive transient failures per gift without storing account names", async () => {
    const stateFile = path.join(dir, "degraded-state.json");
    const summaryFile = path.join(dir, "degraded-summary.md");
    const start = new Date("2026-01-01T00:00:00.000Z");
    let now = new Date(start);
    let claimCount = 0;
    let transient = true;
    let renamed = false;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 77, title: renamed ? "Localized Loyalty Chest" : "30 Day Loyalty Chest", isClaimable: true },
          { bundleId: 78, title: "30 Day Loyalty Chest", isClaimable: true },
        ],
      }),
      claimGift: async () => {
        claimCount += 1;
        if (transient) throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
        return { success: true };
      },
    });
    const options = {
      accounts: [{ name: "private-account-name", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(summaryFile),
      degradedStatePath: stateFile,
      now: () => new Date(now),
    };

    for (let streak = 1; streak <= 3; streak += 1) {
      const { exitCode } = await runAll(options);
      assert.equal(exitCode, 0, "persistent partial failures remain non-fatal");
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
        version: number;
        accounts: Record<string, Record<string, { streak: number; title: string; nextAttemptAt?: string }>>;
      };
      const giftStreaks = Object.values(state.accounts)[0]!;
      assert.equal(state.version, 3);
      assert.equal(giftStreaks["77"]!.streak, streak);
      assert.equal(giftStreaks["78"]!.streak, streak);
      assert.equal(giftStreaks["77"]!.title, renamed ? "Localized Loyalty Chest" : "30 Day Loyalty Chest");
      assert.equal(giftStreaks["78"]!.title, "30 Day Loyalty Chest");
      assert.equal(
        giftStreaks["77"]!.nextAttemptAt,
        streak === 3 ? new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() : undefined,
      );
      assert.doesNotMatch(fs.readFileSync(stateFile, "utf8"), /private-account-name/);
      renamed = true;
    }

    assert.equal(claimCount, 6);
    const alertCreates: Array<{ title: string; labels: readonly string[]; body: string }> = [];
    const alertSync = syncDegradedGiftAlert({
      statePath: stateFile,
      runUrl: "https://github.com/Jamula/stfc/actions/runs/99",
      listIssues: () => [],
      createIssue: (title, labels, body) => alertCreates.push({ title, labels, body }),
      log: () => {},
    });
    assert.equal(alertSync.status, "created");
    assert.equal(alertCreates.length, 1);
    assert.equal(alertCreates[0]!.title, DEGRADED_ALERT_TITLE);
    assert.deepEqual(alertCreates[0]!.labels, DEGRADED_ALERT_LABELS);
    assert.match(alertCreates[0]!.body, /Localized Loyalty Chest \(bundle 77\) — 3 consecutive runs/);

    now = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    fs.writeFileSync(summaryFile, "", "utf8");
    const deferred = await runAll(options);
    assert.equal(deferred.exitCode, 0);
    assert.equal(claimCount, 6, "claims remain deferred until the exact deadline");
    assert.ok(deferred.result.accounts[0]!.items.every((item) => item.deferred && item.outcome === Outcomes.TRANSIENT));
    assert.match(fs.readFileSync(summaryFile, "utf8"), /claim deferred until 2026-01-02T00:00:00\.000Z/);
    assert.match(fs.readFileSync(summaryFile, "utf8"), /STFC Gift Redeemer — DEGRADED/);

    now = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const attemptedAtDeadline = await runAll(options);
    assert.equal(attemptedAtDeadline.exitCode, 0);
    assert.equal(claimCount, 8, "the first run at the deadline attempts each gift once");
    const restartedBackoff = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
      accounts: Record<string, Record<string, { streak: number; nextAttemptAt?: string }>>;
    };
    const restartedGifts = Object.values(restartedBackoff.accounts)[0]!;
    assert.equal(restartedGifts["77"]!.streak, 4);
    assert.equal(
      restartedGifts["77"]!.nextAttemptAt,
      new Date(start.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    );

    transient = false;
    now = new Date(start.getTime() + 48 * 60 * 60 * 1000);
    const recovered = await runAll(options);
    assert.equal(recovered.exitCode, 0);
    assert.equal(claimCount, 10, "recovery claims are attempted once when the restarted backoff expires");
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {},
    });
  });

  it("retains cooldown state when a gift is omitted and defers it when it reappears", async () => {
    const stateFile = path.join(dir, "degraded-state-omitted-gift.json");
    const accountName = "omitted-gift-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    let now = new Date("2026-03-01T00:00:00.000Z");
    let giftVisible = true;
    let claims = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: giftVisible ? [{ bundleId: 77, title: "Loyalty Chest", isClaimable: true }] : [],
      }),
      claimGift: async () => {
        claims += 1;
        throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
      },
    });
    const options = {
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date(now),
    };

    for (let run = 1; run <= 3; run += 1) {
      now = new Date(`2026-03-0${run}T00:00:00.000Z`);
      await runAll(options);
    }

    now = new Date("2026-03-03T12:00:00.000Z");
    giftVisible = false;
    await runAll(options);
    assert.equal(claims, 3, "an omitted gift must not trigger another claim");
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [accountKey]: {
          "77": {
            streak: 3,
            title: "Loyalty Chest",
            nextAttemptAt: "2026-03-04T00:00:00.000Z",
          },
        },
      },
    });

    const alert = syncDegradedGiftAlert({
      state: JSON.parse(fs.readFileSync(stateFile, "utf8")),
      listIssues: () => [{ number: 42, title: DEGRADED_ALERT_TITLE, labels: DEGRADED_ALERT_LABELS }],
      createIssue: () => assert.fail("an omitted gift must not close and recreate its alert"),
      closeIssue: () => assert.fail("omission is not evidence that the gift recovered"),
      updateIssue: () => {},
      log: () => {},
    });
    assert.equal(alert.status, "already-open");

    giftVisible = true;
    now = new Date("2026-03-03T23:59:59.000Z");
    const reappeared = await runAll(options);
    assert.equal(claims, 3, "the reappearing gift remains deferred until the persisted deadline");
    assert.equal(reappeared.result.accounts[0]!.items[0]!.deferred, true);
    assert.equal(reappeared.result.accounts[0]!.items[0]!.outcome, Outcomes.TRANSIENT);
  });

  it("migrates legacy display-name streaks to stable bundle identifiers", async () => {
    const stateFile = path.join(dir, "degraded-state-legacy.json");
    const accountName = "legacy-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    const now = new Date("2026-02-01T00:00:00.000Z");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ version: 1, accounts: { [accountKey]: { "30 Day Loyalty Chest": 2 } } }),
    );
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "30 Day Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async () => {
        throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
      },
    });

    const { exitCode } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      degradedStatePath: stateFile,
      now: () => now,
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [accountKey]: {
          "77": {
            streak: 3,
            title: "30 Day Loyalty Chest",
            nextAttemptAt: "2026-02-02T00:00:00.000Z",
          },
        },
      },
    });
  });

  it("enforces the migrated v1 cooldown for legacy streaks at or above the threshold", async () => {
    for (const streak of [3, 4]) {
      const stateFile = path.join(dir, `degraded-state-v1-${streak}.json`);
      const accountName = "legacy-account";
      const accountKey = createHash("sha256").update(accountName).digest("hex");
      let now = new Date("2026-02-01T00:00:00.000Z");
      const nextAttemptAt = "2026-02-02T00:00:00.000Z";
      let includeNewBundle = false;
      let claims = 0;
      fs.writeFileSync(
        stateFile,
        JSON.stringify({ version: 1, accounts: { [accountKey]: { "30 Day Loyalty Chest": streak } } }),
      );
      const fake = makeFakeClient({
        listGifts: async () => ({
          items: [
            { bundleId: 77, title: "30 Day Loyalty Chest", isClaimable: true },
            ...(includeNewBundle ? [{ bundleId: 78, title: "30 Day Loyalty Chest", isClaimable: true }] : []),
          ],
        }),
        claimGift: async () => {
          claims += 1;
          return { success: true };
        },
      });
      const options = {
        accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
        clientFactory: () => fake as unknown as ApiClient,
        degradedStatePath: stateFile,
        now: () => new Date(now),
      };
      const expectedState = {
        version: 3,
        accounts: {
          [accountKey]: {
            "77": { streak, title: "30 Day Loyalty Chest", nextAttemptAt },
          },
        },
      };

      const migrated = await runAll(options);
      assert.equal(claims, 0, `v1 streak ${streak} must not issue a claim during migration`);
      assert.equal(migrated.exitCode, 0);
      assert.deepEqual(migrated.result.accounts[0]!.items, [{
        id: "30 Day Loyalty Chest",
        stateKey: "77",
        outcome: Outcomes.TRANSIENT,
        detail: `claim deferred until ${nextAttemptAt} after ${streak} consecutive transient failures`,
        deferred: true,
      }]);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), expectedState);

      now = new Date(Date.parse(nextAttemptAt) - 1);
      includeNewBundle = true;
      const deferred = await runAll(options);
      assert.equal(claims, 1, "a new same-title bundle must not inherit the migrated bundle's cooldown");
      assert.equal(deferred.result.accounts[0]!.items[0]!.deferred, true);
      assert.equal(deferred.result.accounts[0]!.items[1]!.stateKey, "78");
      assert.equal(deferred.result.accounts[0]!.items[1]!.outcome, Outcomes.CLAIMED);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), expectedState);

      now = new Date(nextAttemptAt);
      const recovered = await runAll(options);
      assert.equal(claims, 3, "the migrated gift and unrelated new bundle are attempted after the deadline");
      assert.equal(recovered.result.accounts[0]!.items[0]!.outcome, Outcomes.CLAIMED);
      assert.equal(recovered.result.accounts[0]!.items[1]!.outcome, Outcomes.CLAIMED);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), { version: 3, accounts: {} });
    }
  });

  it("binds a legacy cooldown to only one of two same-title bundles on the initial migration run", async () => {
    const stateFile = path.join(dir, "degraded-state-v1-same-title.json");
    const accountName = "legacy-same-title-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ version: 1, accounts: { [accountKey]: { "Loyalty Chest": 3 } } }),
    );
    const claimedBundles: Array<string | number> = [];
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 77, title: "Loyalty Chest", isClaimable: true },
          { bundleId: 78, title: "Loyalty Chest", isClaimable: true },
        ],
      }),
      claimGift: async (bundleId) => {
        claimedBundles.push(bundleId);
        return { success: true };
      },
    });

    const { result } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date("2026-02-01T00:00:00.000Z"),
    });

    assert.deepEqual(claimedBundles, [78], "only the first matching bundle inherits the legacy cooldown");
    assert.equal(result.accounts[0]!.items[0]!.stateKey, "77");
    assert.equal(result.accounts[0]!.items[0]!.deferred, true);
    assert.equal(result.accounts[0]!.items[1]!.stateKey, "78");
    assert.equal(result.accounts[0]!.items[1]!.outcome, Outcomes.CLAIMED);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [accountKey]: {
          "77": { streak: 3, title: "Loyalty Chest", nextAttemptAt: "2026-02-02T00:00:00.000Z" },
        },
      },
    });
  });

  it("migrates current v2 streaks by starting a 24-hour cooldown", async () => {
    const stateFile = path.join(dir, "degraded-state-v2.json");
    const accountName = "current-state-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    const now = new Date("2026-05-01T00:00:00.000Z");
    let claims = 0;
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 2,
        accounts: {
          [accountKey]: { "77": { streak: 3, title: "Loyalty Chest" } },
        },
      }),
    );
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async () => {
        claims += 1;
        throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
      },
    });

    const { exitCode, result } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => now,
    });

    assert.equal(exitCode, 0);
    assert.equal(claims, 0, "a migrated threshold streak must not cause an immediate claim");
    assert.equal(result.accounts[0]!.items[0]!.deferred, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [accountKey]: {
          "77": {
            streak: 3,
            title: "Loyalty Chest",
            nextAttemptAt: "2026-05-02T00:00:00.000Z",
          },
        },
      },
    });
  });

  it("preserves the existing retry deadline after a non-transient claim failure", async () => {
    const stateFile = path.join(dir, "degraded-state-unknown-result.json");
    const accountName = "unknown-result-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    const nextAttemptAt = "2026-06-01T11:00:00.000Z";
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 3,
        accounts: {
          [accountKey]: {
            "77": { streak: 3, title: "Loyalty Chest", nextAttemptAt, legacy: true },
          },
        },
      }),
    );
    let claims = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async () => {
        claims += 1;
        throw new ApiError("HTTP 400 on POST /offers/gifts/claim: Bad request.", 400);
      },
    });

    const { exitCode, result } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date("2026-06-01T12:00:00.000Z"),
    });

    assert.equal(exitCode, 0);
    assert.equal(claims, 1, "the current non-transient result is still attempted once");
    assert.equal(result.accounts[0]!.items[0]!.outcome, Outcomes.UNKNOWN_RESULT);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [accountKey]: {
          "77": { streak: 3, title: "Loyalty Chest", nextAttemptAt },
        },
      },
    });
  });

  it("starts the 24-hour cooldown when the transient failure is observed", async () => {
    const stateFile = path.join(dir, "degraded-state-failure-time.json");
    const accountName = "failure-time-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 3,
        accounts: {
          [accountKey]: { "77": { streak: 2, title: "Loyalty Chest" } },
        },
      }),
    );
    const clockTimes = [
      new Date("2026-07-01T09:00:00.000Z"),
      new Date("2026-07-01T10:00:00.000Z"),
    ];
    let clockRead = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async () => {
        throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
      },
    });

    const { exitCode } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => clockTimes[Math.min(clockRead++, clockTimes.length - 1)]!,
    });

    assert.equal(exitCode, 0);
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
      accounts: Record<string, Record<string, { streak: number; nextAttemptAt?: string }>>;
    };
    assert.equal(state.accounts[accountKey]!["77"]!.streak, 3);
    assert.equal(
      state.accounts[accountKey]!["77"]!.nextAttemptAt,
      "2026-07-02T10:00:00.000Z",
      "backoff starts from the observed failure time, not the earlier run-start time",
    );
  });

  it("keeps transient streaks isolated by account and gift identifier", async () => {
    const stateFile = path.join(dir, "degraded-state-isolation.json");
    const accounts = ["account-one", "account-two"];
    const calls = new Map<string, number>();
    let now = new Date("2026-07-01T00:00:00.000Z");
    const expectedFailures = new Map([
      ["account-one:77", true],
      ["account-one:78", false],
      ["account-two:77", false],
      ["account-two:78", false],
    ]);
    const fakeByAccount = new Map(
      accounts.map((name) => [
        name,
        makeFakeClient({
          listGifts: async () => ({
            items: [
              { bundleId: 77, title: "Shared Gift", isClaimable: true },
              { bundleId: 78, title: "Shared Gift", isClaimable: true },
            ],
          }),
          claimGift: async (bundleId: number) => {
            const key = `${name}:${bundleId}`;
            calls.set(key, (calls.get(key) ?? 0) + 1);
            if (expectedFailures.get(key)) {
              throw new TransientError("Server error 500 on POST /offers/gifts/claim", 500);
            }
            return { success: true, bundleId };
          },
        }),
      ]),
    );

    for (let run = 1; run <= 3; run += 1) {
      now = new Date(`2026-07-0${run}T00:00:00.000Z`);
      const { exitCode } = await runAll({
        accounts: accounts.map((name) => ({ name, token: makeJwt({ exp: 9999999999 }) })),
        clientFactory: (account) => fakeByAccount.get(account.name)! as unknown as ApiClient,
        degradedStatePath: stateFile,
        now: () => new Date(now),
      });
      assert.equal(exitCode, 0);
    }

    const oneKey = createHash("sha256").update("account-one").digest("hex");
    now = new Date("2026-07-03T12:00:00.000Z");
    const duringCooldown = await runAll({
      accounts: accounts.map((name) => ({ name, token: makeJwt({ exp: 9999999999 }) })),
      clientFactory: (account) => fakeByAccount.get(account.name)! as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date(now),
    });
    assert.equal(duringCooldown.exitCode, 0);
    assert.equal(
      duringCooldown.result.accounts[0]!.items[0]!.deferred,
      true,
      "account-one bundle 77 must remain deferred",
    );
    assert.equal(calls.get("account-one:77"), 3, "the deferred gift claim must not be sent again");
    assert.equal(calls.get("account-one:78"), 4, "a different gift in the same account must still be claimed");
    assert.equal(calls.get("account-two:77"), 4, "the same bundle in another account must still be claimed");
    assert.equal(calls.get("account-two:78"), 4, "the second account's unrelated gift remains independent");
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [oneKey]: {
          "77": {
            streak: 3,
            title: "Shared Gift",
            nextAttemptAt: "2026-07-04T00:00:00.000Z",
          },
        },
      },
    });
  });

  it("clears threshold streaks on ALREADY_CLAIMED and AT_MAX outcomes", async () => {
    const stateFile = path.join(dir, "degraded-state-benign-recovery.json");
    const accountName = "benign-recovery-account";
    const accountKey = createHash("sha256").update(accountName).digest("hex");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 3,
        accounts: {
          [accountKey]: {
            "77": {
              streak: 3,
              title: "Already Claimed Gift",
              nextAttemptAt: "2026-08-01T00:00:00.000Z",
            },
            "78": {
              streak: 4,
              title: "At Max Gift",
              nextAttemptAt: "2026-08-01T00:00:00.000Z",
            },
          },
        },
      }),
    );
    let claims = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [
          { bundleId: 77, title: "Already Claimed Gift", isClaimable: true },
          { bundleId: 78, title: "At Max Gift", isAtMax: true },
        ],
      }),
      claimGift: async () => {
        claims += 1;
        throw new ApiError("HTTP 404 on POST /offers/gifts/claim: Bundle not available.", 404);
      },
    });

    const { exitCode, result } = await runAll({
      accounts: [{ name: accountName, token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });

    assert.equal(exitCode, 0);
    assert.equal(claims, 1, "ALREADY_CLAIMED is established by one claim attempt; AT_MAX is skipped");
    assert.deepEqual(
      result.accounts[0]!.items.map(({ stateKey, outcome }) => ({ stateKey, outcome })),
      [
        { stateKey: "77", outcome: Outcomes.ALREADY_CLAIMED },
        { stateKey: "78", outcome: Outcomes.AT_MAX },
      ],
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), { version: 3, accounts: {} });
  });

  it("does not reset a gift streak when the gift list was not observed", async () => {
    const stateFile = path.join(dir, "degraded-state-unobserved.json");
    const configuredAccountKey = createHash("sha256").update("main").digest("hex");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        version: 2,
        accounts: {
          [configuredAccountKey]: {
            "77": { streak: 2, title: "30 Day Loyalty Chest" },
          },
          removedAccount: {
            "88": { streak: 3, title: "Removed Gift" },
          },
        },
      }),
    );
    const fake = makeFakeClient({
      listGifts: async () => {
        throw new TransientError("Server error 500 on GET /offers/gifts", 500);
      },
    });

    const { exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      degradedStatePath: stateFile,
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    assert.equal(exitCode, 0, "transient GET behavior remains partial success");
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
      version: 3,
      accounts: {
        [configuredAccountKey]: {
          "77": { streak: 2, title: "30 Day Loyalty Chest" },
        },
      },
    });
  });

  it("initializes missing state and blocks claims when persistent state is unreadable", async () => {
    const stateFile = path.join(dir, "missing-degraded-state.json");
    let claims = 0;
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "Daily Gift", isClaimable: true }],
      }),
      claimGift: async () => {
        claims += 1;
        return { success: true };
      },
    });

    const initialized = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: stateFile,
      now: () => new Date("2026-04-01T00:00:00.000Z"),
    });
    assert.equal(initialized.exitCode, 0);
    assert.equal(claims, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), { version: 3, accounts: {} });

    const unreadablePath = path.join(dir, "state-is-a-directory");
    fs.mkdirSync(unreadablePath);
    const blocked = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      degradedStatePath: unreadablePath,
      summary: createSummaryWriter(path.join(dir, "state-unreadable-summary.md")),
    });
    assert.equal(blocked.exitCode, 1);
    assert.equal(claims, 1, "an unreadable state file must prevent claim POSTs");
    assert.equal(blocked.result.errors.length, 1);
    assert.match(blocked.result.errors[0]!.message, /could not load persistent degraded-gift state/);
    assert.equal(blocked.result.accounts[0]!.items[0]!.outcome, Outcomes.UNKNOWN_RESULT);
    assert.match(
      fs.readFileSync(path.join(dir, "state-unreadable-summary.md"), "utf8"),
      /persistent degraded-gift state is unavailable; claim not attempted/,
    );
  });

  it("does not prune state when account processing is skipped by a promo-code file error", async () => {
    const stateFile = path.join(dir, "degraded-state-unprocessed.json");
    const invalidPromoCodesPath = path.join(dir, "promo-codes-directory");
    fs.mkdirSync(invalidPromoCodesPath);
    const originalState = {
      version: 2,
      accounts: {
        previousAccount: {
          "88": { streak: 3, title: "Previous Gift" },
        },
      },
    };
    fs.writeFileSync(stateFile, JSON.stringify(originalState));

    const { exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      promoCodesPath: invalidPromoCodesPath,
      degradedStatePath: stateFile,
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), originalState);
  });

  it("a successful claim still goes through in exactly one call", async () => {
    const store = mockClaimFetch(200);

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      fetchImpl: store.fetchImpl,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
      deadCodesPath: path.join(dir, "dead-claim-ok.json"),
    });

    const account = result.accounts[0]!;
    assert.equal(store.calls.claim, 1);
    assert.equal(account.ok, true);
    assert.equal(exitCode, 0);
    assert.deepEqual(
      account.items.map((item) => item.outcome),
      [Outcomes.CLAIMED],
    );
  });

  it("auth/me 200 but gifts/list rejects twice → TOKEN_EXPIRED and exitCode 2", async () => {
    const store = mockStoreFetch([401, 401]);
    const summaryFile = path.join(dir, "summary-store-401.md");
    const codeFile = path.join(dir, "promo-store-401.txt");
    fs.writeFileSync(codeFile, "SHOULDNOTBETRIED\n", "utf8");

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      fetchImpl: store.fetchImpl,
      summary: createSummaryWriter(summaryFile),
      promoCodesPath: codeFile,
      deadCodesPath: path.join(dir, "dead-store-401.json"),
    });

    const account = result.accounts[0]!;
    assert.equal(account.ok, false, "account must not report ok when the store rejects the token");
    assert.equal(account.tokenStatus, Outcomes.TOKEN_EXPIRED);
    assert.equal(exitCode, 2, "a dead token must ask for secret rotation, not exit 0");
    assert.equal(account.promoCodes.length, 0, "promo codes must not be burned against a dead token");
    assert.equal(store.calls.auth, 1);
    assert.equal(store.calls.gifts, 2);

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.match(summary, /secret rotation/i);
  });

  it("records TRANSIENT after a single transient gift-claim failure without replaying the POST", async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 77, title: "30 Day Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async (bundleId: number) => {
        attempts += 1;
        if (attempts === 1) {
          throw new TransientError(`Server error 500 on POST /offers/gifts/claim (${bundleId})`, 500);
        }
        return { success: true, bundleId };
      },
    });

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(attempts, 1);
    assert.deepEqual(sleepCalls, []);
    assert.equal(result.accounts[0]?.items[0]?.outcome, Outcomes.TRANSIENT);
    assert.equal(result.accounts[0]?.ok, false);
  });

  it("does not retry non-transient gift-claim failures", async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];
    const fake = makeFakeClient({
      listGifts: async () => ({
        items: [{ bundleId: 88, title: "7 Day Loyalty Chest", isClaimable: true }],
      }),
      claimGift: async () => {
        attempts += 1;
        throw new ApiError("HTTP 400 on POST /offers/gifts/claim: Bad request.", 400);
      },
    });

    const { result, exitCode } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: emptyPromoFile(),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(attempts, 1);
    assert.deepEqual(sleepCalls, []);
    assert.equal(result.accounts[0]?.items[0]?.outcome, Outcomes.UNKNOWN_RESULT);
    assert.equal(result.accounts[0]?.ok, false);
  });

  it("promo codes mix: success / used / invalid / unknown classified correctly", async () => {    const codeFile = path.join(dir, "promo.txt");
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

  for (const kind of ["promo", "gift"] as const) {
    it(`reports an unreadable successful ${kind} response as an error without replaying the POST`, async () => {
      const codeFile = path.join(dir, "promo-body-timeout.txt");
      fs.writeFileSync(codeFile, kind === "promo" ? "ONE-SIDE-EFFECT\n" : "", "utf8");
      const summaryFile = path.join(dir, `${kind}-body-timeout-summary.md`);
      const syntheticSecret = "syntheticBearerSecret";
      let postCount = 0;
      const apiClient = new ApiClient({
        token: "synthetic.test.token",
        baseUrl: "https://example.test/api/v2",
        fetchImpl: (async (input, init) => {
          const url = String(input);
          if (url.endsWith("/auth/me")) {
            return new Response('{"id":1,"level":50}', {
              status: 200, headers: { "content-type": "application/json" },
            });
          }
          if (url.includes("/offers/gifts?available=true")) {
            return new Response(JSON.stringify({
              items: kind === "gift" ? [{ bundleId: 4242, title: "Daily Gift" }] : [],
            }), { status: 200, headers: { "content-type": "application/json" } });
          }
          const endpoint = kind === "promo" ? "/redeem/claim" : "/offers/gifts/claim";
          assert.ok(url.endsWith(endpoint), `unexpected request path: ${url}`);
          assert.equal(init?.method, "POST");
          postCount += 1;
          const response = new Response(null, {
            status: 200, headers: { "content-type": "application/json" },
          });
          Object.defineProperty(response, "text", {
            value: async () => {
              throw new DOMException(`synthetic body timeout Authorization: Bearer ${syntheticSecret}`, "TimeoutError");
            },
          });
          return response;
        }) as typeof fetch,
      });
      const errors: string[] = [];
      const originalError = console.error;
      let output: Awaited<ReturnType<typeof runAll>>;
      try {
        console.error = (...parts: unknown[]) => { errors.push(parts.join(" ")); };
        output = await runAll({
          accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
          clientFactory: () => apiClient,
          promoCodesPath: codeFile,
          deadCodesPath: path.join(dir, "dead-body-timeout.json"),
          summary: createSummaryWriter(summaryFile),
        });
      } finally {
        console.error = originalError;
      }

      const { result, exitCode } = output;
      const account = result.accounts[0]!;
      const item = kind === "promo" ? account.promoCodes[0] : account.items[0];
      assert.equal(postCount, 1, "an ambiguous successful POST must never be replayed");
      assert.equal(item?.outcome, Outcomes.UNKNOWN_RESULT);
      assert.match(item?.detail ?? "", /HTTP 200 response body/);
      assert.equal(account.ok, false);
      assert.equal(exitCode, 1);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!.message, /HTTP 200 response body/);
      const summary = fs.readFileSync(summaryFile, "utf8");
      for (const visible of [result.errors[0]!.message, summary, errors.join("\n")]) {
        assert.match(visible, /HTTP 200 response body/);
        assert.doesNotMatch(visible, new RegExp(syntheticSecret));
        assert.match(visible, /\[REDACTED\]/);
      }
      assert.match(summary, /Infrastructure errors/);
      assert.match(summary, /UNKNOWN_RESULT/);
    });
  }

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

  it("a rejected promo-code redeem is sent once, never replayed as a transient retry", async () => {
    // ApiClient.request() reports an uncorroborated 401/403 on this
    // side-effecting POST as a TransientError so it stays visible (see
    // client.ts's replay policy comment), but that must not make
    // processOneCode's transient-retry loop resend it — the request already
    // had its one and only send, per #204/#243.
    const codeFile = path.join(dir, "promo.txt");
    const deadCodesPath = path.join(dir, "promo-code-dead.json");
    fs.writeFileSync(codeFile, "AUTHFLAKY\n", "utf8");
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        attempts += 1;
        throw new TransientError(
          "Authentication rejected (401) on POST /redeem/claim; POST is not safe to replay, " +
            "so this rejection is reported as transient rather than corroborated token expiry",
          401,
        );
      },
    });

    const { result } = await runAll({
      accounts: [{ name: "main", token: makeJwt({ exp: 9999999999 }) }],
      clientFactory: () => fake as unknown as ApiClient,
      promoCodesPath: codeFile,
      deadCodesPath,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(attempts, 1, "an uncorroborated auth rejection on a promo-code POST must never be replayed");
    assert.deepEqual(sleepCalls, []);
    assert.equal(result.accounts[0]?.promoCodes[0]?.outcome, Outcomes.TRANSIENT);
    assert.equal(fs.existsSync(deadCodesPath), false, "an uncorroborated auth rejection must not mark the code dead");
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

  it("caps Retry-After at 60s to prevent hostile-server stalls", async () => {
    const codeFile = path.join(dir, "promo.txt");
    fs.writeFileSync(codeFile, "CAPCODE\n", "utf8");
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        attempts += 1;
        if (attempts === 1) {
          // Hostile server returns Retry-After: 86400 (1 day in seconds → 86400000 ms)
          throw new ApiError("HTTP 429", 429, { retryAfterMs: 86_400_000 });
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
    assert.ok(sleepCalls[0] !== undefined && sleepCalls[0] <= 60_000, `expected sleep ≤ 60000ms, got ${sleepCalls[0]}`);
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

  it("gifts/list schema mismatch degrades that account and skips its promo codes", async () => {
    const codeFile = path.join(dir, "promo-schema-mismatch.txt");
    fs.writeFileSync(codeFile, "PROMOCODE\n", "utf8");

    let failedAccountRedemptions = 0;
    let healthyAccountRedemptions = 0;
    const badFake = makeFakeClient({
      listGifts: async () => {
        throw new SchemaMismatchError("unexpected gifts/list payload");
      },
      redeemCode: async () => {
        failedAccountRedemptions += 1;
        return { code: 0, message: "redeem_success" };
      },
    });
    const healthyFake = makeFakeClient({
      listGifts: async () => ({ items: [] }),
      redeemCode: async () => {
        healthyAccountRedemptions += 1;
        return { code: 0, message: "redeem_success" };
      },
    });

    const { result, exitCode } = await runAll({
      accounts: [
        { name: "bad", token: makeJwt({ exp: 9999999999 }) },
        { name: "healthy", token: makeJwt({ exp: 9999999999 }) },
      ],
      clientFactory: (account) => (account.name === "bad" ? badFake : healthyFake) as unknown as ApiClient,
      summary: createSummaryWriter(undefined),
      promoCodesPath: codeFile,
      deadCodesPath: path.join(dir, "dead-schema-mismatch.json"),
    });

    const badAccount = result.accounts.find((account) => account.name === "bad")!;
    const healthyAccount = result.accounts.find((account) => account.name === "healthy")!;
    assert.equal(badAccount.ok, false);
    assert.match(badAccount.items[0]?.detail ?? "", /gifts\/list schema mismatch/);
    assert.equal(badAccount.promoCodes.length, 0);
    assert.equal(failedAccountRedemptions, 0);
    assert.equal(healthyAccount.ok, true);
    assert.equal(healthyAccount.promoCodes[0]?.outcome, Outcomes.CODE_REDEEMED);
    assert.equal(healthyAccountRedemptions, 1);
    assert.ok(result.errors.some((error) => /gifts\/list schema mismatch/.test(error.message)));
    assert.equal(exitCode, 1);
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
