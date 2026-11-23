import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { captureToken } from './capture-token.mjs';
import { parseDocument } from 'yaml';
import { isTokenAccounts } from '../shared/token-account-schema.mjs';
import { createInterface } from 'node:readline/promises';

const API = 'https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/auth/me';

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
  if (response.status !== 200 || response.redirected) throw new Error('Authentication rejected.');
  const id = identifier(document(await response.text())?.payload?.accountId);
  if (!id) throw new Error('Verified account identity is unavailable.');
  return id;
}

export async function mergeRefreshedAccount(raw, refreshed, fetchImpl = fetch) {
  let accounts, candidate;
  try {
    accounts = JSON.parse(raw);
    candidate = JSON.parse(refreshed);
    if (!isTokenAccounts(accounts) || !isTokenAccounts([{ name: 'candidate', token: candidate?.token }])) {
      throw new Error();
    }
    const id = await verifiedIdentity(candidate.token, fetchImpl);
    const matches = accounts.filter(account => {
      const payload = document(Buffer.from(account.token.split('.')[1], 'base64url').toString('utf8'));
      const existingId = identifier(payload?.accountId);
      if (!existingId) throw new Error();
      return existingId === id;
    });
    if (matches.length !== 1) throw new Error();
    return accounts.map(account => account === matches[0] ? { ...account, token: candidate.token } : account);
  } catch {
    throw new Error('Account refresh identity is missing, ambiguous, mismatched, or unverifiable; inventory was not changed.');
  }
}

async function main() {
  if (process.argv[2] !== '--publish' || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run in a private interactive terminal with --publish only after override-secret approval.');
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ((await terminal.question('Type YES only if the override secret is approved and you are the sole recovery operator: ')) !== 'YES') {
      throw new Error('Recovery approval was not confirmed.');
    }
  } finally {
    terminal.close();
  }
  const access = spawnSync('gh', ['api', 'repos/Jamula/stfc/actions/secrets/public-key'], { stdio: 'ignore' });
  if (access.status !== 0) throw new Error('GitHub Actions secret access is unavailable.');
  const inventory = spawnSync('gh', ['secret', 'list', '--repo', 'Jamula/stfc', '--json', 'name'], { encoding: 'utf8' });
  if (inventory.status !== 0 || JSON.parse(inventory.stdout).some(secret => secret.name === 'STFC_ACCOUNT_REFRESH')) {
    throw new Error('An existing override must be reconciled before another refresh.');
  }
  const browser = await chromium.launch({ headless: false });
  const controller = new AbortController();
  let capture;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    capture = captureToken({
      context, timeoutMs: 900000, signal: controller.signal, closeAfterCapture: () => browser.close(),
    });
    capture.catch(() => {});
    console.log('Sign in and enter the email OTP directly in the official browser. No credentials belong in this terminal.');
    await page.goto('https://home.startrekfleetcommand.com/store');
    const { token } = await capture;
    if (!token) throw new Error('Login timed out.');
    await verifiedIdentity(token);
    const current = spawnSync('gh', ['secret', 'list', '--repo', 'Jamula/stfc', '--json', 'name'], { encoding: 'utf8' });
    if (current.status !== 0 || JSON.parse(current.stdout).some(secret => secret.name === 'STFC_ACCOUNT_REFRESH')) {
      throw new Error('An override appeared during login; refusing to replace it.');
    }
    const result = spawnSync('gh', ['secret', 'set', 'STFC_ACCOUNT_REFRESH', '--repo', 'Jamula/stfc'], {
      input: JSON.stringify({ token }), stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (result.status !== 0) throw new Error('Encrypted override update failed.');
    console.log('Non-redeeming authentication passed. Encrypted refresh override saved; inventory matching still requires the auth-check workflow.');
  } finally {
    controller.abort();
    await browser.close();
    await capture?.catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Secure account refresh failed; no inventory update or redemption was attempted.');
    process.exitCode = 1;
  });
}
