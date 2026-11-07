import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, TokenExpiredError } from "../../src/api/client.ts";
import type { Account } from "../../src/lib/accounts.ts";
import type { Gift } from "../../src/api/schemas.ts";
import { checkAuth } from "../../src/skills/checkAuth.ts";
import { claimGifts } from "../../src/skills/claimGifts.ts";
import { listGifts } from "../../src/skills/listGifts.ts";
import { Outcomes } from "../../src/lib/outcomes.ts";

const originalLog = console.log;
const originalError = console.error;
const secret = "supersecret.JWTish-token.AAAAAAAA";

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

function makeToken(
  exp = Math.floor(Date.now() / 1000) + 86_400,
  marker = "fixture",
): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp, marker })).toString("base64url");
  return `${header}.${payload}.signatureSegment`;
}

function withSecretAuthorization<TArgs extends unknown[], TResult>(
  operation: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Authorization:")) {
        throw new Error(`Authorization: Bearer ${secret}`);
      }
      throw error;
    }
  };
}

function makeClient(overrides: {
  getMe?: ApiClient["getMe"];
  listGifts?: ApiClient["listGifts"];
  claimGift?: ApiClient["claimGift"];
}): ApiClient {
  const client = new ApiClient({
    token: "fixture.token.value",
    fetchImpl: async () => {
      throw new Error("Unexpected network request");
    },
  });
  if (overrides.getMe) client.getMe = withSecretAuthorization(overrides.getMe);
  if (overrides.listGifts) client.listGifts = withSecretAuthorization(overrides.listGifts);
  if (overrides.claimGift) client.claimGift = withSecretAuthorization(overrides.claimGift);
  return client;
}

function captureConsole(): string[] {
  const lines: string[] = [];
  console.log = (...parts) => lines.push(parts.map(String).join(" "));
  console.error = (...parts) => lines.push(parts.map(String).join(" "));
  return lines;
}

describe("diagnostic skills", () => {
  it("checkAuth reports valid, expired, malformed-token, and sanitized error outcomes", async () => {
    const accounts: Account[] = [
      { name: "valid", token: makeToken(Math.floor(Date.now() / 1000) + 90_000, "valid") },
      { name: "expired", token: makeToken(Math.floor(Date.now() / 1000) - 60, "expired") },
      { name: "malformed", token: "not-a-jwt" },
      { name: "error", token: makeToken(undefined, "error") },
    ];
    const clients = new Map<string, ApiClient>([
      [accounts[0]!.token, makeClient({ getMe: async () => ({}) })],
      [
        accounts[1]!.token,
        makeClient({ getMe: async () => { throw new TokenExpiredError("expired"); } }),
      ],
      [accounts[2]!.token, makeClient({ getMe: async () => ({}) })],
      [
        accounts[3]!.token,
        makeClient({ getMe: async () => { throw new Error(`Authorization: Bearer ${secret}`); } }),
      ],
    ]);
    const logs = captureConsole();

    const output = await checkAuth({
      accounts,
      clientFactory: (token) => clients.get(token)!,
    });

    assert.equal(output.exitCode, 0);
    assert.deepEqual(
      output.result.rows.map(({ accountName, status }) => ({ accountName, status })),
      [
        { accountName: "valid", status: "OK" },
        { accountName: "expired", status: "TOKEN_EXPIRED" },
        { accountName: "malformed", status: "OK" },
        { accountName: "error", status: "ERROR" },
      ],
    );
    assert.match(output.result.rows[0]!.detail, /^expires in \d+ (day|days)$/);
    assert.match(output.result.rows[1]!.detail, /^EXPIRED /);
    assert.equal(output.result.rows[2]!.detail, "(could not decode)");
    assert.match(output.result.rows[3]!.detail, /\[REDACTED\]/);
    assert.equal(`${output.result.rows[3]!.detail} ${logs.join(" ")}`.includes(secret), false);
  });

  it("listGifts formats camelCase and snake_case flags and captures per-account failures", async () => {
    const accounts: Account[] = [
      { name: "catalog", token: makeToken(undefined, "catalog") },
      { name: "empty", token: makeToken(undefined, "empty") },
      { name: "failed", token: makeToken(undefined, "failed") },
    ];
    const gifts: Gift[] = [
      { bundleId: 101, title: "Daily", isClaimable: true },
      {
        bundle_id: "legacy",
        title: "Legacy",
        isClaimable: false,
        is_claimable: 1,
        isClaimed: false,
        is_claimed: 1,
        isSpecial: 0,
        is_special: 1,
        hasCost: 0,
        has_cost: 1,
        isAtMax: false,
        is_at_max: 1,
      },
      { id: 3 },
      {},
    ];
    const clients = new Map<string, ApiClient>([
      [accounts[0]!.token, makeClient({ listGifts: async () => gifts })],
      [accounts[1]!.token, makeClient({ listGifts: async () => [] })],
      [
        accounts[2]!.token,
        makeClient({ listGifts: async () => { throw new Error(`Authorization: Bearer ${secret}`); } }),
      ],
    ]);
    const logs = captureConsole();

    const output = await listGifts({
      accounts,
      clientFactory: (token) => clients.get(token)!,
    });

    assert.equal(output.exitCode, 0);
    assert.deepEqual(output.result.rows, [
      { accountName: "catalog", gifts },
      { accountName: "empty", gifts: [] },
      {
        accountName: "failed",
        gifts: [],
        error: "Error: Authorization: [REDACTED]",
      },
    ]);
    assert.ok(logs.some((line) => line.includes("id=101 title=Daily [claimable]")));
    assert.ok(
      logs.some((line) =>
        line.includes("id=legacy title=Legacy [claimable,claimed,special,has-cost,at-max]"),
      ),
    );
    assert.ok(logs.some((line) => line.includes("id=3 title=(no title)")));
    assert.ok(logs.some((line) => line.includes("id=? title=(no title)")));
    assert.ok(logs.some((line) => line.includes("[empty] 0 gift(s):")));
    assert.equal(`${JSON.stringify(output)} ${logs.join(" ")}`.includes(secret), false);
  });

  it("claimGifts records skip, missing-ID, success, and sanitized claim/list errors", async () => {
    const accounts: Account[] = [
      { name: "main", token: makeToken(undefined, "main") },
      { name: "unavailable", token: makeToken(undefined, "unavailable") },
    ];
    const gifts: Gift[] = [
      { title: "Already claimed", isClaimed: true },
      { title: "Missing ID" },
      { title: "Claimed", bundleId: 7 },
      { title: "Rejected", bundle_id: "8" },
      { id: 9 },
      { title: "", bundleId: 10 },
      {},
    ];
    const claimedIds: Array<number | string> = [];
    const clients = new Map<string, ApiClient>([
      [
        accounts[0]!.token,
        makeClient({
          listGifts: async () => gifts,
          claimGift: async (id) => {
            claimedIds.push(id);
            if (id === "8") throw new Error(`Authorization: Bearer ${secret}`);
            return { bundleId: id };
          },
        }),
      ],
      [
        accounts[1]!.token,
        makeClient({ listGifts: async () => { throw new Error("Authorization: fixture"); } }),
      ],
    ]);
    const logs = captureConsole();

    const output = await claimGifts({
      accounts,
      clientFactory: (token) => clients.get(token)!,
    });

    assert.equal(output.exitCode, 0);
    assert.deepEqual(output.result.rows[0]!.attempts, [
      { giftLabel: "Already claimed", outcome: Outcomes.ALREADY_CLAIMED },
      { giftLabel: "Missing ID", outcome: "ERROR", detail: "no bundleId/bundle_id/id field" },
      { giftLabel: "Claimed", outcome: Outcomes.CLAIMED },
      {
        giftLabel: "Rejected",
        outcome: "ERROR",
        detail: "Error: Authorization: [REDACTED]",
      },
      { giftLabel: "9", outcome: Outcomes.CLAIMED },
      { giftLabel: "10", outcome: Outcomes.CLAIMED },
      { giftLabel: "(unnamed)", outcome: "ERROR", detail: "no bundleId/bundle_id/id field" },
    ]);
    assert.deepEqual(claimedIds, [7, "8", 9, 10]);
    assert.deepEqual(output.result.rows[1], {
      accountName: "unavailable",
      attempts: [],
      error: "Error: Authorization: [REDACTED]",
    });
    assert.ok(logs.some((line) => line.includes("Authorization: [REDACTED]")));
    assert.equal(`${JSON.stringify(output)} ${logs.join(" ")}`.includes(secret), false);
  });
});
