# Contaminated Spec Sample — Artifact Hygiene Fixture
#
# This file is a FAIL fixture for the artifact hygiene scanner.
# It contains OBVIOUSLY FAKE tokens (labeled as such) that are structured to
# trigger each scanner pattern. Use this file to verify the scanner is working.
#
# ALL VALUES BELOW ARE FABRICATED AND NON-FUNCTIONAL. No real tokens here.
#
# Scanner: node scripts/check-artifact-hygiene.mjs tests/fixtures/artifact-hygiene/contaminated-spec.md
# Expected exit code: 1 (violations found — this is the correct/intended result)
# Expected violations: 6 (one per FAIL CASE below)

---

## FAIL CASE 1 — JWT token (pattern: JWT)
#
# A real JWT pasted into a spec. Should be replaced with <REDACTED>.
# Fake token below — not a real JWT; triggers the eyJ...segment regex only.

Captured session token: eyJfaketoken1A.fakepayload12.fakesig12345

---

## FAIL CASE 2 — Authorization: Bearer header (pattern: BEARER_TOKEN)
#
# A request header with a bearer token value that is not a placeholder.
# This pattern catches raw HTTP captures copy-pasted into specs.

Authorization: Bearer fakeTokenString123456789abcdefghijk

---

## FAIL CASE 3 — GitHub personal access token (pattern: GITHUB_TOKEN)
#
# A GitHub token accidentally included in a spec for "example" purposes.
# 36 chars after ghp_ — completely fabricated, fails any GitHub API call.

ghp_AbcdefghijklmnopqrstuvwxyzABCD012345

---

## FAIL CASE 4 — AWS Access Key ID (pattern: AWS_ACCESS_KEY)
#
# An AWS key ID pasted into infrastructure documentation.
# Pattern: AKIA followed by exactly 16 uppercase alphanumeric chars.
# Value below is nonsense and non-functional.

AKIAFAKEAWSACCESSKEY

---

## FAIL CASE 5 — Generic API key assignment (pattern: API_KEY)
#
# An api_key field with a long alphanumeric value rather than a placeholder.
# Appears in YAML configs or JSON examples pasted into specs.

api_key: "fakeApiKey1234567890abcdefghij"

---

## FAIL CASE 6 — STFC account data with numeric values (pattern: STFC_ACCOUNT_DATA)
#
# Raw API response body pasted into a spec with real-looking numeric IDs.
# Values > 999 in account_id / alliance_id / balance fields trigger this pattern.
# Use "<REDACTED>" string placeholders instead of numeric IDs.

```json
{
  "account_id": 987654321,
  "alliance_id": 12345,
  "balance": 50000
}
```
