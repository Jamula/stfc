#!/usr/bin/env node
// Interactive Playwright JWT capture for the STFC web store.
// Interactive recovery verifies the captured token against an independently
// obtained account identifier before changing any account.
//
// USAGE
//   npm run capture-token
//   npm run capture-token -- --name alt
//   npm run capture-token -- --name main --timeout 600 --debug --force
//
// WHAT IT DOES
//   1. Launches a visible Chromium window.
//   2. Watches the BrowserContext's network traffic for either:
//      a) a POST to .../api/v2/auth/login whose response body contains
//         { accessToken: <STFC store JWT> }, OR
//      b) any outgoing request to the STFC API carrying an
//         "Authorization: Bearer <token>" header.
//   3. Interactive capture drains login requests and response reads before
//      closing the browser; unresolved, cancelled, or ambiguous work fails closed.
//      It validates the captured token with GET /auth/me before proceeding.
//   4. Merges the validated token into a local .env (preserving any
//      other accounts already in STFC_ACCOUNTS).
//   5. Writes only to the local .env. Hosted token updates use the owner-only PWA.
//
// We ALWAYS use a fresh, non-persistent browser context. You will need to
// log in fresh every run; this is by design — it forces /auth/login to
// fire and avoids storing browser session material on disk.

import {
  chromium,
  type Browser,
  type BrowserContext,
  type ElementHandle,
  type Frame,
  type Locator,
  type Page,
} from "playwright";
import { promises as fs, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

export interface TokenCaptureContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: "request" | "response" | "requestfinished" | "requestfailed", listener: (arg: any) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: "request" | "response" | "requestfinished" | "requestfailed", listener: (arg: any) => void): unknown;
}

export type OtpEntry =
  | { kind: "single"; el: ElementHandle<HTMLElement | SVGElement>; frame: Frame }
  | { kind: "split"; boxes: Locator; count: number; frame: Frame };

export interface CapturedAccount {
  name: string;
  token: string;
}

export interface CapturedToken {
  token: string | null;
  source: string;
}

export interface TokenValidation {
  ok: boolean;
  status: number;
  error?: string;
}

export interface PrivateInputStream {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
  resume?: () => void;
  pause?: () => void;
  on?: ((event: "data", listener: (chunk: Buffer) => void) => unknown) &
    ((event: "error", listener: () => void) => unknown);
  off?: ((event: "data", listener: (chunk: Buffer) => void) => unknown) &
    ((event: "error", listener: () => void) => unknown);
}

export interface PrivateOutputStream {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface PrivateStreamOptions {
  stdin?: PrivateInputStream;
  stdout?: PrivateOutputStream;
  allowUnicode?: boolean;
}

export type IdentityFetchImpl = (
  url: string,
  options: {
    headers: { Accept: string; Authorization: string };
    redirect: "error";
    signal: AbortSignal;
  },
) => Promise<Response>;

export interface CaptureMainDependencies {
  ask?: (prompt: string, def?: boolean) => Promise<boolean>;
  envPath?: string;
  privateTerminal?: boolean;
  readAccountName?: () => Promise<string>;
  readExpectedAccountId?: () => Promise<string>;
  launchBrowser?: (options: { headless: boolean }) => Promise<BrowserLike>;
  fetchIdentity?: IdentityFetchImpl;
  ghAvailable?: () => Promise<boolean>;
  setSecret?: () => Promise<void>;
}

interface BrowserLike {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike extends TokenCaptureContext {
  newPage(): Promise<PageLike>;
  cookies?(): Promise<BrowserCookieLike[]>;
}

interface BrowserCookieLike {
  name: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  expires: number;
  value: string;
}

type PageLike = {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
} & Partial<Omit<Page, "goto">>;

interface CaptureRequestLike {
  url(): string;
  method?(): string;
  headers(): Record<string, string | undefined>;
}

interface CaptureResponseLike {
  url(): string;
  request(): CaptureRequestLike;
  json(): Promise<unknown>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const DIAGNOSTICS_DIR = path.join(REPO_ROOT, "playwright-diagnostics");

const STORE_URL = "https://home.startrekfleetcommand.com/store";
const API_BASE = "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2";
const API_HOST = "cdn-nv3-webstore-api.startrek.digitgaming.com";

// ----------------------------------------------------------------------------
// Tiny argv parser (no extra deps).
// ----------------------------------------------------------------------------

interface ParsedCaptureArgs {
  name: string;
  explicitName: boolean;
  timeout: number;
  debug: boolean;
  force: boolean;
  help: boolean;
  invalid: boolean;
  ci: boolean;
  headless: boolean;
}

function parseArgs(argv: readonly string[]): ParsedCaptureArgs {
  const out: ParsedCaptureArgs = {
    name: "main",
    explicitName: false,
    timeout: 300,
    debug: false,
    force: false,
    help: false,
    invalid: false,
    ci: false,
    headless: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--name" && next) {
      out.name = next;
      out.explicitName = true;
      i++;
      continue;
    }
    if (a === "--timeout" && next) {
      out.timeout = Number(next);
      i++;
      continue;
    }
    if (a === "--debug") {
      out.debug = true;
      continue;
    }
    if (a === "--force") {
      out.force = true;
      continue;
    }
    if (a === "--ci") {
      out.ci = true;
      continue;
    }
    if (a === "--headless") {
      out.headless = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    console.error(`Unknown arg: ${a}`);
    out.invalid = true;
  }
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) {
    console.error(`Invalid --timeout: must be a positive number of seconds`);
    out.invalid = true;
  }
  if (out.name.length === 0) {
    console.error(`--name must be non-empty`);
    out.invalid = true;
  }
  return out;
}

function printUsage(): void {
  console.log(`
Usage: npm run capture-token -- [--name <accountName>] [--timeout <seconds>] [--debug] [--force] [--ci] [--headless]

  --name      Account label in --ci mode. Interactive recovery reads it privately.
  --timeout   How long to wait for the login flow (in seconds). Default: 300.
  --debug     On capture failure, prompt to write redacted localStorage /
              sessionStorage / cookie diagnostics. Never includes raw values.
  --force     Allow overwriting an existing STFC_ACCOUNTS entry that fails to
              parse as JSON. Default: refuse and exit non-zero.
  --ci        Headless, non-interactive mode for GitHub Actions. Outputs the
              captured JWT as JSON {"name":"<name>","token":"<jwt>"} to stdout
              (everything else goes to stderr). Skips .env writes and gh
              prompts. Requires STFC_EMAIL + STFC_PASSWORD env vars.
  --headless  Not supported outside --ci: account identity cannot be verified
              without a visible browser.

Environment variables:
  STFC_EMAIL     If set, the script auto-fills the Scopely email form. Combined
                 with STFC_PASSWORD the full password flow is attempted too.
                 For OTP-only accounts, only STFC_EMAIL is needed.
  STFC_PASSWORD  See above. NEVER pass on the command line — always via env
                 or a .env file. Required when --ci is set.
`);
}

// ----------------------------------------------------------------------------
// JWT helpers (decode-only; signature not verified — we don't have the key).
// ----------------------------------------------------------------------------

function isJwtShaped(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const parts = s.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

// ----------------------------------------------------------------------------
// Network capture.
// ----------------------------------------------------------------------------

async function drainPendingResponses(
  pending: Set<Promise<void>>,
  pendingLoginRequests: Set<object>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const quietMs = 100;
  let quietSince: number | null = Date.now();
  while (Date.now() < deadline) {
    if (pending.size > 0 || pendingLoginRequests.size > 0) {
      quietSince = null;
      const jobs = [...pending];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.min(25, deadline - Date.now()));
      });
      try {
        if (jobs.length > 0) await Promise.race([Promise.allSettled(jobs), timeout]);
        else await timeout;
      } finally {
        clearTimeout(timer);
      }
      continue;
    }
    if (quietSince === null) quietSince = Date.now();
    if (Date.now() - quietSince >= quietMs) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, deadline - Date.now())));
  }
  return false;
}

async function captureToken({
  context,
  timeoutMs,
  closeAfterCapture,
  signal,
  responseDrainTimeoutMs = 5000,
}: {
  context: TokenCaptureContext;
  timeoutMs: number;
  closeAfterCapture?: () => Promise<void>;
  signal?: AbortSignal;
  responseDrainTimeoutMs?: number;
}): Promise<CapturedToken> {
  let resolve!: (value: CapturedToken) => void;
  const captured = new Promise<CapturedToken>((r) => {
    resolve = r;
  });
  let first: CapturedToken | null = null;
  let changed = false;
  let ambiguous = false;
  const pending = new Set<Promise<void>>();
  const pendingLoginRequests = new Set<object>();
  const loginRequests = new WeakSet<object>();
  const win = (token: unknown, source: string) => {
    if (!isJwtShaped(token)) {
      ambiguous = true;
      return;
    }
    if (first) {
      if (first.token !== token) changed = true;
      return;
    }
    first = { token, source };
    resolve(first);
  };

  const onResponse = (res: CaptureResponseLike) => {
    let request: CaptureRequestLike;
    try {
      const url = new URL(res.url());
      if (url.protocol !== "https:" || url.host !== API_HOST || url.pathname !== "/api/v2/auth/login") return;
      request = res.request();
      if (request.method?.() !== "POST") return;
      if (!loginRequests.has(request)) {
        loginRequests.add(request);
        pendingLoginRequests.add(request);
      }
    } catch {
      if (closeAfterCapture && first) ambiguous = true;
      return;
    }
    const job = (async () => {
      try {
        const body = (await res.json()) as { accessToken?: unknown } | null;
        if (typeof body?.accessToken === "string") win(body.accessToken, "POST /auth/login response");
        else if (closeAfterCapture) ambiguous = true;
      } catch {
        if (closeAfterCapture) ambiguous = true;
      }
    })();
    pending.add(job);
    job.then(
      () => pending.delete(job),
      () => pending.delete(job),
    );
  };

  const onRequest = (req: CaptureRequestLike) => {
    try {
      const url = new URL(req.url());
      if (url.protocol !== "https:" || url.host !== API_HOST) return;
      if (url.pathname === "/api/v2/auth/login" && req.method?.() === "POST") {
        loginRequests.add(req);
        pendingLoginRequests.add(req);
      }
      const auth = req.headers()["authorization"];
      if (typeof auth === "string" && auth.startsWith("Bearer ")) {
        const token = auth.slice("Bearer ".length).trim();
        if (token.length > 0) win(token, "request header");
      }
    } catch {
      if (closeAfterCapture && first) ambiguous = true;
    }
  };

  const onRequestFinished = (req: object) => {
    if (loginRequests.has(req)) pendingLoginRequests.delete(req);
  };

  const onRequestFailed = (req: object) => {
    if (!loginRequests.has(req)) return;
    pendingLoginRequests.delete(req);
    if (closeAfterCapture) ambiguous = true;
  };

  context.on("response", onResponse);
  context.on("request", onRequest);
  context.on("requestfinished", onRequestFinished);
  context.on("requestfailed", onRequestFailed);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CapturedToken>((r) => {
    timer = setTimeout(() => r({ token: null, source: "timeout" }), timeoutMs);
  });
  let onAbort: (() => void) | undefined;
  const aborted = signal
    ? new Promise<CapturedToken>((r) => {
        onAbort = () => r({ token: null, source: "aborted" });
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      })
    : new Promise<CapturedToken>(() => {});
  try {
    const result = await Promise.race([captured, timeout, aborted]);
    if (result.token && closeAfterCapture) {
      if (!(await drainPendingResponses(pending, pendingLoginRequests, responseDrainTimeoutMs))) ambiguous = true;
      await closeAfterCapture();
      if (!(await drainPendingResponses(pending, pendingLoginRequests, responseDrainTimeoutMs))) ambiguous = true;
      if (changed || ambiguous) throw new Error("Capture was ambiguous or the browser token changed; no update was written.");
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort && signal) signal.removeEventListener("abort", onAbort);
    context.off("response", onResponse);
    context.off("request", onRequest);
    context.off("requestfinished", onRequestFinished);
    context.off("requestfailed", onRequestFailed);
  }
}

function accountId(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? String(value) : null;
  if (typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value)) return value;
  return null;
}

function parseAccountId(text: string): string | null {
  JSON.parse(text);
  const doc = parseDocument(text, { schema: "json", uniqueKeys: true, intAsBigInt: true });
  if (doc.errors.length || doc.warnings.length) return null;
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const payload = (value as Record<string, unknown>)["payload"];
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return null;
  return accountId((payload as Record<string, unknown>)["accountId"]);
}

async function verifyAccountId(
  token: string,
  expectedId: string,
  fetchImpl: IdentityFetchImpl = fetch as unknown as IdentityFetchImpl,
): Promise<boolean> {
  if (!isJwtShaped(token) || !accountId(expectedId)) return false;
  try {
    const response = await fetchImpl(`${API_BASE}/auth/me`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200 || response.redirected) return false;
    const actual = parseAccountId(await response.text());
    return actual !== null && actual === expectedId;
  } catch {
    return false;
  }
}

async function validateToken(token: string): Promise<TokenValidation> {
  try {
    const r = await fetch(`${API_BASE}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// .env merge.
// ----------------------------------------------------------------------------

function unquoteEnvValue(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1);
      if (first === '"') {
        v = v.replace(/\\(["\\nrt])/g, (_m, c: string) =>
          c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
        );
      }
    }
  }
  return v;
}

function quoteEnvValue(v: string): string {
  if (/['\r\n]/.test(v)) {
    throw new Error("STFC_ACCOUNTS cannot be safely represented in a single-quoted .env value.");
  }
  return `'${v}'`;
}

async function readEnv(
  envPath = ENV_PATH,
): Promise<{ exists: boolean; raw: string | null; lines: string[] }> {
  if (!existsSync(envPath)) return { exists: false, raw: null, lines: [] };
  const raw = await fs.readFile(envPath, "utf8");
  return { exists: true, raw, lines: raw.split(/\r?\n/) };
}

// JSON.parse validates syntax; keep each original array element's bytes so
// unrelated metadata (including numbers outside JS's safe range) survives.
function arrayElements(json: string): string[] {
  const elements: string[] = [];
  let start = 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 1; i < json.length; i++) {
    const c = json[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || (c === "]" && depth > 0)) depth--;
    else if (depth === 0 && (c === "," || c === "]")) {
      const element = json.slice(start, i).trim();
      if (element) elements.push(element);
      if (c === "]") break;
      start = i + 1;
    }
  }
  return elements;
}

async function mergeIntoEnv({
  name,
  token,
  force,
  _envPath = ENV_PATH,
  _expectedRaw,
  _beforeReplace,
  _rename = fs.rename,
}: {
  name: string;
  token: string;
  force: boolean;
  _envPath?: string;
  _expectedRaw?: string | null;
  _beforeReplace?: () => Promise<void>;
  _rename?: (source: string, destination: string) => Promise<void>;
}): Promise<CapturedAccount[] & { secretJson: string; envRaw: string }> {
  const { exists, raw, lines } = await readEnv(_envPath);
  if (_expectedRaw !== undefined && raw !== _expectedRaw) {
    throw new Error(".env changed during capture; no update was written.");
  }
  const newAccount: CapturedAccount = { name, token };

  let existingIdx = -1;
  let existingLine = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^(\s*STFC_ACCOUNTS\s*=)(.*)$/);
    if (m?.[2] !== undefined) {
      existingIdx = i;
      existingLine = m[2];
      break;
    }
  }

  let merged: CapturedAccount[];
  let elements: string[];
  if (existingIdx === -1) {
    merged = [newAccount];
    elements = [JSON.stringify(newAccount)];
  } else {
    let parsed: unknown;
    let original: string;
    try {
      original = unquoteEnvValue(existingLine).trim();
      parsed = JSON.parse(original);
    } catch {
      if (!force) {
        throw new Error(
          `${_envPath} line ${existingIdx + 1} has STFC_ACCOUNTS that does not parse as JSON.\n` +
            `Re-run with --force to overwrite, or fix the value manually.`,
        );
      }
      parsed = [];
      original = "[]";
    }
    if (!Array.isArray(parsed)) {
      if (!force) {
        throw new Error(
          `${_envPath} line ${existingIdx + 1} STFC_ACCOUNTS is JSON but not an array.\n` +
            `Re-run with --force to overwrite, or fix the value manually.`,
        );
      }
      parsed = [];
      original = "[]";
    }
    const items = parsed as Array<Record<string, unknown> | null | undefined>;
    elements = arrayElements(original);
    const idx = items.findIndex((a) => a && a["name"] === name);
    if (idx >= 0) {
      const current = items[idx];
      if (
        !current ||
        items.filter((a) => a && a["name"] === name).length !== 1 ||
        Object.keys(current).some((key) => key !== "name" && key !== "token")
      ) {
        throw new Error("Selected account is duplicated or has additional fields; refusing to discard data.");
      }
      items[idx] = { name, token };
      elements[idx] = JSON.stringify(newAccount);
    } else {
      items.push({ name, token });
      elements.push(JSON.stringify(newAccount));
    }
    merged = items as unknown as CapturedAccount[];
  }

  const secretJson = `[${elements.join(",")}]`;
  const newLine = `STFC_ACCOUNTS=${quoteEnvValue(secretJson)}`;
  let newLines: string[];
  if (existingIdx === -1) {
    newLines = exists ? [...lines, newLine] : [newLine, ""];
  } else {
    newLines = [...lines];
    newLines[existingIdx] = newLine;
  }
  const updatedRaw = newLines.join("\n");
  const stagePath = path.join(path.dirname(_envPath), ".env.local");
  let created = false;
  try {
    const stage = await fs.open(stagePath, "wx", 0o600);
    created = true;
    try {
      await stage.writeFile(updatedRaw, "utf8");
      await stage.sync();
    } finally {
      await stage.close();
    }
    if (_beforeReplace) await _beforeReplace();
    if ((await readEnv(_envPath)).raw !== raw) throw new Error(".env changed during capture; no update was written.");
    await _rename(stagePath, _envPath);
    created = false;
  } finally {
    if (created) await fs.unlink(stagePath).catch(() => {});
  }
  const result = merged as CapturedAccount[] & { secretJson: string; envRaw: string };
  Object.defineProperty(result, "secretJson", { value: secretJson });
  Object.defineProperty(result, "envRaw", { value: updatedRaw });
  return result;
}

async function mergeAfterIdentityConfirmation({
  name,
  token,
  force,
  baseline,
  expectedId,
  envPath = ENV_PATH,
  verify = verifyAccountId,
}: {
  name: string;
  token: string;
  force: boolean;
  baseline: string | null;
  expectedId: string;
  envPath?: string;
  verify?: (token: string, expectedId: string) => Promise<boolean>;
}): Promise<CapturedAccount[] & { secretJson: string; envRaw: string }> {
  if (!(await verify(token, expectedId))) {
    throw new Error("Token identity could not be verified against the expected account; no update was written.");
  }
  return mergeIntoEnv({ name, token, force, _envPath: envPath, _expectedRaw: baseline });
}

function validateRecoveryBaseline(raw: string | null, name: string): void {
  if (typeof raw !== "string") throw new Error("A complete local backup is required.");
  const lines = raw.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?STFC_ACCOUNTS\s*=/.test(line));
  if (lines.length !== 1 || lines[0] === undefined) {
    throw new Error("The backup must contain exactly one STFC_ACCOUNTS entry.");
  }
  if (/^\s*export\s+/.test(lines[0])) throw new Error("Exported STFC_ACCOUNTS entries are unsupported.");
  const text = unquoteEnvValue(lines[0].replace(/^\s*STFC_ACCOUNTS\s*=/, "")).trim();
  try {
    const parsed: unknown = JSON.parse(text);
    const doc = parseDocument(text, { schema: "json", uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length || !Array.isArray(parsed) || parsed.length === 0) {
      throw new Error();
    }
    const names = new Set<string>();
    for (const item of parsed as unknown[]) {
      if (!item || Array.isArray(item) || typeof item !== "object") throw new Error();
      const rec = item as Record<string, unknown>;
      const itemName = rec["name"];
      if (typeof itemName !== "string" || !itemName.trim() || !isJwtShaped(rec["token"]) || names.has(itemName)) {
        throw new Error();
      }
      names.add(itemName);
    }
    const target = (parsed as Array<Record<string, unknown>>).filter((item) => item["name"] === name);
    if (target.length !== 1 || !target[0] || Object.keys(target[0]).some((key) => key !== "name" && key !== "token")) {
      throw new Error();
    }
  } catch {
    throw new Error("The backup or selected account is invalid or ambiguous; no update was written.");
  }
}

// ----------------------------------------------------------------------------
// Diagnostics dump (redacted; no raw values).
// ----------------------------------------------------------------------------

async function dumpDiagnostics(context: BrowserContext, page: Page): Promise<string> {
  await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
  const filename = path.join(DIAGNOSTICS_DIR, `diag-${Date.now()}.json`);

  const storage = await page.evaluate(() => {
    const summarize = (s: Storage) => {
      const out: Record<string, { length: number; type: string; jwtShape: boolean }> = {};
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k === null) continue;
        const v = s.getItem(k) ?? "";
        const jwt = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(v);
        out[k] = { length: v.length, type: typeof v, jwtShape: jwt };
      }
      return out;
    };
    return {
      localStorage: summarize(window.localStorage),
      sessionStorage: summarize(window.sessionStorage),
    };
  });

  const cookies = (await context.cookies()).map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    expiresInSeconds: c.expires === -1 ? null : Math.floor(c.expires - Date.now() / 1000),
    valueLength: c.value.length,
  }));

  const dump = { capturedAt: new Date().toISOString(), storage, cookies };
  await fs.writeFile(filename, JSON.stringify(dump, null, 2), "utf8");
  return filename;
}

// ----------------------------------------------------------------------------
// User prompts.
// ----------------------------------------------------------------------------

async function confirm(prompt: string, def = false): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question(`${prompt} [${def ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
    if (ans === "") return def;
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

async function readPrivateValue(
  prompt: string,
  { stdin = input as unknown as PrivateInputStream, stdout = output as unknown as PrivateOutputStream, allowUnicode = false }: PrivateStreamOptions = {},
): Promise<string> {
  if (
    !stdin.isTTY ||
    !stdout.isTTY ||
    typeof stdin.setRawMode !== "function" ||
    typeof stdin.on !== "function" ||
    typeof stdin.off !== "function"
  ) {
    throw new Error("A private interactive terminal is required.");
  }
  const setRawMode = stdin.setRawMode.bind(stdin);
  const addListener = stdin.on.bind(stdin);
  const removeListener = stdin.off.bind(stdin);
  stdout.write(prompt);
  return new Promise<string>((resolve, reject) => {
    let value = "";
    let invalid = false;
    const decoder = new StringDecoder("utf8");
    const wasRaw = stdin.isRaw;
    const finish = (error: boolean) => {
      removeListener("data", onData);
      removeListener("error", onError);
      try {
        setRawMode(Boolean(wasRaw));
      } catch {
        error = true;
      }
      stdin.pause?.();
      stdout.write("\n");
      if (error || invalid || !value || value !== value.trim()) {
        reject(new Error("Private input was cancelled or invalid."));
      } else {
        resolve(value);
      }
    };
    const onError = () => finish(true);
    const onData = (chunk: Buffer) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\r" || char === "\n") {
          finish(false);
          return;
        }
        if (char === "\x03" || char === "\x04") {
          finish(true);
          return;
        }
        if (char === "\x08" || char === "\x7f") {
          const codePoints = Array.from(value);
          codePoints.pop();
          value = codePoints.join("");
        } else if (
          (/^[\x20-\x7e]$/.test(char) || (allowUnicode && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(char))) &&
          value.length < 256
        ) {
          value += char;
        } else {
          invalid = true;
        }
      }
    };
    addListener("data", onData);
    addListener("error", onError);
    try {
      setRawMode(true);
      stdin.resume?.();
    } catch {
      finish(true);
    }
  });
}

async function readAccountName(streams?: PrivateStreamOptions): Promise<string> {
  return readPrivateValue("Enter the exact existing account label (hidden): ", {
    ...streams,
    allowUnicode: true,
  });
}

async function readExpectedAccountId(streams?: PrivateStreamOptions): Promise<string> {
  const value = await readPrivateValue(
    "Enter the accountId from the independently authenticated /auth/me response (hidden): ",
    streams,
  );
  if (!accountId(value)) throw new Error("Account identifier input was cancelled or invalid.");
  return value;
}

// ----------------------------------------------------------------------------
// Auto-login (Scopely Okta).
// ----------------------------------------------------------------------------

const OTP_SELECTORS: string[] = [
  'input[autocomplete="one-time-code"]',
  'input[name="credentials.passcode"]',
  'input[data-se="o-form-input-passcode"]',
  'input[type="text"][maxlength="6"]',
  'input[type="tel"][maxlength="6"]',
];

const SPLIT_OTP_SELECTOR = [
  'input[maxlength="1"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[data-testid*="otp" i]',
  'input[class*="otp" i]',
  'input[aria-label*="digit" i]',
].join(", ");

async function findOtpEntry(page: Page): Promise<OtpEntry | null> {
  for (const frame of page.frames()) {
    for (const sel of OTP_SELECTORS) {
      const el = await frame.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) {
        return { kind: "single", el: el as ElementHandle<HTMLElement | SVGElement>, frame };
      }
    }

    const boxes = frame.locator(SPLIT_OTP_SELECTOR);
    const count = await boxes.count().catch(() => 0);
    if (count >= 4 && (await boxes.first().isVisible().catch(() => false))) {
      return { kind: "split", boxes, count, frame };
    }
  }
  return null;
}

async function fillOtp(page: Page, entry: OtpEntry, code: string): Promise<void> {
  if (entry.kind === "single") {
    await entry.el.fill(code);
    return;
  }

  const digits = code.replace(/\D/g, "").split("");
  const limit = Math.min(digits.length, entry.count);
  for (let i = 0; i < limit; i++) {
    const box = entry.boxes.nth(i);
    const digit = digits[i];
    if (digit === undefined) continue;
    await box.click({ timeout: 2_000 }).catch(() => {});
    try {
      await box.fill(digit);
    } catch {
      await page.keyboard.type(digit, { delay: 30 }).catch(() => {});
    }
  }
}

async function promptAndSubmitOtp({
  page,
  entry,
  log,
  maxAttempts = 3,
  headless = false,
}: {
  page: Page;
  entry: OtpEntry;
  log: (...args: unknown[]) => void;
  maxAttempts?: number;
  headless?: boolean;
}): Promise<boolean> {
  const OTP_ERROR_SELECTORS = [
    '[data-se="o-form-error-container"]:not(:empty)',
    ".okta-form-infobox-error",
    "p.okta-error-container",
    '[role="alert"]',
    ':text("Invalid code")',
    ':text("Incorrect code")',
    ':text("Code is invalid")',
    ':text("Enter a valid")',
    ':text("does not match")',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptLabel = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
    let code: string | undefined;

    const envOtp = process.env["STFC_OTP"]?.trim();
    if (envOtp) {
      log(`auto-login: using OTP from STFC_OTP env var${attemptLabel}`);
      code = envOtp;
    } else if (headless) {
      log("auto-login: headless OTP challenge requires STFC_OTP env var — aborting.");
      return false;
    } else {
      const rl = createInterface({ input, output });
      try {
        code = (
          await rl.question(
            `\n>>> Scopely sent a 6-digit verification code to your email.\n>>> Enter the code now${attemptLabel}: `,
          )
        ).trim();
      } finally {
        rl.close();
      }
      if (!code) {
        log("auto-login: no code entered — falling back to interactive login.");
        return false;
      }
    }

    const currentEntry = (await findOtpEntry(page)) ?? entry;
    await fillOtp(page, currentEntry, code);
    await clickFirstAvailable(page, [
      'button:has-text("Verify")',
      'button:has-text("Submit")',
      'button:has-text("Sign in")',
      'button[type="submit"]',
      "button.ant-btn-primary",
    ]);

    await page.waitForTimeout(2_000);

    let rejected = false;
    for (const sel of OTP_ERROR_SELECTORS) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) {
        const text = await el.textContent().catch(() => "");
        if (/haven't received|send again|resend/i.test(text ?? "")) continue;
        log(`auto-login: OTP rejected (attempt ${attempt}/${maxAttempts}): "${text?.trim().slice(0, 80)}"`);
        rejected = true;
        break;
      }
    }

    if (!rejected) {
      log("auto-login: OTP submitted. Network listeners will catch the resulting JWT.");
      return true;
    }

    if (attempt < maxAttempts) {
      log(`auto-login: will re-prompt for the code.`);
    }
  }

  log(`auto-login: OTP rejected after ${maxAttempts} attempt(s) — falling back to interactive login.`);
  return false;
}

async function tryAutoLogin(
  page: Page,
  {
    email,
    password,
    log,
    err,
    ci,
    headless = false,
  }: {
    email: string;
    password: string;
    log: (...args: unknown[]) => void;
    err: (...args: unknown[]) => void;
    ci: boolean;
    headless?: boolean;
  },
): Promise<boolean> {
  if (!(await beginEmailLogin(page, email, log))) return false;

  log("auto-login: waiting for password-switch link or OTP input…");
  const PASSWORD_SWITCH_SELECTOR =
    'a:has-text("Sign in with password instead"), a.switchAuthenticator, a:has-text("password instead"), button:has-text("Sign in with password instead")';

  let gotPasswordSwitch = false;
  let primaryOtpEntry: OtpEntry | null = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    primaryOtpEntry = await findOtpEntry(page);
    if (primaryOtpEntry) break;
    const switchEl = page.locator(PASSWORD_SWITCH_SELECTOR).first();
    if ((await switchEl.count()) > 0) {
      try {
        await switchEl.click({ timeout: 2_000 });
        gotPasswordSwitch = true;
      } catch {
        /* retry */
      }
      if (gotPasswordSwitch) break;
    }
    await page.waitForTimeout(500);
  }

  if (primaryOtpEntry) {
    log(`auto-login: email code (primary OTP) challenge detected — ${primaryOtpEntry.kind} input.`);
    if (ci && !process.env["STFC_OTP"]?.trim()) {
      err(
        "auto-login: email-code challenge requires user input and cannot run unattended. Run the workflow manually via workflow_dispatch with an otp input.",
      );
      process.exit(2);
    }
    const submitted = await promptAndSubmitOtp({ page, entry: primaryOtpEntry, log, headless: ci || headless });
    if (!submitted) return false;
    return true;
  }

  if (!gotPasswordSwitch) {
    log("auto-login: neither a password-switch link nor an OTP field appeared within 30s — falling back to interactive login.");
    return false;
  }

  if (!password) {
    log("auto-login: no STFC_PASSWORD set — skipping password step (OTP-only account assumed).");
  } else {
    log("auto-login: waiting for password field…");
    const passwordField = await waitForFirstSelector(
      page,
      ['input[type="password"]', 'input[name="password"]'],
      15_000,
    );
    if (!passwordField) {
      log("auto-login: no password field appeared within 15s — falling back to interactive login.");
      return false;
    }
    log("auto-login: filling password and clicking Sign in");
    await passwordField.fill(password);
    await clickFirstAvailable(page, [
      'button:has-text("Sign in")',
      'button[type="submit"]',
      "button.ant-btn-primary",
    ]);

    log("auto-login: submitted credentials, waiting for secondary MFA/OTP challenge or JWT…");

    let secondaryOtpEntry: OtpEntry | null = null;
    const secondaryDeadline = Date.now() + 15_000;
    while (Date.now() < secondaryDeadline) {
      secondaryOtpEntry = await findOtpEntry(page);
      if (secondaryOtpEntry) break;
      await page.waitForTimeout(500);
    }
    if (secondaryOtpEntry) {
      log(`auto-login: secondary MFA/OTP challenge detected — ${secondaryOtpEntry.kind} input.`);
      if (ci && !process.env["STFC_OTP"]?.trim()) {
        err(
          "auto-login: MFA challenge requires user input and cannot run unattended. Run the workflow manually via workflow_dispatch with an otp input.",
        );
        process.exit(2);
      }
      const submitted = await promptAndSubmitOtp({ page, entry: secondaryOtpEntry, log, headless: ci || headless });
      if (!submitted) return false;
    } else {
      log("auto-login: no secondary OTP challenge detected. Network listeners will catch the resulting JWT.");
    }
  }

  return true;
}

async function waitForFirstSelector(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<ElementHandle<HTMLElement | SVGElement> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) {
        return el as ElementHandle<HTMLElement | SVGElement>;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function clickFirstAvailable(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false))) {
      try {
        await el.click();
        return true;
      } catch {
        /* Try the next known submit control. */
      }
    }
  }
  return false;
}

async function beginEmailLogin(
  page: Page,
  email: string,
  log: (...args: unknown[]) => void = () => {},
): Promise<boolean> {
  log("auto-login: dismissing cookie banner if present");
  for (const sel of ["#onetrust-accept-btn-handler", "#onetrust-reject-all-handler"]) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }

  log("auto-login: clicking Sign in with Scopely (modal)");
  try {
    const btn = page.locator("#log-in-button").last();
    await btn.waitFor({ state: "visible", timeout: 30_000 });
    await btn.click({ timeout: 10_000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`auto-login: could not click Sign in with Scopely (${msg.slice(0, 100)}).`);
    return false;
  }

  log("auto-login: waiting for Scopely email form");
  const emailField = await waitForFirstSelector(
    page,
    ['input[name="email"]', 'input[type="email"]', "input.ant-input"],
    60_000,
  );
  if (!emailField) {
    log("auto-login: no email field appeared within 60s.");
    return false;
  }
  await emailField.fill(email);
  return clickFirstAvailable(page, [
    'button:has-text("Continue")',
    'button[type="submit"]',
    "button.ant-btn-primary",
  ]);
}

// ----------------------------------------------------------------------------
// Main.
// ----------------------------------------------------------------------------

async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CaptureMainDependencies = {},
): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || args.invalid) {
    printUsage();
    process.exitCode = args.invalid ? 2 : 0;
    return;
  }
  const ask = dependencies.ask ?? confirm;
  const envPath = dependencies.envPath ?? ENV_PATH;

  if (!args.ci && (args.headless || args.force || args.debug || args.explicitName)) {
    console.error(
      "Stopped: interactive recovery requires a visible browser and a private account selection; --name, --headless, --force and --debug are unavailable.",
    );
    process.exitCode = 1;
    return;
  }

  const log = args.ci ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  const err = (...a: unknown[]) => console.error(...a);

  const email = args.ci ? process.env["STFC_EMAIL"]?.trim() || "" : "";
  const password = args.ci ? process.env["STFC_PASSWORD"] || "" : "";
  const wantAutoLogin = email.length > 0;

  if (args.ci && !wantAutoLogin) {
    err(`--ci requires STFC_EMAIL (and optionally STFC_PASSWORD) env vars.`);
    process.exitCode = 2;
    return;
  }

  log(`\nSTFC Gift Redeemer — JWT capture`);
  log(`────────────────────────────────`);
  log(`  timeout      : ${args.timeout}s`);
  log(`  store URL    : ${STORE_URL}`);
  log(`  auto-login   : ${wantAutoLogin ? "yes" : "no (interactive)"}`);
  const runHeadless = args.ci || args.headless;
  let baseline: string | null = null;
  let expectedId: string | null = null;
  if (!args.ci) {
    try {
      baseline = (await readEnv(envPath)).raw;
      if (!(dependencies.privateTerminal ?? Boolean(input.isTTY && output.isTTY))) throw new Error();
      if (
        !(await ask(
          "Is the backup current and complete, with redemption workflows and other updates stopped until this finishes?",
        ))
      ) {
        throw new Error();
      }
      args.name = await (dependencies.readAccountName ?? readAccountName)();
      validateRecoveryBaseline(baseline, args.name);
      expectedId = await (dependencies.readExpectedAccountId ?? readExpectedAccountId)();
    } catch {
      err("Stopped: the backup, selected account, or private identifier input is invalid; no capture or update was attempted.");
      process.exitCode = 1;
      return;
    }
  }

  log(
    `  mode         : ${args.ci ? "CI (headless)" : "interactive (visible browser)"}`,
  );
  log("");

  let browser: BrowserLike;
  try {
    const launch =
      dependencies.launchBrowser ??
      ((options: { headless: boolean }) => chromium.launch(options) as unknown as Promise<BrowserLike>);
    browser = await launch({ headless: runHeadless });
  } catch {
    err(`\nFailed to launch Chromium.`);
    err(`\nIf this is the first run, install the browser binary:`);
    err(`  npm run playwright:install\n`);
    process.exitCode = 1;
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  log(`Watching network traffic for /auth/login response or Bearer header…`);
  if (!wantAutoLogin) {
    log(`Log in normally in the browser window. Keep it open to verify the account after capture.\n`);
  }

  const capturePromise = captureToken({
    context,
    timeoutMs: args.timeout * 1000,
    closeAfterCapture: args.ci ? undefined : () => browser.close(),
  }).then(
    (result): { result: CapturedToken; failed?: false } => ({ result }),
    (): { failed: true; result?: undefined } => ({ failed: true }),
  );
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  if (wantAutoLogin) {
    tryAutoLogin(page as Page, { email, password, log, err, ci: args.ci, headless: runHeadless }).catch(() => {
      err("auto-login failed.");
    });
  }

  const outcome = await capturePromise;
  if (outcome.failed) {
    err("Capture was ambiguous or the browser token changed; no update was written.");
    await browser.close().catch(() => {});
    process.exitCode = 1;
    return;
  }
  const { token, source } = outcome.result;

  if (!token) {
    err(`\nTimed out after ${args.timeout}s without capturing a token.`);
    if (args.ci) {
      err(`In CI mode this usually means: bad credentials, MFA challenge, or CAPTCHA.`);
    } else {
      err(`Possible causes:`);
      err(`  - You closed the browser before logging in.`);
      err(`  - The login flow used a route we don't know about.`);
      err(`  - Network requests are happening but with a different host.`);
    }

    if (args.ci && args.debug) {
      try {
        const file = await dumpDiagnostics(context as unknown as BrowserContext, page as Page);
        err(`Diagnostics written to ${file}`);
      } catch (e) {
        err(`Failed to write diagnostics: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const shotDir = args.ci ? process.env["STFC_DEBUG_DIR"]?.trim() : "";
    if (shotDir && page.screenshot && page.frames) {
      try {
        await fs.mkdir(shotDir, { recursive: true });
        const shot = path.join(shotDir, "login-failure.png");
        await page.screenshot({ path: shot, fullPage: true });
        err(`Failure screenshot written to ${shot}`);
      } catch (e) {
        err(`Failed to write failure screenshot: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        const frames = [];
        for (const frame of page.frames()) {
          const info = await frame
            .evaluate(() => {
              const attrs = (el: Element) => ({
                tag: el.tagName,
                type: el.getAttribute("type"),
                name: el.getAttribute("name"),
                id: el.id || null,
                cls: el.getAttribute("class"),
                maxlength: el.getAttribute("maxlength"),
                autocomplete: el.getAttribute("autocomplete"),
                inputmode: el.getAttribute("inputmode"),
                ariaLabel: el.getAttribute("aria-label"),
                dataSe: el.getAttribute("data-se"),
                dataTestid: el.getAttribute("data-testid"),
                visible: el.getClientRects().length > 0,
              });
              return {
                url: location.href,
                inputs: Array.from(
                  document.querySelectorAll("input, textarea, [contenteditable='true']"),
                ).map(attrs),
                buttons: Array.from(document.querySelectorAll("button")).map((b) => ({
                  text: (b.textContent || "").trim().slice(0, 40),
                  type: b.getAttribute("type"),
                  disabled: b.disabled,
                })),
                shadowHosts: Array.from(document.querySelectorAll("*"))
                  .filter((e) => e.shadowRoot)
                  .map((e) => e.tagName + (e.id ? `#${e.id}` : "")),
              };
            })
            .catch((e: unknown) => ({ url: frame.url(), error: String(e) }));
          frames.push(info);
        }
        const domFile = path.join(shotDir, "dom-inputs.json");
        await fs.writeFile(domFile, JSON.stringify({ frames }, null, 2), "utf8");
        err(`DOM input inventory written to ${domFile}`);
      } catch (e) {
        err(`Failed to write DOM inventory: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await browser.close();
    process.exitCode = 1;
    return;
  }

  log(`\nCaptured a candidate token via: ${source}`);

  if (args.ci) {
    const v = await validateToken(token);
    if (!v.ok) {
      err("Token validation failed.");
      await browser.close();
      process.exitCode = 1;
      return;
    }
    process.stdout.write(JSON.stringify({ name: args.name, token }) + "\n");
    await browser.close();
    return;
  }

  log("Checking the captured token against the independently supplied account identifier.");
  let merged: CapturedAccount[];
  try {
    merged = await mergeAfterIdentityConfirmation({
      name: args.name,
      token,
      force: false,
      baseline,
      expectedId: expectedId ?? "",
      envPath,
      verify: (candidate, expected) =>
        verifyAccountId(candidate, expected, dependencies.fetchIdentity ?? (fetch as unknown as IdentityFetchImpl)),
    });
  } catch {
    err("Identity verification or local update failed; the hosted token store was not changed.");
    await browser.close().catch(() => {});
    process.exitCode = 1;
    return;
  }

  log(`\nUpdated the local account backup (${merged.length} account(s)).`);

  await browser.close();
  console.log("\nDone. The canonical token store was not updated; use the owner-only PWA for hosted token updates.");
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  main().catch(() => {
    console.error("\nUnexpected error; no further update was attempted.");
    process.exit(1);
  });
}

export {
  findOtpEntry,
  fillOtp,
  promptAndSubmitOtp,
  OTP_SELECTORS,
  SPLIT_OTP_SELECTOR,
  mergeIntoEnv,
  mergeAfterIdentityConfirmation,
  captureToken,
  verifyAccountId,
  validateRecoveryBaseline,
  readAccountName,
  readExpectedAccountId,
  validateToken,
  waitForFirstSelector,
  clickFirstAvailable,
  beginEmailLogin,
  main,
};
