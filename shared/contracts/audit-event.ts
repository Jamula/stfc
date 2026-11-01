// AUTO-GENERATED — do not hand-edit.
// Source of truth: specs/005-web-control-panel/contracts/audit-event.json
// Regenerate:      npm run build:contracts
// Schema is the source of truth.

/**
 * Append-only JSONL row recording every write action against the SWA/Functions surface or chat tool surface. Stored under data/audit/*.jsonl. Phase 0 wave 3 — issue #110. REDACTION RULE: prompts, raw errors, args, and payloads MUST NOT appear in this stream.
 */
export interface AuditEvent {
  /**
   * Contract version. Consumers MUST reject unknown versions.
   */
  schema_version: '1';
  /**
   * ISO-8601 UTC timestamp when the event was recorded.
   */
  ts: string;
  /**
   * GitHub username (allowlisted operator) who initiated the action.
   */
  actor: string;
  /**
   * Endpoint path (e.g. `/api/ops/redeem`) or chat tool name (e.g. `run_redeem`).
   */
  action: string;
  /**
   * Per-request UUID v4 for log correlation.
   */
  request_id: string;
  /**
   * Coarse outcome of the action.
   */
  result: 'ok' | 'denied' | 'error';
  /**
   * Server-side processing latency in milliseconds.
   */
  latency_ms: number;
  /**
   * Which surface originated the action.
   */
  surface: 'ui' | 'chat';
  /**
   * Workflow name when the action dispatched one; null otherwise. Field MUST be present even when null.
   */
  workflow: string | null;
  /**
   * GitHub Actions run id (as string) when the action dispatched a workflow; null otherwise. Field MUST be present.
   */
  run_id: string | null;
  /**
   * Cross-system correlation id (matches run-result.correlation_id when a run was started/adopted); null when not applicable. Field MUST be present.
   */
  correlation_id: string | null;
  /**
   * Short machine-readable error code (no message text) when result != ok; null otherwise. Field MUST be present.
   */
  error_code: string | null;
}
