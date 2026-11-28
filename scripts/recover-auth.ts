#!/usr/bin/env node
/**
 * Cross-platform guided local authentication recovery launcher.
 *
 * Replaces the legacy PowerShell-only recover-auth.ps1 launcher so recovery
 * behaves identically on Windows and Linux Codespaces under Node 26+.
 *
 * Usage:
 *   npm run recover-auth
 *   node scripts/recover-auth.ts
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process, { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrivateInputStream, PrivateOutputStream } from "./capture-token.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const MIN_NODE_MAJOR = 26;
const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLEARED_ENV_KEYS = ["STFC_EMAIL", "STFC_PASSWORD", "STFC_OTP", "STFC_DEBUG_DIR"] as const;

export interface RecoverAuthOptions {
  rootDir?: string;
  nodeVersion?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: PrivateInputStream;
  stdout?: PrivateOutputStream;
  log?: (line: string) => void;
  preflight?: (rootDir: string) => Promise<boolean> | boolean;
  readBackup?: () => Promise<string>;
  confirmConditions?: () => Promise<string>;
  runCapture?: (args: { rootDir: string; env: NodeJS.ProcessEnv }) => Promise<number> | number;
}

function parseMajorVersion(version: string): number {
  const cleaned = version.trim().replace(/^v/i, "");
  const major = Number.parseInt(cleaned.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

async function defaultPreflight(rootDir: string): Promise<boolean> {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { chromium } from "playwright"; import { existsSync } from "node:fs"; await import("yaml"); if (!existsSync(chromium.executablePath())) process.exit(1);',
    ],
    {
      cwd: rootDir,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  return result.status === 0;
}

export function readMaskedLine(
  prompt: string,
  {
    stdin = defaultStdin as unknown as PrivateInputStream,
    stdout = defaultStdout as unknown as PrivateOutputStream,
  }: { stdin?: PrivateInputStream; stdout?: PrivateOutputStream } = {},
): Promise<string> {
  if (
    !stdin.isTTY ||
    !stdout.isTTY ||
    typeof stdin.setRawMode !== "function" ||
    typeof stdin.on !== "function" ||
    typeof stdin.off !== "function"
  ) {
    return Promise.reject(new Error("A private interactive terminal is required."));
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
      if (error || invalid) {
        reject(new Error("Masked input was cancelled or invalid."));
      } else {
        resolve(value.trim());
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
        } else if (!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(char)) {
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

/**
 * Strictly validate a single-line STFC_ACCOUNTS JSON array backup without
 * importing external packages before preflight succeeds, while still rejecting
 * duplicate object keys, non-strings, whitespace names, duplicate account
 * labels, backslashes, or apostrophes.
 */
export function validateSingleLineBackup(baseline: string): number {
  if (
    !baseline ||
    /[\r\n]/.test(baseline) ||
    baseline.includes("'") ||
    baseline.includes("\\")
  ) {
    throw new Error("unsupported format");
  }

  // Reject duplicate keys within any JSON object before JSON.parse collapses them.
  assertUniqueJsonObjectKeys(baseline);

  const parsed: unknown = JSON.parse(baseline);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("not a nonempty array");
  }

  const names = new Set<string>();
  for (const entry of parsed as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("not an object");
    }
    const record = entry as Record<string, unknown>;
    const name = record["name"];
    const token = record["token"];
    if (typeof name !== "string" || typeof token !== "string") {
      throw new Error("invalid field");
    }
    if (!name.trim() || !JWT_SHAPE_RE.test(token) || names.has(name)) {
      throw new Error("invalid account");
    }
    names.add(name);
  }

  return names.size;
}

function assertUniqueJsonObjectKeys(jsonText: string): void {
  // Since backslashes are already rejected above, JSON string tokens have no escapes.
  let i = 0;
  const stack: Array<{ kind: "object"; keys: Set<string>; expectingKey: boolean } | { kind: "array" }> = [];

  const skipWs = () => {
    while (i < jsonText.length && /\s/.test(jsonText[i] ?? "")) i++;
  };

  while (i < jsonText.length) {
    skipWs();
    const ch = jsonText[i];
    if (ch === undefined) break;

    if (ch === "{") {
      stack.push({ kind: "object", keys: new Set<string>(), expectingKey: true });
      i++;
      continue;
    }
    if (ch === "[") {
      stack.push({ kind: "array" });
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      i++;
      continue;
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top?.kind === "object") top.expectingKey = true;
      i++;
      continue;
    }
    if (ch === ":") {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = jsonText.indexOf('"', i + 1);
      if (end === -1) return; // JSON.parse will reject malformed syntax
      const literal = jsonText.slice(i + 1, end);
      i = end + 1;
      skipWs();
      const top = stack[stack.length - 1];
      if (top?.kind === "object" && top.expectingKey && jsonText[i] === ":") {
        if (top.keys.has(literal)) {
          throw new Error("duplicate property");
        }
        top.keys.add(literal);
        top.expectingKey = false;
      }
      continue;
    }
    i++;
  }
}

async function directoryContainsEnvFile(rootDir: string): Promise<boolean> {
  const entries = await fs.readdir(rootDir);
  return process.platform === "win32"
    ? entries.some((entry) => entry.toLowerCase() === ".env")
    : entries.includes(".env");
}

export async function runRecoverAuth(options: RecoverAuthOptions = {}): Promise<number> {
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));

  if (parseMajorVersion(nodeVersion) < MIN_NODE_MAJOR) {
    log(`Stopped: Node.js ${MIN_NODE_MAJOR} or later is required. Run npm run recover-auth under Node ${MIN_NODE_MAJOR}+.`);
    return 1;
  }

  const preflightOk = await (options.preflight ?? defaultPreflight)(rootDir);
  if (!preflightOk) {
    log("Stopped: install the project dependencies and Playwright Chromium before recovery. Nothing was written.");
    return 1;
  }

  let envAlreadyPresent = false;
  try {
    envAlreadyPresent = await directoryContainsEnvFile(rootDir);
  } catch {
    log("Stopped: could not safely create .env. No account data was sent to GitHub.");
    return 1;
  }
  if (envAlreadyPresent) {
    log("Stopped: this worktree already has an .env. Nothing was changed.");
    return 1;
  }

  log("Paste the complete STFC_ACCOUNTS backup as ONE LINE of JSON at the masked prompt.");
  log("Do not paste it into chat. It will be stored as plaintext in this worktree's ignored .env.");

  let baseline: string | null = null;
  let accountCount = 0;
  try {
    baseline = await (options.readBackup ?? (() => readMaskedLine("Complete backup: ", { stdin: options.stdin, stdout: options.stdout })))();
    accountCount = validateSingleLineBackup(baseline);
  } catch {
    baseline = null;
    log(
      "Stopped: backup must be a nonempty single-line JSON array of unique named JWT accounts, without backslashes or apostrophes. Nothing was written.",
    );
    return 1;
  }

  log(`Backup contains ${accountCount} account(s).`);
  log(
    "Continue only if this is the current complete backup and all redemption workflows and concurrent .env updates are stopped until completion.",
  );

  const confirmation = await (
    options.confirmConditions ??
    (async () => {
      const rl = createInterface({ input: defaultStdin, output: defaultStdout });
      try {
        return await rl.question("Type YES to confirm both conditions: ");
      } finally {
        rl.close();
      }
    })
  )();

  if (confirmation !== "YES") {
    baseline = null;
    log("Stopped. Nothing was written.");
    return 1;
  }

  const envPath = path.join(rootDir, ".env");
  let created = false;
  try {
    const handle = await fs.open(envPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`STFC_ACCOUNTS='${baseline}'\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    created = false;
  } catch {
    log("Stopped: could not safely create .env. No account data was sent to GitHub.");
    return 1;
  } finally {
    baseline = null;
    if (created) {
      await fs.unlink(envPath).catch(() => {});
    }
  }

  const previousEnvironment = new Map<string, string | undefined>();
  for (const key of CLEARED_ENV_KEYS) {
    previousEnvironment.set(key, env[key]);
  }

  let captureExitCode = 1;
  try {
    for (const key of CLEARED_ENV_KEYS) {
      delete env[key];
    }
    log("Starting the visible browser. Sign in with email and OTP in the browser, not in this terminal.");
    log("At the hidden prompt, enter the accountId from your independently verified official /auth/me response.");

    const runCapture =
      options.runCapture ??
      (({ rootDir: cwd, env: childEnv }) => {
        const result = spawnSync(
          process.execPath,
          [path.join(cwd, "scripts", "capture-token.ts"), "--timeout", "900"],
          { cwd, env: childEnv, stdio: "inherit" },
        );
        return result.status ?? 1;
      });
    captureExitCode = await runCapture({ rootDir, env });
  } finally {
    for (const key of CLEARED_ENV_KEYS) {
      const prior = previousEnvironment.get(key);
      if (prior === undefined) {
        delete env[key];
      } else {
        env[key] = prior;
      }
    }
  }

  if (captureExitCode !== 0) {
    log("Capture failed or the local backup could not be updated. Check the preceding message before retrying.");
    return captureExitCode;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecoverAuth().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error("Recovery failed unexpectedly.");
      process.exitCode = 1;
    },
  );
}
