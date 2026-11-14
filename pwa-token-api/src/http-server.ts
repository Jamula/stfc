import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  TokenAccountStoreError,
  type TokenAccountStore,
  type TokenUpdateReceipt,
} from "../../shared/token-accounts.js";

const BODY_LIMIT = 8 * 1024;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};
const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

interface ApiDependencies {
  apiKey: string;
  browserUrl: string;
  browserKey: string;
  store: Pick<TokenAccountStore, "listNames" | "replace">;
  fetcher?: typeof fetch;
  validateToken?: (token: string) => Promise<boolean>;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function authorized(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > BODY_LIMIT) throw new ApiError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError("Invalid request body.", 400);
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, RESPONSE_HEADERS);
  res.end(JSON.stringify(body));
}

function safeBrowserError(status: number): number {
  return [400, 404, 409, 410, 422, 429].includes(status) ? status : 502;
}

export function createTokenApiServer(deps: ApiDependencies) {
  const fetcher = deps.fetcher ?? fetch;
  const browserUrl = new URL(deps.browserUrl);
  if (browserUrl.protocol !== "https:") throw new Error("Browser relay URL must use HTTPS.");

  async function browserRequest(
    path: string,
    body: object,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, browserUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.browserKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
          : AbortSignal.timeout(45_000),
      });
    } catch {
      throw new ApiError("The browser service is unavailable.", 502);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError("The browser service returned an invalid response.", 502);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ApiError("The browser service returned an invalid response.", 502);
    }
    const bodyValue = value as Record<string, unknown>;
    if (!response.ok) {
      const status = safeBrowserError(response.status);
      throw new ApiError(
        status === response.status && typeof bodyValue.error === "string"
          ? bodyValue.error.slice(0, 120)
          : "The browser service could not complete the request.",
        status,
      );
    }
    return { status: response.status, body: bodyValue };
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      reply(res, 200, { status: "ok" });
      return;
    }
    if (!authorized(req.headers.authorization, deps.apiKey)) {
      reply(res, 401, { error: "Unauthorized" });
      return;
    }
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (req.method === "GET" && url.pathname === "/accounts") {
        reply(res, 200, { accounts: await deps.store.listNames() });
        return;
      }
      if (req.method !== "POST") {
        reply(res, 405, { error: "Method not allowed" });
        return;
      }
      const body = await readJson(req);
      if (url.pathname === "/sessions/start") {
        if (typeof body.accountName !== "string" || !ACCOUNT_NAME.test(body.accountName) ||
            typeof body.email !== "string" || body.email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
          throw new ApiError("Enter a valid account name and email address.", 400);
        }
        const started = await browserRequest("/sessions/start", body, controller.signal);
        if (typeof started.body.id !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(started.body.id) ||
            typeof started.body.screenshot !== "string" ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(started.body.screenshot) ||
            started.body.screenshot.length > 5_000_000) {
          throw new ApiError("The browser service returned an invalid session.", 502);
        }
        reply(res, 200, { id: started.body.id, screenshot: started.body.screenshot });
        return;
      }
      if (url.pathname === "/sessions/cancel") {
        if (typeof body.id !== "string") throw new ApiError("Invalid login session.", 400);
        await browserRequest("/sessions/cancel", { id: body.id }, controller.signal);
        reply(res, 200, { cancelled: true });
        return;
      }
      if (url.pathname === "/sessions/verify") {
        if (typeof body.id !== "string" || typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp)) {
          throw new ApiError("Enter the 6-digit verification code.", 400);
        }
        const captured = await browserRequest("/sessions/verify", body, controller.signal);
        const accountName = captured.body.accountName;
        const token = captured.body.token;
        if (typeof accountName !== "string" || !ACCOUNT_NAME.test(accountName) ||
            typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
          throw new ApiError("STFC did not return a valid login token.", 422);
        }
        const validate = deps.validateToken ?? validateStfcToken;
        if (!(await validate(token))) throw new ApiError("STFC rejected the login token.", 422);
        let receipt: TokenUpdateReceipt;
        try {
          receipt = await deps.store.replace(accountName, token);
        } catch (error) {
          if (error instanceof TokenAccountStoreError) throw new ApiError(error.message, error.status);
          throw new ApiError("The token store could not be updated.", 503);
        }
        reply(res, 200, receipt);
        return;
      }
      reply(res, 404, { error: "Not found" });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError || error instanceof TokenAccountStoreError) {
        reply(res, error.status, { error: error.message });
        return;
      }
      console.error("Token API request failed", error instanceof Error ? error.name : "UnknownError");
      reply(res, 500, { error: "Token update failed." });
    }
  });
}

export async function validateStfcToken(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(
      "https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2/offers/gifts?available=true",
      {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
