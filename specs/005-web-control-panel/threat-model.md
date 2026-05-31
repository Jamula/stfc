# Threat Model: 005-web-control-panel

**Owner:** Garak
**Tracking issue:** #107
**Status:** Placeholder — awaiting Garak's STRIDE-lite analysis.

## Scope (per v3 plan)

Garak's analysis MUST cover at least these threat classes for the
005 surface:

- **Prompt injection** — adversarial instructions in digests,
  knowledge corpus, and conversation history attempting to bypass
  confirmation gates or extract secrets.
- **CSRF** — cross-site request forgery against `/api/ops/*` and
  `/api/chat` write tools.
- **Replay** — confirmation-token replay (within session, across
  sessions, across users); idempotency-key replay; cooldown bypass
  via concurrent calls.
- **Allowlist bypass** — SWA custom-role misassignment, role drift
  vs Function env-var allowlist, SWA invitation lapses.
- **GitHub App key compromise** — private-key exfiltration from
  Function app settings; scope-creep abuse if the key is
  compromised; revocation runbook.
- **Models token leakage** — GH Models PAT / Gemini API key exposure
  via logs, audit entries, or assistant output.
- **Confirmation-token forgery** — HMAC implementation flaws,
  signing-key exposure, payload-binding mismatches.

## Deliverable

A populated `threat-model.md` replacing this placeholder, structured
per the STRIDE-lite headings Garak uses (Spoofing, Tampering,
Repudiation, Information Disclosure, Denial of Service, Elevation of
Privilege — abbreviated to the threats above). Each threat MUST
identify: (1) the asset at risk, (2) the mitigation enforced by the
v3 plan / spec, (3) the test that proves the mitigation, and (4) the
residual risk if any.

## v3 plan reference

`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`
§ "Phase 0 — Governance + spec + threat model + schema".
