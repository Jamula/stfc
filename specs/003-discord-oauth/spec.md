# Feature Specification: Discord OAuth2 Bot Access for Private Channels

**Feature Branch**: `003-discord-oauth`  
**Created**: 2025-07-18  
**Status**: Draft  
**Input**: User description: "Enable Discord OAuth2/bot authentication so the STFC gift code monitor can access private/restricted server channels."  
**Issue**: #51

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Monitor Members-Only Channels for Gift Codes (Priority: P1)

cyrusj adds a members-only or role-gated STFC Discord channel to the allowlist. On the next scheduled monitor run the bot authenticates with the appropriate gateway scopes, reads messages from the restricted channel, extracts any gift codes, and feeds them through the existing redemption pipeline — exactly the same way it already works for public channels.

**Why this priority**: The entire value proposition of this feature is unlocking channels the monitor currently cannot see. Many active STFC communities gate their gift-code channels behind membership or role requirements. Without this, codes posted in those channels are missed entirely.

**Independent Test**: Add a role-gated test channel to the allowlist, post a known test code, run the monitor, and confirm the code appears in `data/discord/candidates.jsonl` with the correct channel provenance.

**Acceptance Scenarios**:

1. **Given** a role-gated channel is in `config/discord-allowlist.json` and the bot has been invited to the server with the required permissions, **When** the scheduled monitor run executes, **Then** messages from that channel are ingested and processed identically to public-channel messages.
2. **Given** a members-only channel is in the allowlist but the bot has NOT been granted access to it, **When** the monitor runs, **Then** the channel is recorded as "access denied" in the run's health telemetry and the monitor continues processing remaining channels without crashing.
3. **Given** the bot token carries the required read-message scopes and the bot is a member of the server, **When** a new message containing a gift code is posted in a restricted channel, **Then** the code is extracted, de-duplicated, and queued for redemption on the same or next run.

---

### User Story 2 - Graceful Degradation When Permissions Are Insufficient (Priority: P2)

The bot is added to a server but not granted the specific channel-read permissions for a gated channel. The monitor detects the 403 response, logs a clear diagnostic explaining which channel and which permission is missing, and continues processing all other allowlisted channels without interruption.

**Why this priority**: Operators will inevitably misconfigure permissions when onboarding new servers. The system must not fail silently or crash; it needs to surface actionable diagnostics so the operator can fix the configuration.

**Independent Test**: Configure the allowlist with a channel the bot cannot access. Run the monitor and verify (a) the 403 is logged with the channel ID and a human-readable explanation, (b) other channels in the same run are still processed, (c) the health section of the digest names the inaccessible channel.

**Acceptance Scenarios**:

1. **Given** a restricted channel in the allowlist returns 403, **When** the monitor runs, **Then** the run completes successfully for all other channels and the digest health section lists the inaccessible channel with a suggested remediation ("grant bot VIEW_CHANNEL + READ_MESSAGE_HISTORY in server settings").
2. **Given** the bot loses access to a previously accessible channel mid-run, **When** the API returns 403 for that channel, **Then** the error is handled identically to scenario 1 — no unhandled exception, no retry loop, no partial data corruption.

---

### User Story 3 - Bot Token Validation at Startup (Priority: P3)

Before attempting any channel reads, the monitor validates that the `DISCORD_BOT_TOKEN` is a syntactically valid bot token and that it resolves to an authenticated bot identity via the `/users/@me` endpoint. If validation fails, the run terminates early with a clear error rather than producing a cascade of 401 errors across every channel.

**Why this priority**: Early token validation prevents wasted API calls and produces a single, root-cause error message instead of N duplicated auth failures.

**Independent Test**: Set `DISCORD_BOT_TOKEN` to an invalid value, run the monitor, and confirm a single clear error is emitted naming the token validation step — not a series of per-channel 401 errors.

**Acceptance Scenarios**:

1. **Given** `DISCORD_BOT_TOKEN` is set to a valid bot token, **When** the monitor starts, **Then** it calls `/users/@me`, confirms the bot identity, logs the bot username (not the token), and proceeds to channel ingestion.
2. **Given** `DISCORD_BOT_TOKEN` is set to an invalid or expired token, **When** the monitor starts, **Then** it fails fast with a single descriptive error and exits with a non-zero code before attempting any channel reads.
3. **Given** `DISCORD_BOT_TOKEN` is unset or empty, **When** the monitor starts, **Then** it raises `DiscordTokenMissingError` immediately (existing behavior, preserved).

---

### Edge Cases

- What happens when the bot is kicked from a server between runs? → The next run receives 403/404 for those channels; the monitor logs the event and continues with remaining channels.
- What happens when Discord revokes or rotates the bot token? → The `/users/@me` validation fails fast; the run terminates with a single auth error.
- What happens when a channel changes from public to restricted after being allowlisted? → No behavior change needed — the bot either has access (via server membership + permissions) or it doesn't, and the existing 403 handling covers this.
- What happens when the bot hits the Discord rate limit during a run with many restricted channels? → The existing rate-limit retry logic in `DiscordClient` (bounded retry with backoff) applies identically.
- What happens when two monitor runs overlap? → The existing cursor-based idempotency (`data/discord/cursors.json`) prevents duplicate processing regardless of channel access type.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST authenticate to the Discord API using a bot token with the `Bot` prefix in the `Authorization` header (existing behavior, no change).
- **FR-002**: System MUST support reading messages from channels that require the `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY` permissions, provided the bot has been granted those permissions in the target server.
- **FR-003**: System MUST validate the bot token via `GET /users/@me` at the start of each monitor run before attempting channel reads.
- **FR-004**: System MUST fail fast with a single descriptive error if token validation returns 401 (invalid/expired token).
- **FR-005**: System MUST handle 403 (Forbidden) responses per-channel without aborting the entire run — each inaccessible channel is logged and skipped.
- **FR-006**: System MUST include inaccessible channels (403 responses) in the digest health section with the channel ID and a human-readable remediation suggestion.
- **FR-007**: System MUST process messages from restricted channels through the same extraction, de-duplication, classification, and redemption pipeline as public channels — no separate code path.
- **FR-008**: System MUST NOT require any user-account OAuth2 tokens — bot tokens only.
- **FR-009**: System MUST NOT send any messages, reactions, or other write operations to Discord — read-only access only.
- **FR-010**: System MUST NOT store Discord message content beyond what the existing pipeline already stores (extracted gift codes and classified tip excerpts) — no raw message archival.
- **FR-011**: System MUST respect Discord API rate limits using the existing bounded-retry logic in `DiscordClient`.
- **FR-012**: System MUST NOT log, persist, or echo the bot token value in any error message, log output, or telemetry artifact.
- **FR-013**: The `config/discord-allowlist.json` format MUST support restricted channels without requiring a new schema — channel IDs are channel IDs regardless of access level.
- **FR-014**: System MUST surface a clear, actionable error when a server invitation is missing or the bot lacks guild membership, distinguishing this from a per-channel permission issue.

### Key Entities

- **Bot Identity**: The authenticated Discord bot, identified by its bot user ID and username (retrieved via `/users/@me`). Represents the monitor's identity for all API interactions.
- **Restricted Channel**: A Discord text channel gated behind membership, role, or permission requirements. From the API perspective, identical to a public channel — the distinction is in whether the bot's permissions grant access.
- **Channel Access Status**: Per-channel outcome of an ingestion attempt: `accessible`, `forbidden` (403), `not_found` (404), or `error` (transient). Tracked per-run for health reporting.

### API Contract *(mandatory for changes touching external integrations)*

**Endpoints touched** (method + path + auth requirement):

- `GET /users/@me` — Bearer `Bot <REDACTED>` (existing endpoint, used for token validation)
- `GET /channels/{channel.id}/messages` — Bearer `Bot <REDACTED>` (existing endpoint, no change)

**Request shape** (sanitized example):

```
GET /users/@me HTTP/1.1
Authorization: Bot <REDACTED>
Accept: application/json
User-Agent: STFC-Discord-Monitor (https://github.com/Jamula/stfc, 0.1.0)
```

**Success response shape** (sanitized example, with HTTP status):

```text
200 OK
```

```json
{
  "id": "<REDACTED>",
  "username": "<REDACTED>",
  "discriminator": "0",
  "bot": true
}
```

**Error responses** (status code + shape + when emitted):

- `401 Unauthorized` — token invalid, expired, or malformed; trigger fail-fast abort of the entire run.
- `403 Forbidden` — bot lacks `VIEW_CHANNEL` or `READ_MESSAGE_HISTORY` for the target channel; skip channel, log diagnostic, continue run.
- `429 Too Many Requests` — rate limited; honor `Retry-After` header with bounded retry (existing behavior).
- `5xx` — upstream failure; retry once with jitter, then record as transient error (existing behavior).

**Known edge cases**:

- Bot removed from guild returns 403 on channel reads (not 404).
- `Retry-After` header may be absent on some 429 responses; fall back to 1-second default (existing handling).
- Guild-level permissions may override channel-level permissions (Discord's permission hierarchy).

**Source of contract**:

- [x] Upstream documentation: [Discord API — Get Current User](https://discord.com/developers/docs/resources/user#get-current-user)
- [x] Upstream documentation: [Discord API — Get Channel Messages](https://discord.com/developers/docs/resources/message#get-channel-messages)
- [x] Upstream documentation: [Discord API — Bot vs Bearer Auth](https://discord.com/developers/docs/reference#authentication)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The monitor successfully reads messages from at least one members-only or role-gated channel that was previously inaccessible.
- **SC-002**: Gift codes posted in restricted channels are extracted and submitted for redemption within the same time window as codes from public channels (within one scheduled run cycle).
- **SC-003**: When the bot lacks access to a channel, the digest health section names the channel and includes a remediation suggestion — zero silent failures.
- **SC-004**: An invalid bot token causes exactly one error message and a clean exit, not N per-channel failures.
- **SC-005**: No new Discord API endpoints are introduced — only existing endpoints (`/users/@me`, `/channels/{id}/messages`) are used, keeping the API surface unchanged.
- **SC-006**: All existing public-channel monitoring continues to work without regression — existing tests pass without modification.

## In Scope vs Out of Scope

**In scope:**

- Bot-token authentication for reading restricted (members-only, role-gated) channels.
- Pre-flight token validation via `/users/@me`.
- Per-channel access-error handling (403 → log + skip + report).
- Diagnostic reporting for inaccessible channels in the daily digest health section.
- Documentation of required Discord bot permissions for server operators.

**Out of scope:**

- OAuth2 for user accounts — bot tokens only, no user consent flows.
- Sending messages to Discord — the monitor remains strictly read-only.
- Cross-server federation — each server requires its own bot invitation.
- Storing Discord message content — only extracted gift codes and classified tip excerpts are persisted (existing behavior).
- Image/OCR extraction from restricted channels (out of scope in the base monitor, unchanged).
- Modifying the bot's Discord permissions at runtime — permission grants are a manual server-admin action.
- Thread or forum channel access (deferred to a future feature).

## Assumptions

- The bot has already been created in the Discord Developer Portal and a bot token has been generated. Token creation is an operator responsibility, not an automated step.
- Server administrators will manually invite the bot to their servers and grant the required permissions (`VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`). The feature provides documentation but does not automate the invitation flow.
- The existing `config/discord-allowlist.json` schema (channel ID list) is sufficient — restricted channels do not require additional metadata beyond the channel ID.
- The existing `DiscordClient` class and its error-handling taxonomy (`DiscordAuthError`, `DiscordChannelAccessError`, etc.) provide the necessary building blocks. This feature primarily enhances the orchestration layer, not the HTTP client.
- `DISCORD_BOT_TOKEN` continues to be provided exclusively via GitHub Actions encrypted secrets (`gh secret set DISCORD_BOT_TOKEN`), per Constitution v1.3.0.
- Discord's permission model is hierarchical: server-level permissions can override channel-level permissions. The bot needs the correct permissions at whatever level the server admin has configured.
- The existing rate-limit handling (bounded retry with `Retry-After` parsing) is adequate for the additional API calls introduced by restricted-channel access.
