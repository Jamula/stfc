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
//     exitCode: number,  // 0 ok/partial account success, 1 infra error, 2 all tokens expired
//   }

import type { Account } from "../lib/accounts.ts";
import * as fs from "node:fs/promises";
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
import { ApiClient, ApiError, SchemaMismatchError, TokenExpiredError, TransientError } from "../api/client.ts";
import { claimGift, getMe, listGifts, redeemCode } from "../api/endpoints.ts";
import type { Gift } from "../api/schemas.ts";

const log = createLogger("runAll");
const DEFAULT_DEAD_CODES_PATH = "data/promo-code-dead.json";
const RETRY_DELAYS_MS = [1000, 2000] as const;
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

interface DeadCodeEntry {
  marked_dead_at: string;
  first_seen_outcome: typeof Outcomes.CODE_INVALID_OR_EXPIRED;
  accounts_tried: string[];
}

type DeadCodeCache = Record<string, DeadCodeEntry>;
type SleepFn = (ms: number) => Promise<void>;

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
  deadCodesPath?: string;
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
  /** Test seam: override sleeping between retry attempts. */
  sleep?: SleepFn;
}

export async function runAll(opts: RunAllOptions): Promise<RunAllOutput> {
  const report: RunAllReport = { accounts: [], errors: [] };
  const factory =
    opts.clientFactory ?? ((account: Account) => new ApiClient({ token: account.token, fetchImpl: opts.fetchImpl }));
  const sleep = opts.sleep ?? defaultSleep;

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

  const deadCodesPath = opts.deadCodesPath ?? DEFAULT_DEAD_CODES_PATH;
  const deadCodeCache = await readDeadCodeCache(deadCodesPath);
  const deadCodes = new Set(Object.keys(deadCodeCache));
  const skippedDeadCount = promoCodes.filter((code) => deadCodes.has(code)).length;
  if (skippedDeadCount > 0) {
    log.info(`skipping ${skippedDeadCount} dead promo code(s) from ${deadCodesPath}`);
  }

  for (const account of opts.accounts) {
    const activeCodes = promoCodes.filter((code) => !deadCodes.has(code));
    const accountReport = await processAccount(
      account,
      activeCodes,
      factory,
      report,
      deadCodesPath,
      deadCodeCache,
      sleep,
    );
    report.accounts.push(accountReport);
  }

  return finalize(report, opts.summary, opts.historyPath, opts.now);
}

async function processAccount(
  account: Account,
  promoCodes: string[],
  factory: (account: Account) => ApiClient,
  report: RunAllReport,
  deadCodesPath: string,
  deadCodeCache: DeadCodeCache,
  sleep: SleepFn,
): Promise<AccountReport> {
  const expiryHuman = describeAccountExpiry(account.token);
  const items: ItemResult[] = [];
  const codes: PromoResult[] = [];
  const client = factory(account);

  log.info(`account "${account.name}" — ${expiryHuman}`);

  const tokenStatus = await checkAuth(client, account.name, report);
  let effectiveTokenStatus = tokenStatus;

  if (tokenStatus === Outcomes.TOKEN_VALID) {
    items.push(...(await processGifts(client, account.name, report)));
    // /auth/me can answer 200 with a JWT the store itself rejects. Trust the
    // endpoint that does the real work, so the run reports "rotate the
    // secret" instead of a healthy token that silently claims nothing.
    if (items.some((i) => i.outcome === Outcomes.TOKEN_EXPIRED)) {
      effectiveTokenStatus = Outcomes.TOKEN_EXPIRED;
      log.error(`[${account.name}] token passed /auth/me but was rejected by the store — re-capture STFC_ACCOUNTS`);
    } else {
      codes.push(...(await processCodes(client, promoCodes, account.name, report, deadCodesPath, deadCodeCache, sleep)));
    }
  }

  const ok =
    effectiveTokenStatus === Outcomes.TOKEN_VALID &&
    items.every((i) => isExpectedOutcome(i.outcome)) &&
    codes.every((c) => isExpectedOutcome(c.outcome));

  const claimed = items.filter((i) => i.outcome === Outcomes.CLAIMED).length;
  log.info(
    `[${account.name}] token=${effectiveTokenStatus} claimed=${claimed}/${items.length} gift(s), ` +
      `${codes.length} promo code(s) — ${ok ? "ok" : "DEGRADED"}`,
  );

  return { name: account.name, expiryHuman, tokenStatus: effectiveTokenStatus, items, promoCodes: codes, ok };
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
    if (err instanceof TokenExpiredError) {
      log.error(`[${accountName}] auth/me rejected the token — re-capture STFC_ACCOUNTS`);
      return Outcomes.TOKEN_EXPIRED;
    }
    if (err instanceof SchemaMismatchError) {
      report.errors.push({ account: accountName, message: `auth/me schema mismatch: ${redactForLog(err)}` });
      return Outcomes.UNKNOWN_RESULT;
    }
    log.error(`[${accountName}] auth/me failed: ${redactForLog(err)}`);
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
    const outcome = classifyHttpError(err);
    const detail = redactForLog(err);
    log.error(`[${accountName}] gifts/list FAILED (${outcome}): ${detail}`);
    // A 401 here means the stored JWT is no longer accepted by the store,
    // even when /auth/me still answers 200. That is a credential problem,
    // reported via tokenStatus (-> exit code 2 / "rotate the secret"),
    // not an infrastructure error. TRANSIENT resolves itself next cycle.
    // Anything else is a real breakage and must fail the workflow.
    if (outcome !== Outcomes.TOKEN_EXPIRED && outcome !== Outcomes.TRANSIENT) {
      report.errors.push({ account: accountName, message: `gifts/list failed: ${detail}` });
    }
    return [{ id: "(list)", outcome, detail }];
  }

  log.info(`[${accountName}] gifts/list returned ${gifts.length} gift(s)`);

  if (gifts.length === 0) {
    return [{ id: "(none)", outcome: Outcomes.NO_GIFTS_AVAILABLE }];
  }

  const items: ItemResult[] = [];
  for (const gift of gifts) {
    const result = await processOneGift(client, gift, accountName, report);
    log.info(`[${accountName}] gift "${result.id}" → ${result.outcome}${result.detail ? ` (${result.detail})` : ""}`);
    items.push(result);
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
    if (err instanceof TransientError) {
      // We do not replay ambiguous gift-claim POSTs inside the same run
      // without stronger idempotency evidence. The scheduled workflow will
      // naturally re-attempt claimable gifts on the next cycle.
      return { id, outcome: Outcomes.TRANSIENT, detail: redactForLog(err) };
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
  deadCodesPath: string,
  deadCodeCache: DeadCodeCache,
  sleep: SleepFn,
): Promise<PromoResult[]> {
  const items: PromoResult[] = [];
  for (const code of codes) {
    const result = await processOneCode(client, code, accountName, report, sleep);
    items.push(result);
    if (result.outcome === Outcomes.CODE_INVALID_OR_EXPIRED) {
      await markCodeDead(deadCodesPath, deadCodeCache, code, accountName);
    }
  }
  return items;
}

async function processOneCode(
  client: ApiClient,
  code: string,
  accountName: string,
  report: RunAllReport,
  sleep: SleepFn,
): Promise<PromoResult> {
  let lastTransientError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
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

      if (!isTransientRedeemError(err)) {
        return { code, outcome: classifyHttpError(err), detail: redactForLog(err) };
      }

      lastTransientError = err;
      if (attempt >= 3) break;
      await sleep(getRetryDelayMs(err, attempt));
    }
  }

  return { code, outcome: Outcomes.TRANSIENT, detail: redactForLog(lastTransientError) };
}

async function finalize(
  report: RunAllReport,
  summary: SummaryWriter | undefined,
  historyPath: string | undefined,
  now: (() => Date) | undefined,
): Promise<RunAllOutput> {
  const exitCode = determineExitCode(report);
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
 * Insert one row per account that successfully claimed at least one gift,
 * directly under the markdown table header (newest at the top). No-op when
 * nothing was claimed in this run (avoids spamming the log with hourly
 * empty entries). Writes UTC date + time so cron rows are stable regardless
 * of runner timezone.
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

  let existing: string;
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    // File missing entirely — write a fresh header + the new rows. This
    // shouldn't happen in normal operation (the file is committed to the
    // repo) but the orchestrator must never lose claim records.
    const header =
      "# Redeem history\n\n" +
      "Auto-appended log of every successful gift claim. Rows are inserted at\n" +
      "the top so the most recent run is always visible first.\n\n" +
      "| Date (UTC) | Time (UTC) | Account | Gifts claimed |\n" +
      "| --- | --- | --- | --- |\n";
    await fs.writeFile(filePath, header + rows.join("\n") + "\n", "utf8");
    return;
  }

  // Find the markdown table separator line `| --- | --- | --- | --- |` and
  // splice the new rows in immediately after it. Falls back to appending at
  // the end if the structure is unrecognized, so we never lose data.
  const lines = existing.split("\n");
  const sepIdx = lines.findIndex((l) => /^\s*\|\s*-{3,}\s*(\|\s*-{3,}\s*)+\|\s*$/.test(l));
  if (sepIdx === -1) {
    await fs.appendFile(filePath, rows.join("\n") + "\n", "utf8");
    return;
  }
  lines.splice(sepIdx + 1, 0, ...rows);
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
}

function renderSummary(report: RunAllReport, exitCode: number): string {
  const status = exitCode === 0 ? "✅" : "❌";
  const parts: string[] = [];
  parts.push(heading(1, `${status} STFC Gift Redeemer`));

  if (exitCode === 2) {
    parts.push(heading(2, "Secret rotation needed"));
    parts.push("All accounts returned TOKEN_EXPIRED. Re-capture tokens and update STFC_ACCOUNTS.\n");
  }

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

function determineExitCode(report: RunAllReport): number {
  if (report.errors.length > 0) return 1;

  const hasAccounts = report.accounts.length > 0;
  const allAccountsExpired =
    hasAccounts && report.accounts.every((account) => account.tokenStatus === Outcomes.TOKEN_EXPIRED);

  return allAccountsExpired ? 2 : 0;
}

function escapeMd(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

async function readDeadCodeCache(filePath: string): Promise<DeadCodeCache> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DeadCodeCache;
  } catch (err) {
    if (isNotFoundError(err)) return {};
    log.warn(`could not read dead-code cache at ${filePath}:`, redactForLog(err));
    return {};
  }
}

async function markCodeDead(
  filePath: string,
  deadCodeCache: DeadCodeCache,
  code: string,
  accountName: string,
): Promise<void> {
  const existing = deadCodeCache[code];
  if (existing) {
    if (!existing.accounts_tried.includes(accountName)) {
      existing.accounts_tried.push(accountName);
      await writeDeadCodeCacheAtomic(filePath, deadCodeCache);
    }
    return;
  }

  deadCodeCache[code] = {
    marked_dead_at: new Date().toISOString(),
    first_seen_outcome: Outcomes.CODE_INVALID_OR_EXPIRED,
    accounts_tried: [accountName],
  };
  await writeDeadCodeCacheAtomic(filePath, deadCodeCache);
}

async function writeDeadCodeCacheAtomic(filePath: string, deadCodeCache: DeadCodeCache): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(deadCodeCache, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) return ".";
  return filePath.slice(0, idx);
}

function isNotFoundError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT");
}

function isTransientRedeemError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 429) return true;
    if (err.status !== undefined && err.status >= 500 && err.status <= 599) return true;
  }

  const name = (err as { name?: string }).name;
  if (name === "TransientError") return true;
  if (err instanceof TypeError) return true; // catches Node fetch's "TypeError: fetch failed" for unreachable hosts

  const code = String((err as { code?: unknown }).code ?? "").toUpperCase();
  return TRANSIENT_NETWORK_CODES.has(code);
}

const MAX_RETRY_AFTER_MS = 60_000; // cap against hostile servers returning large Retry-After values

function getRetryDelayMs(err: unknown, attempt: number): number {
  if (err instanceof ApiError && err.status === 429 && Number.isFinite(err.retryAfterMs)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, err.retryAfterMs ?? 0));
  }
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
