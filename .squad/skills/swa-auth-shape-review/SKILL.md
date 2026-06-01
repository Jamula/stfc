---
name: "swa-auth-shape-review"
description: "Review auth-shape before Wave-N fanout on Azure SWA + linked Functions projects"
domain: "code-review"
confidence: "high"
source: "extracted"
extracted_from: "Kirk PR #124 review, 2026-06-01"
---

## Context

Before dispatching a Wave of route-handler agents on an Azure Static Web Apps (SWA) + linked Azure Functions project, the Lead must approve the auth helper shape. A post-fanout shape change causes rebase pain across all parallel worktrees.

## When to apply

- Any PR that introduces `api/src/_lib/auth.ts` (or equivalent) for the first time
- Any PR that modifies the public auth API before a fanout of N ≥ 2 route-handler agents

## Review checklist

### 1. Header parsing

- [ ] Reads `x-ms-client-principal` via `headers.get()` (case-insensitive)
- [ ] Decodes base64 → JSON; wraps in try/catch returning null on failure
- [ ] Validates shape (identityProvider, userId, userDetails strings; userRoles string[])
- [ ] Returns `Principal | null` — never throws from parsePrincipal

### 2. Auth assertions

- [ ] Primary allowlist gate (`requireAllowedUser`) throws 401 for no principal, 403 for not-in-list
- [ ] Owner gate (`requireOwner`) stacks on allowlist gate; accepts pre-validated principal to avoid re-parse
- [ ] Role gate (`requireRole`) is supplemental only — does NOT replace username allowlist check
- [ ] All env-var guards fail-closed: empty `SQUAD_ALLOWED_USERS` → blocks everyone; empty `SQUAD_OWNER` → ForbiddenError

### 3. Error types

- [ ] `UnauthorizedError.status = 401 as const`
- [ ] `ForbiddenError.status = 403 as const`
- [ ] `respond.ts` (or equivalent) converts auth errors to typed HTTP responses; non-auth errors → opaque 500

### 4. CI grep gate

- [ ] Handler detection is by framework import (e.g. `@azure/functions`), not file name
- [ ] `_lib`, `dist`, `node_modules` excluded from walk
- [ ] Gate requires both IMPORT and CALL (not just import)
- [ ] Opt-out mechanism is explicit and documented (`@auth-anonymous-justification`)
- [ ] Gate checks presence, not position — document that first-statement placement is manual discipline

### 5. Tests

- [ ] `parsePrincipal`: absent header, bad base64, non-object JSON, missing fields, wrong array types
- [ ] `requireAllowedUser`: allowlisted pass, missing header → 401, not-in-list → 403, empty env var → 403
- [ ] `requireOwner`: owner pass, non-owner allowlisted → 403, pre-validated principal shortcut
- [ ] `requireRole`: role present, no header → 401, role absent → 403

## Canonical Wave-N handler pattern

```ts
// import from @azure/functions — required for grep-gate detection
import { requireAllowedUser } from "../_lib/auth.ts";
import { errorResponse } from "../_lib/respond.ts";

export async function handler(req: HttpRequest): Promise<HttpResponseInit> {
  try {
    const p = requireAllowedUser(req);   // ← MUST be first statement
    // handler logic using p.userDetails
  } catch (e) {
    return errorResponse(e);
  }
}
```

## Wave-N fanout callouts to document in review comment

1. **`requireRole` is NOT a standalone auth gate** — use `requireAllowedUser` first.
2. **CI gate checks presence, not position** — first-statement placement is manual.
3. **Pre-validated principal overload** — if the handler needs both allowlist + owner checks, call `requireAllowedUser` once and pass the result to `requireOwner(req, principal)`.

## Verdict template

```
**APPROVE** ✅ — Kirk (code review)

## Auth shape (Wave N gating concern)
- {what's solid: parsing, throw-based API, error mapping}
- {caveats: requireRole isolation, gate position limitation}

## Overall
- {CI status table with deploy-expected-failure explanation if Azure not provisioned}
- {Rule 6/15/16 compliance}

Ship it. Wave N (#NNN) is GREEN-LIT against this shape.
```
