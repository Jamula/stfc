# System Specification: stfc-gift-redeemer (Current State)

**Created**: 2026-05-08T23:40:33-07:00
**Status**: Authoritative — reverse-engineered from commit `20a5d96`
**Input**: Reverse-engineered from the running codebase. Source recon: spec-recon-{scotty,uhura,bashir}.md.

---

## Purpose

**stfc-gift-redeemer** is a headless command-line tool that automatically redeems web-store gifts and promotional codes from the **Star Trek Fleet Command** (STFC) store on behalf of one or more player accounts. It is designed to run unattended on a recurring schedule (currently every hour via a CI/CD scheduler) so that daily login bonuses, free gift packs, and promotional codes are claimed without the operator ever opening the store in a browser.

The system also provides diagnostic sub-commands for token validation, gift listing, gift claiming, and code redemption — each runnable independently for ad-hoc troubleshooting.

A companion token-capture helper automates the browser-based login flow to obtain fresh JWTs, and an optional scheduled refresh workflow keeps tokens current without manual intervention.

> **Disclaimer (Constitution Principle I):** Automating interactions with the STFC web store may violate Scopely's Terms of Service. The operator assumes all responsibility for consequences including account suspension. This project is unofficial and unaffiliated with Scopely, Digit Game Studios, CBS, or Paramount.

---

## User Scenarios & Testing

### User Story 1 — Scheduled Headless Gift & Code Redemption (Priority: P1)

An operator configures one or more STFC player accounts with bearer tokens and a list of promotional codes. A scheduled job runs every hour, automatically claiming all available free gifts and redeeming all listed promo codes for every configured account, then producing a run summary. The entire process completes without human interaction.

**Why this priority**: This is the core value proposition of the system. Without scheduled headless redemption, the tool has no purpose. Every other capability exists to support, diagnose, or maintain this workflow.

**Independent Test**: Can be fully tested by providing a mock API that returns gift lists and promo code responses, verifying that the orchestrator claims gifts, redeems codes, classifies outcomes correctly, appends history, renders a summary, and exits with the correct code — all without interactive prompts.

**Acceptance Scenarios**:

1. **Given** a valid accounts configuration with two accounts and a promo-codes file with three codes, **When** the orchestrator runs, **Then** it processes both accounts sequentially, attempts to claim all available gifts and redeem all three codes for each account, and exits with code 0.
2. **Given** one account has an expired token and one has a valid token, **When** the orchestrator runs, **Then** the expired account is classified as `TOKEN_EXPIRED` and skipped, the valid account is fully processed, and the run exits with code 0 (not code 1).
3. **Given** a promo code that was already redeemed by an account, **When** the orchestrator submits it, **Then** the API returns a used-before response, the outcome is classified as `CODE_ALREADY_USED`, and the orchestrator continues to the next code without error.
4. **Given** a gift that has already been claimed, **When** the orchestrator encounters it in the gift list, **Then** it classifies the gift as `ALREADY_CLAIMED` and continues processing without error.
5. **Given** the API returns a response that does not match the expected schema on any call during `run-all`, **When** a `SchemaMismatchError` is thrown, **Then** the error is recorded in the run report's errors array, the orchestrator exits with code 1, and the error message is redacted before output.
6. **Given** a valid run with at least one gift successfully claimed, **When** the orchestrator completes, **Then** a new row is appended to the history file (newest-first) and a markdown summary is written to the step-summary file (if configured).
7. **Given** no gifts are claimed in a run, **When** the orchestrator completes, **Then** the history file is NOT modified.

---

### User Story 2 — Manual Local CLI Invocation (Priority: P2)

An operator runs diagnostic sub-commands locally to verify token validity, inspect available gifts, test claiming, or test code redemption — without triggering the full orchestrator or modifying history.

**Why this priority**: Local diagnostics are essential for debugging token expiry, verifying API connectivity, and testing new promo codes before committing them. They reduce the feedback loop from "wait for the next scheduled run" to immediate.

**Independent Test**: Can be tested by invoking each diagnostic sub-command with a mock API client and verifying it produces structured output and always exits with code 0, even when individual accounts fail.

**Acceptance Scenarios**:

1. **Given** the CLI is invoked with the `check-auth` sub-command, **When** the tool runs, **Then** it calls `/auth/me` for each account, prints token expiry/issuer/audience, and exits with code 0 regardless of per-account errors.
2. **Given** the CLI is invoked with the `list-gifts` sub-command, **When** the tool runs, **Then** it fetches and displays available gifts per account and exits with code 0.
3. **Given** the CLI is invoked with the `claim-gifts` sub-command, **When** the tool runs, **Then** it attempts to claim one gift per account, reports the outcome, and exits with code 0.
4. **Given** the CLI is invoked with the `redeem-codes` sub-command, **When** the tool runs, **Then** it attempts to redeem codes from the promo file and exits with code 0.
5. **Given** the CLI is invoked with an unknown sub-command name, **When** the tool runs, **Then** it prints a usage message and exits with code 2.
6. **Given** the accounts configuration environment variable is missing or invalid, **When** any sub-command is invoked, **Then** the tool throws an `AccountsConfigError` and exits with code 1.

---

### User Story 3 — Token Refresh & Re-Capture Lifecycle (Priority: P3)

JWTs expire (typically after ~30 days). The operator can re-capture tokens via an interactive browser-based flow or an automated headless refresh workflow that runs weekly.

**Why this priority**: Without token refresh, the system stops working after ~30 days. Automated refresh extends unattended operation indefinitely, but is not required for the core redemption flow — manual re-capture is always a fallback.

**Independent Test**: Can be tested by verifying the capture helper validates tokens against `/auth/me`, merges tokens into the accounts store correctly, and the refresh workflow invokes the capture helper in headless mode with the correct parameters.

**Acceptance Scenarios**:

1. **Given** the interactive capture helper is invoked, **When** the operator logs in via the browser, **Then** the helper intercepts the JWT from network traffic, validates it against `/auth/me`, merges it into the local environment file, and optionally pushes it to the remote secret store.
2. **Given** the headless capture helper is invoked with `--ci` flag, **When** login credentials are provided via environment variables, **Then** the helper launches a headless browser, auto-fills credentials, intercepts the JWT, validates it, and emits exactly one JSON line to stdout (`{"name":"<name>","token":"<jwt>"}`).
3. **Given** the capture helper intercepts a token that fails `/auth/me` validation, **When** validation fails, **Then** the helper exits non-zero and does NOT write the token to any persistent store.
4. **Given** the weekly refresh workflow runs, **When** the headless capture succeeds, **Then** the new token is merged into the existing accounts array (preserving all other accounts) and the remote secret is updated.
5. **Given** the login requires MFA or CAPTCHA in headless mode, **When** the automated flow cannot proceed, **Then** the workflow fails and the operator must re-capture interactively.

---

### User Story 4 — Per-Run Reporting & History (Priority: P4)

Every orchestrator run produces a structured markdown summary (written to the CI step summary and stdout) and optionally appends to a persistent history file. Operators can review claim history without inspecting raw logs.

**Why this priority**: Observability is essential for an unattended system. Without summaries and history, the operator cannot tell what happened on each run without reading raw logs. However, the system functions correctly even if reporting is disabled or broken.

**Independent Test**: Can be tested by running the orchestrator with various outcome mixes and verifying the summary output format, history file append behavior, and redaction of secrets in all output.

**Acceptance Scenarios**:

1. **Given** the step-summary environment variable points to a writable file, **When** the orchestrator completes, **Then** a markdown summary is appended containing per-account sections with token expiry, gift outcome tables, and code outcome tables.
2. **Given** the step-summary environment variable is not set, **When** the orchestrator completes, **Then** summary content is printed to stdout only, and no file write is attempted.
3. **Given** at least one gift was successfully claimed, **When** the orchestrator writes history, **Then** a new row is inserted immediately after the table header separator (newest-first), containing the UTC date, time, account name, and comma-separated claimed item names.
4. **Given** the `--no-history` flag is passed to `run-all`, **When** the orchestrator completes, **Then** the history file is NOT modified regardless of outcomes.
5. **Given** the history file does not exist, **When** the orchestrator needs to append, **Then** it creates the file with a table header and the new row.
6. **Given** an error occurs during the run, **When** the error message is rendered in the summary, **Then** all JWT-shaped strings and authorization headers are replaced with redaction placeholders.

---

### User Story 5 — Secret Hygiene & Artifact-Hygiene CI Gate (Priority: P5)

All external output from the system (logs, summaries, error messages) is scrubbed of secrets. A CI gate scans committed artifacts (specs, plans, docs) for leaked tokens and blocks merges on violation.

**Why this priority**: Secret leakage is the highest-risk failure mode (Constitution Principle I). However, the hygiene gate protects the development process, not the runtime — the system functions correctly without it, but would be unsafe to maintain.

**Independent Test**: Can be tested by running the redaction functions against strings containing JWT patterns, authorization headers, and nested secret objects, and verifying all are replaced. The artifact hygiene scanner can be tested against clean and contaminated fixture files.

**Acceptance Scenarios**:

1. **Given** a string containing a JWT-shaped token (three base64url segments ≥8 chars each), **When** `redactString` is applied, **Then** the token is replaced with `[REDACTED-JWT]`.
2. **Given** a string containing `Authorization: Bearer <jwt>`, **When** `redactString` is applied, **Then** the bearer value is replaced with `[REDACTED]`.
3. **Given** an object with keys named `Authorization`, `token`, or `refreshToken`, **When** `redactValue` is applied recursively, **Then** all matching values are replaced with `[REDACTED]` and non-secret fields are preserved.
4. **Given** a committed markdown file containing a JWT-shaped string starting with `eyJ`, **When** the artifact hygiene scanner runs, **Then** it exits with code 1 and reports the violation location.
5. **Given** a committed markdown file using `<REDACTED>` placeholders correctly, **When** the artifact hygiene scanner runs, **Then** it exits with code 0.
6. **Given** a PR description contains `[skip-token-scan]`, **When** the artifact hygiene CI gate runs, **Then** the scan is bypassed.

---

### User Story 6 — Multi-Account Support (Priority: P6)

The system supports an arbitrary number of player accounts in a single configuration. Each account is processed independently; one account's failure does not prevent others from being processed.

**Why this priority**: Multi-account support is a multiplier on the core value proposition but is not required for single-account operation.

**Independent Test**: Can be tested by providing multiple accounts with varying token states (valid, expired, schema-error) and verifying each is processed independently with correct per-account outcome reporting.

**Acceptance Scenarios**:

1. **Given** three accounts configured with valid tokens, **When** the orchestrator runs, **Then** all three are processed sequentially in configuration order and each appears in the run report.
2. **Given** one account's token is expired, **When** the orchestrator processes it, **Then** the account is classified as `TOKEN_EXPIRED`, the orchestrator continues to the next account, and the overall run exits with code 0 if any account succeeded.
3. **Given** account names are duplicated in the configuration, **When** accounts are loaded, **Then** an `AccountsConfigError` is thrown and the tool exits with code 1.

---

### Edge Cases

**Explicitly tested (from test suite):**

- Empty `STFC_ACCOUNTS` environment variable → `AccountsConfigError` ("not set")
- Invalid JSON in `STFC_ACCOUNTS` → `AccountsConfigError` ("not valid JSON")
- Non-array value in `STFC_ACCOUNTS` → `AccountsConfigError` ("structure is invalid")
- Empty array `[]` → `AccountsConfigError` ("at least one account")
- Duplicate account names → `AccountsConfigError` ("duplicate account name")
- Non-JWT-shaped token → `AccountsConfigError` ("not JWT-shaped")
- Empty string token → `AccountsConfigError` ("structure is invalid")
- JWT with fewer than 3 segments → rejected by `isJwtShaped`
- JWT with more than 3 segments → rejected by `isJwtShaped`
- JWT with empty middle segment → rejected by `isJwtShaped`
- JWT with base64 padding character `=` → rejected (not valid base64url)
- JWT with no `exp` claim → treated as "no expiry", `isExpired: false`
- JWT with `aud` as string or array → both accepted
- Missing promo-codes file → treated as empty list, no error
- Windows line endings (CRLF) in promo file → handled correctly
- Non-JSON response on HTTP 200 → `SchemaMismatchError`
- Schema-mismatched JSON on HTTP 200 → `SchemaMismatchError`
- HTTP 5xx on GET request → retry once, then `TransientError`
- HTTP 5xx on POST request → no retry, `TransientError`
- Network error on any request → `TransientError`
- HTTP 401/403 → `TokenExpiredError`
- `SchemaMismatchError` during `run-all` → recorded in errors, exit code 1
- `TokenExpiredError` on one account → others continue, exit code 0
- Gift with `isClaimed=true` → classified as `ALREADY_CLAIMED`, skipped
- Gift with `isSpecial=true` → classified as `IS_SPECIAL`, skipped
- Gift with `hasCost=true` → classified as `HAS_COST`, skipped
- Gift with `isAtMax=true` → classified as `AT_MAX`, skipped
- Redeem result code 0 → `CODE_REDEEMED`
- Redeem message "used_before" → `CODE_ALREADY_USED`
- Redeem message "level" → `LEVEL_TOO_LOW`
- No gifts claimed in run → history file not modified
- History file missing → created with header + row

**Not currently tested (potential gaps):**

- **[NEEDS CLARIFICATION: How should the system behave when the promo-codes file has a read error other than ENOENT (e.g., permission denied)? Current behavior is untested — does it throw or silently return empty?]**
- **[NEEDS CLARIFICATION: Should HTTP 429 (rate limit) responses be classified as `TransientError` with retry, or treated as a distinct error type? Current implementation does not explicitly handle 429.]**
- **[NEEDS CLARIFICATION: What is the expected behavior when a gift's server-side state changes between `listGifts()` and `claimGift()` (e.g., gift expires mid-run)? The system likely receives an API error, but the classification is untested.]**
- **[NEEDS CLARIFICATION: Should the history file support de-duplication of rows when the same run executes twice in the same hour? Current behavior appends duplicate rows — is this intentional for audit trail purposes?]**
- **[NEEDS CLARIFICATION: What is the expected behavior when the summary file path (GITHUB_STEP_SUMMARY) is not writable? Current implementation does not test this failure mode.]**
- **[NEEDS CLARIFICATION: How should the system handle 100+ gifts, 100+ promo codes, or 100+ accounts? No performance characteristics or limits are documented or tested.]**
- **[NEEDS CLARIFICATION: Are history file timestamps always UTC, and how should timezone edge cases (DST transitions) be handled? Tests use fixed dates but do not verify timezone conversion.]**

---

## Requirements

### Functional Requirements

#### Account & Secret Management

- **FR-001**: The system MUST load account configuration from a single environment variable (`STFC_ACCOUNTS`) containing a JSON array of account objects. Each object MUST have a `name` (non-empty string) and `token` (non-empty string) field. *(Constitution Principles I, V)*
- **FR-002**: The system MUST validate that the JSON is well-formed, is an array (not a bare object, null, or scalar), contains at least one account, has no duplicate `name` values, and that each `token` passes JWT shape validation. *(Bashir §2.1)*
- **FR-003**: JWT shape validation MUST verify exactly three non-empty segments separated by `.` characters, where each segment contains only base64url characters (`[A-Za-z0-9_-]`). The `=` padding character MUST be rejected. *(Bashir §2.2)*
- **FR-004**: On any account validation failure, the system MUST throw an infrastructure-class error (`AccountsConfigError`) with a descriptive message and cause the CLI to exit with code 1. *(Scotty §1, §5)*
- **FR-005**: The system MUST decode JWT payloads (base64url decode, no signature verification) to extract `exp` (expiry timestamp), `iss` (issuer), and `aud` (audience) claims. Missing claims MUST be tolerated (not treated as errors). *(Bashir §2.2)*
- **FR-006**: The system MUST compute a human-readable expiry description: "expires in X days/hours/minutes" for future expiry, "EXPIRED X days/hours/minutes ago" for past expiry, or "no expiry" when the `exp` claim is absent. *(Bashir §2.2)*
- **FR-007**: Secrets (JWTs, passwords, PATs) MUST reside only in sanctioned surfaces: the local environment file (gitignored), CI encrypted secrets, process memory, and the two narrow hand-off channels (stdout JSON in `--ci` mode; temporary file deleted in same job). *(Constitution Principle V)*

#### Promo Code List Management

- **FR-008**: The system MUST read promotional codes from a plain-text file (`promo-codes.txt`), one code per line. *(Uhura §4.1)*
- **FR-009**: Blank lines MUST be ignored. Lines beginning with `#` MUST be treated as comments and ignored. Inline comments (text after whitespace + `#` on a code line) MUST be stripped. Leading and trailing whitespace on each line MUST be trimmed. *(Bashir §2.3)*
- **FR-010**: Both Unix (`\n`) and Windows (`\r\n`) line endings MUST be supported. *(Bashir §2.3)*
- **FR-011**: If the promo-codes file does not exist, the system MUST treat it as an empty list (zero codes) without raising an error. *(Bashir §2.3)*
- **FR-012**: Promo codes MUST be submitted to the API on every run without local de-duplication. The upstream API's "already redeemed" response is the source of truth. Duplicate codes in the file MUST be submitted as separate attempts. *(Uhura §4.3, Constitution Principle V)*

#### API Integration Contract

- **FR-013**: All communication with the STFC store API MUST go through a centralized API client. No direct HTTP calls to the STFC API are permitted outside the client module. *(Constitution Principle III)*
- **FR-014**: The API client MUST construct requests with the following headers: `Authorization: Bearer <JWT>`, `Accept: application/json`, `Content-Type: application/json` (on POST). *(Uhura §1.3)*
- **FR-015**: Every API response MUST be validated against a declared schema. Responses that are non-JSON or fail schema validation MUST throw a `SchemaMismatchError`. *(Constitution Principle III, Bashir §2.7)*
- **FR-016**: The API client MUST use permissive schema validation (tolerate unknown additional fields) to handle upstream API schema drift gracefully. *(Uhura §1.5)*
- **FR-017**: The API client MUST impose a timeout on every request (default: 10 seconds) so a hung upstream cannot stall the scheduled job. *(Constitution Principle III)*
- **FR-018**: GET requests MUST be retried exactly once on `TransientError` (HTTP 5xx or network failure), with a random jitter delay between 500ms and 1000ms. POST requests MUST NOT be retried automatically. *(Uhura §1.4, Bashir §2.7)*
- **FR-019**: The API client MUST classify HTTP errors into a typed error taxonomy: `TokenExpiredError` (401/403), `TransientError` (5xx and network failures), `SchemaMismatchError` (non-JSON or schema-invalid), and a generic `ApiError` (other 4xx). Outcome classification MUST branch on these typed errors, not on string matching. *(Constitution Principle III, Bashir §2.7)*
- **FR-020**: The API client MUST never include the bearer token in error messages. All error messages constructed by the client MUST be redacted before throwing. *(Constitution Principle I, Bashir §2.7)*

#### Outcome Vocabulary

- **FR-021**: The system MUST define and use the following 13 outcome terms for classifying per-attempt results. All are considered "expected" outcomes and MUST NOT cause the orchestrator to exit with a non-zero code: *(Uhura §6.3, Bashir §2.5)*

  **Gift Claim Outcomes:**
  | Outcome | Meaning |
  |---------|---------|
  | `CLAIMED` | Gift successfully claimed |
  | `ALREADY_CLAIMED` | Gift already claimed by this account |
  | `AT_MAX` | Account at maximum of this gift type |
  | `IS_SPECIAL` | Gift is special/limited; cannot be freely claimed |
  | `HAS_COST` | Gift requires currency; free claim unavailable |

  **Promo Code Outcomes:**
  | Outcome | Meaning |
  |---------|---------|
  | `CODE_REDEEMED` | Code successfully redeemed |
  | `CODE_ALREADY_USED` | Code previously redeemed by this account |
  | `CODE_INVALID_OR_EXPIRED` | Code invalid, expired, or level-gated |
  | `LEVEL_TOO_LOW` | Account operation level insufficient for code |

  **Cross-Cutting Outcomes:**
  | Outcome | Meaning |
  |---------|---------|
  | `TOKEN_VALID` | Token validated successfully |
  | `TOKEN_EXPIRED` | Token expired (HTTP 401/403); account skipped |
  | `NO_GIFTS_AVAILABLE` | Gift list empty or all gifts skipped |
  | `UNKNOWN_RESULT` | Unrecognized response; logged for investigation |

- **FR-022**: Gift skip classification MUST inspect gift properties (`isClaimed`, `isSpecial`, `hasCost`, `isAtMax`) accepting both boolean and numeric (0/1) values. A gift with none of these flags set MUST be treated as claimable. *(Bashir §2.5)*
- **FR-023**: Promo code result classification MUST use numeric result codes (0=success, 1=expired, 3=invalid) AND message text keyword matching (case-insensitive: "used_before" → `CODE_ALREADY_USED`, "level" → `LEVEL_TOO_LOW`, "success" → `CODE_REDEEMED`). An empty object or unrecognized code MUST classify as `UNKNOWN_RESULT`. *(Bashir §2.5)*
- **FR-024**: HTTP error classification MUST map `TokenExpiredError` → `TOKEN_EXPIRED`, `TransientError` → `TRANSIENT`, and all other errors → `UNKNOWN_RESULT`. Null and string inputs MUST also classify as `UNKNOWN_RESULT`. *(Bashir §2.5)*

#### Redaction Rules

- **FR-025**: The system MUST provide string redaction that replaces the following patterns: *(Uhura §6.2, Bashir §2.4)*

  | Pattern | Replacement |
  |---------|-------------|
  | JWT-shaped string (three base64url segments ≥8 chars each) | `[REDACTED-JWT]` |
  | `Authorization: Bearer <value>` | `Authorization: Bearer [REDACTED]` |
  | `"authorization": "Bearer <value>"` (JSON) | `"authorization": "Bearer [REDACTED]"` |
  | Other Authorization header variants (case-insensitive) | `Authorization: [REDACTED]` |

- **FR-026**: The system MUST provide deep object/array redaction that recursively replaces values of keys named `Authorization`, `token`, and `refreshToken` with `[REDACTED]`, preserving all non-secret fields. *(Bashir §2.4)*
- **FR-027**: The system MUST provide log-formatting redaction that accepts Error objects, plain strings, and plain objects, and returns output with all secret patterns replaced. The original secret MUST never appear in the output. *(Bashir §2.4)*
- **FR-028**: All error messages surfaced externally (thrown errors, uncaught failures, API response error text) MUST pass through redaction before output. *(Constitution Principle I)*

#### Run Summary Format

- **FR-029**: The orchestrator MUST produce a markdown-formatted run summary containing: *(Uhura §6.4)*
  1. Infrastructure errors section (if any), with redacted error messages.
  2. Per-account sections containing: account name, token expiry description, gift outcomes table (columns: Gift, Outcome, Message), and code outcomes table (columns: Code, Outcome, Message).
  3. Overall statistics (total gifts claimed, total codes redeemed) if any claims succeeded.

- **FR-030**: The summary MUST be written to the step-summary file path (if the corresponding environment variable is set) by appending. If the environment variable is not set, the summary MUST still be rendered to stdout. The write MUST be a no-op (not an error) when the file path is unavailable. *(Bashir §2.6)*
- **FR-031**: The summary writer MUST ensure a trailing newline after each append. *(Bashir §2.6)*

#### Markdown Helpers

- **FR-032**: The system MUST provide markdown table rendering that accepts headers and rows, renders pipe-delimited format with header and separator rows, escapes pipe characters in cells to `\|`, and returns empty string for empty headers. *(Bashir §2.6)*
- **FR-033**: The system MUST provide markdown heading rendering (levels 1–3) and bullet-point rendering. *(Bashir §2.6)*

#### History Append Rules

- **FR-034**: After each orchestrator run, if at least one gift was successfully claimed (`CLAIMED` outcome) AND the `--no-history` flag was NOT passed, the system MUST append a new row to the history file. *(Uhura §6.5, Bashir §2.8)*
- **FR-035**: The history row format MUST include: date (YYYY-MM-DD, UTC), time (HH:MM:SS, UTC), account name, and comma-separated claimed item names with type annotation ("(Gift)" or "(Code)"). *(Uhura §6.5)*
- **FR-036**: New rows MUST be inserted immediately after the markdown table separator line (`| --- | --- | --- | --- |`), resulting in newest-first ordering. *(Uhura §6.5, Bashir §2.8)*
- **FR-037**: If the history file does not exist, the system MUST create it with a table header and separator before appending the row. *(Bashir §2.8)*
- **FR-038**: If no gifts were claimed in a run, the history file MUST NOT be modified (no empty rows appended). *(Bashir §2.8)*

#### CLI Surface Contract

- **FR-039**: The system MUST expose a single CLI entry point that accepts a sub-command name as its first positional argument. *(Scotty §1)*
- **FR-040**: The following sub-commands MUST be registered: *(Scotty §1)*

  | Sub-command | Purpose | Side Effects |
  |-------------|---------|--------------|
  | `run-all` | Full orchestrator: claim gifts + redeem codes for all accounts | HTTP POST (claim/redeem), file append (history, summary) |
  | `check-auth` | Diagnostic: validate JWT via `/auth/me` | None (read-only) |
  | `list-gifts` | Diagnostic: list available gifts per account | None (read-only) |
  | `claim-gifts` | Diagnostic: attempt one claim per account | HTTP POST (claim) |
  | `redeem-codes` | Diagnostic: attempt code redemption per account | HTTP POST (redeem) |

- **FR-041**: The `run-all` sub-command MUST accept an optional `--no-history` flag that suppresses history file append. *(Scotty §1)*

#### Exit Code Contract

- **FR-042**: The CLI MUST use the following exit codes: *(Scotty §5, Bashir §2.8)*

  | Code | Meaning | When |
  |------|---------|------|
  | 0 | Success or expected diagnostic completion | `run-all`: all accounts processed without infrastructure errors. Diagnostic sub-commands: always, even if per-account errors occur. |
  | 1 | Infrastructure error | Account config parse failure, uncaught exception, API schema mismatch, all accounts have expired tokens. |
  | 2 | Unknown sub-command | The first argument does not match any registered sub-command. |

- **FR-043**: Process termination (exit) MUST be centralized in the CLI entry point. Sub-command modules MUST return structured results (including an exit code) rather than terminating the process directly. *(Constitution Principle II)*

#### Configuration Surface

- **FR-044**: The system MUST respect the following environment variables: *(Scotty §4)*

  | Variable | Required | Default | Purpose |
  |----------|----------|---------|---------|
  | `STFC_ACCOUNTS` | Yes | — | JSON array of `{"name","token"}` account objects |
  | `GITHUB_STEP_SUMMARY` | No | — | File path for CI step summary markdown output |
  | `DEBUG_STFC` | No | — | When set to any value, enables debug-level log output |
  | `STFC_API_URL` | No | STFC CDN endpoint | Override API base URL |

- **FR-045**: Debug-level logging MUST be gated on the `DEBUG_STFC` environment variable. When unset, debug output MUST be suppressed entirely (no-op). *(Scotty §3)*

#### Skill Orchestration

- **FR-046**: The `run-all` orchestrator MUST execute the following steps in order: *(Scotty §2)*
  1. Load and validate accounts (exit 1 on failure).
  2. Load promo codes from file (missing file = empty list).
  3. For each account (sequentially, in configuration order):
     a. Validate JWT expiry (log warning if expired; still attempt API calls).
     b. Call `/auth/me` to verify token.
     c. Fetch available gifts via the gifts endpoint.
     d. For each claimable gift, attempt to claim it and record the outcome.
     e. For each promo code, attempt to redeem it and record the outcome.
  4. Append to history file (if applicable per FR-034).
  5. Render markdown summary to step-summary file and stdout.
  6. Exit with appropriate code.

- **FR-047**: The orchestrator MUST continue processing remaining accounts after any per-account failure (token expiry, transient errors, API errors). Per-account failures are reportable outcomes, not workflow failures. *(Constitution Principle II)*
- **FR-048**: `SchemaMismatchError` on any API call during `run-all` MUST be treated as an infrastructure error: recorded in the run report's `errors` array and causing exit code 1. This is distinct from per-account expected outcomes. *(Constitution Principle III)*

#### Build/Runtime Profile (Technology-Agnostic)

- **FR-049**: The system MUST be runnable headlessly with no interactive prompts during redemption. *(Constitution Principle II)*
- **FR-050**: The system MUST complete a scheduled run within a CI job timeout (currently 5 minutes) for typical workloads. *(Uhura §5.1)*
- **FR-051**: The system MUST have a static type-checking gate and an automated test suite that both pass before code changes are merged. *(Constitution Principles IV, IX)*
- **FR-052**: The system MUST support execution from a CI/CD scheduler (currently: hourly cron for redemption, weekly cron for token refresh, push/PR trigger for tests). *(Uhura §5)*

#### Scheduled Workflow Requirements

- **FR-053**: The redemption workflow MUST run on a recurring schedule (currently: hourly at minute 0, UTC) and support manual dispatch. *(Uhura §5.1)*
- **FR-054**: The redemption workflow MUST install dependencies, execute the `run-all` orchestrator, commit history file changes (if any), and render the step summary. The job MUST have a timeout (currently: 5 minutes). *(Uhura §5.1)*
- **FR-055**: The token refresh workflow MUST run on a recurring schedule (currently: weekly, Sunday 04:00 UTC) and support manual dispatch with an optional account name parameter. *(Uhura §5.2)*
- **FR-056**: The redemption and refresh workflows MUST share a concurrency group so they never run simultaneously. If a new run starts while one is in progress, the in-progress run MUST be cancelled. *(Uhura §5.1, §5.2; Constitution Known Tension #3)*
- **FR-057**: A diagnostic workflow MUST be available (manual trigger only) to verify which expected secrets are configured, reporting presence/absence without exposing values. *(Uhura §5.3)*
- **FR-058**: CI test workflows MUST run the type-checking gate and test suite on every push and pull request, blocking merge on failure. *(Uhura §5.4)*

#### Artifact Hygiene CI Gate

- **FR-059**: A CI scanner MUST check committed artifacts for leaked secrets, matching the following 6 patterns: *(Bashir §6)*

  | Pattern | Description |
  |---------|-------------|
  | JWT | 3-segment base64url starting with `eyJ`, ≥10 chars per segment |
  | Bearer Token | `Authorization: Bearer <value>` where value is not a placeholder |
  | GitHub Token | `ghp_`, `gho_`, `ghs_`, `ghu_` prefix + 36-char suffix |
  | AWS Access Key | `AKIA` + 16 uppercase alphanumeric chars |
  | API Key | `api_key` / `api-key` assignment with ≥20-char alphanumeric value |
  | STFC Account Data | `account_id`, `alliance_id`, `balance` fields with numeric values >999 |

- **FR-060**: The scanner MUST run on PRs that touch files under the watched directories (`specs/`, `plans/`, `tasks/`, `.specify/memory/`, `.specify/templates/`, `docs/`, `.github/`) with watched extensions (`.md`, `.txt`, `.yaml`, `.yml`, `.json`). Exit code 1 on violation; exit code 0 on clean scan. *(Bashir §6)*
- **FR-061**: The scanner MUST support a `[skip-token-scan]` bypass in the PR description for confirmed false positives. *(Constitution Principle VII)*

---

### Key Entities

- **Account**: A named STFC player identity, represented as a `{name, token}` pair. The `name` is an operator-chosen label (e.g., "main", "alt"). The `token` is a JWT bearer token obtained from the STFC web store login flow. Accounts are loaded from a single JSON-array configuration source and processed sequentially.

- **Promo Code**: A string code (e.g., "STARTREKDAY2024") that can be submitted to the STFC store to receive in-game rewards. Codes are sourced from a plain-text file, manually maintained by the operator. Codes may be level-gated, time-limited, or one-time-use.

- **Gift**: An in-game reward bundle available for claiming in the STFC web store. Each gift has a bundle identifier, a display title/name, and boolean flags indicating claimability constraints (`isClaimed`, `isSpecial`, `hasCost`, `isAtMax`). Gifts that are free and unclaimed are eligible for automatic claiming.

- **Redemption Outcome**: One of 13 defined outcome terms (see FR-021) that classify the result of a gift claim or code redemption attempt. Every attempt produces exactly one outcome. All defined outcomes are "expected" — only infrastructure errors (schema mismatches, uncaught exceptions) cause workflow failure.

- **Run Report**: The structured result of a single orchestrator execution. Contains an array of per-account results (each with `name`, `tokenStatus`, `items`, and optionally `promoCodes`) and an array of infrastructure errors. The exit code is derived from the report: 0 if no infrastructure errors, 1 otherwise.

- **Token (JWT)**: A JSON Web Token used as a bearer credential for STFC store API calls. Decoded (not cryptographically verified) to extract `exp`, `iss`, and `aud` claims. Tokens have a limited lifespan (~30 days) and must be refreshed periodically. Shape validation requires exactly three non-empty base64url segments separated by dots.

- **History Entry**: A single row in the persistent history file, recording the date, time (UTC), account name, and claimed items from a successful orchestrator run. Entries are appended in newest-first order after the table header.

- **Summary Writer**: An abstraction that writes markdown content to a file path (derived from an environment variable) or acts as a no-op when no path is configured. Used by the orchestrator to produce CI step summaries.

---

### API Contract

**Base URL**: `https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2`
(configurable via `STFC_API_URL` environment variable)

**Source of contract**: Captured request/response pairs validated against schema definitions in the codebase. API is third-party, unversioned, and may change without notice (Constitution Principle VIII).

---

#### Endpoint 1: Validate Token

**`GET /auth/me`** — Bearer `<REDACTED>`

**Request**: Authorization header only; no body.

**Success response (200 OK)**:
```json
{
  "player_id": "<account-id>",
  "player_name": "<redacted>",
  "level": 45,
  "faction": "<redacted>"
}
```

**Error responses**:
- `401 Unauthorized` / `403 Forbidden` — Token expired or invalid → `TokenExpiredError`
- `5xx` — Server error → `TransientError` (retry once with jitter)

**Known edge cases**:
- Schema uses `.passthrough()` to tolerate additional fields.
- **[NEEDS CLARIFICATION: What is the exact behavior when `/auth/me` returns a non-TokenExpired, non-SchemaMismatch error (e.g., 400, 404)? The current implementation pushes it to `report.errors` and sets exit code 1, but this is documented as an overclaim in Constitution Known Tension #1.]**

---

#### Endpoint 2: List Available Gifts

**`GET /offers/gifts`** — Bearer `<REDACTED>`

**Request**: No query parameters used by client.

**Success response (200 OK)**:
```json
{
  "gifts": [
    {
      "bundle_id": "<gift-id>",
      "id": "<gift-id>",
      "title": "<redacted>",
      "description": "<redacted>",
      "is_claimed": 0,
      "is_special": 0,
      "has_cost": 0,
      "is_at_max": 0
    }
  ]
}
```

**Known edge cases**:
- **[NEEDS CLARIFICATION: The API returns field names in both snake_case (`bundle_id`, `is_claimed`) and camelCase (`bundleId`). Does the API consistently return both forms, or does it vary by environment/version?]**
- **[NEEDS CLARIFICATION: The schema accepts both `title` and `name` fields for gift display names (preferring `title`). Does the API always include both, or is one omitted in certain contexts?]**
- Boolean-like fields (`is_claimed`, `is_special`, `has_cost`, `is_at_max`) may be 0/1 integers or boolean values; schema accepts both.

---

#### Endpoint 3: Claim a Gift

**`POST /offers/gifts/claim`** — Bearer `<REDACTED>`

**Request**:
```json
{
  "bundleId": "<gift-id>"
}
```
*Note: Client attempts `bundleId`, then `bundle_id`, then `id` in fallback order when constructing the claim request from the gift object.*

**[NEEDS CLARIFICATION: Which gift identifier field (`bundleId`, `bundle_id`, or `id`) is authoritative for the claim request? The current fallback order appears empirically determined.]**

**Success response (200 OK)**:
```json
{
  "success": true,
  "code": 0,
  "message": "<redacted>"
}
```

**Error responses**:
- Response with `code` value 1 → token expired
- Response with `code` values 2–5 → validation failures
- Message containing "Bundle not available." → treated as already claimed, not error
- `401/403` → `TokenExpiredError`
- `5xx` → `TransientError` (no retry on POST)

---

#### Endpoint 4: Redeem a Promo Code

**`POST /redeem/claim`** — Bearer `<REDACTED>`

**Request**:
```json
{
  "code": "STOREWARS"
}
```

**Success response (200 OK)**:
```json
{
  "success": true,
  "code": 0,
  "message": "redeem_success"
}
```

**Error/alternate responses (all HTTP 200)**:
```json
{
  "success": false,
  "code": 1,
  "message": "redeem_error_code_used_before"
}
```

**Outcome classification (from response)**:
| Response Indicator | Outcome |
|-------------------|---------|
| `code: 0` or message contains "success" | `CODE_REDEEMED` |
| Message contains "used_before" | `CODE_ALREADY_USED` |
| Message contains "level" | `LEVEL_TOO_LOW` |
| `code: 1` or message contains "expired" or "invalid" | `CODE_INVALID_OR_EXPIRED` |
| `code: 3` | `CODE_INVALID_OR_EXPIRED` |
| Empty object or unrecognized | `UNKNOWN_RESULT` |

**[NEEDS CLARIFICATION: Numeric result codes (0=success, 1=expired, 2–5=invalid) are sourced from an external Scopely client JS bundle, not from official API documentation. These could become stale if Scopely updates result codes.]**

**Known edge cases**:
- Level-gated codes return `CODE_INVALID_OR_EXPIRED` or `LEVEL_TOO_LOW` depending on message text.
- `401/403` → `TokenExpiredError`
- `5xx` → `TransientError` (no retry on POST)

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A scheduled run MUST complete within 5 minutes for any reasonable number of accounts and codes (validated by CI job timeout of 5 minutes).
- **SC-002**: 100% of JWT-shaped strings and authorization headers MUST be redacted from all external output (logs, summaries, error messages). Validated by dedicated redaction tests covering JWT patterns, Bearer headers, JSON authorization fields, nested objects, and arrays.
- **SC-003**: Already-redeemed codes MUST be correctly classified as `CODE_ALREADY_USED` and MUST NOT produce errors or non-zero exit codes. Validated by test cases exercising the `classifyRedeemResult` function with "used_before" messages.
- **SC-004**: A new contributor MUST be able to configure and run the CLI locally in under 15 minutes by following the setup documentation. Validated by the completeness of `docs/SETUP.md` covering prerequisites, token capture, secret configuration, and first-run verification.
- **SC-005**: When a JWT expires, the next scheduled run MUST report `TOKEN_EXPIRED` clearly for the affected account without crashing, and MUST continue processing remaining accounts. The overall exit code MUST be 0 if any account succeeded. Validated by test cases in the orchestrator suite.
- **SC-006**: A schema change in the upstream API MUST cause the system to exit with code 1 and report a `SchemaMismatchError` in the run summary, providing clear signal that developer action is required. Validated by API client tests with schema-mismatched responses.
- **SC-007**: The artifact hygiene scanner MUST detect all 6 secret patterns in committed artifacts and exit with code 1 on any match. Validated by the contaminated-spec fixture containing one example of each pattern.
- **SC-008**: The system MUST pass all automated tests (static type checking + test suite) before any code change is merged. Validated by CI workflows triggered on push and PR.
- **SC-009**: Multi-account runs MUST process every account regardless of individual account failures (token expiry, transient errors). Each account MUST appear in the run report with its own outcome. Validated by orchestrator tests with mixed success/failure accounts.
- **SC-010**: The `run-all` exit code MUST be deterministic: 0 when no infrastructure errors occurred, 1 when any infrastructure error (schema mismatch, config error, uncaught exception) occurred. Per-account expected outcomes (all 13 defined outcomes) MUST NOT influence the exit code. Validated by exit code assertions in orchestrator tests.

---

## Assumptions

- The STFC web-store API at `https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2` is publicly reachable from both the operator's local machine and CI runners (no VPN, IP allowlist, or geographic restrictions observed).
- Promo codes are sourced manually by the operator from public community sites. There is no automated code discovery, no RSS feed, and no API for finding new codes.
- JWTs are bearer tokens: the system performs no cryptographic signature verification. The upstream API server validates signatures on its end.
- JWT expiry is typically ~30 days from issuance, but this is controlled by Scopely and could change.
- A single CI repository hosts the entire system for one operator. There is no multi-tenant sharing, no central server, and no user accounts beyond the operator.
- The STFC API treats gift claiming and code redemption as idempotent from the caller's perspective: re-submitting already-claimed gifts or already-used codes returns a distinct "already done" response rather than an error.
- The `cj_pwd` secret (checked by the secrets-check diagnostic workflow) is of unknown purpose — possibly historical or reserved. **[NEEDS CLARIFICATION: What is the purpose of the `cj_pwd` secret? Is it an alias for `STFC_PASSWORD`, a legacy name, or something else entirely?]**
- The `STFC_API_URL` environment variable allows overriding the API base URL, but no test endpoints, staging environments, or fallback URLs are documented. **[NEEDS CLARIFICATION: Under what circumstances would an operator override `STFC_API_URL`? Is there a staging or test environment?]**
- The current implementation uses TypeScript running on a headless runtime, but this specification is written to be technology-agnostic. Any language or runtime that can make HTTPS requests, parse JSON, and run on a CI scheduler can reimplement this system.
- The operator's CI environment provides: HTTPS outbound connectivity, encrypted secret storage, scheduled job execution, and file system access for history and summary writes.
- Token refresh automation (the `Refresh token` workflow) requires a Scopely account that does NOT have MFA or CAPTCHA challenges enabled for the headless login flow to succeed. If Scopely serves a challenge, the workflow fails and the operator must capture tokens interactively.

---

## Out of Scope (Current State)

The following capabilities are explicitly NOT implemented in the current system. Reimplementers should NOT build these unless extending beyond the current-state specification:

1. **Multi-factor authentication (MFA) handling**: The headless token refresh does not solve MFA challenges. If Scopely requires MFA, the operator must capture tokens interactively.
2. **Automated promo code discovery**: Codes are manually sourced and committed. There is no web scraper, RSS reader, or API integration for finding new codes.
3. **Push notifications**: No email, SMS, Discord, Slack, or any notification mechanism. The system is summary-only; operators check the CI job summary page.
4. **Graphical user interface (GUI)**: No web UI, desktop app, mobile app, or browser extension. The system is entirely CLI and CI-driven.
5. **Rate limiting / backoff beyond single retry**: GET requests retry once with jitter. There is no exponential backoff, no rate-limit header parsing, and no explicit 429 handling.
6. **Local state tracking**: No database, no "already redeemed" list, no run-state persistence between invocations. Idempotency is delegated entirely to the upstream API.
7. **Concurrent account processing**: Accounts are processed sequentially. There is no parallelism, no threading, and no async fan-out.
8. **Account management UI**: Accounts are configured via a JSON environment variable. There is no interactive account add/remove/edit flow beyond the capture-token helper.
9. **Promo code expiry tracking**: The system has no knowledge of when codes expire. Expired codes are submitted and the API returns `CODE_INVALID_OR_EXPIRED`.
10. **Multi-platform packaging**: No standalone binary, no container image, no package manager distribution. The system runs from source in a CI environment or local development setup.
11. **Signature verification of JWTs**: Tokens are decoded but not cryptographically verified. The API server handles verification.
12. **Webhook or API surface**: The system exposes no inbound API. It is a batch job that runs and exits.
13. **Browser extension**: Despite historical references in early constitution versions, no browser extension exists or is planned.
14. **Lint / build step**: The system has no linter configuration and no compilation/build step. Source is executed directly by the runtime.
15. **Rollback or transactional semantics**: If one code fails, the next is still attempted. There is no undo, no rollback, and no transactional guarantee across codes or gifts.

---

## Source Material

This specification was reverse-engineered from the following recon documents and project artifacts. The recon documents contain implementation-level detail that this spec intentionally abstracts:

| Source | Path | Content |
|--------|------|---------|
| Scotty's Recon | `.squad/.scratch/spec-recon-scotty.md` | Runtime, CLI, build surface, configuration, exit codes, skill orchestration |
| Uhura's Recon | `.squad/.scratch/spec-recon-uhura.md` | STFC API endpoints, auth flow, CI workflows, reporting, secrets matrix, open questions |
| Bashir's Recon | `.squad/.scratch/spec-recon-bashir.md` | Test-encoded behavior catalog (92 MUST/SHOULD statements), fixtures, edge cases, gaps |
| Constitution | `.specify/memory/constitution.md` | Governing principles (v1.2.0): I–IX + Security & Compliance + Development Workflow |
| README | `README.md` | User-facing overview, quick start, project layout |
| Setup Guide | `docs/SETUP.md` | End-to-end setup instructions, troubleshooting |
| Decisions Log | `.squad/decisions.md` | Architectural decisions and team deliberations |

### Constitutional Principles Referenced

| Principle | Name | Where Referenced |
|-----------|------|-----------------|
| I | User Safety & Trust First | FR-007, FR-020, FR-028 |
| II | Skill-Isolated CLI Architecture | FR-043, FR-047, FR-049 |
| III | Resilient Upstream-API Automation | FR-013, FR-015, FR-017, FR-019, FR-048 |
| IV | Type-Safe Headless CLI | FR-051 |
| V | Stateless Operation & Secret Custody | FR-001, FR-007, FR-012 |
| VII | Artifact Hygiene | FR-059, FR-060, FR-061 |
| VIII | Wire-First Discovery | API Contract section |
| IX | Test-First Discipline | FR-051, SC-008 |
