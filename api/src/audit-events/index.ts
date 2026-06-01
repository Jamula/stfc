import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { fetchContent, listDirectory } from "../../_lib/github-raw.js";
import { requireOwner } from "../_lib/auth.js";
import { errorResponse } from "../_lib/respond.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const JSON_HEADERS = { "Content-Type": "application/json" };

interface AuditEventLike {
  schema_version: "1";
  ts: string;
  actor: string;
  action: string;
  request_id: string;
  result: "ok" | "denied" | "error";
  latency_ms: number;
  surface: "ui" | "chat";
  workflow: string | null;
  run_id: string | null;
}

function jsonResponse(body: unknown, status = 200): HttpResponseInit {
  return {
    status,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseTtlMs(): number | undefined {
  const raw = process.env["GITHUB_RAW_TTL_MS"];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function isAuditEvent(value: unknown): value is AuditEventLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["schema_version"] === "1" &&
    typeof candidate["ts"] === "string" &&
    typeof candidate["actor"] === "string" &&
    typeof candidate["action"] === "string" &&
    typeof candidate["request_id"] === "string" &&
    (candidate["result"] === "ok" ||
      candidate["result"] === "denied" ||
      candidate["result"] === "error") &&
    typeof candidate["latency_ms"] === "number" &&
    (candidate["surface"] === "ui" || candidate["surface"] === "chat") &&
    ("workflow" in candidate && "run_id" in candidate)
  );
}

function parseJsonl(content: string): unknown[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is unknown => entry !== null);
}

async function loadAuditEvents(limit: number): Promise<AuditEventLike[]> {
  const ttlMs = parseTtlMs();
  const dir = await listDirectory("data/audit", { ttlMs });
  if (!dir) return [];

  const files = dir.entries.filter(
    (entry) =>
      entry.type === "file" &&
      (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json")),
  );

  const loaded = await Promise.all(
    files.map(async (entry): Promise<AuditEventLike[]> => {
      const file = await fetchContent(entry.path, { ref: entry.sha, ttlMs });
      if (!file) return [];

      const parsedRecords = entry.name.endsWith(".jsonl")
        ? parseJsonl(file.content)
        : (() => {
            try {
              return [JSON.parse(file.content) as unknown];
            } catch {
              return [];
            }
          })();

      return parsedRecords.filter(isAuditEvent);
    }),
  );

  return loaded
    .flat()
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

export async function auditEventsHandler(
  req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireOwner(req);
    void user;

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const events = await loadAuditEvents(limit);

    return jsonResponse({ events });
  } catch (err) {
    return errorResponse(err);
  }
}

app.http("data-audit-events", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "data/audit-events",
  handler: auditEventsHandler,
});
