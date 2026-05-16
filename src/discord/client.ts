// Discord REST client foundation. Phase 2 (T011) lands only the secret
// loader; the full client (REST request layer, typed-error taxonomy,
// pagination) arrives at T024 in Phase 3.
//
// Constitution Principle V & FR-029: `DISCORD_BOT_TOKEN` is env-only.
// It is NEVER persisted, NEVER logged, NEVER embedded in a thrown error
// message. Every error path here routes through `redactForLog` from
// src/lib/redact.ts as a defence-in-depth second pass, even though
// neither the missing-env nor the empty-env path has any reason to carry
// the value.

import { redactForLog } from "../lib/redact.ts";

const ENV_VAR = "DISCORD_BOT_TOKEN";

export class DiscordTokenMissingError extends Error {
  override readonly name = "DiscordTokenMissingError";
}

/**
 * Read DISCORD_BOT_TOKEN from the process environment.
 *
 * Throws `DiscordTokenMissingError` (a typed error, per Principle III) when
 * the variable is unset or empty. The thrown message is run through
 * `redactForLog` so any caller that templates it into a log line still cannot
 * leak credentials (defence in depth — see src/api/client.ts for the same
 * pattern around STFC bearer tokens).
 */
export function loadDiscordToken(): string {
  const raw = process.env[ENV_VAR];
  if (raw === undefined || raw.length === 0) {
    throw new DiscordTokenMissingError(
      redactForLog(
        `${ENV_VAR} is not set in the environment (required for the Discord monitor; expected GitHub Actions encrypted secret or local .env).`,
      ),
    );
  }
  return raw;
}
