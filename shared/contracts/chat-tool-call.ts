// AUTO-GENERATED — do not hand-edit.
// Source of truth: specs/005-web-control-panel/contracts/chat-tool-call.json
// Regenerate:      npm run build:contracts
// Schema is the source of truth.

/**
 * Canonical chat tool-call payload presented to the user for confirmation and bound by HMAC (RD P1.9) for execution in Phase 7. Phase 0 wave 3 — issue #110. The HMAC over this payload ensures the executed payload cannot be substituted for the confirmed one.
 */
export interface ChatToolCall {
  /**
   * Contract version. Consumers MUST reject unknown versions.
   */
  schema_version: '1';
  /**
   * Registered tool name to invoke (e.g. `run_redeem`, `run_discord_monitor`, `run_refresh_token`). Validated against the tool registry at execution time.
   */
  tool_name: string;
  /**
   * Canonical (sorted-keys) tool arguments object. Hashed into idempotency_key.
   */
  args: {};
  /**
   * GitHub username (allowlisted operator) who initiated the chat tool call.
   */
  actor: string;
  /**
   * Chat session identifier this confirmation belongs to.
   */
  session_id: string;
  /**
   * Per-request UUID v4 for log correlation.
   */
  request_id: string;
  /**
   * Free-form user-supplied reason captured in the confirm modal; surfaced in audit + run-result.
   */
  reason: string;
  /**
   * HMAC of actor + tool_name + canonical-args + 5-minute window. Deterministic dedup key (RD P0.3).
   */
  idempotency_key: string;
  /**
   * ISO-8601 UTC timestamp when the confirmation token was issued.
   */
  issued_at: string;
  /**
   * Seconds until the confirmation token expires. Default 60, min 5, max 300.
   */
  ttl_seconds: number;
}
