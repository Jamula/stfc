// T016 [US1] — redeemer-seam tests. Asserts the new extraCandidates path
// merges correctly with promo-codes.txt and the (a) existing seam function
// names are preserved, (b) the forbidden name `loadPromoCodes` is absent
// (Tuvok corrections memo P1-6), (c) the new `readCodesForRun` wrapper is
// exported.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parsePromoCodes,
  readCodesForRun,
  readPromoCodes,
} from "../../src/lib/promoCodes.ts";
import * as promoCodesModule from "../../src/lib/promoCodes.ts";
import * as redeemCodesModule from "../../src/skills/redeemCodes.ts";
import { redeemCodes } from "../../src/skills/redeemCodes.ts";
import { ApiClient } from "../../src/api/client.ts";
import { Outcomes } from "../../src/lib/outcomes.ts";

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

function makeFakeClient(redeemed: Map<string, { code?: number; message?: string }>) {
  return {
    getMe: async () => ({ id: 1, level: 50 }),
    listGifts: async () => ({ items: [] }),
    listAllGifts: async () => ({ items: [] }),
    claimGift: async () => ({ success: true }),
    redeemCode: async (code: string) =>
      redeemed.get(code) ?? { message: "redeem_success", code: 0 },
  } as unknown as ApiClient;
}

describe("promo-codes seam: import surface", () => {
  it("readPromoCodes is exported (unchanged name)", () => {
    assert.equal(typeof readPromoCodes, "function");
  });

  it("parsePromoCodes is exported (unchanged name)", () => {
    assert.equal(typeof parsePromoCodes, "function");
  });

  it("readCodesForRun is exported (new wrapper from T023)", () => {
    assert.equal(typeof readCodesForRun, "function");
  });

  it("loadPromoCodes is NOT exported (Tuvok P1-6: this name MUST NOT appear)", () => {
    assert.equal(
      (promoCodesModule as Record<string, unknown>)["loadPromoCodes"],
      undefined,
      "the name `loadPromoCodes` MUST NOT exist anywhere in src/lib/promoCodes.ts",
    );
  });

  it("the redeemCodes skill imports readPromoCodes (or readCodesForRun), NOT loadPromoCodes", () => {
    // Source-level grep: the import line at redeemCodes.ts:9 (per Tuvok memo)
    // must reference readPromoCodes / readCodesForRun, never loadPromoCodes.
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "src", "skills", "redeemCodes.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /\bloadPromoCodes\b/, "must not reference loadPromoCodes");
    assert.match(src, /\b(readPromoCodes|readCodesForRun)\b/);
  });

  it("redeemCodes module accepts extraCandidates in its options", () => {
    // Structural assertion: TS types are erased at runtime, so we just verify
    // the export shape compiles + that the function accepts the new opt.
    assert.equal(typeof redeemCodesModule.redeemCodes, "function");
  });
});

describe("readCodesForRun (T023)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-readcfr-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("file codes first, then extras, dedup by trim+uppercase", async () => {
    const file = path.join(dir, "promo.txt");
    fs.writeFileSync(file, "FILECODE1\nFILECODE2\n", "utf8");
    const out = await readCodesForRun({
      promoCodesPath: file,
      extraCandidates: ["EXTRA1", " filecode1 ", "extra2"],
    });
    // FILECODE1 from file wins; "  filecode1 " dedups against it (case-insensitive trim).
    // EXTRA1, extra2 normalized too.
    assert.deepEqual(out, ["FILECODE1", "FILECODE2", "EXTRA1", "EXTRA2"]);
  });

  it("works with no extras (file only)", async () => {
    const file = path.join(dir, "promo.txt");
    fs.writeFileSync(file, "ALONE\n", "utf8");
    const out = await readCodesForRun({ promoCodesPath: file });
    assert.deepEqual(out, ["ALONE"]);
  });

  it("works with no file (extras only)", async () => {
    const out = await readCodesForRun({
      extraCandidates: ["EXTRA1", "EXTRA2"],
    });
    assert.deepEqual(out, ["EXTRA1", "EXTRA2"]);
  });

  it("works with neither (returns [])", async () => {
    const out = await readCodesForRun();
    assert.deepEqual(out, []);
  });
});

describe("redeemCodes seam (T023)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stfc-redeem-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("extraCandidates are merged after promo-codes.txt and submitted via the client", async () => {
    const file = path.join(dir, "promo.txt");
    fs.writeFileSync(file, "FILECODE\n", "utf8");
    const seen: string[] = [];
    const client = {
      getMe: async () => ({ id: 1 }),
      listGifts: async () => ({ items: [] }),
      redeemCode: async (code: string) => {
        seen.push(code);
        return { code: 0, message: "redeem_success" };
      },
    } as unknown as ApiClient;

    const { result, exitCode } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      promoCodesPath: file,
      extraCandidates: ["EXTRA1", "EXTRA2"],
      clientFactory: () => client,
    });

    assert.equal(exitCode, 0);
    // Order: file first, extras after (deterministic per readCodesForRun).
    assert.deepEqual(seen, ["FILECODE", "EXTRA1", "EXTRA2"]);
    const attempts = result.rows[0]!.attempts.map((a) => a.code);
    assert.deepEqual(attempts, ["FILECODE", "EXTRA1", "EXTRA2"]);
  });

  it("extraCandidates dedup against file entries (no double-submit)", async () => {
    const file = path.join(dir, "promo.txt");
    fs.writeFileSync(file, "SHARED\n", "utf8");
    const seen: string[] = [];
    const client = makeFakeClient(new Map());
    (client as unknown as { redeemCode: (c: string) => Promise<unknown> }).redeemCode = async (
      code: string,
    ) => {
      seen.push(code);
      return { code: 0, message: "redeem_success" };
    };

    await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      promoCodesPath: file,
      extraCandidates: ["SHARED", "FRESH"],
      clientFactory: () => client,
    });

    // SHARED submitted ONCE (from file); FRESH submitted ONCE (from extras).
    assert.deepEqual(seen, ["SHARED", "FRESH"]);
  });

  it("no-arg call (no extraCandidates, no path) still works — no regression", async () => {
    const seen: string[] = [];
    const client = {
      redeemCode: async (code: string) => {
        seen.push(code);
        return { code: 0, message: "redeem_success" };
      },
    } as unknown as ApiClient;

    const { result, exitCode } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      clientFactory: () => client,
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(seen, []);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0]!.attempts, []);
  });

  it("classifies redeem outcomes correctly (regression for outcomes mapping)", async () => {
    const client = {
      redeemCode: async (code: string) => {
        if (code === "GOOD") return { code: 0, message: "redeem_success" };
        if (code === "USED") return { message: "redeem_error_code_used_before" };
        return { message: "unknown" };
      },
    } as unknown as ApiClient;
    const { result } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      extraCandidates: ["GOOD", "USED", "WEIRD"],
      clientFactory: () => client,
    });
    const byCode = new Map(result.rows[0]!.attempts.map((a) => [a.code, a.outcome] as const));
    assert.equal(byCode.get("GOOD"), Outcomes.CODE_REDEEMED);
    assert.equal(byCode.get("USED"), Outcomes.CODE_ALREADY_USED);
    assert.equal(byCode.get("WEIRD"), Outcomes.UNKNOWN_RESULT);
  });

  // Regression for issue #209: live API returns numeric redeem_result (not code).
  // A successful Discord-discovered code must be classified CODE_REDEEMED, not
  // UNKNOWN_RESULT, so it is never put into Discord cooldown/suppression.
  it("#209: numeric redeem_result=0 (no legacy code field) → CODE_REDEEMED, not UNKNOWN_RESULT", async () => {
    const client = {
      redeemCode: async (_code: string) => ({
        // Simulate live API response: only redeem_result present, no code field.
        redeem_result: 0,
        promo_code: "DISCORD123",
      }),
    } as unknown as ApiClient;

    const { result } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      extraCandidates: ["DISCORD123"],
      clientFactory: () => client,
    });

    const attempt = result.rows[0]!.attempts[0]!;
    assert.equal(
      attempt.outcome,
      Outcomes.CODE_REDEEMED,
      "numeric redeem_result=0 must classify as CODE_REDEEMED (not UNKNOWN_RESULT)",
    );
  });

  it("#209: numeric redeem_result=0 with no message is not classified as UNKNOWN_RESULT", async () => {
    const client = {
      redeemCode: async (_code: string) => ({ redeem_result: 0 }),
    } as unknown as ApiClient;

    const { result } = await redeemCodes({
      accounts: [{ name: "discord", token: makeJwt() }],
      extraCandidates: ["TESTCODE"],
      clientFactory: () => client,
    });

    assert.notEqual(
      result.rows[0]!.attempts[0]!.outcome,
      Outcomes.UNKNOWN_RESULT,
      "successful redeem via numeric redeem_result must never produce UNKNOWN_RESULT",
    );
  });

  it("#209: redeem_result takes precedence over legacy code when both present", async () => {
    // Edge case: both fields present — redeem_result (live) wins over code (legacy).
    const client = {
      redeemCode: async (_code: string) => ({
        redeem_result: 0, // success
        code: 3,         // legacy field would have been CODE_INVALID_OR_EXPIRED
      }),
    } as unknown as ApiClient;

    const { result } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      extraCandidates: ["AMBIGUOUS"],
      clientFactory: () => client,
    });

    assert.equal(
      result.rows[0]!.attempts[0]!.outcome,
      Outcomes.CODE_REDEEMED,
      "redeem_result=0 must win over legacy code=3 when both are present",
    );
  });

  it("#209: legacy code field still works when redeem_result is absent (backward compat)", async () => {
    const client = {
      redeemCode: async (_code: string) => ({ code: 0, message: "redeem_success" }),
    } as unknown as ApiClient;

    const { result } = await redeemCodes({
      accounts: [{ name: "main", token: makeJwt() }],
      extraCandidates: ["LEGACY"],
      clientFactory: () => client,
    });

    assert.equal(
      result.rows[0]!.attempts[0]!.outcome,
      Outcomes.CODE_REDEEMED,
      "legacy code=0 fallback must still classify as CODE_REDEEMED",
    );
  });
});
