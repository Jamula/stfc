---
name: "strict-input-validation"
description: "Validate untrusted input shape before crypto calls, and collapse verification-path throws into uniform auth failures"
domain: "security, edge-runtime, input-validation"
confidence: "high"
source: "observed — PR #151 reviewer-lockout revision (2026-06-02), Garak hostile finding on malformed signature handling"
tools:
  - bash
---

## Context

When signature verification sits on a public HTTP edge, malformed attacker input must never bubble up as runtime exceptions or differentiated status paths. Validate exact input shape before conversion/verification, then treat **all** verification-path throws as invalid signatures.

## Procedure

1. Add strict shape checks before any hex decoding:
   - Signature must be exact `64` bytes (`128` hex chars).
   - Public key must be exact `32` bytes (`64` hex chars).
   - Characters must match `^[0-9a-fA-F]+$`.
2. If signature shape is wrong, return the same 401 used for invalid signatures.
3. Validate operator-supplied public key config and fail fast (e.g., 500 + single clear operator log).
4. Wrap hex decode + verify call in `try/catch`; map all throws to invalid signature.
5. Keep async downstream work in `ctx.waitUntil`, and log non-OK/throw outcomes without leaking request content.

## Reference implementation sketch

```ts
if (!isStrictHex(signatureHeader, 64)) {
  return new Response("Invalid signature", { status: 401 });
}
if (!isStrictHex(env.DISCORD_PUBLIC_KEY, 32)) {
  console.error("DISCORD_PUBLIC_KEY misconfigured");
  return new Response("Server misconfiguration", { status: 500 });
}

let isValid = false;
try {
  const sig = hexToBytes(signatureHeader);
  const msg = new TextEncoder().encode(timestamp + rawBody);
  const pub = hexToBytes(env.DISCORD_PUBLIC_KEY);
  isValid = await ed.verifyAsync(sig, msg, pub);
} catch {
  isValid = false;
}
if (!isValid) {
  return new Response("Invalid signature", { status: 401 });
}
```

## Tests to require

- odd-length hex header → 401
- non-hex header (correct length) → 401
- short header → 401
- long header → 401
- parseable-but-invalid signature → 401
- malformed public key config → explicit failure path (500 or policy-chosen equivalent)
- downstream dispatch 5xx still returns deferred Discord response, with warning log

## Anti-patterns

- ❌ Calling crypto verification directly on unvalidated header bytes.
- ❌ Returning 500 for malformed attacker signatures while returning 401 for bad signatures.
- ❌ Logging raw request body/signature contents in verification failures.
