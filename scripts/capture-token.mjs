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
//   3. Whichever fires first, validates the captured token by calling
//      GET /auth/me. If valid, decodes the JWT exp and proceeds.
//   4. Merges the validated token into a local .env (preserving any
//      other accounts already in STFC_ACCOUNTS).
//   5. Writes only to the local .env. Hosted token updates use the owner-only PWA.
//
// We ALWAYS use a fresh, non-persistent browser context. You will need to
// log in fresh every run; this is by design — it forces /auth/login to
// fire and avoids storing browser session material on disk.

import { chromium } from "playwright";
import { promises as fs, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const DIAGNOSTICS_DIR = path.join(REPO_ROOT, "playwright-diagnostics");

const STORE_URL = "https://home.startrekfleetcommand.com/store";
const API_BASE  = "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2";
const API_HOST  = "cdn-nv3-webstore-api.startrek.digitgaming.com";

// ----------------------------------------------------------------------------
// Tiny argv parser (no extra deps).
// ----------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { name: "main", explicitName: false, timeout: 300, debug: false, force: false, help: false, invalid: false, ci: false, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) { out.name = argv[++i]; out.explicitName = true; continue; }
    if (a === "--timeout" && argv[i + 1]) { out.timeout = Number(argv[++i]); continue; }
    if (a === "--debug") { out.debug = true; continue; }
    if (a === "--force") { out.force = true; continue; }
    if (a === "--ci") { out.ci = true; continue; }
    if (a === "--headless") { out.headless = true; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
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

function printUsage() {
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

function isJwtShaped(s) {
  if (typeof s !== "string") return false;
  const parts = s.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[A-Za-z0-9_\-]+$/.test(p));
}

function decodeJwt(token) {
  if (!isJwtShaped(token)) return null;
  const [, p] = token.split(".");
  try {
    const pad = p.length % 4 === 0 ? 0 : 4 - (p.length % 4);
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function describeExpiry(payload) {
  if (!payload || typeof payload.exp !== "number") return "no exp claim";
  const delta = payload.exp - Math.floor(Date.now() / 1000);
  if (delta <= 0) return `EXPIRED ${humanDelta(-delta)} ago`;
  return `expires in ${humanDelta(delta)}`;
}

function humanDelta(seconds) {
  const d = Math.floor(seconds / 86400);
  if (d >= 1) return `${d} day${d === 1 ? "" : "s"}`;
  const h = Math.floor(seconds / 3600);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"}`;
  const m = Math.floor(seconds / 60);
  if (m >= 1) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

// ----------------------------------------------------------------------------
// Network capture.
// ----------------------------------------------------------------------------

async function captureToken({ context, timeoutMs, closeAfterCapture, signal }) {
  let resolve;
  const captured = new Promise((r) => { resolve = r; });
  let first = null, changed = false, ambiguous = false;
  const pending = new Set();
  const win = (token, source) => {
    if (!isJwtShaped(token)) { ambiguous = true; return; }
    if (first) {
      if (first.token !== token) changed = true;
      return;
    }
    first = { token, source };
    resolve(first);
  };

  const onResponse = (res) => {
    try {
      const url = new URL(res.url());
      if (url.protocol !== "https:" || url.host !== API_HOST || url.pathname !== "/api/v2/auth/login") return;
      if (res.request().method() !== "POST") return;
    } catch { if (closeAfterCapture) ambiguous = true; return; }
    const job = (async () => {
      try {
        const body = await res.json();
        if (typeof body?.accessToken === "string") win(body.accessToken, "POST /auth/login response");
        else if (closeAfterCapture && res.status() >= 200 && res.status() < 300) ambiguous = true;
      } catch {
        if (closeAfterCapture) ambiguous = true;
      }
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  };

  const onRequest = (req) => {
    try {
      const url = new URL(req.url());
      if (url.protocol !== "https:" || url.host !== API_HOST) return;
      const auth = req.headers()["authorization"];
      if (typeof auth === "string" && auth.startsWith("Bearer ")) {
        const token = auth.slice("Bearer ".length).trim();
        if (token.length > 0) win(token, "request header");
      }
    } catch { if (closeAfterCapture) ambiguous = true; }
  };

  context.on("response", onResponse);
  context.on("request", onRequest);
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r({ token: null, source: "timeout" }), timeoutMs); });
  let onAbort;
  const aborted = signal ? new Promise((r) => {
    onAbort = () => r({ token: null, source: "aborted" });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }) : new Promise(() => {});
  try {
    const result = await Promise.race([captured, timeout, aborted]);
    if (result.token && closeAfterCapture) {
      await closeAfterCapture();
      await Promise.all([...pending]);
      if (changed || ambiguous) throw new Error("Capture was ambiguous or the browser token changed; no update was written.");
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    context.off("response", onResponse);
    context.off("request", onRequest);
  }
}

function accountId(value) {
  if (typeof value === "bigint") return value >= 0n ? String(value) : null;
  if (typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value)) return value;
  return null;
}

function parseAccountId(text) {
  JSON.parse(text);
  const doc = parseDocument(text, { schema: "json", uniqueKeys: true, intAsBigInt: true });
  if (doc.errors.length || doc.warnings.length) return null;
  const value = doc.toJS({ maxAliasCount: 0 });
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      !value.payload || Array.isArray(value.payload) || typeof value.payload !== "object") return null;
  return accountId(value.payload.accountId);
}

async function verifyAccountId(token, expectedId, fetchImpl = fetch) {
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

async function validateToken(token) {
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

function unquoteEnvValue(raw) {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1);
      if (first === '"') {
        v = v.replace(/\\(["\\nrt])/g, (_m, c) =>
          c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
        );
      }
    }
  }
  return v;
}

function quoteEnvValue(v) {
  if (/['\r\n]/.test(v)) {
    throw new Error("STFC_ACCOUNTS cannot be safely represented in a single-quoted .env value.");
  }
  return `'${v}'`;
}

async function readEnv(envPath = ENV_PATH) {
  if (!existsSync(envPath)) return { exists: false, raw: null, lines: [] };
  const raw = await fs.readFile(envPath, "utf8");
  return { exists: true, raw, lines: raw.split(/\r?\n/) };
}

// JSON.parse validates syntax; keep each original array element's bytes so
// unrelated metadata (including numbers outside JS's safe range) survives.
function arrayElements(json) {
  const elements = [];
  let start = 1, depth = 0, quoted = false, escaped = false;
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

async function mergeIntoEnv({ name, token, force, _envPath = ENV_PATH, _expectedRaw, _beforeReplace, _rename = fs.rename }) {
  const { exists, raw, lines } = await readEnv(_envPath);
  if (_expectedRaw !== undefined && raw !== _expectedRaw) {
    throw new Error(".env changed during capture; no update was written.");
  }
  const newAccount = { name, token };

  let existingIdx = -1;
  let existingLine = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*STFC_ACCOUNTS\s*=)(.*)$/);
    if (m) {
      existingIdx = i;
      existingLine = m[2];
      break;
    }
  }

  let merged, elements;
  if (existingIdx === -1) {
    merged = [newAccount];
    elements = [JSON.stringify(newAccount)];
  } else {
    let parsed, original;
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
    elements = arrayElements(original);
    const idx = parsed.findIndex((a) => a && a.name === name);
    if (idx >= 0) {
      if (parsed.filter((a) => a && a.name === name).length !== 1 ||
          Object.keys(parsed[idx]).some((key) => key !== "name" && key !== "token")) {
        throw new Error("Selected account is duplicated or has additional fields; refusing to discard data.");
      }
      parsed[idx] = newAccount;
      elements[idx] = JSON.stringify(newAccount);
    } else {
      parsed.push(newAccount);
      elements.push(JSON.stringify(newAccount));
    }
    merged = parsed;
  }

  const secretJson = `[${elements.join(",")}]`;
  const newLine = `STFC_ACCOUNTS=${quoteEnvValue(secretJson)}`;
  let newLines;
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
    try { await stage.writeFile(updatedRaw, "utf8"); await stage.sync(); } finally { await stage.close(); }
    if (_beforeReplace) await _beforeReplace();
    if ((await readEnv(_envPath)).raw !== raw) throw new Error(".env changed during capture; no update was written.");
    await _rename(stagePath, _envPath);
    created = false;
  } finally {
    if (created) await fs.unlink(stagePath).catch(() => {});
  }
  Object.defineProperty(merged, "secretJson", { value: secretJson });
  Object.defineProperty(merged, "envRaw", { value: updatedRaw });
  return merged;
}

async function mergeAfterIdentityConfirmation({ name, token, force, baseline, expectedId, envPath = ENV_PATH, verify = verifyAccountId }) {
  if (!await verify(token, expectedId)) {
    throw new Error("Token identity could not be verified against the expected account; no update was written.");
  }
  return mergeIntoEnv({ name, token, force, _envPath: envPath, _expectedRaw: baseline });
}

function validateRecoveryBaseline(raw, name) {
  if (typeof raw !== "string") throw new Error("A complete local backup is required.");
  const lines = raw.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?STFC_ACCOUNTS\s*=/.test(line));
  if (lines.length !== 1) throw new Error("The backup must contain exactly one STFC_ACCOUNTS entry.");
  if (/^\s*export\s+/.test(lines[0])) throw new Error("Exported STFC_ACCOUNTS entries are unsupported.");
  const text = unquoteEnvValue(lines[0].replace(/^\s*STFC_ACCOUNTS\s*=/, "")).trim();
  try {
    const parsed = JSON.parse(text);
    const doc = parseDocument(text, { schema: "json", uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length || !Array.isArray(parsed) || parsed.length === 0) throw new Error();
    const names = new Set();
    for (const item of parsed) {
      if (!item || Array.isArray(item) || typeof item !== "object" ||
          typeof item.name !== "string" || !item.name.trim() ||
          !isJwtShaped(item.token) || names.has(item.name)) throw new Error();
      names.add(item.name);
    }
    const target = parsed.filter((item) => item.name === name);
    if (target.length !== 1 || Object.keys(target[0]).some((key) => key !== "name" && key !== "token")) throw new Error();
  } catch {
    throw new Error("The backup or selected account is invalid or ambiguous; no update was written.");
  }
}

// ----------------------------------------------------------------------------
// Diagnostics dump (redacted; no raw values).
// ----------------------------------------------------------------------------

async function dumpDiagnostics(context, page) {
  await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
  const filename = path.join(DIAGNOSTICS_DIR, `diag-${Date.now()}.json`);

  const storage = await page.evaluate(() => {
    const summarize = (s) => {
      const out = {};
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        const v = s.getItem(k) ?? "";
        const jwt = /\b[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/.test(v);
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

async function confirm(prompt, def = false) {
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question(`${prompt} [${def ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
    if (ans === "") return def;
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

async function readPrivateValue(prompt, { stdin = input, stdout = output, allowUnicode = false } = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("A private interactive terminal is required.");
  }
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "", invalid = false;
    const decoder = new StringDecoder("utf8");
    const wasRaw = stdin.isRaw;
    const finish = (error) => {
      stdin.off("data", onData);
      stdin.off("error", onError);
      try { stdin.setRawMode(Boolean(wasRaw)); } catch { error = true; }
      stdin.pause();
      stdout.write("\n");
      if (error || invalid || !value || value !== value.trim()) reject(new Error("Private input was cancelled or invalid."));
      else resolve(value);
    };
    const onError = () => finish(true);
    const onData = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\r" || char === "\n") { finish(false); return; }
        if (char === "\x03" || char === "\x04") { finish(true); return; }
        if (char === "\x08" || char === "\x7f") {
          const codePoints = Array.from(value);
          codePoints.pop();
          value = codePoints.join("");
        }
        else if ((/^[\x20-\x7e]$/.test(char) ||
            (allowUnicode && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(char))) && value.length < 256) value += char;
        else invalid = true;
      }
    };
    stdin.on("data", onData);
    stdin.on("error", onError);
    try { stdin.setRawMode(true); stdin.resume(); } catch { finish(true); }
  });
}

async function readAccountName(streams) {
  return readPrivateValue("Enter the exact existing account label (hidden): ", {
    ...streams,
    allowUnicode: true,
  });
}

async function readExpectedAccountId(streams) {
  const value = await readPrivateValue("Enter the accountId from the independently authenticated /auth/me response (hidden): ", streams);
  if (!accountId(value)) throw new Error("Account identifier input was cancelled or invalid.");
  return value;
}

// ----------------------------------------------------------------------------
// Auto-login (Scopely Okta). When STFC_EMAIL + STFC_PASSWORD are set the
// script fills the form for you. The selectors are deliberately generic
// (input[type=email], input[type=password]) with class fallbacks that match
// the current Okta-hosted form. If those break, the script logs which
// selectors were tried so the next maintainer knows what to update.
// ----------------------------------------------------------------------------

// Selectors for a single-input OTP field (classic Okta widget).
const OTP_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name="credentials.passcode"]',
  'input[data-se="o-form-input-passcode"]',
  'input[type="text"][maxlength="6"]',
  'input[type="tel"][maxlength="6"]',
];

// Scopely's passwordless login renders the code as several separate
// single-character boxes, so none of the single-input selectors above match.
// Their exact attributes have changed before, so match on any of the shapes
// these widgets commonly use rather than on maxlength alone.
const SPLIT_OTP_SELECTOR = [
  'input[maxlength="1"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[data-testid*="otp" i]',
  'input[class*="otp" i]',
  'input[aria-label*="digit" i]',
].join(", ");

// Locate the OTP entry widget, whichever form it takes. Searches every frame
// because the Scopely login renders inside a modal that may be an iframe.
// Returns null when neither is present/visible.
async function findOtpEntry(page) {
  for (const frame of page.frames()) {
    for (const sel of OTP_SELECTORS) {
      const el = await frame.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) return { kind: "single", el, frame };
    }

    const boxes = frame.locator(SPLIT_OTP_SELECTOR);
    const count = await boxes.count().catch(() => 0);
    if (count >= 4 && (await boxes.first().isVisible().catch(() => false))) {
      return { kind: "split", boxes, count, frame };
    }
  }
  return null;
}

// Type the code into whichever widget we found. Split widgets usually
// auto-advance focus, but we target each box explicitly so the code lands
// correctly even when they don't.
async function fillOtp(page, entry, code) {
  if (entry.kind === "single") {
    await entry.el.fill(code);
    return;
  }

  const digits = code.replace(/\D/g, "").split("");
  const limit = Math.min(digits.length, entry.count);
  for (let i = 0; i < limit; i++) {
    const box = entry.boxes.nth(i);
    const digit = digits[i];
    await box.click({ timeout: 2_000 }).catch(() => {});
    try {
      await box.fill(digit);
    } catch {
      await page.keyboard.type(digit, { delay: 30 }).catch(() => {});
    }
  }
}

// Prompt the user for the 6-digit OTP, fill it into the OTP widget, and click
// the submit button. Retries up to `maxAttempts` times if Okta rejects the code
// (detects the error banner or the input field re-appearing). Returns true on
// success, false if the user presses Enter without a code or exhausts retries.
//
// In headless mode (headless=true) the code is read from /tmp/stfc-otp instead
// of stdin. The script writes /tmp/stfc-otp-ready to signal it is waiting, then
// polls /tmp/stfc-otp until the file appears (or timeout is reached).
async function promptAndSubmitOtp({ page, entry, log, maxAttempts = 3, headless = false }) {
  const OTP_READY_FILE = "/tmp/stfc-otp-ready";
  const OTP_CODE_FILE = "/tmp/stfc-otp";

  const OTP_ERROR_SELECTORS = [
    // Okta-rendered inline error messages (various versions)
    '[data-se="o-form-error-container"]:not(:empty)',
    '.okta-form-infobox-error',
    'p.okta-error-container',
    '[role="alert"]',
    // Generic "invalid code" text
    ':text("Invalid code")',
    ':text("Incorrect code")',
    ':text("Code is invalid")',
    ':text("Enter a valid")',
    ':text("does not match")',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptLabel = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
    let code;

    // STFC_OTP env var: injected by workflow_dispatch `otp` input — takes
    // precedence over both the file-poll (headless) and stdin paths.
    const envOtp = process.env.STFC_OTP?.trim();
    if (envOtp) {
      log(`auto-login: using OTP from STFC_OTP env var${attemptLabel}`);
      code = envOtp;
    } else if (headless) {
      // Remove any stale code file from a previous attempt.
      await fs.unlink(OTP_CODE_FILE).catch(() => {});
      // Write the ready marker so the caller knows the script is waiting.
      await fs.writeFile(OTP_READY_FILE, `attempt:${attempt}\ntimestamp:${new Date().toISOString()}\n`, "utf8").catch(() => {});
      log(`\nauto-login: waiting for OTP code in ${OTP_CODE_FILE}${attemptLabel}`);
      log(`  → write the 6-digit code to that file, e.g.:  echo '123456' > ${OTP_CODE_FILE}\n`);

      const pollDeadline = Date.now() + 300_000; // poll up to 5 min
      while (Date.now() < pollDeadline) {
        if (existsSync(OTP_CODE_FILE)) {
          code = (await fs.readFile(OTP_CODE_FILE, "utf8").catch(() => "")).trim();
          await fs.unlink(OTP_CODE_FILE).catch(() => {});
          if (code) break;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
      if (!code) {
        log("auto-login: timed out waiting for OTP file — giving up.");
        await fs.unlink(OTP_READY_FILE).catch(() => {});
        return false;
      }
    } else {
      const rl = createInterface({ input, output });
      try {
        code = (await rl.question(
          `\n>>> Scopely sent a 6-digit verification code to your email.\n>>> Enter the code now${attemptLabel}: `
        )).trim();
      } finally {
        rl.close();
      }
      if (!code) {
        log("auto-login: no code entered — falling back to interactive login.");
        return false;
      }
    }

    // The widget may have been cleared/re-rendered between attempts, so
    // re-query it to avoid stale-element errors.
    const currentEntry = (await findOtpEntry(page)) ?? entry;
    await fillOtp(page, currentEntry, code);
    await clickFirstAvailable(page, [
      'button:has-text("Verify")',
      'button:has-text("Submit")',
      'button:has-text("Sign in")',
      'button[type="submit"]',
      'button.ant-btn-primary',
    ]);

    // Wait briefly and check whether Okta rejected the code (error banner or
    // the OTP input is still/again visible).
    await page.waitForTimeout(2_000);

    let rejected = false;
    // Check for explicit error messages first.
    for (const sel of OTP_ERROR_SELECTORS) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) {
        const text = await el.textContent().catch(() => "");
        // The passwordless screen shows a permanent "Haven't received an
        // email? Send again" notice that also carries role="alert". Treating
        // it as a rejection would burn every retry instantly.
        if (/haven't received|send again|resend/i.test(text ?? "")) continue;
        log(`auto-login: OTP rejected (attempt ${attempt}/${maxAttempts}): "${text?.trim().slice(0, 80)}"`);
        rejected = true;
        break;
      }
    }

    if (!rejected) {
      // If no error, assume the code was accepted.
      await fs.unlink(OTP_READY_FILE).catch(() => {});
      log("auto-login: OTP submitted. Network listeners will catch the resulting JWT.");
      return true;
    }

    if (attempt < maxAttempts) {
      log(`auto-login: will re-prompt for the code.`);
    }
  }

  await fs.unlink(OTP_READY_FILE).catch(() => {});
  log(`auto-login: OTP rejected after ${maxAttempts} attempt(s) — falling back to interactive login.`);
  return false;
}

async function tryAutoLogin(page, { email, password, log, err, ci, headless = false }) {
  if (!(await beginEmailLogin(page, email, log))) return false;

  // Stage D: after Continue, wait up to 15s for EITHER a "Sign in with
  // password instead" link (password-capable account) OR an OTP/passcode
  // input (email-code-only account). Whichever arrives first determines
  // which branch we take.
  log("auto-login: waiting for password-switch link or OTP input…");
  const PASSWORD_SWITCH_SELECTOR =
    'a:has-text("Sign in with password instead"), a.switchAuthenticator, a:has-text("password instead"), button:has-text("Sign in with password instead")';

  let gotPasswordSwitch = false;
  let primaryOtpEntry = null;
  // Scopely is passwordless now: the code email has to arrive and the boxes
  // have to render, so give it longer than the original 15s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // Check for the OTP widget first (primary email-code flow).
    primaryOtpEntry = await findOtpEntry(page);
    if (primaryOtpEntry) break;
    // Check for the password-switch link.
    const switchEl = page.locator(PASSWORD_SWITCH_SELECTOR).first();
    if ((await switchEl.count()) > 0) {
      try {
        await switchEl.click({ timeout: 2_000 });
        gotPasswordSwitch = true;
      } catch { /* retry */ }
      if (gotPasswordSwitch) break;
    }
    await page.waitForTimeout(500);
  }

  // Stage D-OTP: account uses email code as primary authenticator.
  if (primaryOtpEntry) {
    log(`auto-login: email code (primary OTP) challenge detected — ${primaryOtpEntry.kind} input.`);
    if (ci && !process.env.STFC_OTP) {
      err("auto-login: email-code challenge requires user input and cannot run unattended. Run the workflow manually via workflow_dispatch with an otp input.");
      process.exit(2);
    }
    const submitted = await promptAndSubmitOtp({ page, entry: primaryOtpEntry, log, headless });
    if (!submitted) return false;
    return true;
  }

  if (!gotPasswordSwitch) {
    log("auto-login: neither a password-switch link nor an OTP field appeared within 30s — falling back to interactive login.");
    return false;
  }

  // Stage E: password-capable account — fill password and submit.
  // Skip if no password was provided (OTP-only accounts don't need it).
  if (!password) {
    log("auto-login: no STFC_PASSWORD set — skipping password step (OTP-only account assumed).");
  } else {
    log("auto-login: waiting for password field…");
    const passwordField = await waitForFirstSelector(page, [
      'input[type="password"]',
      'input[name="password"]',
    ], 15_000);
    if (!passwordField) {
      log("auto-login: no password field appeared within 15s — falling back to interactive login.");
      return false;
    }
    log("auto-login: filling password and clicking Sign in");
    await passwordField.fill(password);
    await clickFirstAvailable(page, [
      'button:has-text("Sign in")',
      'button[type="submit"]',
      'button.ant-btn-primary',
    ]);

    log("auto-login: submitted credentials, waiting for secondary MFA/OTP challenge or JWT…");

    // Stage F: some accounts require a secondary 6-digit OTP after password
    // entry (e.g. Okta MFA step-up). We wait up to 15s.
    let secondaryOtpEntry = null;
    const secondaryDeadline = Date.now() + 15_000;
    while (Date.now() < secondaryDeadline) {
      secondaryOtpEntry = await findOtpEntry(page);
      if (secondaryOtpEntry) break;
      await page.waitForTimeout(500);
    }
    if (secondaryOtpEntry) {
      log(`auto-login: secondary MFA/OTP challenge detected — ${secondaryOtpEntry.kind} input.`);
      if (ci && !process.env.STFC_OTP) {
        err("auto-login: MFA challenge requires user input and cannot run unattended. Run the workflow manually via workflow_dispatch with an otp input.");
        process.exit(2);
      }
      const submitted = await promptAndSubmitOtp({ page, entry: secondaryOtpEntry, log, headless });
      if (!submitted) return false;
    } else {
      log("auto-login: no secondary OTP challenge detected. Network listeners will catch the resulting JWT.");
    }
  }

  return true;
}

async function waitForFirstSelector(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await el.isVisible().catch(() => false))) return el;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function clickFirstAvailable(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false))) {
      try {
        await el.click();
        return true;
      } catch { /* Try the next known submit control. */ }
    }
  }
  return false;
}

async function beginEmailLogin(page, email, log = () => {}) {
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
    log(`auto-login: could not click Sign in with Scopely (${e.message?.slice(0, 100)}).`);
    return false;
  }

  log("auto-login: waiting for Scopely email form");
  const emailField = await waitForFirstSelector(page, [
    'input[name="email"]',
    'input[type="email"]',
    'input.ant-input',
  ], 60_000);
  if (!emailField) {
    log("auto-login: no email field appeared within 60s.");
    return false;
  }
  await emailField.fill(email);
  return clickFirstAvailable(page, [
    'button:has-text("Continue")',
    'button[type="submit"]',
    'button.ant-btn-primary',
  ]);
}

async function clickWithRetry(page, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = page.locator(selector).first();
    if (await el.count() > 0) {
      try {
        await el.click({ timeout: 2_000 });
        return true;
      } catch { /* retry */ }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

// ----------------------------------------------------------------------------
// Main.
// ----------------------------------------------------------------------------

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  if (args.help || args.invalid) { printUsage(); process.exitCode = args.invalid ? 2 : 0; return; }
  const ask = dependencies.ask ?? confirm;
  const envPath = dependencies.envPath ?? ENV_PATH;

  if (!args.ci && (args.headless || args.force || args.debug || args.explicitName)) {
    console.error("Stopped: interactive recovery requires a visible browser and a private account selection; --name, --headless, --force and --debug are unavailable.");
    process.exitCode = 1;
    return;
  }

  // In CI mode, redirect everything diagnostic to stderr so stdout is reserved
  // for the captured-token JSON the workflow consumes.
  const log = args.ci ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const err = (...a) => console.error(...a);

  const email = args.ci ? process.env.STFC_EMAIL?.trim() || "" : "";
  const password = args.ci ? process.env.STFC_PASSWORD || "" : "";
  // Auto-login only requires STFC_EMAIL; password is optional for OTP-only accounts.
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
  let baseline = null, expectedId = null;
  if (!args.ci) {
    try {
      baseline = (await readEnv(envPath)).raw;
      if (!(dependencies.privateTerminal ?? (input.isTTY && output.isTTY))) throw new Error();
      if (!await ask("Is the backup current and complete, with redemption workflows and other updates stopped until this finishes?")) {
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

  log(`  mode         : ${args.ci ? "CI (headless)" : args.headless ? "headless (file OTP)" : "interactive (visible browser)"}`);
  log("");

  let browser;
  try {
    browser = await (dependencies.launchBrowser ?? ((options) => chromium.launch(options)))({ headless: runHeadless });
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
    context, timeoutMs: args.timeout * 1000,
    closeAfterCapture: args.ci ? undefined : () => browser.close(),
  }).then((result) => ({ result }), () => ({ failed: true }));
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  if (wantAutoLogin) {
    // Run auto-login in parallel with the network capture; if it succeeds the
    // /auth/login response handler picks up the JWT. If auto-login fails (e.g.
    // CAPTCHA) the user can still complete login manually in the visible
    // browser when not in --ci mode.
    tryAutoLogin(page, { email, password, log, err, ci: args.ci, headless: args.headless }).catch(() => {
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
        const file = await dumpDiagnostics(context, page);
        err(`Diagnostics written to ${file}`);
      } catch (e) {
        err(`Failed to write diagnostics: ${e instanceof Error ? e.message : e}`);
      }
    }

    // A screenshot of whatever the login page is actually showing is the only
    // way to tell a changed selector apart from a CAPTCHA when running
    // headless in CI. Only the rendered page is captured — never page HTML,
    // which could contain the JWT we are trying to protect.
    const shotDir = args.ci ? process.env.STFC_DEBUG_DIR?.trim() : "";
    if (shotDir) {
      try {
        await fs.mkdir(shotDir, { recursive: true });
        const shot = path.join(shotDir, "login-failure.png");
        await page.screenshot({ path: shot, fullPage: true });
        err(`Failure screenshot written to ${shot}`);
      } catch (e) {
        err(`Failed to write failure screenshot: ${e instanceof Error ? e.message : e}`);
      }

      // Attribute-only inventory of every frame's inputs. Deliberately records
      // no element *values*, so it can never leak the code or the JWT — it
      // exists purely so a selector that stops matching can be fixed from
      // evidence instead of guesswork.
      try {
        const frames = [];
        for (const frame of page.frames()) {
          const info = await frame
            .evaluate(() => {
              const attrs = (el) => ({
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
                inputs: Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']")).map(attrs),
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
            .catch((e) => ({ url: frame.url(), error: String(e) }));
          frames.push(info);
        }
        const domFile = path.join(shotDir, "dom-inputs.json");
        await fs.writeFile(domFile, JSON.stringify({ frames }, null, 2), "utf8");
        err(`DOM input inventory written to ${domFile}`);
      } catch (e) {
        err(`Failed to write DOM inventory: ${e instanceof Error ? e.message : e}`);
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
    // The workflow consumes a single line of JSON: {"name":"<n>","token":"<t>"}.
    // Everything else has gone to stderr.
    process.stdout.write(JSON.stringify({ name: args.name, token }) + "\n");
    await browser.close();
    return;
  }

  log("Checking the captured token against the independently supplied account identifier.");
  let merged;
  try {
    merged = await mergeAfterIdentityConfirmation({
      name: args.name, token, force: false, baseline, expectedId, envPath,
      verify: (candidate, expected) => verifyAccountId(candidate, expected, dependencies.fetchIdentity ?? fetch),
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

// Only run the CLI when invoked directly, so tests can import the OTP
// helpers without launching a browser.
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
