# Clean Spec Sample — Artifact Hygiene Fixture
#
# This file is a PASS fixture for the artifact hygiene scanner.
# It demonstrates correct use of <REDACTED> placeholders in spec files.
# Scanner: node scripts/check-artifact-hygiene.ts tests/fixtures/artifact-hygiene/clean-spec.md
# Expected exit code: 0 (no violations)

## API Contract

### Authentication

All requests require a JWT bearer token obtained via the STFC store login flow.
Captured tokens belong to the user and MUST NOT be committed to the repository.

Request header: `Authorization: Bearer <REDACTED>`

Token shape: a 3-segment base64url JWT — `<header>.<payload>.<signature>`
Expiry: typically 1 hour from issue time (verify against `exp` claim at runtime).

### Gift List — Sanitized Response Shape

The following shows the *structure* of a successful gift-list response.
All real values are replaced with typed placeholders. No live account data below.

```json
{
  "account_id": "<REDACTED>",
  "alliance_id": "<REDACTED>",
  "balance": 0,
  "gifts": [
    {
      "id": "<REDACTED>",
      "name": "Example Gift Name",
      "type": "resource",
      "claimed": false
    }
  ]
}
```

### Claim Gift — Sanitized Response Shape

```json
{
  "success": true,
  "gift_id": "<REDACTED>",
  "message": "Gift claimed successfully."
}
```

### Error Responses

| HTTP Status | Meaning                          | App action            |
|-------------|----------------------------------|-----------------------|
| 401         | Token expired or invalid         | Surface token-refresh |
| 403         | Account suspended                | Surface error to user |
| 429         | Rate limited                     | Exponential back-off  |
| 5xx         | Upstream server error            | Retry with back-off   |

### Notes

- Rate limit: unknown; treat any 429 as a hard stop for the current run.
- Token refresh: not available via API; user must re-run `npm run capture-token`.
- See `src/api/client.ts` for the typed request/response shapes consumed by production code.
