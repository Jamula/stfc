# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — Artifact Hygiene Enforcement (2026-05-08)

**Implementation completed:** Built cross-platform artifact hygiene scanner to enforce Principle VII (no real tokens/account data in committed artifacts).

**Components delivered:**
1. `scripts/check-artifact-hygiene.mjs` — Node.js scanner (Windows + Linux compatible); detects 6 token patterns (JWT, BEARER_TOKEN, GITHUB_TOKEN, AWS_ACCESS_KEY, API_KEY, STFC_ACCOUNT_DATA).
2. `.github/workflows/squad-artifact-hygiene.yml` — CI gate triggered on PR touching specs/plans/tasks/docs.
3. Test fixtures: `clean-spec.md` (PASS) and `contaminated-spec.md` (FAIL with 6 labeled patterns).
4. Coordination note for Scotty on `npm test` integration.

**Verification:** Each pattern cross-checked against live code. All patterns correctly redact matched content to `<REDACTED-TOKEN>`.

**Status:** Ready for ratification and pre-commit hook integration.

### Post-Ratification Commitment

High urgency: CI token-scanner must be deployed before first speckit spec merge (blocking prerequisite per Borg Queen's v1.2.0 audit). Secret-leakage risk is constitutional violation if unmitigated.

---

### Workflow cron edits — operating reminders (2026-05-17)

Captured while fixing Issue #14 (`refresh-token.yml` → Saturday 00:00 UTC,
PR #20):

- **GitHub Actions cron DOW field:** `MIN HOUR DOM MONTH DOW`, where DOW
  uses `0=Sunday` and `6=Saturday`. So `0 0 * * 6` is every Saturday at
  00:00 UTC. Easy to flip these by mistake — always state the cadence
  in plain English in the PR body so reviewers don't have to look it up.
- **Same-commit pinning-test rule (repo Rule 3):** *Before* committing
  any `.github/workflows/*.yml` edit, run `grep -rn '<workflow-file>'
  tests/`. If anything pins a literal cron / group / permission, it
  MUST be updated in the same commit. For #14 the grep was empty, so
  the PR is a one-file diff — call that out explicitly in the PR body
  so reviewers know it wasn't an oversight.
- **PR-without-draft norm for small workflow tweaks:** Single-file
  workflow diffs with passing tests should ship as normal PRs (not
  drafts). Cyrus prefers the lower-friction path when the blast radius
  is one cron line.
- **Concurrency-group awareness:** `refresh-token.yml`, `redeem.yml`,
  and the incoming `discord-monitor.yml` all share
  `concurrency.group: stfc-gift-redeemer`. Any cron move needs to call
  out the queue/cancel interaction in a comment so future readers
  understand why a scheduled-redeem run might be skipped that hour.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
