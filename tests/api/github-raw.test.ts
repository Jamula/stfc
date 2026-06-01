/**
 * tests/api/github-raw.test.ts
 *
 * Unit tests for api/_lib/github-raw.ts.
 * All GitHub HTTP calls are intercepted via globalThis.fetch mock.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchContent,
  listDirectory,
  streamRawContent,
  _clearCache,
} from "../../api/_lib/github-raw.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;

interface MockHandle {
  calls: Array<{ url: string; init: RequestInit }>;
}

function mockFetch(impl: FetchImpl): MockHandle {
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

/** Encode a string to base64 as the Contents API does (with newline wrapping). */
function toBase64Content(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function contentsApiBody(
  content: string,
  sha = "abc123",
): { content: string; sha: string; encoding: string } {
  return { content: toBase64Content(content), sha, encoding: "base64" };
}

const ETAG_1 = '"etag-v1"';
const ETAG_2 = '"etag-v2"';

// ── Setup / teardown ──────────────────────────────────────────────────────────

let origFetch: typeof globalThis.fetch;

beforeEach(() => {
  origFetch = globalThis.fetch;
  _clearCache();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

// ── fetchContent ──────────────────────────────────────────────────────────────

describe("fetchContent", () => {
  it("200 — decodes base64 content and returns sha + etag + cached:false", async () => {
    mockFetch(() =>
      jsonResponse(200, contentsApiBody("hello world", "sha1"), {
        etag: ETAG_1,
        "x-ratelimit-remaining": "59",
      }),
    );

    const result = await fetchContent("data/test.txt");
    assert.ok(result !== null);
    assert.equal(result.content, "hello world");
    assert.equal(result.sha, "sha1");
    assert.equal(result.etag, ETAG_1);
    assert.equal(result.cached, false);
    assert.equal(result.rateLimitRemaining, 59);
  });

  it("second call within TTL — returns cached value without network call", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(200, contentsApiBody("hello world"), {
        etag: ETAG_1,
        "x-ratelimit-remaining": "59",
      }),
    );

    await fetchContent("data/test.txt", { ttlMs: 60_000 });
    const second = await fetchContent("data/test.txt", { ttlMs: 60_000 });

    assert.equal(calls.length, 1, "should not make a second HTTP call within TTL");
    assert.ok(second !== null);
    assert.equal(second.cached, true);
    assert.equal(second.rateLimitRemaining, null, "no network call means no header");
    assert.equal(second.content, "hello world");
  });

  it("second call after TTL expiry — sends If-None-Match, 304 returns cached body with cached:true", async () => {
    const { calls } = mockFetch((_, init) => {
      const ifNoneMatch = new Headers(
        (init as RequestInit).headers as HeadersInit | undefined,
      ).get("if-none-match");
      if (ifNoneMatch === ETAG_1) {
        return new Response(null, {
          status: 304,
          headers: { "x-ratelimit-remaining": "55" },
        });
      }
      return jsonResponse(200, contentsApiBody("hello world"), {
        etag: ETAG_1,
        "x-ratelimit-remaining": "59",
      });
    });

    // First fetch: TTL of 0 so next call is always expired.
    const first = await fetchContent("data/test.txt", { ttlMs: 0 });
    assert.ok(first !== null);
    assert.equal(first.cached, false);

    // Second fetch: TTL 0 → expired immediately → sends If-None-Match → 304
    const second = await fetchContent("data/test.txt", { ttlMs: 0 });
    assert.equal(calls.length, 2);

    const secondHeaders = new Headers(calls[1]!.init.headers as HeadersInit | undefined);
    assert.equal(secondHeaders.get("if-none-match"), ETAG_1, "should send ETag on second call");

    assert.ok(second !== null);
    assert.equal(second.cached, true);
    assert.equal(second.content, "hello world");
    assert.equal(second.rateLimitRemaining, 55);
  });

  it("404 — returns null without throwing", async () => {
    mockFetch(() => new Response(null, { status: 404 }));

    const result = await fetchContent("does/not/exist.txt");
    assert.equal(result, null);
  });

  it("500 — throws an error", async () => {
    mockFetch(() => new Response("Server Error", { status: 500 }));

    await assert.rejects(
      () => fetchContent("data/test.txt"),
      /GitHub Contents API 500/,
    );
  });

  it("rate-limit-remaining is propagated from response headers", async () => {
    mockFetch(() =>
      jsonResponse(200, contentsApiBody("x"), {
        etag: ETAG_1,
        "x-ratelimit-remaining": "3",
      }),
    );

    const result = await fetchContent("data/x.txt");
    assert.ok(result !== null);
    assert.equal(result.rateLimitRemaining, 3);
  });

  it("rate-limit-remaining is null when header absent", async () => {
    mockFetch(() => jsonResponse(200, contentsApiBody("x"), { etag: ETAG_1 }));

    const result = await fetchContent("data/x.txt");
    assert.ok(result !== null);
    assert.equal(result.rateLimitRemaining, null);
  });

  it("includes User-Agent stfc-control-panel/0.1.0 in request", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(200, contentsApiBody("x"), { etag: ETAG_1 }),
    );

    await fetchContent("data/x.txt");
    const h = new Headers(calls[0]!.init.headers as HeadersInit | undefined);
    assert.equal(h.get("user-agent"), "stfc-control-panel/0.1.0");
  });

  it("200 with updated content on cache miss — fetches new body", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      const body = callCount === 1 ? "v1" : "v2";
      const etag = callCount === 1 ? ETAG_1 : ETAG_2;
      return jsonResponse(200, contentsApiBody(body), { etag });
    });

    const r1 = await fetchContent("data/x.txt", { ttlMs: 0 });
    const r2 = await fetchContent("data/x.txt", { ttlMs: 0 });

    assert.ok(r1 !== null && r2 !== null);
    assert.equal(r1.content, "v1");
    assert.equal(r2.content, "v2");
  });
});

// ── listDirectory ─────────────────────────────────────────────────────────────

describe("listDirectory", () => {
  const dirEntries = [
    { name: "foo.json", path: "data/foo.json", sha: "s1", size: 100, type: "file" },
    { name: "bar/", path: "data/bar", sha: "s2", size: 0, type: "dir" },
  ];

  it("200 — parses array response and returns entries", async () => {
    mockFetch(() =>
      jsonResponse(200, dirEntries, {
        etag: ETAG_1,
        "x-ratelimit-remaining": "42",
      }),
    );

    const result = await listDirectory("data");
    assert.ok(result !== null);
    assert.equal(result.cached, false);
    assert.equal(result.rateLimitRemaining, 42);
    assert.deepEqual(result.entries, dirEntries);
  });

  it("second call within TTL — cached, no second HTTP call", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(200, dirEntries, { etag: ETAG_1 }),
    );

    await listDirectory("data", { ttlMs: 60_000 });
    const second = await listDirectory("data", { ttlMs: 60_000 });

    assert.equal(calls.length, 1);
    assert.ok(second !== null);
    assert.equal(second.cached, true);
    assert.deepEqual(second.entries, dirEntries);
  });

  it("304 on revalidation — returns cached entries", async () => {
    const { calls } = mockFetch((_, init) => {
      const ifNoneMatch = new Headers(
        (init as RequestInit).headers as HeadersInit | undefined,
      ).get("if-none-match");
      if (ifNoneMatch === ETAG_1) {
        return new Response(null, { status: 304, headers: { "x-ratelimit-remaining": "40" } });
      }
      return jsonResponse(200, dirEntries, { etag: ETAG_1 });
    });

    await listDirectory("data", { ttlMs: 0 });
    const second = await listDirectory("data", { ttlMs: 0 });

    assert.equal(calls.length, 2);
    assert.ok(second !== null);
    assert.equal(second.cached, true);
    assert.equal(second.rateLimitRemaining, 40);
    assert.deepEqual(second.entries, dirEntries);
  });

  it("404 — returns null", async () => {
    mockFetch(() => new Response(null, { status: 404 }));

    const result = await listDirectory("nonexistent");
    assert.equal(result, null);
  });

  it("entries contain expected fields: name, path, sha, size, type", async () => {
    mockFetch(() => jsonResponse(200, dirEntries, { etag: ETAG_1 }));

    const result = await listDirectory("data");
    assert.ok(result !== null);
    for (const entry of result.entries) {
      assert.ok("name" in entry);
      assert.ok("path" in entry);
      assert.ok("sha" in entry);
      assert.ok("size" in entry);
      assert.ok("type" in entry);
    }
  });
});

// ── streamRawContent ──────────────────────────────────────────────────────────

describe("streamRawContent", () => {
  it("returns a ReadableStream and the raw.githubusercontent.com URL with SHA", async () => {
    const sha = "deadbeefcafe";
    const { calls } = mockFetch(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode("file content here"));
          ctrl.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const result = await streamRawContent("data/digests/digest.json", { ref: sha });

    assert.ok(result.url.startsWith("https://raw.githubusercontent.com/Jamula/stfc/"));
    assert.ok(
      result.url.includes(sha),
      `URL should contain SHA ${sha}, got: ${result.url}`,
    );
    assert.ok(result.url.endsWith("/data/digests/digest.json"));
    assert.ok(result.body instanceof ReadableStream);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, result.url);
  });

  it("404 — throws an error describing the path", async () => {
    mockFetch(() => new Response(null, { status: 404 }));

    await assert.rejects(
      () => streamRawContent("data/missing.txt", { ref: "main" }),
      /File not found/,
    );
  });

  it("non-404 error — throws with status code", async () => {
    mockFetch(() => new Response("Server Error", { status: 503 }));

    await assert.rejects(
      () => streamRawContent("data/x.txt", { ref: "main" }),
      /503/,
    );
  });

  it("defaults ref to 'main' when not specified", async () => {
    const { calls } = mockFetch(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode("x"));
          ctrl.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    await streamRawContent("README.md");
    assert.ok(calls[0]!.url.includes("/main/"), `Expected /main/ in ${calls[0]!.url}`);
  });

  it("includes User-Agent in request headers", async () => {
    const { calls } = mockFetch(() => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode("x"));
          ctrl.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    await streamRawContent("data/x.txt", { ref: "abc" });
    const h = new Headers(calls[0]!.init.headers as HeadersInit | undefined);
    assert.equal(h.get("user-agent"), "stfc-control-panel/0.1.0");
  });
});

// ── Cache TTL eviction ────────────────────────────────────────────────────────

describe("Cache TTL eviction", () => {
  it("entry with ttlMs=0 is never served from hot cache (always expired)", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse(200, contentsApiBody("v" + String(callCount)), {
        etag: `"etag-${String(callCount)}"`,
      });
    });

    // With ttlMs=0 every call is past TTL, so each call hits the network.
    // (If-None-Match is sent on the second call; the mock here returns 200 to
    //  simulate a content change.)
    await fetchContent("data/x.txt", { ttlMs: 0 });
    await fetchContent("data/x.txt", { ttlMs: 0 });

    assert.equal(callCount, 2, "ttlMs=0 should bypass the hot-cache on every call");
  });

  it("entry with large ttlMs is served from hot cache on second call", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      return jsonResponse(200, contentsApiBody("v"), { etag: ETAG_1 });
    });

    await fetchContent("data/x.txt", { ttlMs: 60_000 });
    const r2 = await fetchContent("data/x.txt", { ttlMs: 60_000 });

    assert.equal(callCount, 1, "second call within TTL must not hit network");
    assert.ok(r2 !== null);
    assert.equal(r2.cached, true);
  });

  // NOTE: A time-travel test (Date.now mock) verifying that an entry populated
  // with ttlMs=X is evicted after X ms would require fake timer support.
  // Node.js >=22 provides mock.timers in node:test; the test is deferred until
  // the minimum runtime is confirmed to be >=22 in .nvmrc or engines.
});
