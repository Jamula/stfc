import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

import { auditEventsHandler } from "../../api/src/audit-events/index.ts";
import { _clearCache } from "../../api/_lib/github-raw.ts";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

const auditSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "specs",
  "005-web-control-panel",
  "contracts",
  "audit-event.json",
);

const auditSchema = JSON.parse(
  fs.readFileSync(auditSchemaPath, "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateAuditEvent = ajv.compile(auditSchema);

type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = typeof url === "string" ? url : url.toString();
    const i = init ?? {};
    calls.push({ url: u, init: i });
    return impl(u, i);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function toPrincipalHeader(userDetails: string): string {
  const principal = {
    identityProvider: "github",
    userId: `${userDetails}-id`,
    userDetails,
    userRoles: ["anonymous", "authenticated", "stfc_operator"],
    claims: [],
  };
  return Buffer.from(JSON.stringify(principal), "utf8").toString("base64");
}

function makeReq(userDetails?: string, query = "") {
  const headers = new Map<string, string>();
  if (userDetails) {
    headers.set("x-ms-client-principal", toPrincipalHeader(userDetails));
  }
  return {
    url: `https://example.test/api/data/audit-events${query}`,
    headers: {
      get(name: string): string | null {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

function contentsApiBody(content: string, sha: string) {
  return {
    content: Buffer.from(content, "utf8").toString("base64"),
    sha,
    encoding: "base64",
  };
}

let originalFetch: typeof globalThis.fetch;
let originalAllowedUsers: string | undefined;
let originalOwner: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalAllowedUsers = process.env["SQUAD_ALLOWED_USERS"];
  originalOwner = process.env["SQUAD_OWNER"];
  process.env["SQUAD_ALLOWED_USERS"] = "alloweduser,cyrusjamula";
  process.env["SQUAD_OWNER"] = "cyrusjamula";
  _clearCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowedUsers === undefined) delete process.env["SQUAD_ALLOWED_USERS"];
  else process.env["SQUAD_ALLOWED_USERS"] = originalAllowedUsers;

  if (originalOwner === undefined) delete process.env["SQUAD_OWNER"];
  else process.env["SQUAD_OWNER"] = originalOwner;
  _clearCache();
});

describe("audit-events endpoint", () => {
  it("returns 401 for anonymous requests", async () => {
    const res = await auditEventsHandler(makeReq() as never, {} as never);
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.body as string), {
      error: "No valid authentication principal",
    });
  });

  it("returns 403 for allowlisted non-owner users", async () => {
    const res = await auditEventsHandler(makeReq("alloweduser") as never, {} as never);
    assert.equal(res.status, 403);
    assert.deepEqual(JSON.parse(res.body as string), {
      error: 'User "alloweduser" is not the owner',
    });
  });

  it("returns owner-only audit events that conform to audit-event schema", async () => {
    const eventA = {
      schema_version: "1",
      ts: "2026-06-01T00:30:00Z",
      actor: "cyrusjamula",
      action: "/api/ops/redeem",
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      result: "ok",
      latency_ms: 42,
      surface: "ui",
      workflow: "redeem",
      run_id: "123",
      correlation_id: "hmac-abc123",
      error_code: null,
    };
    const eventB = {
      ...eventA,
      ts: "2026-06-01T00:00:00Z",
      request_id: "550e8400-e29b-41d4-a716-446655440001",
    };
    const jsonl = `${JSON.stringify(eventA)}\n${JSON.stringify(eventB)}\n`;

    mockFetch((url) => {
      if (url.includes("data/audit/2026-06-01.jsonl?ref=sha-audit-1")) {
        return jsonResponse(200, contentsApiBody(jsonl, "sha-audit-1"), {
          etag: '"audit-file-etag-1"',
        });
      }
      if (url.includes("/contents/data/audit")) {
        return jsonResponse(
          200,
          [
            {
              name: "2026-06-01.jsonl",
              path: "data/audit/2026-06-01.jsonl",
              sha: "sha-audit-1",
              size: 100,
              type: "file",
            },
          ],
          { etag: '"audit-dir-etag-1"' },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const res = await auditEventsHandler(
      makeReq("cyrusjamula", "?limit=2") as never,
      {} as never,
    );

    assert.equal(res.status, 200);
    const body = JSON.parse(res.body as string) as { events: unknown[] };
    assert.equal(body.events.length, 2);
    assert.equal(
      validateAuditEvent(body.events[0]),
      true,
      JSON.stringify(validateAuditEvent.errors),
    );
    assert.equal(
      validateAuditEvent(body.events[1]),
      true,
      JSON.stringify(validateAuditEvent.errors),
    );
  });

  it("returns 500 when upstream github fetch fails", async () => {
    mockFetch(() => new Response("upstream outage", { status: 503 }));
    const res = await auditEventsHandler(makeReq("cyrusjamula") as never, {} as never);
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body as string), {
      error: "Internal server error",
    });
  });
});
