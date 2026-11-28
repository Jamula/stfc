#!/usr/bin/env node
// =============================================================================
// scripts/discord-ops/set-discord-app-metadata.ts
//
// PURPOSE
//   Operator-only one-shot utility for writing Discord bot identity metadata:
//     - Bot avatar (PATCH /users/@me .avatar)
//     - Bot username (PATCH /users/@me .username)
//     - Application description (PATCH /applications/@me .description)
//
// DEPENDENCIES
//   Node >= 26 built-ins only: node:fs/promises, node:path, global fetch.
//   No npm packages.
// =============================================================================

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export interface ParsedDiscordMetadataArgs {
  icon: string | undefined;
  description: string | undefined;
  username: string | undefined;
  dryRun: boolean;
  help: boolean;
}

export type SupportedDiscordImageMime = "image/png" | "image/jpeg" | "image/gif";

export interface LoadedDiscordIcon {
  dataUri: string;
  mime: SupportedDiscordImageMime;
  byteLength: number;
  dimensions: { width: number; height: number } | null;
  warnings: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

export const DISCORD_API_BASE = "https://discord.com/api/v10";
const USER_AGENT =
  "STFC-Discord-Ops (https://github.com/Jamula/stfc, set-discord-app-metadata)";
const MAX_ICON_BYTES = 10 * 1024 * 1024;
const MIN_ICON_DIMENSION = 512;
const MAX_DESCRIPTION_LEN = 400;
const USERNAME_MIN = 2;
const USERNAME_MAX = 32;

const USAGE = `Usage:
  node scripts/discord-ops/set-discord-app-metadata.ts [options]

Options:
  --icon <path|data-uri>   Update the bot avatar. Accepts a path to a PNG,
                           JPEG, or GIF, OR a "data:image/<type>;base64,..."
                           URI. Max 10 MB; >=512x512 recommended.
  --description <text>     Update the application description (<=400 chars).
  --username <name>        Update the bot username (2-32 chars).
  --dry-run                Print the intended PATCH body(s) and exit 0.
  --help                   Show this message and exit 0.

Environment:
  DISCORD_BOT_TOKEN        Bot token, REQUIRED unless --help is passed.
                           Never pass the token on argv.

At least one of --icon / --description / --username is required.
`;

// ── Redaction (inlined from src/lib/redact.ts to keep this script free of
//    runtime imports — FR-009 requires this file is not reachable from src/) ──

const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const AUTH_HEADER_RE =
  /(authorization\s*"?\s*[:=]\s*"?)(Bot\s+|Bearer\s+)?[^",\s}]+/gi;

export function redactString(input: unknown, token?: string): string {
  let out = String(input)
    .replace(AUTH_HEADER_RE, "$1[REDACTED]")
    .replace(JWT_RE, "[REDACTED-JWT]");
  if (typeof token === "string" && token.length > 0) {
    const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safe, "g"), "[REDACTED-TOKEN]");
  }
  return out;
}

// ── Tiny arg parser ──────────────────────────────────────────────────────────

export function parseArgs(argv: readonly string[]): ParsedDiscordMetadataArgs {
  const out: ParsedDiscordMetadataArgs = {
    icon: undefined,
    description: undefined,
    username: undefined,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--icon":
        out.icon = argv[++i];
        break;
      case "--description":
        out.description = argv[++i];
        break;
      case "--username":
        out.username = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${String(a)}`);
    }
  }
  return out;
}

// ── Image format detection + dimension probe ─────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIG = Buffer.from("GIF87a", "ascii");
const GIF89_SIG = Buffer.from("GIF89a", "ascii");

export function detectImageMime(buf: Buffer): SupportedDiscordImageMime {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return "image/png";
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_SOI)) return "image/jpeg";
  if (
    buf.length >= 6 &&
    (buf.subarray(0, 6).equals(GIF87_SIG) || buf.subarray(0, 6).equals(GIF89_SIG))
  ) {
    return "image/gif";
  }
  throw new Error(
    "Unsupported image format: expected PNG, JPEG, or GIF (detected from magic bytes).",
  );
}

export function probeImageDimensions(
  buf: Buffer,
  mime: string,
): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      if (buf.length < 24) return null;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
    if (mime === "image/gif") {
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        while (i < buf.length && buf[i] === 0xff) i++;
        const marker = buf[i];
        if (marker === undefined) return null;
        i++;
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          continue;
        }
        if (i + 1 >= buf.length) return null;
        const segLen = buf.readUInt16BE(i);
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          if (i + 7 >= buf.length) return null;
          const height = buf.readUInt16BE(i + 3);
          const width = buf.readUInt16BE(i + 5);
          return { width, height };
        }
        i += segLen;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

// ── Icon loader: file path OR data URI ───────────────────────────────────────

const DATA_URI_RE = /^data:(image\/(?:png|jpeg|gif));base64,(.+)$/i;

export async function loadIconAsDataUri(input: string): Promise<LoadedDiscordIcon> {
  const warnings: string[] = [];
  let bytes: Buffer;
  let mime: SupportedDiscordImageMime;

  const m = DATA_URI_RE.exec(input);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    mime = m[1].toLowerCase() as SupportedDiscordImageMime;
    bytes = Buffer.from(m[2], "base64");
    const detected = detectImageMime(bytes);
    if (detected !== mime) {
      warnings.push(
        `data URI declared ${mime} but magic bytes indicate ${detected}; using ${detected}.`,
      );
      mime = detected;
    }
  } else {
    const filePath = resolve(input);
    bytes = await readFile(filePath);
    mime = detectImageMime(bytes);
  }

  if (bytes.length > MAX_ICON_BYTES) {
    throw new Error(
      `Icon is ${bytes.length} bytes, exceeds Discord's ${MAX_ICON_BYTES}-byte limit.`,
    );
  }

  const dimensions = probeImageDimensions(bytes, mime);
  if (dimensions === null) {
    warnings.push(
      `Could not probe image dimensions for ${mime}; skipping the >=${MIN_ICON_DIMENSION}px check.`,
    );
  } else if (
    dimensions.width < MIN_ICON_DIMENSION ||
    dimensions.height < MIN_ICON_DIMENSION
  ) {
    warnings.push(
      `Icon is ${dimensions.width}x${dimensions.height}; Discord recommends >=${MIN_ICON_DIMENSION}x${MIN_ICON_DIMENSION}.`,
    );
  }

  const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
  return { dataUri, mime, byteLength: bytes.length, dimensions, warnings };
}

// ── Validation for the text fields ───────────────────────────────────────────

export function validateDescription(text: unknown): void {
  if (typeof text !== "string") {
    throw new Error("--description must be a string.");
  }
  if (text.length === 0) {
    throw new Error("--description must not be empty.");
  }
  if (text.length > MAX_DESCRIPTION_LEN) {
    throw new Error(
      `--description is ${text.length} chars; Discord's max is ${MAX_DESCRIPTION_LEN}.`,
    );
  }
}

export function validateUsername(name: unknown): void {
  if (typeof name !== "string") {
    throw new Error("--username must be a string.");
  }
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    throw new Error(
      `--username must be ${USERNAME_MIN}-${USERNAME_MAX} chars (got ${name.length}).`,
    );
  }
}

// ── Discord PATCH primitive ──────────────────────────────────────────────────

export class DiscordApiError extends Error {
  status: number | undefined;
  code: number | undefined;

  constructor(
    message: string,
    { status, code }: { status?: number; code?: number } = {},
  ) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
  }
}

export async function discordPatch({
  path,
  body,
  token,
  fetchImpl,
  baseUrl,
}: {
  path: string;
  body: Record<string, unknown>;
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchImpl?: (url: string, init?: any) => Promise<any>;
  baseUrl?: string;
}): Promise<unknown> {
  const url = `${baseUrl ?? DISCORD_API_BASE}${path}`;
  const f = fetchImpl ?? fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any;
  try {
    res = await f(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      redactString(`Network failure on PATCH ${path}: ${detail}`, token),
    );
  }

  let parsed: Record<string, unknown> | null = null;
  let raw = "";
  try {
    raw = await res.text();
    parsed = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const code =
      parsed && typeof parsed === "object" && typeof parsed["code"] === "number"
        ? parsed["code"]
        : undefined;
    const message =
      parsed && typeof parsed === "object" && typeof parsed["message"] === "string"
        ? parsed["message"]
        : truncate(raw, 200);
    const suffix = code === undefined ? "" : ` (code ${code})`;
    throw new DiscordApiError(
      redactString(
        `Discord PATCH ${path} failed: HTTP ${String(res.status)}${suffix} — ${message}`,
        token,
      ),
      { status: res.status as number, code },
    );
  }

  return parsed;
}

function truncate(s: unknown, n: number): string {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ── Main entry point (exported for tests) ────────────────────────────────────

export async function runCli({
  argv = [],
  env = process.env,
  fetchImpl = fetch,
  stdout = process.stdout,
  stderr = process.stderr,
}: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchImpl?: (url: string, init?: any) => Promise<any>;
  stdout?: { write: (chunk: string) => unknown };
  stderr?: { write: (chunk: string) => unknown };
} = {}): Promise<number> {
  let args: ParsedDiscordMetadataArgs;
  try {
    args = parseArgs(argv);
  } catch (err: unknown) {
    stderr.write(`${redactString(err instanceof Error ? err.message : String(err))}\n`);
    stderr.write(USAGE);
    return 1;
  }

  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }

  if (
    args.icon === undefined &&
    args.description === undefined &&
    args.username === undefined
  ) {
    stderr.write("At least one of --icon, --description, --username is required.\n");
    stderr.write(USAGE);
    return 1;
  }

  try {
    if (args.description !== undefined) validateDescription(args.description);
    if (args.username !== undefined) validateUsername(args.username);
  } catch (err: unknown) {
    stderr.write(`${redactString(err instanceof Error ? err.message : String(err))}\n`);
    return 1;
  }

  const token = env["DISCORD_BOT_TOKEN"];
  if (typeof token !== "string" || token.length === 0) {
    stderr.write("DISCORD_BOT_TOKEN env var not set\n");
    return 1;
  }

  let iconLoaded: LoadedDiscordIcon | null = null;
  if (args.icon !== undefined) {
    try {
      iconLoaded = await loadIconAsDataUri(args.icon);
    } catch (err: unknown) {
      stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err), token)}\n`,
      );
      return 1;
    }
    for (const w of iconLoaded.warnings) {
      stderr.write(`warning: ${w}\n`);
    }
  }

  const userMeBody: Record<string, unknown> = {};
  if (iconLoaded !== null) userMeBody["avatar"] = iconLoaded.dataUri;
  if (args.username !== undefined) userMeBody["username"] = args.username;

  const appMeBody: Record<string, unknown> = {};
  if (args.description !== undefined) appMeBody["description"] = args.description;

  const plannedCalls: Array<{
    path: string;
    body: Record<string, unknown>;
    label: string;
  }> = [];
  if (Object.keys(userMeBody).length > 0) {
    plannedCalls.push({
      path: "/users/@me",
      body: userMeBody,
      label: describePatch(["avatar", "username"], userMeBody),
    });
  }
  if (Object.keys(appMeBody).length > 0) {
    plannedCalls.push({
      path: "/applications/@me",
      body: appMeBody,
      label: "description",
    });
  }

  if (args.dryRun) {
    for (const call of plannedCalls) {
      stdout.write(
        `DRY-RUN PATCH ${call.path}\n${redactString(
          JSON.stringify(redactIconInBody(call.body), null, 2),
          token,
        )}\n`,
      );
    }
    return 0;
  }

  let worstExit = 0;
  for (const call of plannedCalls) {
    try {
      await discordPatch({
        path: call.path,
        body: call.body,
        token,
        fetchImpl,
      });
      stdout.write(`✓ PATCH ${call.path} (${call.label})\n`);
    } catch (err: unknown) {
      stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err), token)}\n`,
      );
      if (err instanceof DiscordApiError) {
        worstExit = Math.max(worstExit, 2);
      } else {
        worstExit = Math.max(worstExit, 1);
      }
    }
  }

  return worstExit;
}

function describePatch(fields: readonly string[], body: Record<string, unknown>): string {
  const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
  return present.join("+");
}

function redactIconInBody(body: Record<string, unknown>): Record<string, unknown> {
  const avatar = body["avatar"];
  if (typeof avatar !== "string") return body;
  const trimmed =
    avatar.length > 80
      ? `${avatar.slice(0, 64)}…[+${avatar.length - 64} chars]`
      : avatar;
  return { ...body, avatar: trimmed };
}

// ── Direct-invocation guard ──────────────────────────────────────────────────

const isMain =
  (process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false) ||
  Boolean(process.argv[1]?.endsWith("set-discord-app-metadata.ts"));

if (isMain) {
  runCli({ argv: process.argv.slice(2) }).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err))}\n`,
      );
      process.exit(1);
    },
  );
}
