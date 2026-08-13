/**
 * HTTP response helpers for Azure Functions handlers.
 *
 * Converts thrown auth errors (and generic errors) to typed HTTP responses so
 * handlers can keep their error-handling path simple:
 *
 *   try {
 *     const p = requireAllowedUser(req);
 *     // ... handler logic
 *   } catch (e) {
 *     return errorResponse(e);
 *   }
 */

import type { UnauthorizedError, ForbiddenError } from "./auth.ts";

/** Minimal Azure Functions HttpResponseInit shape (no @azure/functions dependency). */
export interface HttpResponseInit {
  status: number;
  body: string;
  headers: Record<string, string>;
}

type AuthError = UnauthorizedError | ForbiddenError;

function isAuthError(err: unknown): err is AuthError {
  return (
    err instanceof Error &&
    "status" in err &&
    (err.status === 401 || err.status === 403)
  );
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Convert a thrown error to an Azure Functions HTTP response.
 *
 * - Auth errors (UnauthorizedError / ForbiddenError) get their correct status
 *   code (401 / 403) with the error message in the JSON body.
 * - All other errors become 500 Internal Server Error.
 *
 * Raw error details for non-auth errors are never sent to the client
 * (threat-model I-2).
 */
export function errorResponse(err: unknown): HttpResponseInit {
  if (isAuthError(err)) {
    return {
      status: err.status,
      body: JSON.stringify({ error: err.message }),
      headers: JSON_HEADERS,
    };
  }
  return {
    status: 500,
    body: JSON.stringify({ error: "Internal server error" }),
    headers: JSON_HEADERS,
  };
}
