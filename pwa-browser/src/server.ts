import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { LoginSessionManager } from "./login-sessions.js";
import { LoginSessionError } from "./login-sessions.js";

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json" };

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
    if (length > MAX_BODY_BYTES) throw new LoginSessionError("Request body is too large.", 400);
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new LoginSessionError("Invalid request body.", 400);
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, NO_STORE);
  res.end(JSON.stringify(body));
}

export function createBrowserRelayServer(service: LoginSessionManager, secret: string) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      reply(res, 200, { status: "ok" });
      return;
    }
    if (!authorized(req.headers.authorization, secret)) {
      reply(res, 401, { error: "Unauthorized" });
      return;
    }
    if (req.method !== "POST") {
      reply(res, 405, { error: "Method not allowed" });
      return;
    }

    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const body = await readJson(req);
      if (url.pathname === "/sessions/start") {
        reply(res, 200, await service.start(body.accountName, body.email, controller.signal));
      } else if (url.pathname === "/sessions/verify") {
        reply(res, 200, await service.verify(body.id, body.otp));
      } else if (url.pathname === "/sessions/cancel") {
        await service.cancel(body.id);
        reply(res, 200, { cancelled: true });
      } else {
        reply(res, 404, { error: "Not found" });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof LoginSessionError) {
        reply(res, error.status, { error: error.message });
        return;
      }
      console.error("Browser relay request failed", error instanceof Error ? error.name : "UnknownError");
      reply(res, 500, { error: "Browser relay failed." });
    }
  });
}
