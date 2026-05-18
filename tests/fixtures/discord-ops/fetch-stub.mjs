// Test fixture: replace global fetch with a stub controlled via env vars.
//
// Invoked via `node --import ./tests/fixtures/discord-ops/fetch-stub.mjs
// scripts/discord-ops/set-discord-app-metadata.mjs ...`.
//
// Stub config (env vars read at module init time):
//   STUB_STATUS  — HTTP status to return (default 200)
//   STUB_BODY    — response body string (default "{}")
//   STUB_CT      — content-type header (default application/json)
//
// Side effect: each call writes a JSON line to stderr prefixed with
// `STUB_FETCH ` so the test can assert on URL/method/header usage without
// the script needing to expose internals.

const status = Number(process.env["STUB_STATUS"] ?? "200");
const body = process.env["STUB_BODY"] ?? "{}";
const ct = process.env["STUB_CT"] ?? "application/json";

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init && init.method) || "GET";
  const headers = (init && init.headers) || {};
  // Serialize headers safely (Headers instance or plain object), but
  // REDACT any Authorization value so the stub itself never leaks the
  // bearer token into the test observation channel. The script under
  // test is what we're testing — the stub must not poison the assertion.
  let headerObj = {};
  if (headers instanceof Headers) {
    for (const [k, v] of headers.entries()) headerObj[k] = v;
  } else if (typeof headers === "object") {
    headerObj = { ...headers };
  }
  for (const k of Object.keys(headerObj)) {
    if (/^authorization$/i.test(k)) headerObj[k] = "[REDACTED]";
  }
  process.stderr.write(
    `STUB_FETCH ${JSON.stringify({ url, method, headers: headerObj })}\n`,
  );
  return new Response(body, {
    status,
    headers: { "content-type": ct },
  });
};
