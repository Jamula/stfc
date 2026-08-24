import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  ApiClient,
  TokenExpiredError,
  TransientError,
  SchemaMismatchError,
} from "../../src/api/client.ts";

// Test contract assumptions (documented for the api-client implementer):
//   new ApiClient({ baseUrl, token })
//   client.request({ path, method, body?, schema }) -> Promise<T>
//   - GETs are retried once on 5xx / network error; POSTs are not retried.
//   - 401/403 -> retried once regardless of method (a rejection has no
//     side effect to double up on), then TokenExpiredError only if the
//     retry also 401/403s. See issue #243: a single transient 401 must not
//     be trusted as a dead token without that corroboration.
//   - 5xx / fetch throw -> TransientError
//   - non-JSON body or schema-mismatched body on 200 -> SchemaMismatchError
//   - Authorization header value is never echoed in error messages.

describe("ApiClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(
    impl: (url: string, init: RequestInit) => Response | Promise<Response>,
  ): { calls: Array<{ url: string; init: RequestInit }> } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const i = init ?? {};
      calls.push({ url: u, init: i });
      return impl(u, i);
    }) as typeof fetch;
    return { calls };
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function mockStatusSequence(...statuses: number[]): {
    calls: Array<{ url: string; init: RequestInit }>;
  } {
    let index = 0;
    return mockFetch(() => {
      const status = statuses[Math.min(index, statuses.length - 1)]!;
      index += 1;
      return jsonResponse(status, status === 200 ? { ok: true } : { error: `HTTP ${status}` });
    });
  }

  const OkSchema = z.object({ ok: z.boolean() }).passthrough();

  it("GET sends Authorization: Bearer <token> and base URL prefix", async () => {
    const { calls } = mockFetch(() => jsonResponse(200, { ok: true }));
    const client = new ApiClient({ baseUrl: "https://example.com/api", token: "tok-123" });
    const result = await client.request({ path: "/foo", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /^https:\/\/example\.com\/api\/?foo$/);
    const headers = new Headers(calls[0]!.init.headers as HeadersInit | undefined);
    assert.equal(headers.get("authorization"), "Bearer tok-123");
  });

  it("POST sends body as JSON", async () => {
    const { calls } = mockFetch(() => jsonResponse(200, { ok: true }));
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await client.request({
      path: "/x",
      method: "POST",
      body: { hello: "world" },
      schema: OkSchema,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.body, JSON.stringify({ hello: "world" }));
    const headers = new Headers(calls[0]!.init.headers as HeadersInit | undefined);
    assert.match(headers.get("content-type") ?? "", /application\/json/);
  });

  it("GET retries once on 401 then succeeds", async () => {
    const { calls } = mockStatusSequence(401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      calls.length,
      2,
      "a single GET 401 must be corroborated before surfacing TokenExpiredError",
    );
  });

  it("GET retries once on 403 then succeeds", async () => {
    const { calls } = mockStatusSequence(403, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
  });

  it("GET 401 then 403 → TokenExpiredError after corroboration", async () => {
    const { calls } = mockStatusSequence(401, 403);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof TokenExpiredError,
    );
    assert.equal(calls.length, 2, "two auth rejections should terminate the shared sequence");
  });

  it("GET 500 then 401 then 200 succeeds within the shared attempt bound", async () => {
    const { calls } = mockStatusSequence(500, 401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 3, "one transient and one auth retry must share a three-call bound");
  });

  it("GET 401 then 500 then 200 succeeds within the shared attempt bound", async () => {
    const { calls } = mockStatusSequence(401, 500, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 3, "auth corroboration must compose with the GET transient retry");
  });

  it("POST retries once on 401 then succeeds", async () => {
    const { calls } = mockStatusSequence(401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({
      path: "/x",
      method: "POST",
      body: { y: 1 },
      schema: OkSchema,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2, "401 retry must apply to POST even though 5xx retry does not");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[1]!.init.method, "POST");
  });

  it("POST retries once on 403 then succeeds", async () => {
    const { calls } = mockStatusSequence(403, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({
      path: "/x",
      method: "POST",
      body: { y: 1 },
      schema: OkSchema,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
  });

  it("POST 401 twice → TokenExpiredError after exactly two calls", async () => {
    const { calls } = mockStatusSequence(401, 401);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () =>
        client.request({
          path: "/x",
          method: "POST",
          body: { y: 1 },
          schema: OkSchema,
        }),
      (err: unknown) => err instanceof TokenExpiredError,
    );
    assert.equal(calls.length, 2, "POST auth corroboration must remain bounded");
  });

  it("500 (POST) → TransientError, no retry", async () => {
    const { calls } = mockFetch(() => jsonResponse(500, { error: "boom" }));
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () =>
        client.request({
          path: "/x",
          method: "POST",
          body: { y: 1 },
          schema: OkSchema,
        }),
      (err: unknown) => err instanceof TransientError,
    );
    assert.equal(calls.length, 1, "POST should not be retried");
  });

  it("network error → TransientError", async () => {
    const { calls } = mockFetch(() => {
      throw new TypeError("network failure");
    });
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "POST", body: {}, schema: OkSchema }),
      (err: unknown) => err instanceof TransientError,
    );
    assert.equal(calls.length, 1, "POST network failures must not be retried");
  });

  it("non-JSON 200 response → SchemaMismatchError", async () => {
    mockFetch(
      () =>
        new Response("not json at all", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof SchemaMismatchError,
    );
  });

  it("schema mismatch (missing field) → SchemaMismatchError", async () => {
    mockFetch(() => jsonResponse(200, { wrong: 1 }));
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof SchemaMismatchError,
    );
  });

  it("GET retries once on 500 then succeeds", async () => {
    const { calls } = mockStatusSequence(500, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "GET", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2, "GET should retry exactly once on 5xx");
  });

  it("GET stops after one transient retry", async () => {
    const { calls } = mockStatusSequence(500, 500, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof TransientError,
    );
    assert.equal(calls.length, 2, "GET must retain its exact one-transient-retry bound");
  });

  it("error messages NEVER leak the Bearer token", async () => {
    mockFetch(() => jsonResponse(500, { error: "secret-leaking-body" }));
    const client = new ApiClient({
      baseUrl: "https://example.com",
      token: "supersecrettoken",
    });
    try {
      await client.request({
        path: "/x",
        method: "POST",
        body: { authorization: "Bearer supersecrettoken" },
        schema: OkSchema,
      });
      assert.fail("expected throw");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      assert.doesNotMatch(msg, /Bearer/);
      assert.doesNotMatch(msg, /supersecrettoken/);
    }
  });
});
