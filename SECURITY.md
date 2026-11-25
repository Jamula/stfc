# Security Policy

## Supported versions

Security fixes are applied on `main` against the current **`0.1.0`** product
baseline (see [CHANGELOG.md](CHANGELOG.md)). An earlier `v1.0.0` GitHub Release
tag predates the 2026-11-08 reset to `0.1.0` and is retained for history only;
reproduce suspected issues on current `main` or `v0.1.0` before reporting.

| Version | Supported |
| --- | --- |
| `main` / `0.1.0` (current MVP baseline) | Yes |
| `v1.0.0` (historical pre-reset tag) | No |

## Reporting a vulnerability

Please check the repository's **Security** tab for **Report a vulnerability**
and submit a private GitHub Security Advisory when available. If private
reporting is unavailable, contact the maintainers to request a private channel
before sharing technical details. **Never disclose a suspected vulnerability in
a public issue, discussion, or pull request.**

Maintainers will review the report, follow up through GitHub's private
advisory process, and coordinate remediation and disclosure with the reporter.
There is no fixed response-time commitment.

## Credential and account-data handling

- **Never include live secrets in reports, issues, or PRs.** Redact STFC bearer
  JWTs, Scopely sign-in codes/OTPs, Discord bot or webhook tokens, Cloudflare or
  Azure credentials, and raw player/account identifiers.
- **Rotate exposed credentials immediately.** If a live token or key has been
  committed or pasted anywhere, revoke or replace it in the upstream service
  first; rewriting Git history alone does not invalidate an exposed secret.
- **Automated hygiene checks are defense-in-depth.** Pre-commit checks and
  `.github/workflows/artifact-hygiene.yml` scan for common secret and account
  patterns, and hosted workflows use GitHub OIDC against private Azure Blob
  Storage rather than echoing tokens in logs, but operators remain responsible
  for keeping `.env` files and live session artifacts local.
