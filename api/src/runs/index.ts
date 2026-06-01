import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { fetchContent, listDirectory } from "../../_lib/github-raw.js";
import { requireAllowedUser } from "../_lib/auth.js";
import { errorResponse } from "../_lib/respond.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const JSON_HEADERS = { "Content-Type": "application/json" };

type Workflow = "redeem" | "discord-monitor" | "refresh-token";

interface RunResultLike {
  schema_version: "1";
  correlation_id: string;
  workflow: Workflow;
  started_at: string;
  finished_at: string;
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

function parseWorkflow(raw: string | null): Workflow | null {
  if (!raw) return null;
  if (
    raw === "redeem" ||
    raw === "discord-monitor" ||
    raw === "refresh-token"
  ) {
    return raw;
  }
  return null;
}

function parseTtlMs(): number | undefined {
  const raw = process.env["GITHUB_RAW_TTL_MS"];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function isRunResult(value: unknown): value is RunResultLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const workflow = candidate["workflow"];
  return (
    candidate["schema_version"] === "1" &&
    (workflow === "redeem" ||
      workflow === "discord-monitor" ||
      workflow === "refresh-token") &&
    typeof candidate["correlation_id"] === "string" &&
    typeof candidate["started_at"] === "string" &&
    typeof candidate["finished_at"] === "string"
  );
}

async function loadRunResults(
  limit: number,
  workflow: Workflow | null,
): Promise<RunResultLike[]> {
  const ttlMs = parseTtlMs();
  const dir = await listDirectory("data/runs", { ttlMs });
  if (!dir) return [];

  const files = dir.entries.filter(
    (entry) => entry.type === "file" && entry.name.endsWith(".json"),
  );

  const loaded = await Promise.all(
    files.map(async (entry): Promise<RunResultLike | null> => {
      const file = await fetchContent(entry.path, { ref: entry.sha, ttlMs });
      if (!file) return null;
      try {
        const parsed = JSON.parse(file.content) as unknown;
        return isRunResult(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }),
  );

  return loaded
    .filter((item): item is RunResultLike => item !== null)
    .filter((item) => (workflow ? item.workflow === workflow : true))
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
    .slice(0, limit);
}

export async function runsHandler(
  req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireAllowedUser(req);
    void user;

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const workflow = parseWorkflow(url.searchParams.get("workflow"));
    const runs = await loadRunResults(limit, workflow);

    return jsonResponse({ runs });
  } catch (err) {
    return errorResponse(err);
  }
}

app.http("data-runs", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "data/runs",
  handler: runsHandler,
});
