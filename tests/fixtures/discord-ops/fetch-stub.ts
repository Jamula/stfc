// Test fixture: replace global fetch with a stub controlled via env vars.

const status = Number(process.env["STUB_STATUS"] ?? "200");
const body = process.env["STUB_BODY"] ?? "{}";
const ct = process.env["STUB_CT"] ?? "application/json";

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
  return new Response(body, {
    status,
    headers: { "content-type": ct },
  });
};
