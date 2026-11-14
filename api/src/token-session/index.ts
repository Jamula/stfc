import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { requireOwner } from "../_lib/auth.js";
import { errorResponse } from "../_lib/respond.js";

const ACTIONS = ["accounts", "start", "verify", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: string | undefined): value is Action {
  return ACTIONS.some((action) => action === value);
}

function response(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    },
    jsonBody: body,
  };
}

async function requestBody(req: HttpRequest, action: Action): Promise<Record<string, unknown> | null> {
  if (action === "accounts") return null;
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (action === "start") return { accountName: body.accountName, email: body.email };
  if (action === "verify") return { id: body.id, otp: body.otp };
  return { id: body.id };
}

function safeResponse(action: Action, value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (action === "accounts" && Array.isArray(body.accounts) &&
      body.accounts.every((name) => typeof name === "string")) {
    return { accounts: body.accounts };
  }
  if (action === "start" && typeof body.id === "string" && typeof body.screenshot === "string") {
    return { id: body.id, screenshot: body.screenshot };
  }
  if (action === "verify" && typeof body.accountName === "string" &&
      typeof body.added === "boolean" && typeof body.updatedAt === "string") {
    return { accountName: body.accountName, added: body.added, updatedAt: body.updatedAt };
  }
  if (action === "cancel" && body.cancelled === true) return { cancelled: true };
  if (typeof body.error === "string" && body.error.length <= 120) {
    return { error: body.error };
  }
  return null;
}

export async function handler(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireOwner(req);
    const action = req.params["action"];
    if (!isAction(action)) return response(404, { error: "Unknown token-update action." });
    const method = action === "accounts" ? "GET" : "POST";
    if (req.method !== method) return response(405, { error: "Method not allowed." });

    const backendUrl = process.env["STFC_PWA_BACKEND_URL"] ?? "";
    const backendKey = process.env["STFC_PWA_BACKEND_KEY"] ?? "";
    let url: URL;
    try {
      url = new URL(backendUrl);
    } catch {
      return response(503, { error: "Token update service is not configured." });
    }
    if (url.protocol !== "https:" || backendKey.length < 32) {
      return response(503, { error: "Token update service is not configured." });
    }

    const body = await requestBody(req, action);
    if (action !== "accounts" && body === null) {
      return response(400, { error: "Invalid request." });
    }
    url.pathname = action === "accounts" ? "/accounts" : `/sessions/${action}`;
    url.search = "";
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${backendKey}`,
          ...(body === null ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return response(502, { error: "Token update service is unavailable." });
    }

    let value: unknown;
    try {
      value = await upstream.json();
    } catch {
      return response(502, { error: "Token update service returned an invalid response." });
    }
    const safeBody = safeResponse(action, value);
    if (!safeBody) return response(502, { error: "Token update service returned an invalid response." });
    return response(upstream.status, safeBody);
  } catch (error) {
    context.error("Token update request failed", error instanceof Error ? error.name : "UnknownError");
    return errorResponse(error);
  }
}

app.http("token-session", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "token-session/{action}",
  handler,
});
