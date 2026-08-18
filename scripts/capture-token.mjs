#!/usr/bin/env node
// Interactive Playwright JWT capture for the STFC web store.
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
//   5. If `gh` CLI is available, offers (y/N) to set the GitHub repo
//      secret STFC_ACCOUNTS via `gh secret set STFC_ACCOUNTS`,
//      passing the JSON via stdin (so the token never lands on a
//      command line, in shell history, or in a process listing).
//
// We ALWAYS use a fresh, non-persistent browser context. You will need to
// log in fresh every run; this is by design — it forces /auth/login to
// fire and avoids storing browser session material on disk.

import { chromium } from "playwright";
import { promises as fs, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const out = { name: "main", timeout: 300, debug: false, force: false, help: false, invalid: false, ci: false, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) { out.name = argv[++i]; continue; }
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

  --name      Name to record this account under in STFC_ACCOUNTS. Default: "main".
              Re-run with a different name to add additional accounts.
  --timeout   How long to wait for the login flow (in seconds). Default: 300.
  --debug     On capture failure, prompt to write redacted localStorage /
              sessionStorage / cookie diagnostics. Never includes raw values.
  --force     Allow overwriting an existing STFC_ACCOUNTS entry that fails to
              parse as JSON. Default: refuse and exit non-zero.
  --ci        Headless, non-interactive mode for GitHub Actions. Outputs the
              captured JWT as JSON {"name":"<name>","token":"<jwt>"} to stdout
              (everything else goes to stderr). Skips .env writes and gh
              prompts. Requires STFC_EMAIL + STFC_PASSWORD env vars.
  --headless  Run the browser headless (no visible window) but keep interactive
              features. When STFC_EMAIL is set, auto-fills the email and waits
              for an OTP code via the file /tmp/stfc-otp instead of stdin.
              Useful when running inside a server/agent environment that has no
              display but still needs a human to supply the verification code.

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

async function captureToken({ context, timeoutMs }) {
  let resolve;
  const captured = new Promise((r) => { resolve = r; });
  let done = false;
  const win = (token, source) => {
    if (done) return;
    done = true;
    resolve({ token, source });
  };

  context.on("response", async (res) => {
    try {
      const url = res.url();
      const req = res.request();
      if (req.method() !== "POST") return;
      if (!url.includes(`${API_HOST}/api/v2/auth/login`)) return;
      const body = await res.json().catch(() => null);
      if (body && typeof body.accessToken === "string" && body.accessToken.length > 0) {
        win(body.accessToken, "POST /auth/login response.accessToken");
      }
    } catch {
      // ignore body-read failures (redirects, aborted, non-JSON, etc.)
    }
  });

  context.on("request", (req) => {
    try {
      const url = req.url();
      if (!url.includes(API_HOST)) return;
      const auth = req.headers()["authorization"];
      if (typeof auth === "string" && auth.startsWith("Bearer ")) {
        const token = auth.slice("Bearer ".length).trim();
        if (token.length > 0) win(token, `request header on ${new URL(url).pathname}`);
      }
    } catch { /* noop */ }
  });

  const timeout = new Promise((r) => setTimeout(() => r({ token: null, source: "timeout" }), timeoutMs));
  return Promise.race([captured, timeout]);
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
  // Single-quoted with backslash-escaped single quotes. Safer for JSON
  // payloads than double-quoted-with-escaped-double-quotes, which Node's
  // own --env-file parser does NOT handle the way dotenv does.
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function readEnv() {
  if (!existsSync(ENV_PATH)) return { exists: false, lines: [] };
  const raw = await fs.readFile(ENV_PATH, "utf8");
  return { exists: true, lines: raw.split(/\r?\n/) };
}

async function mergeIntoEnv({ name, token, force }) {
  const { exists, lines } = await readEnv();
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

  let merged;
  if (existingIdx === -1) {
    merged = [newAccount];
  } else {
    let parsed;
    try {
      parsed = JSON.parse(unquoteEnvValue(existingLine));
    } catch {
      if (!force) {
        throw new Error(
          `${ENV_PATH} line ${existingIdx + 1} has STFC_ACCOUNTS that does not parse as JSON.\n` +
          `Existing value: ${existingLine.trim()}\n` +
          `Re-run with --force to overwrite, or fix the value manually.`,
        );
      }
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      if (!force) {
        throw new Error(
          `${ENV_PATH} line ${existingIdx + 1} STFC_ACCOUNTS is JSON but not an array.\n` +
          `Re-run with --force to overwrite, or fix the value manually.`,
        );
      }
      parsed = [];
    }
    const idx = parsed.findIndex((a) => a && a.name === name);
    if (idx >= 0) parsed[idx] = newAccount;
    else parsed.push(newAccount);
    merged = parsed;
  }

  const newLine = `STFC_ACCOUNTS=${quoteEnvValue(JSON.stringify(merged))}`;
  let newLines;
  if (existingIdx === -1) {
    newLines = exists ? [...lines, newLine] : [newLine, ""];
  } else {
    newLines = [...lines];
    newLines[existingIdx] = newLine;
  }
  await fs.writeFile(ENV_PATH, newLines.join("\n"), "utf8");
  return merged;
}

// ----------------------------------------------------------------------------
// `gh secret set` (consent-gated, secret via stdin only).
// ----------------------------------------------------------------------------

async function ghAvailable() {
  return new Promise((resolve) => {
    const p = spawn("gh", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

async function ghSetSecret(secretJson) {
  return new Promise((resolve, reject) => {
    // gh reads the secret value from stdin when --body is omitted. Older gh
    // releases don't support --body-file, so rely on the stdin path here.
    const p = spawn("gh", ["secret", "set", "STFC_ACCOUNTS"], {
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh exited with code ${code}`));
    });
    p.stdin.end(secretJson);
  });
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
    await entry.el.fill(code).catch(() => {});
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
  // Stage A: dismiss the OneTrust cookie banner if present (it intercepts
  // clicks on the page-level Sign-in button).
  log("auto-login: dismissing cookie banner if present");
  for (const sel of ["#onetrust-accept-btn-handler", "#onetrust-reject-all-handler"]) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }

  // Stage B: click "Sign in with Scopely" inside the modal (the page-level
  // duplicate is hidden behind the modal). `.last()` reliably picks the
  // visible one.
  log("auto-login: clicking Sign in with Scopely (modal)");
  try {
    const btn = page.locator("#log-in-button").last();
    await btn.waitFor({ state: "visible", timeout: 30_000 });
    await btn.click({ timeout: 10_000 });
  } catch (e) {
    log(`auto-login: could not click Sign in with Scopely (${e.message?.slice(0, 100)}); falling back to interactive login.`);
    return false;
  }

  // Stage C: wait for the Scopely Okta email form, fill, click Continue.
  log("auto-login: waiting for Scopely email form…");
  const emailField = await waitForFirstSelector(page, [
    'input[name="email"]',
    'input[type="email"]',
    'input.ant-input',
  ], 60_000);
  if (!emailField) {
    log("auto-login: no email field appeared within 60s — falling back to interactive login.");
    return false;
  }
  log("auto-login: filling email and clicking Continue");
  await emailField.fill(email);
  await clickFirstAvailable(page, [
    'button:has-text("Continue")',
    'button[type="submit"]',
    'button.ant-btn-primary',
  ]);

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
      await el.click().catch(() => {});
      return true;
    }
  }
  return false;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.invalid) { printUsage(); process.exit(args.invalid ? 2 : 0); }

  // In CI mode, redirect everything diagnostic to stderr so stdout is reserved
  // for the captured-token JSON the workflow consumes.
  const log = args.ci ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const err = (...a) => console.error(...a);

  const email = process.env.STFC_EMAIL?.trim() || "";
  const password = process.env.STFC_PASSWORD || "";
  // Auto-login only requires STFC_EMAIL; password is optional for OTP-only accounts.
  const wantAutoLogin = email.length > 0;

  if (args.ci && !wantAutoLogin) {
    err(`--ci requires STFC_EMAIL (and optionally STFC_PASSWORD) env vars.`);
    process.exit(2);
  }

  log(`\nSTFC Gift Redeemer — JWT capture`);
  log(`────────────────────────────────`);
  log(`  account name : ${args.name}`);
  log(`  timeout      : ${args.timeout}s`);
  log(`  store URL    : ${STORE_URL}`);
  log(`  auto-login   : ${wantAutoLogin ? `yes (${email})` : "no (interactive)"}`);
  const runHeadless = args.ci || args.headless;

  log(`  mode         : ${args.ci ? "CI (headless)" : args.headless ? "headless (file OTP)" : "interactive (visible browser)"}`);
  log("");

  let browser;
  try {
    browser = await chromium.launch({ headless: runHeadless });
  } catch (e) {
    err(`\nFailed to launch Chromium: ${e instanceof Error ? e.message : e}`);
    err(`\nIf this is the first run, install the browser binary:`);
    err(`  npm run playwright:install\n`);
    process.exit(1);
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  log(`Watching network traffic for /auth/login response or Bearer header…`);
  if (!wantAutoLogin) {
    log(`Log in normally in the browser window. The browser will close automatically once a token is captured.\n`);
  }

  const capturePromise = captureToken({ context, timeoutMs: args.timeout * 1000 });
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  if (wantAutoLogin) {
    // Run auto-login in parallel with the network capture; if it succeeds the
    // /auth/login response handler picks up the JWT. If auto-login fails (e.g.
    // CAPTCHA) the user can still complete login manually in the visible
    // browser when not in --ci mode.
    tryAutoLogin(page, { email, password, log, err, ci: args.ci, headless: args.headless }).catch((e) => {
      err(`auto-login failed: ${e instanceof Error ? e.message : e}`);
    });
  }

  const { token, source } = await capturePromise;

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

    if (args.debug || (!args.ci && (await confirm("Write redacted storage/cookie diagnostics?")))) {
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
    const shotDir = process.env.STFC_DEBUG_DIR?.trim();
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
    process.exit(1);
  }

  log(`\nCaptured a candidate token via: ${source}`);

  log(`Validating against ${API_BASE}/auth/me…`);
  const v = await validateToken(token);
  if (!v.ok) {
    err(`Validation failed: HTTP ${v.status}${v.error ? ` (${v.error})` : ""}`);
    await browser.close();
    process.exit(1);
  }
  log(`Validation OK (HTTP 200).`);

  const payload = decodeJwt(token);
  log(`Token expiry: ${describeExpiry(payload)}`);

  if (args.ci) {
    // The workflow consumes a single line of JSON: {"name":"<n>","token":"<t>"}.
    // Everything else has gone to stderr.
    process.stdout.write(JSON.stringify({ name: args.name, token }) + "\n");
    await browser.close();
    return;
  }

  let merged;
  try {
    merged = await mergeIntoEnv({ name: args.name, token, force: args.force });
  } catch (e) {
    err(`\nFailed to update ${ENV_PATH}:`);
    err(e instanceof Error ? e.message : String(e));
    await browser.close();
    process.exit(1);
  }

  log(`\nUpdated ${ENV_PATH}: STFC_ACCOUNTS now contains ${merged.length} account(s) [${merged.map((a) => a.name).join(", ")}].`);

  const ghOk = await ghAvailable();
  if (ghOk) {
    console.log("");
    if (await confirm("Set the GitHub repo secret STFC_ACCOUNTS via gh now?", false)) {
      try {
        await ghSetSecret(JSON.stringify(merged));
        console.log(`GitHub secret STFC_ACCOUNTS set successfully.`);
      } catch (err) {
        console.error(`gh failed: ${err instanceof Error ? err.message : err}`);
        console.error(`You can set the secret manually: GitHub repo → Settings → Secrets and variables → Actions → STFC_ACCOUNTS.`);
      }
    } else {
      console.log(`Skipped. Set the secret manually when you're ready: GitHub repo → Settings → Secrets and variables → Actions → STFC_ACCOUNTS.`);
    }
  } else {
    console.log(`\n'gh' CLI not found on PATH.`);
    console.log(`Set the secret manually: GitHub repo → Settings → Secrets and variables → Actions → STFC_ACCOUNTS.`);
    console.log(`The value to paste is the JSON now in your local .env file.`);
  }

  await browser.close();
  console.log(`\nDone. Trigger the workflow with: gh workflow run "Redeem gifts" (or via the GitHub UI).`);
}

// Only run the CLI when invoked directly, so tests can import the OTP
// helpers without launching a browser.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  main().catch((err) => {
    console.error(`\nUnexpected error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    process.exit(1);
  });
}

export { findOtpEntry, fillOtp, OTP_SELECTORS, SPLIT_OTP_SELECTOR };
