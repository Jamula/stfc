/**
 * Unit tests for api/src/_lib/auth.ts
 *
 * Covers: parsePrincipal, requireAllowedUser, requireOwner, requireRole,
 * UnauthorizedError, ForbiddenError.
 * Also covers respond.ts errorResponse.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  parsePrincipal,
  requireAllowedUser,
  requireOwner,
  requireRole,
  UnauthorizedError,
  ForbiddenError,
  type Principal,
} from "../../api/src/_lib/auth.ts";
import { errorResponse } from "../../api/src/_lib/respond.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Real-shape SWA principal fixture (from research.md Q1). */
const VALID_PRINCIPAL = {
  identityProvider: "github",
  userId: "abcd12345abcd012345abcdef0123450",
  userDetails: "cyrusjamula",
  userRoles: ["anonymous", "authenticated", "stfc_operator"],
  claims: [],
};

const ALLOWLISTED_USER = {
  ...VALID_PRINCIPAL,
  userDetails: "alloweduser",
  userId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

function makeBase64(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** Build a minimal request-like object (compatible with @azure/functions HttpRequest). */
function makeReq(headers: Record<string, string>) {
  return {
    headers: {
      get(name: string): string | null {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

function withPrincipal(payload = VALID_PRINCIPAL) {
  return makeReq({ "x-ms-client-principal": makeBase64(payload) });
}

function noHeader() {
  return makeReq({});
}

// ── parsePrincipal ────────────────────────────────────────────────────────────

describe("parsePrincipal", () => {
  it("decodes a valid base64 SWA principal header", () => {
    const req = withPrincipal();
    const p = parsePrincipal(req);
    assert.ok(p !== null, "Should return a principal");
    assert.equal(p.identityProvider, "github");
    assert.equal(p.userId, VALID_PRINCIPAL.userId);
    assert.equal(p.userDetails, "cyrusjamula");
    assert.deepEqual(p.userRoles, [
      "anonymous",
      "authenticated",
      "stfc_operator",
    ]);
  });

  it("returns null when the header is absent", () => {
    assert.equal(parsePrincipal(noHeader()), null);
  });

  it("returns null when the header is not valid base64 JSON", () => {
    const req = makeReq({ "x-ms-client-principal": "not-base64!!!" });
    assert.equal(parsePrincipal(req), null);
  });

  it("returns null when base64 decodes to non-object JSON (e.g. a string)", () => {
    const req = makeReq({
      "x-ms-client-principal": makeBase64("hello" as unknown as object),
    });
    assert.equal(parsePrincipal(req), null);
  });

  it("returns null when required fields are missing (no userDetails)", () => {
    const bad = { identityProvider: "github", userId: "aaa", userRoles: [] };
    const req = makeReq({ "x-ms-client-principal": makeBase64(bad) });
    assert.equal(parsePrincipal(req), null);
  });

  it("returns null when userRoles is not an array", () => {
    const bad = { ...VALID_PRINCIPAL, userRoles: "stfc_operator" };
    const req = makeReq({ "x-ms-client-principal": makeBase64(bad) });
    assert.equal(parsePrincipal(req), null);
  });

  it("returns null when a role in userRoles is not a string", () => {
    const bad = { ...VALID_PRINCIPAL, userRoles: [42] };
    const req = makeReq({ "x-ms-client-principal": makeBase64(bad) });
    assert.equal(parsePrincipal(req), null);
  });

  it("header lookup is case-insensitive (SWA may normalise header names)", () => {
    // The makeReq helper stores in lowercase; get() must also lower-case the key.
    const req = withPrincipal();
    // Both forms should find the header stored under the lowercase key.
    assert.ok(parsePrincipal(req) !== null);
  });
});

// ── requireAllowedUser ────────────────────────────────────────────────────────

describe("requireAllowedUser", () => {
  let originalAllowed: string | undefined;

  beforeEach(() => {
    originalAllowed = process.env["STFC_ALLOWED_USERS"];
    process.env["STFC_ALLOWED_USERS"] = "cyrusjamula,alloweduser";
  });

  afterEach(() => {
    if (originalAllowed === undefined) {
      delete process.env["STFC_ALLOWED_USERS"];
    } else {
      process.env["STFC_ALLOWED_USERS"] = originalAllowed;
    }
  });

  it("returns the principal when the user is in the allowlist", () => {
    const req = withPrincipal();
    const p = requireAllowedUser(req);
    assert.equal(p.userDetails, "cyrusjamula");
  });

  it("throws UnauthorizedError(401) when the principal header is missing", () => {
    assert.throws(
      () => requireAllowedUser(noHeader()),
      (err) => {
        assert.ok(err instanceof UnauthorizedError, "Must be UnauthorizedError");
        assert.equal((err as UnauthorizedError).status, 401);
        return true;
      },
    );
  });

  it("throws ForbiddenError(403) when user is not in the allowlist", () => {
    const req = withPrincipal({ ...VALID_PRINCIPAL, userDetails: "hacker" });
    assert.throws(
      () => requireAllowedUser(req),
      (err) => {
        assert.ok(err instanceof ForbiddenError, "Must be ForbiddenError");
        assert.equal((err as ForbiddenError).status, 403);
        return true;
      },
    );
  });

  it("throws ForbiddenError when STFC_ALLOWED_USERS is empty string", () => {
    process.env["STFC_ALLOWED_USERS"] = "";
    assert.throws(() => requireAllowedUser(withPrincipal()), ForbiddenError);
  });

  it("trims whitespace around usernames in the allowlist env var", () => {
    process.env["STFC_ALLOWED_USERS"] = " cyrusjamula , alloweduser ";
    const p = requireAllowedUser(withPrincipal());
    assert.equal(p.userDetails, "cyrusjamula");
  });
});

// ── requireOwner ──────────────────────────────────────────────────────────────

describe("requireOwner", () => {
  let originalAllowed: string | undefined;
  let originalOwner: string | undefined;

  beforeEach(() => {
    originalAllowed = process.env["STFC_ALLOWED_USERS"];
    originalOwner = process.env["STFC_OWNER"];
    process.env["STFC_ALLOWED_USERS"] = "cyrusjamula,alloweduser";
    process.env["STFC_OWNER"] = "cyrusjamula";
  });

  afterEach(() => {
    if (originalAllowed === undefined) delete process.env["STFC_ALLOWED_USERS"];
    else process.env["STFC_ALLOWED_USERS"] = originalAllowed;

    if (originalOwner === undefined) delete process.env["STFC_OWNER"];
    else process.env["STFC_OWNER"] = originalOwner;
  });

  it("returns the principal when the user is the owner", () => {
    const p = requireOwner(withPrincipal());
    assert.equal(p.userDetails, "cyrusjamula");
  });

  it("throws ForbiddenError(403) for an allowlisted non-owner user", () => {
    const req = withPrincipal(ALLOWLISTED_USER);
    assert.throws(
      () => requireOwner(req),
      (err) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal((err as ForbiddenError).status, 403);
        return true;
      },
    );
  });

  it("accepts a pre-validated principal (skips re-parsing) when allowlisted", () => {
    const principal = parsePrincipal(withPrincipal())!;
    const p = requireOwner(noHeader(), principal);
    assert.equal(p.userDetails, "cyrusjamula");
  });

  it("throws UnauthorizedError when no principal and none supplied", () => {
    assert.throws(() => requireOwner(noHeader()), UnauthorizedError);
  });

  it("throws ForbiddenError when STFC_OWNER is not set", () => {
    delete process.env["STFC_OWNER"];
    assert.throws(() => requireOwner(withPrincipal()), ForbiddenError);
  });

  it("re-validates a supplied principal against STFC_ALLOWED_USERS (no bypass)", () => {
    // P1#15: prior behaviour let callers bypass the allowlist by supplying any
    // parsed Principal whose userDetails matched STFC_OWNER. requireOwner now
    // re-runs the allowlist check on the supplied principal — the
    // pre-validated argument is a parse-fast-path only, never a security
    // bypass.
    const fake: Principal = {
      identityProvider: "github",
      userId: "ffffffffffffffffffffffffffffffff",
      userDetails: "cyrusjamula", // == STFC_OWNER, but...
      userRoles: ["authenticated"],
    };
    process.env["STFC_ALLOWED_USERS"] = "alloweduser"; // ...NOT on the allowlist.
    assert.throws(
      () => requireOwner(noHeader(), fake),
      (err) => {
        assert.ok(
          err instanceof ForbiddenError,
          "Must be ForbiddenError (not in allowlist)",
        );
        assert.equal((err as ForbiddenError).status, 403);
        assert.match(
          (err as ForbiddenError).message,
          /not in the allowed list/,
          "Diagnostic must identify the allowlist as the rejecting gate",
        );
        return true;
      },
    );
  });

  it("rejects a supplied principal when STFC_ALLOWED_USERS is empty", () => {
    // Defence-in-depth: empty allowlist must block even a pre-validated principal.
    process.env["STFC_ALLOWED_USERS"] = "";
    const principal: Principal = {
      identityProvider: "github",
      userId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      userDetails: "cyrusjamula",
      userRoles: ["authenticated"],
    };
    assert.throws(() => requireOwner(noHeader(), principal), ForbiddenError);
  });
});

// ── requireRole ───────────────────────────────────────────────────────────────

describe("requireRole", () => {
  it("returns principal when the role is present in userRoles", () => {
    const p = requireRole(withPrincipal(), "stfc_operator");
    assert.equal(p.userDetails, "cyrusjamula");
  });

  it("throws UnauthorizedError when the principal header is missing", () => {
    assert.throws(() => requireRole(noHeader(), "stfc_operator"), UnauthorizedError);
  });

  it("throws ForbiddenError when the role is absent", () => {
    assert.throws(
      () => requireRole(withPrincipal(), "stfc_admin"),
      (err) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal((err as ForbiddenError).status, 403);
        return true;
      },
    );
  });
});

// ── errorResponse (respond.ts) ────────────────────────────────────────────────

describe("errorResponse", () => {
  it("maps UnauthorizedError to HTTP 401 JSON response", () => {
    const err = new UnauthorizedError("No auth header");
    const res = errorResponse(err);
    assert.equal(res.status, 401);
    assert.deepEqual(JSON.parse(res.body), { error: "No auth header" });
    assert.equal(res.headers["Content-Type"], "application/json");
  });

  it("maps ForbiddenError to HTTP 403 JSON response", () => {
    const err = new ForbiddenError("Not in allowlist");
    const res = errorResponse(err);
    assert.equal(res.status, 403);
    assert.deepEqual(JSON.parse(res.body), { error: "Not in allowlist" });
    assert.equal(res.headers["Content-Type"], "application/json");
  });

  it("maps unknown errors to HTTP 500 without leaking details", () => {
    const res = errorResponse(new Error("database connection string: secret"));
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body), { error: "Internal server error" });
  });

  it("maps non-Error throws to HTTP 500", () => {
    const res = errorResponse("string thrown");
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body), { error: "Internal server error" });
  });
});
