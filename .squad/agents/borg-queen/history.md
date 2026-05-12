# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Key Insights from Constitution v1.2.0 Cycle (2026-05-08 → 2026-05-09)

**Cross-Provider Critique Effectiveness:** Borg Queen (gpt-5.4) performed 4 verification passes on the v1.2.0 amendment cycle, finding structural claims that same-provider reviewers would likely rationalize internally. Key finding: claim-by-claim verification against live repo code (not just the diff) is the distinguishing factor between hollow governance and real governance.

**Ratification Outcome:** v1.2.0 ratified with Known Tensions (Path D acceptance). 3 known defects acknowledged in Known Tensions section (Principle III auth/me failure taxonomy, Principle VII .github/ scan path, redeem/refresh concurrency lock) scheduled for v1.3.0 resolution.

**Reviewer-Lockout Pattern:** Cycle-scoped lockout (applies to all authors) resets for v1.3.0. Recommended approach: Same cross-provider critic (Borg Queen) for consistency in future cycles.

**Core Learning:** Critique framing matters. "Did this amendment defuse my concerns?" is weaker than "Does every concrete claim match the repository?" The latter catches inherited baseline text overclaiming and structural lies that delta-focused review misses.

### Post-Ratification Backlog (v1.3.0)

- **Known Tension 1:** Principle III overstates which per-account `auth/me` failures stay non-fatal.
- **Known Tension 2:** Principle VII/Security overclaim `.github/` scan coverage in PRs vs. workflow trigger scope.
- **Known Tension 3:** Redeem/refresh concurrency lock is un-principled (enforced via shared `concurrency.group` but not stated in any principle).

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
