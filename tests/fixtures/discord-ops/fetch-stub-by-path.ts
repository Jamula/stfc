// Test fixture: replace global fetch with a stub that returns different
// responses per Discord endpoint path.

const usersStatus = Number(process.env["STUB_USERS_STATUS"] ?? "200");
const usersBody = process.env["STUB_USERS_BODY"] ?? "{}";
const appsStatus = Number(process.env["STUB_APPS_STATUS"] ?? "200");
const appsBody = process.env["STUB_APPS_BODY"] ?? "{}";
const defaultStatus = Number(process.env["STUB_DEFAULT_STATUS"] ?? "500");
const defaultBody = process.env["STUB_DEFAULT_BODY"] ?? "{}";
const ct = process.env["STUB_CT"] ?? "application/json";

function pickResponse(url: string): { status: number; body: string } {
  if (url.includes("/users/@me")) return { status: usersStatus, body: usersBody };
  if (url.includes("/applications/@me")) return { status: appsStatus, body: appsBody };
  return { status: defaultStatus, body: defaultBody };
}

function serializeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const headerObj: Record<string, string> = {};
  if (!headers) return headerObj;
  if (headers instanceof Headers) {
    for (const [k, v] of headers.entries()) headerObj[k] = v;
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) headerObj[k] = v;
  } else if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) headerObj[k] = v;
    }
  }
  for (const k of Object.keys(headerObj)) {
    if (/^authorization$/i.test(k)) headerObj[k] = "[REDACTED]";
  }
  return headerObj;
}

globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init.method || "GET";
  const headerObj = serializeHeaders(init.headers);
  process.stderr.write(
    `STUB_FETCH ${JSON.stringify({ url, method, headers: headerObj })}\n`,
  );
  const { status, body } = pickResponse(url);
  return new Response(body, { status, headers: { "content-type": ct } });
};
