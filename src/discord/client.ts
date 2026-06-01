// T024 [US1] — Discord REST client.
//
// We use a thin custom fetch wrapper rather than @discordjs/rest so:
//   - the `fetchImpl` injection seam mirrors `src/api/client.ts`, which keeps
//     the test stubbing pattern identical across the project;
//   - typed-error mapping (auth / rate-limit / channel-access / not-found /
//     transient / schema-mismatch) stays explicit at the call site;
//   - we avoid pulling in the (much larger) @discordjs/rest event-emitter
//     surface for a single GET endpoint family.
//
// Constitution Principle V & FR-029: `DISCORD_BOT_TOKEN` is env-only.
// It is NEVER persisted, NEVER logged, NEVER embedded in a thrown error
// message. Every error path routes through `redactForLog` as a second pass.

import { redactString } from "../lib/redact.ts";
import {
  BotIdentitySchema,
  DiscordMessageArraySchema,
  DiscordMessageSchema,
  type BotIdentity,
  type DiscordMessage,
} from "./schemas.ts";

const ENV_VAR = "DISCORD_BOT_TOKEN";

export const DISCORD_API_BASE = "https://discord.com/api/v10";
const USER_AGENT = "STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)";
const DEFAULT_TIMEOUT_MS = 10_000;
type DiscordHttpMethod = "GET" | "POST";

// ── Typed errors ────────────────────────────────────────────────────────────

export class DiscordTokenMissingError extends Error {
  override readonly name = "DiscordTokenMissingError";
}

export class DiscordAuthError extends Error {
  override readonly name = "DiscordAuthError";
}

export class DiscordRateLimitError extends Error {
  override readonly name = "DiscordRateLimitError";
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export class DiscordTransientError extends Error {
  override readonly name = "DiscordTransientError";
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class DiscordChannelAccessError extends Error {
  override readonly name = "DiscordChannelAccessError";
  /** Feature 003: the upstream Discord JSON-error `code` (e.g. 50001, 50013)
   *  when the 403 body carried one. Undefined when absent or unparseable. */
  readonly discordErrorCode?: number;
  constructor(message: string, opts?: { discordErrorCode?: number }) {
    super(message);
    if (opts?.discordErrorCode !== undefined) {
      this.discordErrorCode = opts.discordErrorCode;
    }
  }
}

export class DiscordChannelNotFoundError extends Error {
  override readonly name = "DiscordChannelNotFoundError";
}

export class SchemaMismatchError extends Error {
  override readonly name = "SchemaMismatchError";
}

// ── Token loader (kept verbatim from Phase 2 T011) ──────────────────────────

export function loadDiscordToken(): string {
  const raw = process.env[ENV_VAR];
  if (raw === undefined || raw.length === 0) {
    throw new DiscordTokenMissingError(
      redactString(
        `${ENV_VAR} is not set in the environment (required for the Discord monitor; expected GitHub Actions encrypted secret or local .env).`,
      ),
    );
  }
  return raw;
}

// ── Client ──────────────────────────────────────────────────────────────────

export interface DiscordClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Total bounded retry budget for 429 responses per request. Default 3. */
  rateLimitRetryCap?: number;
  /** Sleep injection for tests. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface GetChannelMessagesOpts {
  after?: string;
  limit?: number;
}

export class DiscordClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimitRetryCap: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(opts: DiscordClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DISCORD_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.rateLimitRetryCap = opts.rateLimitRetryCap ?? 3;
    this.sleep = opts.sleep ?? defaultSleep;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getMe(): Promise<BotIdentity> {
    const json = await this.requestJson("GET", "/users/@me");
    // Reject user-account tokens before zod parsing so the failure mode is
    // the explicit auth error (per data-model.md §BotIdentity validation).
    if (
      json !== null &&
      typeof json === "object" &&
      "bot" in json &&
      (json as { bot: unknown }).bot === false
    ) {
      throw new DiscordAuthError(
        redactString("token is not a bot token (GET /users/@me returned bot: false)"),
      );
    }
    const parsed = BotIdentitySchema.safeParse(json);
    if (!parsed.success) {
      throw new SchemaMismatchError(
        redactString(`GET /users/@me schema mismatch: ${parsed.error.message}`),
      );
    }
    return parsed.data;
  }

  async getChannelMessages(
    channelId: string,
    opts: GetChannelMessagesOpts = {},
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams();
    params.set("limit", String(opts.limit ?? 100));
    if (opts.after !== undefined) params.set("after", opts.after);
    const path = `/channels/${channelId}/messages?${params.toString()}`;
    const json = await this.requestJson("GET", path);
    const parsed = DiscordMessageArraySchema.safeParse(json);
    if (!parsed.success) {
      throw new SchemaMismatchError(
        redactString(
          `GET ${path} schema mismatch: ${parsed.error.message}`,
        ),
      );
    }
    return parsed.data;
  }

  async postMessage(channelId: string, content: string): Promise<DiscordMessage> {
    const path = `/channels/${channelId}/messages`;
    const json = await this.requestJson("POST", path, { content });
    const parsed = DiscordMessageSchema.safeParse(json);
    if (!parsed.success) {
      throw new SchemaMismatchError(
        redactString(
          `POST ${path} schema mismatch: ${parsed.error.message}`,
        ),
      );
    }
    return parsed.data;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requestJson(
    method: DiscordHttpMethod,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let retries = 0;
    let transientRetries = 0;
    for (;;) {
      const res = await this.attempt(method, path, body);
      const status = res.status;

      if (status === 200) {
        return await this.parseJson(res, method, path);
      }

      if (status === 401) {
        throw new DiscordAuthError(
          redactString(`Authentication rejected (401) on ${method} ${path}`),
        );
      }

      if (status === 403) {
        // Pre-read the JSON envelope to extract Discord's numeric `code`
        // (e.g. 50001 / 50013) so the orchestrator can produce a targeted
        // remediation. A missing/non-JSON body is tolerated — the error
        // surfaces with `discordErrorCode === undefined`.
        const body = await safeReadJson(res);
        const code = extractDiscordErrorCode(body);
        const opts = code === undefined ? undefined : { discordErrorCode: code };
        throw new DiscordChannelAccessError(
          redactString(
            code === undefined
              ? `Access forbidden (403) on ${method} ${path}`
              : `Access forbidden (403, code ${code}) on ${method} ${path}`,
          ),
          opts,
        );
      }

      if (status === 404) {
        throw new DiscordChannelNotFoundError(
          redactString(`Not found (404) on ${method} ${path}`),
        );
      }

      if (status === 429) {
        if (retries >= this.rateLimitRetryCap) {
          const retryMs = await readRetryAfterMs(res);
          throw new DiscordRateLimitError(
            redactString(`Rate-limited (429) on ${method} ${path} after ${retries} retries`),
            retryMs,
          );
        }
        const retryMs = await readRetryAfterMs(res);
        await this.sleep(retryMs);
        retries++;
        continue;
      }

      if (status >= 500 && status <= 599) {
        if (transientRetries === 0) {
          transientRetries++;
          await this.sleep(jitter(250, 1000));
          continue;
        }
        throw new DiscordTransientError(
          redactString(`Server error (${status}) on ${method} ${path}`),
          status,
        );
      }

      // Other 4xx / unexpected: surface as a (non-retrying) transient class
      // so the orchestrator still records the channel as errored.
      throw new DiscordTransientError(
        redactString(`Unexpected HTTP ${status} on ${method} ${path}`),
        status,
      );
    }
  }

  private async attempt(
    method: DiscordHttpMethod,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(this.timeoutMs);
    const headers: Record<string, string> = {
      // Bot token MUST be sent with the `Bot ` prefix per Discord docs.
      Authorization: `Bot ${this.token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Wrap network/abort errors so the token is never echoed back via
      // any default string conversion.
      const detail = err instanceof Error ? err.message : String(err);
      throw new DiscordTransientError(
        redactString(`Network failure on ${method} ${path}: ${detail}`),
        0,
      );
    }
  }

  private async parseJson(
    res: Response,
    method: DiscordHttpMethod,
    path: string,
  ): Promise<unknown> {
    const contentType = res.headers.get("content-type") ?? "";
    if (!/json/i.test(contentType)) {
      const body = await safeReadText(res);
      throw new SchemaMismatchError(
        redactString(
          `Expected JSON from ${method} ${path} (content-type "${contentType}"): ${truncate(body, 200)}`,
        ),
      );
    }
    try {
      return await res.json();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SchemaMismatchError(
        redactString(`Failed to parse JSON from ${method} ${path}: ${detail}`),
      );
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readRetryAfterMs(res: Response): Promise<number> {
  // Discord 429s carry `Retry-After` both as a header (seconds, float) and
  // in the JSON body's `retry_after`. Prefer the header; fall back to body.
  const header = res.headers.get("retry-after");
  if (header !== null) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
  }
  try {
    const body = (await res.clone().json()) as { retry_after?: unknown };
    const n = Number(body.retry_after);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
  } catch {
    /* fall through */
  }
  return 1000;
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return undefined;
  }
}

function extractDiscordErrorCode(body: unknown): number | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const raw = (body as { code?: unknown }).code;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return undefined;
  return raw;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "(could not read body)";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function jitter(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
