// Diagnostic skill: walks promo-codes.txt against each account.
// Always exits 0; the orchestrator (run-all) is what CI actually runs.

import type { Account } from "../lib/accounts.ts";
import { ApiClient } from "../api/client.ts";
import { redeemCode as apiRedeemCode } from "../api/endpoints.ts";
import { createLogger } from "../lib/logger.ts";
import { classifyRedeemResult, type Outcome } from "../lib/outcomes.ts";
import { PromoCodesFileError, readCodesForRun } from "../lib/promoCodes.ts";
import { redactForLog } from "../lib/redact.ts";

const log = createLogger("redeemCodes");

export interface RedeemCodesOptions {
  accounts: Account[];
  promoCodesPath?: string;
  /** T023: Discord-monitor candidates merged after the static file. */
  extraCandidates?: string[];
  clientFactory?: (token: string) => ApiClient;
  fetchImpl?: typeof fetch;
}

export interface RedeemAttempt {
  code: string;
  outcome: Outcome | "ERROR";
  detail?: string;
}

export interface RedeemCodesRow {
  accountName: string;
  attempts: RedeemAttempt[];
  error?: string;
}

export interface RedeemCodesOutput {
  result: { rows: RedeemCodesRow[] };
  exitCode: number;
}

export async function redeemCodes(opts: RedeemCodesOptions): Promise<RedeemCodesOutput> {
  const factory = opts.clientFactory ?? ((token: string) => new ApiClient({ token, fetchImpl: opts.fetchImpl }));
  const rows: RedeemCodesRow[] = [];

  let codes: string[] = [];
  try {
    codes = await readCodesForRun({
      promoCodesPath: opts.promoCodesPath,
      extraCandidates: opts.extraCandidates,
    });
  } catch (err) {
    if (err instanceof PromoCodesFileError) {
      const detail = redactForLog(err);
      log.error(`could not read promo codes: ${detail}`);
      for (const account of opts.accounts) {
        rows.push({ accountName: account.name, attempts: [], error: detail });
      }
      return { result: { rows }, exitCode: 0 };
    }
    throw err;
  }

  if (codes.length === 0) {
    log.info("no promo codes to redeem");
  }

  for (const account of opts.accounts) {
    const client = factory(account.token);
    const attempts: RedeemAttempt[] = [];
    for (const code of codes) {
      attempts.push(await tryRedeem(client, account.name, code));
    }
    rows.push({ accountName: account.name, attempts });
  }

  return { result: { rows }, exitCode: 0 };
}

async function tryRedeem(client: ApiClient, accountName: string, code: string): Promise<RedeemAttempt> {
  try {
    const res = await apiRedeemCode(client, code);
    const outcome = classifyRedeemResult({ code: res.code, message: res.message });
    log.info(`[${accountName}] code "${code}" → ${outcome}${res.message ? ` (${res.message})` : ""}`);
    return { code, outcome, detail: res.message };
  } catch (err) {
    const detail = redactForLog(err);
    log.error(`[${accountName}] code "${code}" ERROR: ${detail}`);
    return { code, outcome: "ERROR", detail };
  }
}
