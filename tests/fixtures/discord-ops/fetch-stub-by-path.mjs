// Test fixture: replace global fetch with a stub that returns different
// responses per Discord endpoint path. Use for partial-success tests
// where /users/@me must succeed and /applications/@me must fail (or
// any other per-endpoint sequencing).
//
// Invoked via `node --import
// ./tests/fixtures/discord-ops/fetch-stub-by-path.mjs
// scripts/discord-ops/set-discord-app-metadata.mjs ...`.
//
// Stub config (env vars read at module init time):
//   STUB_USERS_STATUS   — HTTP status for /users/@me      (default 200)
//   STUB_USERS_BODY     — response body for /users/@me    (default "{}")
//   STUB_APPS_STATUS    — HTTP status for /applications/@me (default 200)
//   STUB_APPS_BODY      — response body for /applications/@me (default "{}")
//   STUB_DEFAULT_STATUS — HTTP status for any other URL   (default 500)
//   STUB_DEFAULT_BODY   — response body for any other URL (default "{}")
//   STUB_CT             — content-type header (default application/json)
//
// Side effect: each call writes a JSON line to stderr prefixed with
// `STUB_FETCH ` so the test can assert on URL/method usage. The
// Authorization header is REDACTED before logging — the stub itself
// must not leak the bearer token into the test observation channel.

const usersStatus = Number(process.env["STUB_USERS_STATUS"] ?? "200");
const usersBody = process.env["STUB_USERS_BODY"] ?? "{}";
const appsStatus = Number(process.env["STUB_APPS_STATUS"] ?? "200");
const appsBody = process.env["STUB_APPS_BODY"] ?? "{}";
const defaultStatus = Number(process.env["STUB_DEFAULT_STATUS"] ?? "500");
const defaultBody = process.env["STUB_DEFAULT_BODY"] ?? "{}";
const ct = process.env["STUB_CT"] ?? "application/json";

function pickResponse(url) {
  if (url.includes("/users/@me")) return { status: usersStatus, body: usersBody };
  if (url.includes("/applications/@me")) return { status: appsStatus, body: appsBody };
  return { status: defaultStatus, body: defaultBody };
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = (init && init.method) || "GET";
  const headers = (init && init.headers) || {};
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
  const { status, body } = pickResponse(url);
  return new Response(body, { status, headers: { "content-type": ct } });
};
