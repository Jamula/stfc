import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

import { runsHandler } from "../../api/src/runs/index.ts";
import { _clearCache } from "../../api/_lib/github-raw.ts";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

const runSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "specs",
  "005-web-control-panel",
  "contracts",
  "run-result.json",
);

const runSchema = JSON.parse(
  fs.readFileSync(runSchemaPath, "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRunResult = ajv.compile(runSchema);

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
    url: `https://example.test/api/data/runs${query}`,
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
let originalRawTtlMs: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalAllowedUsers = process.env["SQUAD_ALLOWED_USERS"];
  originalRawTtlMs = process.env["GITHUB_RAW_TTL_MS"];
  process.env["SQUAD_ALLOWED_USERS"] = "alloweduser,cyrusjamula";
  delete process.env["GITHUB_RAW_TTL_MS"];
  _clearCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowedUsers === undefined) delete process.env["SQUAD_ALLOWED_USERS"];
  else process.env["SQUAD_ALLOWED_USERS"] = originalAllowedUsers;

  if (originalRawTtlMs === undefined) delete process.env["GITHUB_RAW_TTL_MS"];
  else process.env["GITHUB_RAW_TTL_MS"] = originalRawTtlMs;
  _clearCache();
});

describe("runs endpoint", () => {
  it("returns 401 for anonymous requests", async () => {
    const res = await runsHandler(makeReq() as never, {} as never);
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.body as string), {
      error: "No valid authentication principal",
    });
  });

  it("returns allowlisted run results that conform to run-result schema", async () => {
    const runResult = {
      schema_version: "1",
      correlation_id: "hmac-abc123",
      workflow: "redeem",
      triggered_by: "cyrusjamula",
      reason: "manual sweep",
      started_at: "2026-06-01T00:00:00Z",
      finished_at: "2026-06-01T00:00:08Z",
      duration_ms: 8000,
      conclusion: "success",
      business_result: { claimed: 1, redeemed: 2, infra_errors: [] },
    };

    mockFetch((url) => {
      if (url.includes("data/runs/run-1.json?ref=sha-run-1")) {
        return jsonResponse(200, contentsApiBody(JSON.stringify(runResult), "sha-run-1"), {
          etag: '"file-etag-1"',
        });
      }
      if (url.includes("/contents/data/runs")) {
        return jsonResponse(
          200,
          [
            {
              name: "run-1.json",
              path: "data/runs/run-1.json",
              sha: "sha-run-1",
              size: 100,
              type: "file",
            },
          ],
          { etag: '"dir-etag-1"' },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const res = await runsHandler(
      makeReq("alloweduser", "?workflow=redeem&limit=5") as never,
      {} as never,
    );

    assert.equal(res.status, 200);
    const body = JSON.parse(res.body as string) as { runs: unknown[] };
    assert.equal(body.runs.length, 1);
    assert.equal(validateRunResult(body.runs[0]), true, JSON.stringify(validateRunResult.errors));
  });

  it("returns 500 when upstream github fetch fails", async () => {
    mockFetch(() => new Response("upstream outage", { status: 503 }));
    const res = await runsHandler(makeReq("alloweduser") as never, {} as never);
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body as string), {
      error: "Internal server error",
    });
  });

  it("reuses cached content when github returns 304 after ETag revalidation", async () => {
    process.env["GITHUB_RAW_TTL_MS"] = "0";

    const runResult = {
      schema_version: "1",
      correlation_id: "hmac-abc123",
      workflow: "redeem",
      triggered_by: "cyrusjamula",
      reason: "manual sweep",
      started_at: "2026-06-01T00:00:00Z",
      finished_at: "2026-06-01T00:00:08Z",
      duration_ms: 8000,
      conclusion: "success",
      business_result: { claimed: 1, redeemed: 2, infra_errors: [] },
    };

    let call = 0;
    mockFetch((url, init) => {
      call += 1;
      const headers = new Headers(init.headers as HeadersInit | undefined);

      if (call === 1) {
        return jsonResponse(
          200,
          [
            {
              name: "run-1.json",
              path: "data/runs/run-1.json",
              sha: "sha-run-1",
              size: 100,
              type: "file",
            },
          ],
          { etag: '"dir-etag-1"' },
        );
      }

      if (call === 2) {
        return jsonResponse(200, contentsApiBody(JSON.stringify(runResult), "sha-run-1"), {
          etag: '"file-etag-1"',
        });
      }

      if (call === 3) {
        assert.ok(url.includes("/contents/data/runs"));
        assert.equal(headers.get("if-none-match"), '"dir-etag-1"');
        return new Response(null, { status: 304 });
      }

      if (call === 4) {
        assert.ok(url.includes("data/runs/run-1.json?ref=sha-run-1"));
        assert.equal(headers.get("if-none-match"), '"file-etag-1"');
        return new Response(null, { status: 304 });
      }

      throw new Error(`Unexpected fetch call ${call}`);
    });

    const first = await runsHandler(makeReq("alloweduser") as never, {} as never);
    const second = await runsHandler(makeReq("alloweduser") as never, {} as never);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(
      JSON.parse(second.body as string),
      JSON.parse(first.body as string),
    );
    assert.equal(call, 4);
  });
});
