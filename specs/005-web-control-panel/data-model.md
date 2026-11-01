# Data Model: 005-web-control-panel

**Status:** Placeholder — schema sources of truth live under
`contracts/` (issue #108).

This file enumerates the three contract schemas that drive the 005
data model. The actual JSON Schema definitions land in
`specs/005-web-control-panel/contracts/` during Phase 0 wave 3
(issue #108); this placeholder records the inventory and the
mandatory cross-cutting fields up front so spec consumers know what
to expect.

## Schemas

1. **`contracts/run-result.json`** — the state-change artifact
   committed by workflows when business state actually changed OR a
   manual dispatch occurred.
   - Identity field: `correlation_id` (manual: HMAC-derived; cron:
     `cron-{run_id}`).
   - Mandatory: `schema_version` (string, starts at `"1"`).
   - Business fields per workflow family (e.g. `claimed`, `redeemed`,
     `infra_errors[]`).

2. **`contracts/audit-event.json`** — append-only JSONL row recording
   every write action.
   - Fields: `ts, actor, action, request_id, result, latency_ms,
     workflow, run_id, correlation_id, error_code, surface`.
   - Mandatory: `schema_version` (string, starts at `"1"`).
   - REDACTION: prompts and raw errors MUST NOT appear in this
     stream.

3. **`contracts/chat-tool-call.json`** — the canonical payload
   presented to the user for confirmation and bound by HMAC for
   execution.
   - Fields: `actor, session, tool, args (canonical), reason,
     request_id, idempotency_key`.
   - Mandatory: `schema_version` (string, starts at `"1"`).
   - HMAC binding ensures the executed payload cannot be substituted
     for the confirmed one (per RD P1.9).

## Cross-cutting rules

- **`schema_version` is mandatory on all three.** Consumers MUST
  reject unknown versions. Producers MAY add OPTIONAL fields in
  `v1.x` minor revisions; breaking changes bump to `v2` with a
  coordinated consumer update PR.
- **TS types are generated, not hand-written.** A build step emits
  `shared/contracts/*.ts` from these JSON
  Schemas; a CI gate fails if generated types drift from the schemas
  (FR-015 in `spec.md`).
- **Schema validation.** Add round-trip validation tests using known-good
  fixtures (FR-007 in `spec.md`).

## v3 plan reference

`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`
§ "Phase 0 — Governance + spec + threat model + schema" and the
schema-version rule in the §"How v3 differs from v2" table.
