# Feature Specification: Current-State STFC Gift Redeemer

**Feature Branch**: `[copilot/create-spec-kit-style-spec]`  
**Created**: 2026-05-09  
**Status**: Draft (reverse-engineered current behavior)  
**Input**: Existing repository behavior snapshot for language-agnostic regeneration

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scheduled account redemption pipeline (Priority: P1)

As an operator, I can run a single command/workflow that processes every configured account, validates auth, claims claimable gifts, and redeems configured promo codes.

**Why this priority**: This is the core value of the project.

**Independent Test**: Can be tested by running `run-all` with one or more accounts and asserting outcomes, summary output, and exit code behavior.

**Acceptance Scenarios**:

1. **Given** a valid account token and claimable gifts, **When** `run-all` executes, **Then** claimable gifts are claimed and reported as `CLAIMED`.
2. **Given** mixed account health, **When** one account token is expired, **Then** that account is reported as `TOKEN_EXPIRED` and other accounts still process.
3. **Given** infrastructure-level schema mismatch for upstream API responses, **When** `run-all` executes, **Then** errors are recorded and process exit code is non-zero.

---

### User Story 2 - Safe operations and observability (Priority: P2)

As an operator, I can inspect run outcomes through logs and markdown summaries without leaking sensitive tokens.

**Why this priority**: Automation is only usable if results are visible and safe to store in CI logs/artifacts.

**Independent Test**: Can be tested by inducing API errors and asserting no JWT/Bearer token leakage and correct markdown summary rendering.

**Acceptance Scenarios**:

1. **Given** an API failure containing auth-like data, **When** errors are logged or summarized, **Then** token-like values are redacted.
2. **Given** run completion with account and item outcomes, **When** summary output is generated, **Then** markdown includes per-account token status and outcome tables.
3. **Given** successful claims, **When** history writing is enabled, **Then** new rows are inserted directly under the markdown table header (newest first).

---

### User Story 3 - Token and secret lifecycle operations (Priority: P3)

As an operator, I can provision/refresh tokens and run the system in GitHub Actions with secret-driven configuration.

**Why this priority**: Keeps scheduled automation operational over time without manual code changes.

**Independent Test**: Can be tested by configuring required secrets and running `Redeem gifts` / `Refresh token` workflows.

**Acceptance Scenarios**:

1. **Given** `STFC_ACCOUNTS` contains valid account JSON, **When** workflows execute, **Then** accounts are parsed and processed.
2. **Given** refresh workflow credentials and PAT are configured, **When** `Refresh token` runs, **Then** a fresh token is captured and merged back into `STFC_ACCOUNTS`.
3. **Given** malformed or missing account configuration, **When** CLI starts, **Then** execution fails with actionable configuration errors.

---

### Edge Cases

- Missing/empty/non-JSON/malformed `STFC_ACCOUNTS`.
- Duplicate account names in `STFC_ACCOUNTS`.
- Token structurally invalid vs. token expired at API auth.
- Upstream non-JSON responses or schema drift.
- HTTP 404 gift-claim response with "Bundle not available" interpreted as already claimed.
- Missing `promo-codes.txt` treated as no promo codes (not a hard failure).
- No gifts newly claimed should not append empty rows to history.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose CLI skills: `run-all`, `check-auth`, `list-gifts`, `claim-gifts`, `redeem-codes`.
- **FR-002**: System MUST load account configuration from `STFC_ACCOUNTS` as a JSON array of `{name, token}` with strict validation and unique account names.
- **FR-003**: System MUST call STFC store API using Bearer auth and perform `auth/me`, gift listing, gift claiming, and promo-code redemption.
- **FR-004**: System MUST classify gift, promo, and auth outcomes using a stable outcome vocabulary (e.g., `CLAIMED`, `TOKEN_EXPIRED`, `CODE_ALREADY_USED`, `UNKNOWN_RESULT`).
- **FR-005**: System MUST continue processing remaining accounts even when a single account has expected account-level failures (e.g., token expired).
- **FR-006**: System MUST treat infrastructure-class failures (e.g., schema mismatch/config errors/uncaught failures) as non-zero process exit.
- **FR-007**: System MUST generate markdown run summaries suitable for GitHub Actions step summaries.
- **FR-008**: System MUST redact JWT/auth secrets from logs, errors, and rendered details.
- **FR-009**: System MUST maintain `docs/redeem-history.md` by inserting new successful-claim rows at the top of the table and skipping empty runs.
- **FR-010**: System MUST provide scheduled GitHub workflows for recurring redemption and weekly token refresh.

### Key Entities *(include if feature involves data)*

- **Account**: Named STFC account with JWT token.
- **Gift**: Store item candidate with identifiers, title/name, and claimability flags.
- **Promo Code**: Plain-text code sourced from `promo-codes.txt`.
- **Outcome**: Normalized result label for token, gift, promo, and transport classifications.
- **Account Report**: Per-account run result including token status, gift outcomes, promo outcomes, and health flag.
- **Run Report**: Full run aggregate containing account reports plus infrastructure errors and derived exit code.

### API Contract *(mandatory for changes touching external integrations)*

**Endpoints touched** (method + path + auth requirement):

- `GET /auth/me` — Bearer `<REDACTED>`
- `GET /offers/gifts?available=true` — Bearer `<REDACTED>`
- `POST /offers/gifts/claim` — Bearer `<REDACTED>`
- `POST /redeem/claim` — Bearer `<REDACTED>`

**Request shape** (sanitized example):

```json
{ "bundleId": 12345 }
```

```json
{ "promo_code": "<CODE>" }
```

**Success response shape** (sanitized example, with HTTP status):

```text
200 OK
```

```json
{ "items": [{ "bundle_id": 12345, "title": "<gift>", "is_claimable": 1 }] }
```

```json
{ "redeem_result": 0, "message": "redeem_success", "promo_code": "<CODE>" }
```

**Error responses** (status code + shape + when emitted):

- `401/403` — treated as token-expired auth rejection.
- `404` on claim with "Bundle not available" text — treated as already claimed.
- `5xx` or network error — treated as transient transport failure.
- `2xx` non-JSON or schema mismatch — treated as schema/infrastructure failure.

**Known edge cases**:

- Field naming drift between snake_case and camelCase across endpoints.
- API responses include extra fields; only consumed fields are required.
- Promo response may use legacy `code` or current `redeem_result`.

**Source of contract** (cite at least one per Principle VIII):

- [x] Captured and encoded behavior in repository tests and schema adapters.
- [x] Measured behavior in existing workflow/runtime code paths.
- [ ] Upstream published API documentation (not relied on in this snapshot).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given valid configuration and reachable upstream API, `run-all` returns exit code `0` and produces per-account outcomes for every configured account.
- **SC-002**: Given malformed `STFC_ACCOUNTS`, startup fails fast with non-zero exit and actionable error text.
- **SC-003**: Given an expired token for one account among many, at least one healthy account still completes processing in the same run.
- **SC-004**: Error messages and summaries do not expose raw JWT tokens or Bearer credential values.

## Assumptions

- STFC web-store API remains reachable at the configured base URL and continues accepting Bearer JWT auth.
- JWT signature verification is delegated to upstream API; local logic only performs structure/expiry introspection.
- Scheduled automation runs in GitHub Actions with required secrets and permissions configured by repository operator.
- Promo code submission is idempotent from the operator perspective (already-used codes are expected outcomes, not fatal errors).
