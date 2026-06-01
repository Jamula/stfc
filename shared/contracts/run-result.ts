// AUTO-GENERATED — do not hand-edit.
// Source of truth: specs/005-web-control-panel/contracts/run-result.json
// Regenerate:      npm run build:contracts
// Schema is the source of truth (Kirk review #6).

/**
 * RunResult variant for workflow = "redeem".
 */
export interface RedeemRunResult {
  /**
   * Contract version. Consumers MUST reject unknown versions (Kirk #6).
   */
  schema_version: '1';
  /**
   * Identity. Manual: HMAC-derived from actor+tool+canonical-args+window. Cron: `cron-{run_id}`.
   */
  correlation_id: string;
  /**
   * GitHub username for manual dispatch; the literal string "schedule" for cron.
   */
  triggered_by: string;
  /**
   * Free-form reason supplied with manual dispatch; null for cron.
   */
  reason: string | null;
  /**
   * ISO-8601 UTC timestamp when the workflow run started.
   */
  started_at: string;
  /**
   * ISO-8601 UTC timestamp when the workflow run finished.
   */
  finished_at: string;
  /**
   * End-to-end run duration in milliseconds.
   */
  duration_ms: number;
  /**
   * GitHub Actions conclusion at run completion.
   */
  conclusion: 'success' | 'failure' | 'cancelled';
  /**
   * Which workflow produced this artifact.
   */
  workflow: 'redeem';
  business_result: {
    claimed: number;
    redeemed: number;
    infra_errors: string[];
  };
}
/**
 * RunResult variant for workflow = "discord-monitor".
 */
export interface DiscordMonitorRunResult {
  /**
   * Contract version. Consumers MUST reject unknown versions (Kirk #6).
   */
  schema_version: '1';
  /**
   * Identity. Manual: HMAC-derived from actor+tool+canonical-args+window. Cron: `cron-{run_id}`.
   */
  correlation_id: string;
  /**
   * GitHub username for manual dispatch; the literal string "schedule" for cron.
   */
  triggered_by: string;
  /**
   * Free-form reason supplied with manual dispatch; null for cron.
   */
  reason: string | null;
  /**
   * ISO-8601 UTC timestamp when the workflow run started.
   */
  started_at: string;
  /**
   * ISO-8601 UTC timestamp when the workflow run finished.
   */
  finished_at: string;
  /**
   * End-to-end run duration in milliseconds.
   */
  duration_ms: number;
  /**
   * GitHub Actions conclusion at run completion.
   */
  conclusion: 'success' | 'failure' | 'cancelled';
  /**
   * Which workflow produced this artifact.
   */
  workflow: 'discord-monitor';
  business_result: {
    digests_added: number;
    codes_extracted: number;
    infra_errors: string[];
  };
}
/**
 * RunResult variant for workflow = "refresh-token".
 */
export interface RefreshTokenRunResult {
  /**
   * Contract version. Consumers MUST reject unknown versions (Kirk #6).
   */
  schema_version: '1';
  /**
   * Identity. Manual: HMAC-derived from actor+tool+canonical-args+window. Cron: `cron-{run_id}`.
   */
  correlation_id: string;
  /**
   * GitHub username for manual dispatch; the literal string "schedule" for cron.
   */
  triggered_by: string;
  /**
   * Free-form reason supplied with manual dispatch; null for cron.
   */
  reason: string | null;
  /**
   * ISO-8601 UTC timestamp when the workflow run started.
   */
  started_at: string;
  /**
   * ISO-8601 UTC timestamp when the workflow run finished.
   */
  finished_at: string;
  /**
   * End-to-end run duration in milliseconds.
   */
  duration_ms: number;
  /**
   * GitHub Actions conclusion at run completion.
   */
  conclusion: 'success' | 'failure' | 'cancelled';
  /**
   * Which workflow produced this artifact.
   */
  workflow: 'refresh-token';
  business_result: {
    token_refreshed_for: string[];
    infra_errors: string[];
  };
}

/**
 * Discriminated union of all RunResult variants.
 * Narrow by `workflow`: "redeem" | "discord-monitor" | "refresh-token".
 */
export type RunResult = RedeemRunResult | DiscordMonitorRunResult | RefreshTokenRunResult;
