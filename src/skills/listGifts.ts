// Diagnostic skill: prints each account's available gifts as a small table.
// Always exits 0; this is for humans inspecting the API state, not CI.

import type { Account } from "../lib/accounts.ts";
import { ApiClient } from "../api/client.ts";
import { listGifts as apiListGifts } from "../api/endpoints.ts";
import type { Gift } from "../api/schemas.ts";
import { createLogger } from "../lib/logger.ts";
import { redactForLog } from "../lib/redact.ts";

const log = createLogger("listGifts");

export interface ListGiftsOptions {
  accounts: Account[];
  promoCodesPath?: string;
  clientFactory?: (token: string) => ApiClient;
  fetchImpl?: typeof fetch;
}

export interface ListGiftsRow {
  accountName: string;
  gifts: Gift[];
  error?: string;
}

export interface ListGiftsOutput {
  result: { rows: ListGiftsRow[] };
  exitCode: number;
}

export async function listGifts(opts: ListGiftsOptions): Promise<ListGiftsOutput> {
  const factory = opts.clientFactory ?? ((token: string) => new ApiClient({ token, fetchImpl: opts.fetchImpl }));
  const rows: ListGiftsRow[] = [];

  for (const account of opts.accounts) {
    const client = factory(account.token);
    try {
      const gifts = await apiListGifts(client);
      printGiftTable(account.name, gifts);
      rows.push({ accountName: account.name, gifts });
    } catch (err) {
      const detail = redactForLog(err);
      log.error(`[${account.name}] failed to list gifts: ${detail}`);
      rows.push({ accountName: account.name, gifts: [], error: detail });
    }
  }

  return { result: { rows }, exitCode: 0 };
}

function printGiftTable(accountName: string, gifts: Gift[]): void {
  log.info(`[${accountName}] ${gifts.length} gift(s):`);
  for (const g of gifts) {
    const id = g.bundleId ?? g.bundle_id ?? g.id ?? "?";
    const flags = describeFlags(g);
    log.info(`  - id=${String(id)} title=${g.title ?? "(no title)"} ${flags}`);
  }
}

// The API sends these flags as snake_case 0/1 numbers; older surfaces used
// camelCase booleans. Accept either spelling and treat any non-zero/true as set.
const truthy = (v: unknown): boolean => (typeof v === "number" ? v !== 0 : v === true);

function describeFlags(g: Gift): string {
  const parts: string[] = [];
  if (truthy(g.isClaimable) || truthy(g.is_claimable)) parts.push("claimable");
  if (truthy(g.isClaimed) || truthy(g.is_claimed)) parts.push("claimed");
  if (truthy(g.isSpecial) || truthy(g.is_special)) parts.push("special");
  if (truthy(g.hasCost) || truthy(g.has_cost)) parts.push("has-cost");
  if (truthy(g.isAtMax) || truthy(g.is_at_max)) parts.push("at-max");
  return parts.length > 0 ? `[${parts.join(",")}]` : "";
}
