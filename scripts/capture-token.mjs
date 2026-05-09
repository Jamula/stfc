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
//      secret STFC_ACCOUNTS via `gh secret set ... --body-file -`,
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
  const out = { name: "main", timeout: 300, debug: false, force: false, help: false, invalid: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) { out.name = argv[++i]; continue; }
    if (a === "--timeout" && argv[i + 1]) { out.timeout = Number(argv[++i]); continue; }
    if (a === "--debug") { out.debug = true; continue; }
    if (a === "--force") { out.force = true; continue; }
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
Usage: npm run capture-token -- [--name <accountName>] [--timeout <seconds>] [--debug] [--force]

  --name      Name to record this account under in STFC_ACCOUNTS. Default: "main".
              Re-run with a different name to add additional accounts.
  --timeout   How long to wait for the login flow (in seconds). Default: 300.
  --debug     On capture failure, prompt to write redacted localStorage /
              sessionStorage / cookie diagnostics. Never includes raw values.
  --force     Allow overwriting an existing STFC_ACCOUNTS entry that fails to
              parse as JSON. Default: refuse and exit non-zero.
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
    const p = spawn("gh", ["secret", "set", "STFC_ACCOUNTS", "--body-file", "-"], {
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
// Main.
// ----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.invalid) { printUsage(); process.exit(args.invalid ? 2 : 0); }

  console.log(`\nSTFC Gift Redeemer — JWT capture`);
  console.log(`────────────────────────────────`);
  console.log(`  account name : ${args.name}`);
  console.log(`  timeout      : ${args.timeout}s`);
  console.log(`  store URL    : ${STORE_URL}`);
  console.log("");

  let browser;
  try {
    browser = await chromium.launch({ headless: false });
  } catch (err) {
    console.error(`\nFailed to launch Chromium: ${err instanceof Error ? err.message : err}`);
    console.error(`\nIf this is the first run, install the browser binary:`);
    console.error(`  npm run playwright:install\n`);
    process.exit(1);
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Watching network traffic for /auth/login response or Bearer header…`);
  console.log(`Log in normally in the browser window. The browser will close automatically once a token is captured.\n`);

  const capturePromise = captureToken({ context, timeoutMs: args.timeout * 1000 });
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  const { token, source } = await capturePromise;

  if (!token) {
    console.error(`\nTimed out after ${args.timeout}s without capturing a token.`);
    console.error(`Possible causes:`);
    console.error(`  - You closed the browser before logging in.`);
    console.error(`  - The login flow used a route we don't know about.`);
    console.error(`  - Network requests are happening but with a different host.`);

    if (args.debug || (await confirm("Write redacted storage/cookie diagnostics?"))) {
      try {
        const file = await dumpDiagnostics(context, page);
        console.error(`Diagnostics written to ${file}`);
      } catch (err) {
        console.error(`Failed to write diagnostics: ${err instanceof Error ? err.message : err}`);
      }
    }

    await browser.close();
    process.exit(1);
  }

  console.log(`\nCaptured a candidate token via: ${source}`);

  console.log(`Validating against ${API_BASE}/auth/me…`);
  const v = await validateToken(token);
  if (!v.ok) {
    console.error(`Validation failed: HTTP ${v.status}${v.error ? ` (${v.error})` : ""}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`Validation OK (HTTP 200).`);

  const payload = decodeJwt(token);
  console.log(`Token expiry: ${describeExpiry(payload)}`);

  let merged;
  try {
    merged = await mergeIntoEnv({ name: args.name, token, force: args.force });
  } catch (err) {
    console.error(`\nFailed to update ${ENV_PATH}:`);
    console.error(err instanceof Error ? err.message : String(err));
    await browser.close();
    process.exit(1);
  }

  console.log(`\nUpdated ${ENV_PATH}: STFC_ACCOUNTS now contains ${merged.length} account(s) [${merged.map((a) => a.name).join(", ")}].`);

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

main().catch((err) => {
  console.error(`\nUnexpected error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
