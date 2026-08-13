# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-26

Initial tagged release of the STFC gift redeemer.

### Added

- Scheduled, headless redemption of Star Trek Fleet Command web-store gifts and
  promo codes, runnable as a GitHub Action (`run-all` orchestrator).
- Per-account orchestration that validates each JWT, claims every claimable
  gift, redeems every active promo code, and classifies each outcome.
- Exit-code contract surfaced to CI: `0` for ok/partial success, `1` for
  infrastructure errors, and `2` when every account token is expired
  ("secret rotation needed" alarm).
- Dead promo-code cache (`data/promo-code-dead.json`) so known-invalid codes are
  skipped on subsequent runs.
- Auto-appended redeem history (`docs/redeem-history.md`) recording every
  successful claim.
- Weekly token refresh workflow that re-captures the store JWT via Playwright
  and updates the `STFC_ACCOUNTS` secret.
- Additional skills: `check-auth`, `list-gifts`, `claim-gifts`, `redeem-codes`,
  `discord-monitor`, `roster`, `optimize-crew`, `progression`, and `telemetry`.

[1.0.0]: https://github.com/Jamula/stfc/releases/tag/v1.0.0
