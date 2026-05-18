#!/usr/bin/env node
// =============================================================================
// scripts/discord-ops/set-discord-app-metadata.mjs
//
// PURPOSE
//   Operator-only one-shot utility for writing Discord bot identity metadata:
//     - Bot avatar (PATCH /users/@me .avatar)
//     - Bot username (PATCH /users/@me .username)
//     - Application description (PATCH /applications/@me .description)
//
//   This script is invoked manually by a human operator (or via the
//   `.github/workflows/discord-ops.yml` workflow_dispatch wrapper) when the
//   bot's public presentation needs to change. It is NOT loaded by the
//   monitor runtime under any code path.
//
// INVOCATION
//   node scripts/discord-ops/set-discord-app-metadata.mjs \
//     [--icon <path-to-image-file-or-data-uri>] \
//     [--description <text>] \
//     [--username <name>] \
//     [--dry-run]
//
//   At least one of --icon / --description / --username is required.
//   --dry-run prints the intended PATCH body(s) (token redacted) and exits 0.
//   --help    prints usage and exits 0.
//
// SECURITY MODEL
//   - The bot token MUST be supplied via the env var `DISCORD_BOT_TOKEN`.
//     It is NEVER accepted on argv (would land in shell history /
//     process listings / Actions logs).
//   - Every error path routes the message through `redactString` before
//     it is thrown, written, or printed. Tests assert the token shape
//     never appears in any error message.
//   - The script does NOT log the token, the Authorization header, the
//     full request init, or any response that might echo credentials.
//
// CONSTITUTION CARVE-OUT
//   Principle V (Discord scope) is read-only-by-default. This script is
//   the explicit operator-write carve-out: lives under `scripts/discord-ops/`,
//   not imported by `src/`, and redacts `DISCORD_BOT_TOKEN` on every error
//   path (FR-012). See `.specify/memory/constitution.md` and the
//   `.squad/decisions/inbox/copilot-directive-override-picard-discord-avatar-(a).md`
//   directive for the full scope.
//
// CI WRAPPER
//   `.github/workflows/discord-ops.yml` exposes the same flags as
//   workflow_dispatch inputs and maps the `DISCORD_BOT_TOKEN` repo secret
//   into the env. Operators in Codespaces or without a local clone use
//   the Actions UI rather than running this script locally.
//
// DEPENDENCIES
//   Node ≥ 24 built-ins only: node:fs/promises, node:path, global fetch.
//   No npm packages. Roll-your-own arg parser, redactor, and image probe
//   keeps this file standalone and audit-friendly.
// =============================================================================

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

// ── Constants ────────────────────────────────────────────────────────────────

export const DISCORD_API_BASE = "https://discord.com/api/v10";
const USER_AGENT =
  "STFC-Discord-Ops (https://github.com/Jamula/stfc, set-discord-app-metadata)";
const MAX_ICON_BYTES = 10 * 1024 * 1024; // Discord hard limit
const MIN_ICON_DIMENSION = 512;          // Discord recommended floor
const MAX_DESCRIPTION_LEN = 400;         // Discord hard limit
const USERNAME_MIN = 2;
const USERNAME_MAX = 32;

const USAGE = `Usage:
  node scripts/discord-ops/set-discord-app-metadata.mjs [options]

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

/**
 * Redact a string of any authorization material we can recognise:
 *  - "Authorization: Bot/Bearer <token>" header forms (HTTP + JSON)
 *  - Bare JWT-shaped 3-segment values
 *  - The literal `DISCORD_BOT_TOKEN` value when supplied.
 */
export function redactString(input, token) {
  let out = String(input)
    .replace(AUTH_HEADER_RE, "$1[REDACTED]")
    .replace(JWT_RE, "[REDACTED-JWT]");
  if (typeof token === "string" && token.length > 0) {
    // Escape regex metacharacters in the token before substitution.
    const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safe, "g"), "[REDACTED-TOKEN]");
  }
  return out;
}

// ── Tiny arg parser ──────────────────────────────────────────────────────────

/**
 * Parse argv. Returns { icon, description, username, dryRun, help }.
 * Unknown flags throw. Repeated flags overwrite (last-wins) so the
 * workflow wrapper can pass through optional inputs cleanly.
 */
export function parseArgs(argv) {
  const out = {
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
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

// ── Image format detection + dimension probe ─────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIG = Buffer.from("GIF87a", "ascii");
const GIF89_SIG = Buffer.from("GIF89a", "ascii");

/** Returns "image/png" | "image/jpeg" | "image/gif" or throws. */
export function detectImageMime(buf) {
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

/**
 * Best-effort width/height probe using only the headers. Returns
 * { width, height } or null if the format couldn't be probed cheaply.
 */
export function probeImageDimensions(buf, mime) {
  try {
    if (mime === "image/png") {
      // IHDR chunk starts at byte 8; chunk data begins at byte 16.
      if (buf.length < 24) return null;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
    if (mime === "image/gif") {
      // Logical Screen Descriptor: width@6 (LE u16), height@8 (LE u16).
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      // Walk JPEG markers looking for an SOF (Start Of Frame) marker.
      // SOF0..SOF15 = 0xFFC0..0xFFCF, excluding 0xC4 (DHT), 0xC8 (JPG),
      // 0xCC (DAC), which are not frame markers.
      let i = 2; // skip SOI
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        // Skip fill bytes (consecutive 0xFF).
        while (i < buf.length && buf[i] === 0xff) i++;
        if (i >= buf.length) return null;
        const marker = buf[i];
        i++;
        // Standalone markers (no length): SOI (D8), EOI (D9), RST0-7 (D0-D7).
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

/**
 * Returns { dataUri, mime, byteLength, dimensions, warnings[] } or throws.
 * Validates magic-byte mime, hard size cap, soft dimension floor.
 */
export async function loadIconAsDataUri(input) {
  const warnings = [];
  let bytes;
  let mime;

  const m = DATA_URI_RE.exec(input);
  if (m) {
    mime = m[1].toLowerCase();
    bytes = Buffer.from(m[2], "base64");
    // Re-validate via magic bytes — never trust the declared MIME.
    const detected = detectImageMime(bytes);
    if (detected !== mime) {
      warnings.push(
        `data URI declared ${mime} but magic bytes indicate ${detected}; using ${detected}.`,
      );
      mime = detected;
    }
  } else {
    const path = resolve(input);
    bytes = await readFile(path);
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

export function validateDescription(text) {
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

export function validateUsername(name) {
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

/**
 * Thrown by discordPatch when Discord returns a non-2xx response.
 * Distinct from plain Error (transport failure) so the caller can
 * apply different exit codes per the runAll.ts convention.
 */
export class DiscordApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * PATCH a JSON body to a Discord endpoint. Returns the parsed JSON body
 * on 2xx. Throws DiscordApiError on non-2xx (Discord rejected the
 * request) or plain Error on transport failure. The token is captured
 * in closure so it can be redacted from any error.
 */
export async function discordPatch({ path, body, token, fetchImpl, baseUrl }) {
  const url = `${baseUrl ?? DISCORD_API_BASE}${path}`;
  const f = fetchImpl ?? fetch;
  let res;
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
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      redactString(`Network failure on PATCH ${path}: ${detail}`, token),
    );
  }

  let parsed = null;
  let raw = "";
  try {
    raw = await res.text();
    parsed = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const code =
      parsed && typeof parsed === "object" && typeof parsed.code === "number"
        ? parsed.code
        : undefined;
    const message =
      parsed && typeof parsed === "object" && typeof parsed.message === "string"
        ? parsed.message
        : truncate(raw, 200);
    const suffix = code === undefined ? "" : ` (code ${code})`;
    throw new DiscordApiError(
      redactString(
        `Discord PATCH ${path} failed: HTTP ${res.status}${suffix} — ${message}`,
        token,
      ),
      { status: res.status, code },
    );
  }

  return parsed;
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ── Main entry point (exported for tests) ────────────────────────────────────

// Exit codes (runAll.ts convention):
//   0 = success / dry-run preview
//   1 = operator/infra (bad args, missing env, validation, icon-load, transport)
//   2 = Discord rejected a well-formed request (4xx/5xx)

/**
 * Run the CLI. Returns the exit code. All I/O is injectable so tests
 * can capture stdout/stderr and stub fetch. The token is read from
 * `env.DISCORD_BOT_TOKEN` and never echoed back.
 */
export async function runCli({
  argv = [],
  env = process.env,
  fetchImpl = fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
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

  // Validate text fields up front (fail fast, no Discord call).
  try {
    if (args.description !== undefined) validateDescription(args.description);
    if (args.username !== undefined) validateUsername(args.username);
  } catch (err) {
    stderr.write(`${redactString(err instanceof Error ? err.message : String(err))}\n`);
    return 1;
  }

  // Token check. We deliberately do not echo the var name's *value* in any
  // error path — the message tells the operator the var is missing, nothing
  // about what was found.
  const token = env.DISCORD_BOT_TOKEN;
  if (typeof token !== "string" || token.length === 0) {
    stderr.write("DISCORD_BOT_TOKEN env var not set\n");
    return 1;
  }

  // Resolve the icon (filesystem read + format/size validation) before any
  // network call so a bad image fails fast and never charges a request.
  let iconLoaded = null;
  if (args.icon !== undefined) {
    try {
      iconLoaded = await loadIconAsDataUri(args.icon);
    } catch (err) {
      stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err), token)}\n`,
      );
      return 1;
    }
    for (const w of iconLoaded.warnings) {
      stderr.write(`warning: ${w}\n`);
    }
  }

  // Build the per-endpoint PATCH bodies.
  const userMeBody = {};
  if (iconLoaded !== null) userMeBody.avatar = iconLoaded.dataUri;
  if (args.username !== undefined) userMeBody.username = args.username;

  const appMeBody = {};
  if (args.description !== undefined) appMeBody.description = args.description;

  const plannedCalls = [];
  if (Object.keys(userMeBody).length > 0) {
    plannedCalls.push({
      path: "/users/@me",
      body: userMeBody,
      label: describePatch("avatar", "username", userMeBody),
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
    } catch (err) {
      stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err), token)}\n`,
      );
      // DiscordApiError = remote rejected well-formed request (exit 2);
      // anything else = transport / infra failure (exit 1). Per runAll.ts.
      if (err instanceof DiscordApiError) {
        worstExit = Math.max(worstExit, 2);
      } else {
        worstExit = Math.max(worstExit, 1);
      }
    }
  }

  return worstExit;
}

function describePatch(...fields) {
  // The last arg is the body; the rest are candidate field names in order.
  const body = fields.pop();
  const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
  return present.join("+");
}

function redactIconInBody(body) {
  // Avoid dumping a 14 MB base64 string into the operator's terminal on
  // --dry-run; preserve the prefix so the format is verifiable.
  if (typeof body.avatar !== "string") return body;
  const trimmed =
    body.avatar.length > 80 ? `${body.avatar.slice(0, 64)}…[+${body.avatar.length - 64} chars]` : body.avatar;
  return { ...body, avatar: trimmed };
}

// ── Direct-invocation guard ──────────────────────────────────────────────────

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("set-discord-app-metadata.mjs");

if (isMain) {
  runCli({ argv: process.argv.slice(2) }).then(
    (code) => process.exit(code),
    (err) => {
      // Last-ditch safety net: anything that escapes runCli still gets
      // redacted before it hits stderr.
      process.stderr.write(
        `${redactString(err instanceof Error ? err.message : String(err))}\n`,
      );
      process.exit(1);
    },
  );
}
