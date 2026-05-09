// Redaction helpers. The fetch client and orchestrator funnel any string
// destined for stdout/stderr/summary through these so a runaway log line
// can never leak a Bearer token.

const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
// Matches both HTTP-style `Authorization: Bearer <tok>` and JSON-style
// `"authorization":"Bearer <tok>"`. The optional `"?` between the field
// name and `:` lets us catch the JSON form.
const AUTH_HEADER_RE = /(authorization\s*"?\s*[:=]\s*"?)(Bearer\s+)?[^",\s}]+/gi;

export function redactString(input: string): string {
  return input.replace(AUTH_HEADER_RE, "$1[REDACTED]").replace(JWT_RE, "[REDACTED-JWT]");
}

export function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^authorization$/i.test(k) || /token/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return value;
}

// For Errors and unknowns: redact deeply, then stringify, then redact again
// (catches anything the structural pass missed).
export function redactForLog(value: unknown): string {
  let raw: string;
  if (value instanceof Error) {
    raw = `${value.name}: ${value.message}`;
  } else if (typeof value === "string") {
    raw = value;
  } else {
    try { raw = JSON.stringify(redactValue(value)); } catch { raw = String(value); }
  }
  return redactString(raw);
}

