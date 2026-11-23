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
//   - 401/403 on a SAFE method (GET/OPTIONS) is retried once, then
//     TokenExpiredError only if the retry also 401/403s. See issue #243: a
//     single transient 401 must not be trusted as a dead token without that
//     corroboration.
//   - 401/403 on a side-effecting method (POST/PUT/DELETE) is NEVER replayed —
//     an auth response is not proof the server applied nothing first (#204) —
//     and surfaces as TransientError, i.e. visible and degrading, but not a
//     token-expiry verdict drawn from one uncorroborated response.
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

  function unreadableBodyResponse(error = new DOMException("The operation timed out", "TimeoutError")): Response {
    const response = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "text", { value: async () => { throw error; } });
    return response;
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

  it("GET 500 then 401 then 401 → TokenExpiredError on the final attempt", async () => {
    const { calls } = mockStatusSequence(500, 401, 401);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof TokenExpiredError,
    );
    assert.equal(calls.length, 3, "the third attempt is the corroborating one");
  });

  it("GET 401 then 500 then 500 → TransientError, not a token verdict", async () => {
    const { calls } = mockStatusSequence(401, 500, 500);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof TransientError && !(err instanceof TokenExpiredError),
    );
    assert.equal(calls.length, 3);
  });

  it("OPTIONS is treated as safe and recovers from a single 401", async () => {
    const { calls } = mockStatusSequence(401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    const result = await client.request({ path: "/x", method: "OPTIONS", schema: OkSchema });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      calls.length,
      2,
      "a single OPTIONS 401 must be corroborated before surfacing TokenExpiredError",
    );
  });

  it("OPTIONS 401 then 401 → TokenExpiredError after corroboration", async () => {
    const { calls } = mockStatusSequence(401, 401);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "OPTIONS", schema: OkSchema }),
      (err: unknown) => err instanceof TokenExpiredError,
    );
    assert.equal(calls.length, 2, "two auth rejections should terminate the shared sequence");
  });

  it("POST 401 is NOT replayed — surfaces TransientError after exactly one call", async () => {
    const { calls } = mockStatusSequence(401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () =>
        client.request({
          path: "/x",
          method: "POST",
          body: { y: 1 },
          schema: OkSchema,
        }),
      (err: unknown) => err instanceof TransientError && !(err instanceof TokenExpiredError),
    );
    assert.equal(
      calls.length,
      1,
      "a side-effecting request must never be re-sent to corroborate an auth rejection (#204)",
    );
  });

  it("POST 403 is NOT replayed", async () => {
    const { calls } = mockStatusSequence(403, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () =>
        client.request({
          path: "/x",
          method: "POST",
          body: { y: 1 },
          schema: OkSchema,
        }),
      (err: unknown) => err instanceof TransientError && !(err instanceof TokenExpiredError),
    );
    assert.equal(calls.length, 1);
  });

  it("PUT and DELETE 401 are NOT replayed either", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      const { calls } = mockStatusSequence(401, 200);
      const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
      await assert.rejects(
        () => client.request({ path: "/x", method, body: { y: 1 }, schema: OkSchema }),
        (err: unknown) => err instanceof TransientError && !(err instanceof TokenExpiredError),
      );
      assert.equal(calls.length, 1, `${method} must not be replayed after an auth rejection`);
    }
  });

  it("a POST auth rejection never claims TOKEN_EXPIRED, even repeatedly", async () => {
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
      (err: unknown) => err instanceof TransientError && !(err instanceof TokenExpiredError),
    );
    assert.equal(calls.length, 1, "there is no second call to corroborate with");
  });

  it("the POST auth-rejection message explains it was not corroborated", async () => {
    mockStatusSequence(401, 200);
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/x", method: "POST", body: {}, schema: OkSchema }),
      (err: unknown) => {
        assert.ok(err instanceof TransientError);
        assert.match(err.message, /not safe to replay/);
        assert.equal(err.status, 401, "the original status must survive the reclassification");
        return true;
      },
    );
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

  it("GET retries a 200 response body timeout within the safe retry budget", async () => {
    let responses = 0;
    const { calls } = mockFetch(() => {
      responses += 1;
      return responses === 1 ? unreadableBodyResponse() : jsonResponse(200, { ok: true });
    });
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    assert.deepEqual(await client.request({ path: "/x", method: "GET", schema: OkSchema }), { ok: true });
    assert.equal(calls.length, 2, "a transient body timeout after headers should receive the one safe GET retry");

    const exhausted = mockFetch(() => unreadableBodyResponse());
    const exhaustedClient = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => exhaustedClient.request({ path: "/x", method: "GET", schema: OkSchema }),
      (err: unknown) => err instanceof TransientError && /timed out/.test(err.message),
    );
    assert.equal(exhausted.calls.length, 2, "body timeouts must stop at the existing one-retry bound");
  });

  it("does not retry malformed JSON, schema errors, or a side-effecting body timeout", async () => {
    for (const response of [
      new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
      jsonResponse(200, { wrong: true }),
    ]) {
      const { calls } = mockFetch(() => response.clone());
      const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
      await assert.rejects(
        () => client.request({ path: "/x", method: "GET", schema: OkSchema }),
        (err: unknown) => err instanceof SchemaMismatchError,
      );
      assert.equal(calls.length, 1, "invalid JSON and schema responses are not transient body failures");
    }

    const { calls } = mockFetch(() => unreadableBodyResponse());
    const client = new ApiClient({ baseUrl: "https://example.com", token: "tok" });
    await assert.rejects(
      () => client.request({ path: "/claim", method: "POST", body: { id: 1 }, schema: OkSchema }),
      (err: unknown) => err instanceof TransientError && /timed out/.test(err.message),
    );
    assert.equal(calls.length, 1, "a side-effecting request must never be replayed after its body fails");
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
    await assert.rejects(
      () => client.request({
        path: "/x",
        method: "POST",
        body: { authorization: "Bearer supersecrettoken" },
        schema: OkSchema,
      }),
      (err: unknown) => {
        const msg = (err as Error).message ?? "";
        assert.doesNotMatch(msg, /Bearer/);
        assert.doesNotMatch(msg, /supersecrettoken/);
        return true;
      },
    );
  });
});
