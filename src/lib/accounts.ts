// Loader and validator for STFC_ACCOUNTS or STFC_ACCOUNTS_FILE.
//
// Format (single JSON value):
//   [{"name":"main","token":"<JWT>"}, {"name":"alt","token":"<JWT>"}]
//
// Anything else is rejected with a clear, actionable message. Errors thrown
// from here are infrastructure-class (the orchestrator exits non-zero).

import { z } from "zod";
import { readFileSync } from "node:fs";
import { isJwtShaped } from "./jwt.ts";

export class AccountsConfigError extends Error {
  override readonly name = "AccountsConfigError";
}

const AccountSchema = z.object({
  name: z.string().min(1, "account name must be a non-empty string"),
  token: z.string().min(1, "account token must be a non-empty string"),
});

const AccountsSchema = z.array(AccountSchema).min(1, "STFC_ACCOUNTS must contain at least one account");

export interface Account {
  name: string;
  token: string;
}

export interface LoadAccountsOptions {
  envValue?: string | undefined;
  filePath?: string | undefined;
}

export function loadAccounts(opts: LoadAccountsOptions = {}): Account[] {
  const envValue = opts.envValue ?? process.env.STFC_ACCOUNTS;
  const filePath = opts.filePath ?? process.env.STFC_ACCOUNTS_FILE;
  if (envValue && filePath) {
    throw new AccountsConfigError("Set only one of STFC_ACCOUNTS and STFC_ACCOUNTS_FILE.");
  }
  let raw = envValue;
  if (!raw && filePath) {
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown file error";
      throw new AccountsConfigError(
        `STFC_ACCOUNTS_FILE could not be read: ${detail}. See docs/SETUP.md for token-store configuration.`,
      );
    }
  }
  if (!raw || raw.trim().length === 0) {
    throw new AccountsConfigError(
      "Neither STFC_ACCOUNTS nor STFC_ACCOUNTS_FILE is set. " +
      "See docs/SETUP.md for token-store configuration.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AccountsConfigError(
      `Account data from STFC_ACCOUNTS or STFC_ACCOUNTS_FILE is not valid JSON: ${detail}. ` +
      `When pasting into a GitHub Secret, paste the raw JSON without surrounding quotes — ` +
      `e.g. [{"name":"main","token":"eyJ..."}]`,
    );
  }

  const result = AccountsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new AccountsConfigError(
      `Account data structure is invalid:\n${issues}\n` +
      `Expected an array of {name, token} objects, e.g. [{"name":"main","token":"eyJ..."}].`,
    );
  }

  const accounts = result.data;

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const a of accounts) {
    if (seen.has(a.name)) dupes.push(a.name);
    seen.add(a.name);
  }
  if (dupes.length > 0) {
    throw new AccountsConfigError(
      `Account data has duplicate account name(s): ${[...new Set(dupes)].join(", ")}. ` +
      `Each account must have a unique name.`,
    );
  }

  for (const a of accounts) {
    if (!isJwtShaped(a.token)) {
      throw new AccountsConfigError(
        `Account "${a.name}" token is not JWT-shaped (expected three base64url segments separated by dots). ` +
        `Run \`npm run capture-token\` locally or use the STFC token PWA to capture a valid token.`,
      );
    }
  }

  return accounts;
}
