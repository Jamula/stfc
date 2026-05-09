// The orchestrator. Iterates every account: validate token, claim every
// claimable gift, redeem every promo code, classify every outcome.
// Returns its exit code to the caller (cli.ts) — never calls process.exit
// itself, so it stays fully unit-testable.
//
// Result shape (consumed by tests/skills/runAll.test.ts):
//   {
//     result: {
//       accounts: Array<{
//         name: string,
//         expiryHuman: string,
//         tokenStatus: Outcome,
//         items: Array<{ id: string, outcome: Outcome, detail?: string }>,
//         promoCodes: Array<{ code: string, outcome: Outcome, detail?: string }>,
//         ok: boolean,
//       }>,
//       errors: Array<{ account?: string, message: string }>,
//     },
//     exitCode: number,  // 0 unless an infrastructure-class error occurred
//   }

import type { Account } from "../lib/accounts.ts";
import { decodeJwt, describeExpiry, JwtParseError } from "../lib/jwt.ts";
import { createLogger } from "../lib/logger.ts";
import {
  classifyGiftSkip,
  classifyHttpError,
  classifyRedeemResult,
  isExpectedOutcome,
  Outcomes,
  type Outcome,
} from "../lib/outcomes.ts";
import { PromoCodesFileError, readPromoCodes } from "../lib/promoCodes.ts";
import { redactForLog } from "../lib/redact.ts";
import { heading, table, type SummaryWriter } from "../lib/summary.ts";
import { ApiClient, ApiError, SchemaMismatchError, TokenExpiredError } from "../api/client.ts";
import { claimGift, getMe, listGifts, redeemCode } from "../api/endpoints.ts";
import type { Gift } from "../api/schemas.ts";

const log = createLogger("runAll");

export interface ItemResult {
  id: string;
  outcome: Outcome;
  detail?: string;
}

export interface PromoResult {
  code: string;
  outcome: Outcome;
  detail?: string;
}

export interface RunErrorEntry {
  account?: string;
  message: string;
}

export interface AccountReport {
  name: string;
  expiryHuman: string;
  tokenStatus: Outcome;
  items: ItemResult[];
  promoCodes: PromoResult[];
  ok: boolean;
}

export interface RunAllReport {
  accounts: AccountReport[];
  errors: RunErrorEntry[];
}

export interface RunAllOutput {
  result: RunAllReport;
  exitCode: number;
}

export interface RunAllOptions {
  accounts: Account[];
  promoCodesPath?: string;
  summary?: SummaryWriter;
  /** Path to the redeem-history Markdown table (e.g. docs/redeem-history.md).
   *  When set, a row is appended for every account that successfully claimed
   *  at least one gift in this run. No row is appended when there's nothing
   *  to log (avoids spamming the file with hourly empties). */
  historyPath?: string;
  /** Override clock for tests. */
  now?: () => Date;
  /** Test seam: build a custom client per account. */
  clientFactory?: (account: Account) => ApiClient;
  /** Test seam: override fetch globally. */
  fetchImpl?: typeof fetch;
}

export async function runAll(opts: RunAllOptions): Promise<RunAllOutput> {
  const report: RunAllReport = { accounts: [], errors: [] };
  const factory =
    opts.clientFactory ?? ((account: Account) => new ApiClient({ token: account.token, fetchImpl: opts.fetchImpl }));

  let promoCodes: string[] = [];
  if (opts.promoCodesPath) {
    try {
      promoCodes = await readPromoCodes(opts.promoCodesPath);
    } catch (err) {
      if (err instanceof PromoCodesFileError) {
        report.errors.push({ message: redactForLog(err) });
        return finalize(report, opts.summary, opts.historyPath, opts.now);
      }
      throw err;
    }
  }

  for (const account of opts.accounts) {
    const accountReport = await processAccount(account, promoCodes, factory, report);
    report.accounts.push(accountReport);
  }

  return finalize(report, opts.summary, opts.historyPath, opts.now);
}

async function processAccount(
  account: Account,
  promoCodes: string[],
  factory: (account: Account) => ApiClient,
  report: RunAllReport,
): Promise<AccountReport> {
  const expiryHuman = describeAccountExpiry(account.token);
  const items: ItemResult[] = [];
  const codes: PromoResult[] = [];
  const client = factory(account);

  log.info(`account "${account.name}" — ${expiryHuman}`);

  const tokenStatus = await checkAuth(client, account.name, report);

  if (tokenStatus === Outcomes.TOKEN_VALID) {
    items.push(...(await processGifts(client, account.name, report)));
    codes.push(...(await processCodes(client, promoCodes, account.name, report)));
  }

  const ok =
    tokenStatus === Outcomes.TOKEN_VALID &&
    items.every((i) => isExpectedOutcome(i.outcome)) &&
    codes.every((c) => isExpectedOutcome(c.outcome));

  return { name: account.name, expiryHuman, tokenStatus, items, promoCodes: codes, ok };
}

function describeAccountExpiry(token: string): string {
  try {
    return describeExpiry(decodeJwt(token)).human;
  } catch (err) {
    if (err instanceof JwtParseError) return "(could not decode)";
    return "(could not decode)";
  }
}

async function checkAuth(client: ApiClient, accountName: string, report: RunAllReport): Promise<Outcome> {
  try {
    await getMe(client);
    return Outcomes.TOKEN_VALID;
  } catch (err) {
    if (err instanceof TokenExpiredError) return Outcomes.TOKEN_EXPIRED;
    if (err instanceof SchemaMismatchError) {
      report.errors.push({ account: accountName, message: `auth/me schema mismatch: ${redactForLog(err)}` });
      return Outcomes.UNKNOWN_RESULT;
    }
    report.errors.push({ account: accountName, message: `auth/me failed: ${redactForLog(err)}` });
    return Outcomes.UNKNOWN_RESULT;
  }
}

async function processGifts(
  client: ApiClient,
  accountName: string,
  report: RunAllReport,
): Promise<ItemResult[]> {
  let gifts: Gift[];
  try {
    gifts = await listGifts(client);
  } catch (err) {
    if (err instanceof SchemaMismatchError) {
      report.errors.push({ account: accountName, message: `gifts/list schema mismatch: ${redactForLog(err)}` });
      return [];
    }
    return [{ id: "(list)", outcome: classifyHttpError(err), detail: redactForLog(err) }];
  }

  if (gifts.length === 0) {
    return [{ id: "(none)", outcome: Outcomes.NO_GIFTS_AVAILABLE }];
  }

  const items: ItemResult[] = [];
  for (const gift of gifts) {
    items.push(await processOneGift(client, gift, accountName, report));
  }
  return items;
}

async function processOneGift(
  client: ApiClient,
  gift: Gift,
  accountName: string,
  report: RunAllReport,
): Promise<ItemResult> {
  const id = describeGift(gift);
  const skip = classifyGiftSkip(gift);
  if (skip !== null) {
    return { id, outcome: skip };
  }

  const bundleId = gift.bundleId ?? gift.bundle_id ?? gift.id;
  if (bundleId === undefined) {
    return { id, outcome: Outcomes.UNKNOWN_RESULT, detail: "no bundleId/bundle_id/id field" };
  }

  try {
    await claimGift(client, bundleId);
    return { id, outcome: Outcomes.CLAIMED };
  } catch (err) {
    if (err instanceof SchemaMismatchError) {
      report.errors.push({ account: accountName, message: `gifts/claim schema mismatch: ${redactForLog(err)}` });
      return { id, outcome: Outcomes.UNKNOWN_RESULT, detail: "schema mismatch" };
    }
    // The API returns HTTP 404 with body "Bundle not available." for gifts
    // that have already been claimed in the current cycle (or are otherwise
    // no longer redeemable for this player). That's an expected outcome,
    // not an error.
    if (err instanceof ApiError && err.status === 404 && /not available/i.test(err.message)) {
      return { id, outcome: Outcomes.ALREADY_CLAIMED };
    }
    return { id, outcome: classifyHttpError(err), detail: redactForLog(err) };
  }
}

function describeGift(gift: Gift): string {
  if (gift.title && gift.title.length > 0) return gift.title;
  if (gift.name && gift.name.length > 0) return gift.name;
  if (gift.bundleId !== undefined) return String(gift.bundleId);
  if (gift.bundle_id !== undefined) return String(gift.bundle_id);
  if (gift.id !== undefined) return String(gift.id);
  return "(unnamed)";
}

async function processCodes(
  client: ApiClient,
  codes: string[],
  accountName: string,
  report: RunAllReport,
): Promise<PromoResult[]> {
  const items: PromoResult[] = [];
  for (const code of codes) {
    items.push(await processOneCode(client, code, accountName, report));
  }
  return items;
}

async function processOneCode(
  client: ApiClient,
  code: string,
  accountName: string,
  report: RunAllReport,
): Promise<PromoResult> {
  try {
    const res = await redeemCode(client, code);
    // Live API uses `redeem_result` (numeric); fall back to legacy `code`.
    const resultCode = res.redeem_result ?? res.code;
    return {
      code,
      outcome: classifyRedeemResult({ code: resultCode, message: res.message }),
      detail: res.message ?? (resultCode !== undefined ? `redeem_result=${resultCode}` : undefined),
    };
  } catch (err) {
    if (err instanceof SchemaMismatchError) {
      report.errors.push({ account: accountName, message: `redeem/claim schema mismatch: ${redactForLog(err)}` });
      return { code, outcome: Outcomes.UNKNOWN_RESULT, detail: "schema mismatch" };
    }
    return { code, outcome: classifyHttpError(err), detail: redactForLog(err) };
  }
}

async function finalize(
  report: RunAllReport,
  summary: SummaryWriter | undefined,
  historyPath: string | undefined,
  now: (() => Date) | undefined,
): Promise<RunAllOutput> {
  const exitCode = report.errors.length > 0 ? 1 : 0;
  if (summary) {
    try {
      await summary.append(renderSummary(report, exitCode));
    } catch (err) {
      log.warn("could not write summary:", redactForLog(err));
    }
  }
  if (historyPath) {
    try {
      await appendHistory(historyPath, report, now ? now() : new Date());
    } catch (err) {
      log.warn("could not append history:", redactForLog(err));
    }
  }
  return { result: report, exitCode };
}

/**
 * Append one row per account that successfully claimed at least one gift.
 * No-op when nothing was claimed in this run (avoids spamming the log with
 * hourly empty entries). Writes UTC date + time so cron rows are stable
 * regardless of runner timezone.
 */
async function appendHistory(filePath: string, report: RunAllReport, now: Date): Promise<void> {
  const date = now.toISOString().slice(0, 10);          // YYYY-MM-DD
  const time = now.toISOString().slice(11, 16);         // HH:MM
  const rows: string[] = [];
  for (const account of report.accounts) {
    const claimed = account.items
      .filter((i) => i.outcome === Outcomes.CLAIMED)
      .map((i) => i.id);
    if (claimed.length === 0) continue;
    const list = claimed.map(escapeMd).join(", ");
    rows.push(`| ${date} | ${time} | ${escapeMd(account.name)} | ${list} |`);
  }
  if (rows.length === 0) return;

  // Lazy import so test runs that don't pass historyPath have zero fs cost.
  const fs = await import("node:fs/promises");
  // The orchestrator never creates the file from scratch — `docs/redeem-history.md`
  // is committed to the repo with a header. If it's somehow missing we still
  // append rows; future readers can grep them out.
  await fs.appendFile(filePath, rows.join("\n") + "\n", "utf8");
}

function renderSummary(report: RunAllReport, exitCode: number): string {
  const status = exitCode === 0 ? "✅" : "❌";
  const parts: string[] = [];
  parts.push(heading(1, `${status} STFC Gift Redeemer`));

  if (report.errors.length > 0) {
    parts.push(heading(2, "Infrastructure errors"));
    for (const e of report.errors) {
      const prefix = e.account ? `[${e.account}] ` : "";
      parts.push(`- ${escapeMd(prefix + e.message)}\n`);
    }
  }

  for (const account of report.accounts) {
    const accStatus = account.ok ? "✅" : "⚠️";
    parts.push(heading(2, `${accStatus} ${account.name}`));
    parts.push(`Token: ${escapeMd(account.expiryHuman)} — ${account.tokenStatus}\n\n`);

    if (account.items.length > 0) {
      parts.push(heading(3, "Gifts"));
      const rows = account.items.map((i) => [i.id, i.outcome, i.detail ? redactForLog(i.detail) : ""]);
      parts.push(table(["Gift", "Outcome", "Detail"], rows));
    }

    if (account.promoCodes.length > 0) {
      parts.push(heading(3, "Promo codes"));
      const rows = account.promoCodes.map((c) => [c.code, c.outcome, c.detail ? redactForLog(c.detail) : ""]);
      parts.push(table(["Code", "Outcome", "Detail"], rows));
    }
  }

  return parts.join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}
