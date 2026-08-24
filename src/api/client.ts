// Thin fetch wrapper. Owns timeouts, header construction, JSON parsing,
// zod validation, retries, and the typed-error taxonomy the orchestrator
// branches on. The Authorization header is set here and never rendered
// into any thrown error or log line — the redactor in lib/redact backs
// that up as a second line of defense.

import type { ZodType } from "zod";
import { redactString } from "../lib/redact.ts";
import {
  AuthMeResponseSchema,
  ClaimResponseSchema,
  GiftsResponseSchema,
  RedeemResponseSchema,
  type GiftsResponse,
  type RedeemResponse,
} from "./schemas.ts";

type GiftsLike = GiftsResponse;
type RedeemLike = RedeemResponse;

export const DEFAULT_BASE_URL =
  "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2";

const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  override readonly name: string = "ApiError";
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(message: string, status?: number, options?: { retryAfterMs?: number }) {
    super(message);
    this.status = status;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class TokenExpiredError extends ApiError {
  override readonly name = "TokenExpiredError";
}

export class TransientError extends ApiError {
  override readonly name = "TransientError";
}

export class SchemaMismatchError extends ApiError {
  override readonly name = "SchemaMismatchError";
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface RequestArgs<T> {
  path: string;
  schema: ZodType<T>;
  method?: HttpMethod;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(args: RequestArgs<T>): Promise<T> {
    const method: HttpMethod = args.method ?? "GET";
    const isSafe = method === "GET";

    // One bounded sequence composes the existing single GET-transient retry
    // with auth corroboration. A 401/403 is safe to replay for every method
    // because the server rejected the request before applying side effects.
    // Three total attempts cover either ordering of one transient failure and
    // one auth rejection without allowing POST 5xx/network retries.
    const maxAttempts = 3;
    let authRejections = 0;
    let transientRetries = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attempt(args, method);
      } catch (err) {
        if (err instanceof TokenExpiredError) {
          authRejections += 1;
          if (authRejections >= 2) throw err;
          if (attempt === maxAttempts) {
            throw new TransientError(
              redactString(
                `Authentication rejection on ${method} ${args.path} could not be corroborated within the retry limit`,
              ),
              err.status,
            );
          }
        } else if (
          isSafe &&
          transientRetries === 0 &&
          (err instanceof TransientError || err instanceof TypeError) &&
          attempt < maxAttempts
        ) {
          transientRetries += 1;
        } else {
          throw err;
        }

        await sleep(jitter(500, 1000));
      }
    }

    throw new Error("API request retry loop exhausted unexpectedly");
  }

  private async attempt<T>(args: RequestArgs<T>, method: HttpMethod): Promise<T> {
    const url = this.buildUrl(args.path);
    const signal = args.signal ?? AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };

    const init: RequestInit = { method, headers, signal };
    if (args.body !== undefined && (method === "POST" || method === "PUT")) {
      init.body = JSON.stringify(args.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw wrapNetworkError(err, method, args.path);
    }

    return parseAndValidate(res, args.schema, method, args.path);
  }

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  // -- Endpoint methods. The orchestrator and tests' fake clients use these,
  // -- so they MUST live on the client (not as module functions in
  // -- endpoints.ts) or the test's FakeClient interface cannot satisfy
  // -- ApiClient's structural shape. endpoints.ts re-exports them as
  // -- standalone functions for the diagnostic skills.

  getMe(): Promise<unknown> {
    // Schema declared in api/schemas.ts; imported lazily here to avoid a
    // circular import (endpoints.ts -> client.ts -> schemas.ts is fine).
    return this.request({ path: "/auth/me", method: "GET", schema: AuthMeResponseSchema });
  }

  async listGifts(): Promise<GiftsLike> {
    // The list endpoint without ?available=true returns the entire bundle
    // catalog (mostly bundles you can't claim). With ?available=true it
    // returns the subset the player can act on right now.
    return this.request({ path: "/offers/gifts?available=true", method: "GET", schema: GiftsResponseSchema });
  }

  /** List all gift bundles (catalog) — for the diagnostic `list-gifts` skill. */
  async listAllGifts(): Promise<GiftsLike> {
    return this.request({ path: "/offers/gifts", method: "GET", schema: GiftsResponseSchema });
  }

  claimGift(bundleId: number | string): Promise<unknown> {
    return this.request({
      path: "/offers/gifts/claim",
      method: "POST",
      body: { bundleId },
      schema: ClaimResponseSchema,
    });
  }

  redeemCode(code: string): Promise<RedeemLike> {
    return this.request({
      path: "/redeem/claim",
      method: "POST",
      body: { promo_code: code },
      schema: RedeemResponseSchema,
    });
  }
}

function wrapNetworkError(err: unknown, method: HttpMethod, path: string): TransientError {
  const detail = err instanceof Error ? err.message : String(err);
  return new TransientError(
    redactString(`Network failure on ${method} ${path}: ${detail}`),
  );
}

async function parseAndValidate<T>(
  res: Response,
  schema: ZodType<T>,
  method: HttpMethod,
  path: string,
): Promise<T> {
  const status = res.status;

  if (status === 401 || status === 403) {
    throw new TokenExpiredError(
      redactString(`Authentication rejected (${status}) on ${method} ${path}`),
      status,
    );
  }

  if (status >= 500 && status <= 599) {
    throw new TransientError(
      redactString(`Server error ${status} on ${method} ${path}`),
      status,
    );
  }

  if (status >= 400 && status <= 499) {
    const body = await safeReadText(res);
    throw new ApiError(
      redactString(`HTTP ${status} on ${method} ${path}: ${truncate(body, 500)}`),
      status,
      { retryAfterMs: status === 429 ? parseRetryAfterMs(res.headers.get("retry-after")) : undefined },
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!/json/i.test(contentType)) {
    const body = await safeReadText(res);
    throw new SchemaMismatchError(
      redactString(
        `Expected JSON from ${method} ${path} (status ${status}, content-type "${contentType}"): ${truncate(body, 200)}`,
      ),
      status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SchemaMismatchError(
      redactString(`Failed to parse JSON from ${method} ${path}: ${detail}`),
      status,
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new SchemaMismatchError(
      redactString(`Response from ${method} ${path} failed schema validation: ${parsed.error.message}`),
      status,
    );
  }
  return parsed.data;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.max(0, Math.ceil(asSeconds * 1000));
  }

  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return undefined;
}
