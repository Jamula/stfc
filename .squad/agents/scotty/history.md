# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — npm test Enforcement Gate (2026-05-08)

**Implementation completed:** Built `npm test` CI enforcement gate to operationalize Principle IX (tests are not optional; `npm test` MUST pass before any commit).

**Trigger and Scope:**
- Workflow: `.github/workflows/squad-test-enforcement.yml`
- Triggered on: All pull requests touching `src/`, `tests/`, package.json, or tsconfig.json
- Enforcement: PR cannot merge until all tests pass in CI

**Coordination with Bashir:** Bashir's reviewer gates (spec review, tasks review, implementation review) complement this CI gate. Tests must exist (Bashir's gates) AND pass (Scotty's CI gate).

**Design Pragmatism:** "Trigger Threshold" (speckit for >4-hour work, multi-file changes, architectural decisions) calibrated to maintenance-heavy project. Exemptions cover 70–80% of actual PR mix (bumps, single-file fixes, docs).

**Post-Ratification Commitment:** Pre-commit hook optional but recommended (Bashir to advise if simple-git-hooks or husky are preferred).

**Status:** Deployed and operational. npm test is gated at both code-review and CI layers.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
