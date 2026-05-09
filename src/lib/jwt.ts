// Decode-only JWT parser. We do NOT verify the signature — we don't have
// the issuer's public key and don't need to: the token is only used as a
// bearer token by the API server, which performs its own validation. Local
// decoding is purely for UX (showing "expires in N days" in the summary
// and rejecting obviously-malformed values from STFC_ACCOUNTS).

export class JwtParseError extends Error {
  override readonly name = "JwtParseError";
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  exp: number | undefined;        // seconds since epoch
  iss: string | undefined;
  aud: string | string[] | undefined;
}

function base64UrlDecode(segment: string): string {
  const pad = segment.length % 4 === 0 ? 0 : 4 - (segment.length % 4);
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64").toString("utf8");
}

export function isJwtShaped(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

export function decodeJwt(token: string): DecodedJwt {
  if (!isJwtShaped(token)) {
    throw new JwtParseError("Not a JWT (expected three base64url segments separated by dots)");
  }
  const [h, p] = token.split(".") as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(h)) as Record<string, unknown>;
  } catch {
    throw new JwtParseError("JWT header is not valid JSON");
  }
  try {
    payload = JSON.parse(base64UrlDecode(p)) as Record<string, unknown>;
  } catch {
    throw new JwtParseError("JWT payload is not valid JSON");
  }

  return {
    header,
    payload,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    iss: typeof payload.iss === "string" ? payload.iss : undefined,
    aud: typeof payload.aud === "string" || Array.isArray(payload.aud)
      ? (payload.aud as string | string[])
      : undefined,
  };
}

export interface ExpiryStatus {
  exp: number | undefined;            // unix seconds
  expiresInSeconds: number | undefined;
  isExpired: boolean;
  // Human-friendly: "expires in 13 days", "EXPIRED 2 days ago", "no expiry"
  human: string;
}

export function describeExpiry(decoded: DecodedJwt, now: Date = new Date()): ExpiryStatus {
  if (decoded.exp == null) {
    return { exp: undefined, expiresInSeconds: undefined, isExpired: false, human: "no expiry" };
  }
  const nowSec = Math.floor(now.getTime() / 1000);
  const delta = decoded.exp - nowSec;
  return {
    exp: decoded.exp,
    expiresInSeconds: delta,
    isExpired: delta <= 0,
    human: humanDelta(delta),
  };
}

function humanDelta(seconds: number): string {
  const expired = seconds <= 0;
  const abs = Math.abs(seconds);
  const minutes = Math.floor(abs / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let amount: string;
  if (days >= 1) amount = `${days} day${days === 1 ? "" : "s"}`;
  else if (hours >= 1) amount = `${hours} hour${hours === 1 ? "" : "s"}`;
  else if (minutes >= 1) amount = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  else amount = `${abs} second${abs === 1 ? "" : "s"}`;

  return expired ? `EXPIRED ${amount} ago` : `expires in ${amount}`;
}
