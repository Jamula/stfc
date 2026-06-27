// Diagnostic skill: lists gifts and attempts to claim every claimable one.
// Always exits 0; the orchestrator (run-all) is what CI actually runs.

import type { Account } from "../lib/accounts.ts";
import { ApiClient } from "../api/client.ts";
import { claimGift as apiClaimGift, listGifts as apiListGifts } from "../api/endpoints.ts";
import type { Gift } from "../api/schemas.ts";
import { createLogger } from "../lib/logger.ts";
import { classifyGiftSkip, Outcomes, type Outcome } from "../lib/outcomes.ts";
import { redactForLog } from "../lib/redact.ts";

const log = createLogger("claimGifts");

export interface ClaimGiftsOptions {
  accounts: Account[];
  promoCodesPath?: string;
  clientFactory?: (token: string) => ApiClient;
  fetchImpl?: typeof fetch;
}

export interface ClaimAttempt {
  giftLabel: string;
  outcome: Outcome | "ERROR";
  detail?: string;
}

export interface ClaimGiftsRow {
  accountName: string;
  attempts: ClaimAttempt[];
  error?: string;
}

export interface ClaimGiftsOutput {
  result: { rows: ClaimGiftsRow[] };
  exitCode: number;
}

export async function claimGifts(opts: ClaimGiftsOptions): Promise<ClaimGiftsOutput> {
  const factory = opts.clientFactory ?? ((token: string) => new ApiClient({ token, fetchImpl: opts.fetchImpl }));
  const rows: ClaimGiftsRow[] = [];

  for (const account of opts.accounts) {
    const client = factory(account.token);
    let gifts: Gift[];
    try {
      gifts = await apiListGifts(client);
    } catch (err) {
      const detail = redactForLog(err);
      log.error(`[${account.name}] could not list gifts: ${detail}`);
      rows.push({ accountName: account.name, attempts: [], error: detail });
      continue;
    }

    const attempts: ClaimAttempt[] = [];
    for (const gift of gifts) {
      attempts.push(await tryClaim(client, account.name, gift));
    }
    rows.push({ accountName: account.name, attempts });
  }

  return { result: { rows }, exitCode: 0 };
}

async function tryClaim(client: ApiClient, accountName: string, gift: Gift): Promise<ClaimAttempt> {
  const label = giftLabel(gift);
  const skip = classifyGiftSkip(gift);
  if (skip !== null) {
    log.info(`[${accountName}] skip ${label}: ${skip}`);
    return { giftLabel: label, outcome: skip };
  }
  const bundleId = gift.bundleId ?? gift.bundle_id ?? gift.id;
  if (bundleId === undefined) {
    log.warn(`[${accountName}] no bundleId for ${label}`);
    return { giftLabel: label, outcome: "ERROR", detail: "no bundleId/bundle_id/id field" };
  }
  try {
    await apiClaimGift(client, bundleId);
    log.info(`[${accountName}] CLAIMED ${label}`);
    return { giftLabel: label, outcome: Outcomes.CLAIMED };
  } catch (err) {
    const detail = redactForLog(err);
    log.error(`[${accountName}] failed to claim ${label}: ${detail}`);
    return { giftLabel: label, outcome: "ERROR", detail };
  }
}

function giftLabel(gift: Gift): string {
  if (gift.title && gift.title.length > 0) return gift.title;
  if (gift.bundleId !== undefined) return String(gift.bundleId);
  if (gift.bundle_id !== undefined) return String(gift.bundle_id);
  if (gift.id !== undefined) return String(gift.id);
  return "(unnamed)";
}
