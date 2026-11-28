import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { pathToFileURL } from "node:url";
import { captureToken, type CapturedToken } from "./capture-token.ts";
import { parseDocument } from "yaml";
import { isTokenAccounts, type TokenAccountRecord } from "../shared/token-account-schema.ts";
import { createInterface } from "node:readline/promises";
import {
  ApiClient,
  ApiError,
  SchemaMismatchError,
  TokenExpiredError,
  TransientError,
  readResponseText,
  withSafeGetRetries,
} from "../src/api/client.ts";
import { AuthMeResponseSchema } from "../src/api/schemas.ts";

export interface GithubSecretCommandOptions {
  encoding?: BufferEncoding;
  input?: string;
  stdio?: SpawnSyncOptions["stdio"];
  env?: NodeJS.ProcessEnv;
}

export interface GithubSecretCommandResult {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export type GithubSecretCommandRunner = (
  command: string,
  args: string[],
  options: GithubSecretCommandOptions,
) => GithubSecretCommandResult;

const API = "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me";
const REFRESH_SECRET = "STFC_ACCOUNT_REFRESH_61690F065F04521CBA2CAE742A6BEC0DB2606A8E38A2FF74AEA5E1CB58D4E854";
const GITHUB_REPO = "github.com/Jamula/stfc";

function identifier(value: unknown): string | null {
  if (typeof value === "bigint" && value >= 0n) return String(value);
  return typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value) ? value : null;
}

function document(text: string): unknown {
  JSON.parse(text);
  const parsed = parseDocument(text, { schema: "json", uniqueKeys: true, intAsBigInt: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error("Invalid identity document.");
  return parsed.toJS({ maxAliasCount: 0 });
}

export async function verifiedIdentity(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!isTokenAccounts([{ name: "candidate", token }])) throw new Error("Invalid credential shape.");
  return withSafeGetRetries(async () => {
    let response: Response;
    try {
      response = await fetchImpl(API, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new TransientError("Network failure on GET /auth/me");
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new ApiError(`Redirected response on GET /auth/me (${response.status})`, response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TokenExpiredError(`Authentication rejected (${response.status}) on GET /auth/me`, response.status);
    }
    if (response.status >= 500 && response.status <= 599) {
      throw new TransientError(`Server error ${response.status} on GET /auth/me`, response.status);
    }
    if (response.status !== 200) {
      throw new ApiError(`Unexpected HTTP ${response.status} on GET /auth/me; expected 200`, response.status);
    }
    if (!/json/i.test(response.headers.get("content-type") ?? "")) {
      throw new SchemaMismatchError("Expected JSON from GET /auth/me", response.status);
    }
    const body = await readResponseText(response, "GET", "/auth/me");
    const identity = AuthMeResponseSchema.parse(document(body));
    const payload = identity?.payload as Record<string, unknown> | undefined;
    const id = identifier(payload?.["accountId"]);
    if (!id) throw new Error("Verified account identity is unavailable.");
    return id;
  });
}

export async function verifyGiftAccess(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const client = new ApiClient({
    token,
    fetchImpl: (url, options) => fetchImpl(url, { ...options, redirect: "error" }),
  });
  await client.listGifts({ expectedStatus: 200, rejectRedirects: true });
}

export function runGithubSecretCommand(
  args: string[],
  options: GithubSecretCommandOptions = {},
  run: GithubSecretCommandRunner = spawnSync as unknown as GithubSecretCommandRunner,
): GithubSecretCommandResult {
  return run("gh", [...args, "--repo", GITHUB_REPO], {
    ...options,
    env: { ...process.env, ...options.env, GH_HOST: "github.com" },
  });
}

export async function mergeRefreshedAccount(
  raw: string,
  refreshed: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenAccountRecord[]> {
  return mergeRefreshedAccounts(raw, [refreshed], fetchImpl);
}

export async function mergeRefreshedAccounts(
  raw: string,
  overrides: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<TokenAccountRecord[]> {
  try {
    const inventory = readInventory(raw);
    const result = await applyRefreshOverrides(inventory, overrides, fetchImpl);
    if (result.rejectedCount > 0) throw new Error();
    return result.accounts;
  } catch {
    throw new Error("Account refresh identity is missing, ambiguous, mismatched, or unverifiable; inventory was not changed.");
  }
}

export async function mergeAvailableRefreshedAccounts(
  raw: string,
  overrides: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{
  accounts: TokenAccountRecord[];
  rejectedCount: number;
  acceptedOverrides: boolean[];
}> {
  try {
    return await applyRefreshOverrides(readInventory(raw), overrides, fetchImpl);
  } catch {
    throw new Error("Account refresh inventory is invalid; inventory was not changed.");
  }
}

function readInventory(raw: string): { accounts: TokenAccountRecord[]; ids: string[] } {
  const accounts: unknown = JSON.parse(raw);
  if (!isTokenAccounts(accounts)) throw new Error();
  const ids = accounts.map((account) => {
    const segment = account.token.split(".")[1] ?? "";
    const payload = document(Buffer.from(segment, "base64url").toString("utf8")) as
      | { accountId?: unknown }
      | null
      | undefined;
    const id = identifier(payload?.accountId);
    if (!id) throw new Error();
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error();
  return { accounts, ids };
}

async function applyRefreshOverrides(
  { accounts, ids }: { accounts: TokenAccountRecord[]; ids: string[] },
  overrides: string[],
  fetchImpl: typeof fetch,
): Promise<{
  accounts: TokenAccountRecord[];
  rejectedCount: number;
  acceptedOverrides: boolean[];
}> {
  const replacements = new Map<string, string>();
  const acceptedOverrides: boolean[] = [];
  let rejectedCount = 0;
  for (const refreshed of overrides) {
    try {
      const candidate = JSON.parse(refreshed) as { token?: unknown } | null;
      const candidateToken = candidate?.token;
      if (typeof candidateToken !== "string" || !isTokenAccounts([{ name: "candidate", token: candidateToken }])) {
        throw new Error();
      }
      const id = await verifiedIdentity(candidateToken, fetchImpl);
      if (!ids.includes(id) || replacements.has(id)) throw new Error();
      await verifyGiftAccess(candidateToken, fetchImpl);
      replacements.set(id, candidateToken);
      acceptedOverrides.push(true);
    } catch {
      rejectedCount += 1;
      acceptedOverrides.push(false);
    }
  }
  return {
    accounts: accounts.map((account, index) => {
      const id = ids[index] ?? "";
      const replacement = replacements.get(id);
      return replacement !== undefined ? { ...account, token: replacement } : account;
    }),
    rejectedCount,
    acceptedOverrides,
  };
}

export async function captureFromPage(
  browser: Browser,
  context: BrowserContext,
  page: Page,
): Promise<CapturedToken> {
  const controller = new AbortController();
  let capture: Promise<CapturedToken> | undefined;
  let closing = false;
  try {
    capture = captureToken({
      context,
      timeoutMs: 900000,
      signal: controller.signal,
      closeAfterCapture: async () => {
        closing = true;
        await browser.close();
      },
    });
    const navigation = page.goto("https://home.startrekfleetcommand.com/store").catch((error: unknown) => {
      if (closing && error instanceof Error && /Target page, context or browser has been closed/.test(error.message)) {
        return;
      }
      throw error;
    });
    const [, result] = await Promise.all([navigation, capture]);
    return result;
  } finally {
    controller.abort();
    await browser.close();
    await capture?.catch(() => {});
  }
}

export async function publishFromPage(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  {
    fetchImpl = fetch,
    runSecretCommand = runGithubSecretCommand,
    checkSecretAbsent = assertSecretAbsent,
  }: {
    fetchImpl?: typeof fetch;
    runSecretCommand?: typeof runGithubSecretCommand;
    checkSecretAbsent?: () => void;
  } = {},
): Promise<void> {
  const { token } = await captureFromPage(browser, context, page);
  if (!token) throw new Error("Login timed out.");
  await verifiedIdentity(token, fetchImpl);
  await verifyGiftAccess(token, fetchImpl);
  checkSecretAbsent();
  const result = runSecretCommand(["secret", "set", REFRESH_SECRET], {
    input: JSON.stringify({ token }),
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (result.status !== 0) throw new Error("Encrypted override update failed.");
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "";
  if (!["--publish", "--verify-only"].includes(mode) || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run in a private interactive terminal.");
  }
  if (mode === "--publish") {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (
        (await terminal.question(
          `Type YES only if this exact secret name is approved, no other writer will use it, and it will be retained until safely incorporated: ${REFRESH_SECRET}\n`,
        )) !== "YES"
      ) {
        throw new Error("Publishing approval was not confirmed.");
      }
    } finally {
      terminal.close();
    }
    assertSecretAbsent();
  }
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log("Sign in and enter the email OTP directly in the official browser. No credentials belong in this terminal.");
    if (mode === "--publish") {
      await publishFromPage(browser, context, page);
      console.log("Encrypted override saved; run the recovery authentication workflow to verify inventory matching.");
    } else {
      const { token } = await captureFromPage(browser, context, page);
      if (!token) throw new Error("Login timed out.");
      await verifiedIdentity(token);
      await verifyGiftAccess(token);
      console.log("Non-redeeming authentication and gift-list access passed. No credential was saved or published.");
    }
  } finally {
    await browser.close();
  }
}

function assertSecretAbsent(): void {
  const result = runGithubSecretCommand(["secret", "list", "--json", "name"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Cannot verify secret names.");
  const secrets: unknown = JSON.parse(String(result.stdout));
  if (
    !Array.isArray(secrets) ||
    secrets.some(
      (secret: unknown) =>
        !secret ||
        typeof secret !== "object" ||
        typeof (secret as Record<string, unknown>)["name"] !== "string" ||
        (secret as Record<string, unknown>)["name"] === REFRESH_SECRET,
    )
  ) {
    throw new Error("The proposed override name already exists; refusing to replace it.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      "Secure account refresh failed; no inventory update or redemption was attempted. Check approval, secret-name availability, and authentication.",
    );
    process.exitCode = 1;
  });
}
