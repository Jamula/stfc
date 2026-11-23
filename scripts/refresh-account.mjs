import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { captureToken } from './capture-token.mjs';
import { parseDocument } from 'yaml';
import { isTokenAccounts } from '../shared/token-account-schema.mjs';
import { createInterface } from 'node:readline/promises';
import { ApiClient } from '../src/api/client.ts';
import { AuthMeResponseSchema } from '../src/api/schemas.ts';

const API = 'https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me';
const REFRESH_SECRET = 'STFC_ACCOUNT_REFRESH_61690F065F04521CBA2CAE742A6BEC0DB2606A8E38A2FF74AEA5E1CB58D4E854';
const GITHUB_REPO = 'github.com/Jamula/stfc';

function identifier(value) {
  if (typeof value === 'bigint' && value >= 0n) return String(value);
  return typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value) ? value : null;
}

function document(text) {
  JSON.parse(text);
  const parsed = parseDocument(text, { schema: 'json', uniqueKeys: true, intAsBigInt: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('Invalid identity document.');
  return parsed.toJS({ maxAliasCount: 0 });
}

export async function verifiedIdentity(token, fetchImpl = fetch) {
  if (!isTokenAccounts([{ name: 'candidate', token }])) throw new Error('Invalid credential shape.');
  const response = await fetchImpl(API, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 200 || response.redirected || !/json/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Authentication rejected.');
  }
  const identity = AuthMeResponseSchema.parse(document(await response.text()));
  const id = identifier(identity?.payload?.accountId);
  if (!id) throw new Error('Verified account identity is unavailable.');
  return id;
}

export async function verifyGiftAccess(token, fetchImpl = fetch) {
  const client = new ApiClient({
    token,
    fetchImpl: (url, options) => fetchImpl(url, { ...options, redirect: 'error' }),
  });
  await client.listGifts({ expectedStatus: 200, rejectRedirects: true });
}

export function runGithubSecretCommand(args, options = {}, run = spawnSync) {
  return run('gh', [...args, '--repo', GITHUB_REPO], {
    ...options,
    env: { ...process.env, ...options.env, GH_HOST: 'github.com' },
  });
}

export async function mergeRefreshedAccount(raw, refreshed, fetchImpl = fetch) {
  return mergeRefreshedAccounts(raw, [refreshed], fetchImpl);
}

export async function mergeRefreshedAccounts(raw, overrides, fetchImpl = fetch) {
  try {
    const inventory = readInventory(raw);
    const result = await applyRefreshOverrides(inventory, overrides, fetchImpl);
    if (result.rejectedCount > 0) throw new Error();
    return result.accounts;
  } catch {
    throw new Error('Account refresh identity is missing, ambiguous, mismatched, or unverifiable; inventory was not changed.');
  }
}

export async function mergeAvailableRefreshedAccounts(raw, overrides, fetchImpl = fetch) {
  try {
    return await applyRefreshOverrides(readInventory(raw), overrides, fetchImpl);
  } catch {
    throw new Error('Account refresh inventory is invalid; inventory was not changed.');
  }
}

function readInventory(raw) {
  const accounts = JSON.parse(raw);
  if (!isTokenAccounts(accounts)) throw new Error();
  const ids = accounts.map(account => {
    const payload = document(Buffer.from(account.token.split('.')[1], 'base64url').toString('utf8'));
    const id = identifier(payload?.accountId);
    if (!id) throw new Error();
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error();
  return { accounts, ids };
}

async function applyRefreshOverrides({ accounts, ids }, overrides, fetchImpl) {
  const replacements = new Map();
  const acceptedOverrides = [];
  let rejectedCount = 0;
  for (const refreshed of overrides) {
    try {
      const candidate = JSON.parse(refreshed);
      if (!isTokenAccounts([{ name: 'candidate', token: candidate?.token }])) throw new Error();
      const id = await verifiedIdentity(candidate.token, fetchImpl);
      if (!ids.includes(id) || replacements.has(id)) throw new Error();
      await verifyGiftAccess(candidate.token, fetchImpl);
      replacements.set(id, candidate.token);
      acceptedOverrides.push(true);
    } catch {
      rejectedCount += 1;
      acceptedOverrides.push(false);
    }
  }
  return {
    accounts: accounts.map((account, index) => replacements.has(ids[index])
      ? { ...account, token: replacements.get(ids[index]) } : account),
    rejectedCount,
    acceptedOverrides,
  };
}

export async function captureFromPage(browser, context, page) {
  const controller = new AbortController();
  let capture;
  let closing = false;
  try {
    capture = captureToken({
      context, timeoutMs: 900000, signal: controller.signal, closeAfterCapture: async () => {
        closing = true;
        await browser.close();
      },
    });
    const navigation = page.goto('https://home.startrekfleetcommand.com/store').catch(error => {
      if (closing && error instanceof Error && /Target page, context or browser has been closed/.test(error.message)) return;
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

async function main() {
  if (!['--publish', '--verify-only'].includes(process.argv[2]) || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run in a private interactive terminal.');
  }
  if (process.argv[2] === '--publish') {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (await terminal.question(`Type YES only if this exact secret name is approved, no other writer will use it, and it will be retained until safely incorporated: ${REFRESH_SECRET}\n`) !== 'YES') {
        throw new Error('Publishing approval was not confirmed.');
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
    console.log('Sign in and enter the email OTP directly in the official browser. No credentials belong in this terminal.');
    const { token } = await captureFromPage(browser, context, page);
    if (!token) throw new Error('Login timed out.');
    await verifiedIdentity(token);
    await verifyGiftAccess(token);
    if (process.argv[2] === '--publish') {
      assertSecretAbsent();
      const result = runGithubSecretCommand(['secret', 'set', REFRESH_SECRET], {
        input: JSON.stringify({ token }), stdio: ['pipe', 'ignore', 'ignore'],
      });
      if (result.status !== 0) throw new Error('Encrypted override update failed.');
      console.log('Encrypted override saved; run the recovery authentication workflow to verify inventory matching.');
    } else {
      console.log('Non-redeeming authentication and gift-list access passed. No credential was saved or published.');
    }
  } finally {
    await browser.close();
  }
}

function assertSecretAbsent() {
  const result = runGithubSecretCommand(['secret', 'list', '--json', 'name'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot verify secret names.');
  const secrets = JSON.parse(result.stdout);
  if (!Array.isArray(secrets) || secrets.some(secret => !secret || typeof secret.name !== 'string' || secret.name === REFRESH_SECRET)) {
    throw new Error('The proposed override name already exists; refusing to replace it.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Secure account refresh failed; no inventory update or redemption was attempted. Check approval, secret-name availability, and authentication.');
    process.exitCode = 1;
  });
}
