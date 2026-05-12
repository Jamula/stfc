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

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
