// Diagnostic skill: validates each account's token by calling /auth/me.
// Always exits 0 — it's an inspection tool, not a health check.

import type { Account } from "../lib/accounts.ts";
import { ApiClient, TokenExpiredError } from "../api/client.ts";
import { getMe } from "../api/endpoints.ts";
import { decodeJwt, describeExpiry, JwtParseError } from "../lib/jwt.ts";
import { createLogger } from "../lib/logger.ts";
import { redactForLog } from "../lib/redact.ts";

const log = createLogger("checkAuth");

export interface CheckAuthOptions {
  accounts: Account[];
  promoCodesPath?: string;
  clientFactory?: (token: string) => ApiClient;
  fetchImpl?: typeof fetch;
}

export interface CheckAuthRow {
  accountName: string;
  status: "OK" | "TOKEN_EXPIRED" | "ERROR";
  detail: string;
}

export interface CheckAuthOutput {
  result: { rows: CheckAuthRow[] };
  exitCode: number;
}

export async function checkAuth(opts: CheckAuthOptions): Promise<CheckAuthOutput> {
  const factory = opts.clientFactory ?? ((token: string) => new ApiClient({ token, fetchImpl: opts.fetchImpl }));
  const rows: CheckAuthRow[] = [];

  for (const account of opts.accounts) {
    const expiry = describeExpiryFor(account.token);
    const client = factory(account.token);
    try {
      await getMe(client);
      log.info(`[${account.name}] OK (${expiry})`);
      rows.push({ accountName: account.name, status: "OK", detail: expiry });
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        log.warn(`[${account.name}] TOKEN_EXPIRED`);
        rows.push({ accountName: account.name, status: "TOKEN_EXPIRED", detail: expiry });
      } else {
        const detail = redactForLog(err);
        log.error(`[${account.name}] ERROR: ${detail}`);
        rows.push({ accountName: account.name, status: "ERROR", detail });
      }
    }
  }

  return { result: { rows }, exitCode: 0 };
}

function describeExpiryFor(token: string): string {
  try {
    return describeExpiry(decodeJwt(token)).human;
  } catch (err) {
    if (err instanceof JwtParseError) return "(could not decode)";
    return "(could not decode)";
  }
}
