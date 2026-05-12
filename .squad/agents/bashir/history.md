# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — Test-First Proof Workflow (2026-05-08)

**Implementation completed:** Built test-first proof workflow to enforce Principle IX and close the honor-system gap around optional test tasks.

**Three reviewer gates established:**
1. **Specification review gate:** Scope, acceptance criteria, and risk boundaries verified before planning begins.
2. **Tasks review gate:** All acceptance criteria have corresponding test tasks (no optional tests; no untested flows).
3. **Implementation review gate:** All acceptance criteria have passing test artifacts (unit + integration tests required before merge).

**Test quality checklist:** Template created for test-first discipline, ensuring:
- No untested code paths
- Tests are written and passing before implementation
- Acceptance criteria have clear, verifiable test coverage

**Coordination:** Parallel work with Scotty (npm test enforcement) ensures tests are gated both at CI (npm test must pass) and at code review (tests must exist).

**Status:** Integrated into Constitution Principle IX with reviewer-gate enforcement. Closes the gap between "tests are mandatory" policy and "tests are optional in templates" footgun.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
