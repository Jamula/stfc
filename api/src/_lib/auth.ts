/**
 * SWA principal auth helpers for Azure Functions handlers.
 *
 * SWA injects X-MS-CLIENT-PRINCIPAL as a base64-encoded JSON blob on every
 * authenticated request forwarded to a linked Azure Function (research.md Q1).
 * We decode it defensively here and validate against the SQUAD_ALLOWED_USERS
 * env-var allowlist as the Function-side defence-in-depth re-check (threat-model
 * S-1, S-2, E-1).
 *
 * Every HTTP handler MUST call requireAllowedUser() or requireOwner() as its
 * first statement — enforced by scripts/ci/check-api-auth.mjs.
 */

/** Minimal header interface — compatible with @azure/functions HttpRequest.headers. */
interface RequestLike {
  headers: { get(name: string): string | null };
}

/** Shape of the SWA-injected principal (research.md Q1). */
export interface Principal {
  identityProvider: string;
  userId: string;
  /** GitHub username (the field we use for allowlist checks). */
  userDetails: string;
  userRoles: string[];
}

// ── Error classes ─────────────────────────────────────────────────────────────

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Access forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isValidPrincipal(v: unknown): v is Principal {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p["identityProvider"] === "string" &&
    typeof p["userId"] === "string" &&
    typeof p["userDetails"] === "string" &&
    Array.isArray(p["userRoles"]) &&
    (p["userRoles"] as unknown[]).every((r) => typeof r === "string")
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Decode and validate the SWA-injected `X-MS-CLIENT-PRINCIPAL` header.
 * Returns the typed Principal on success, or null if the header is absent,
 * not valid base64, or does not match the expected shape.
 */
export function parsePrincipal(req: RequestLike): Principal | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    return isValidPrincipal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Assert the request has a valid SWA principal AND the GitHub username is in
 * the `SQUAD_ALLOWED_USERS` env-var allowlist (comma-separated GitHub logins).
 *
 * @throws UnauthorizedError(401) — principal missing or malformed
 * @throws ForbiddenError(403)    — principal valid but not in allowlist
 */
export function requireAllowedUser(req: RequestLike): Principal {
  const principal = parsePrincipal(req);
  if (!principal) {
    throw new UnauthorizedError("No valid authentication principal");
  }
  const allowlist = (process.env["SQUAD_ALLOWED_USERS"] ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (allowlist.length === 0 || !allowlist.includes(principal.userDetails)) {
    throw new ForbiddenError(
      `User "${principal.userDetails}" is not in the allowed list`,
    );
  }
  return principal;
}

/**
 * Assert the request comes from the `SQUAD_OWNER` (env var, typically `cyrusjamula`).
 * Calls `requireAllowedUser` first unless a pre-validated principal is supplied.
 *
 * Use for refresh-token and other owner-only endpoints (threat-model S-4, E-2, E-5).
 *
 * @throws UnauthorizedError(401) — no principal
 * @throws ForbiddenError(403)    — authenticated but not the owner
 */
export function requireOwner(req: RequestLike, principal?: Principal): Principal {
  const p = principal ?? requireAllowedUser(req);
  const owner = process.env["SQUAD_OWNER"] ?? "";
  if (!owner || p.userDetails !== owner) {
    throw new ForbiddenError(`User "${p.userDetails}" is not the owner`);
  }
  return p;
}

/**
 * Assert the request principal carries a specific SWA role (e.g. `stfc_operator`).
 * This is a role-level check independent of the username allowlist.
 *
 * @throws UnauthorizedError(401) — no principal
 * @throws ForbiddenError(403)    — principal valid but role absent
 */
export function requireRole(req: RequestLike, role: string): Principal {
  const principal = parsePrincipal(req);
  if (!principal) {
    throw new UnauthorizedError("No valid authentication principal");
  }
  if (!principal.userRoles.includes(role)) {
    throw new ForbiddenError(
      `User "${principal.userDetails}" does not have role "${role}"`,
    );
  }
  return principal;
}
