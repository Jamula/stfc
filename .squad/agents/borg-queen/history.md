# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Speckit Adoption Context (2026-05-08)

1. **Project is maintenance-mode:** STFC Gift Redeemer is a feature-complete 4-hour cron orchestrator. ~90% of PRs are maintenance (bug fixes, selector improvements, dependency updates). Only ~5% are "non-trivial features" that warrant spec-driven flow.

2. **Governance assumes human authorship:** Constitution requires manual smoke-test against live STFC store for all automation/auth/selector changes. Speckit agents cannot do this. Conflict: agent implementation + human verification gate = friction and silently abandoned adoption.

3. **"When possible" needs decision gates:** Without explicit criteria (e.g., "speckit for features >100 LOC, architecture changes, new platforms"), teams will interpret it as "when convenient" and skip it for maintenance. Process becomes theatre by month 3.

4. **Overhead ratio is unfavorable:** Spec/plan/tasks overhead (4–7 hours) exceeds implementation time (1–2 hours) for most changes in a stable project. Teams will route around speckit to optimize speed.

5. **Annual review lock-in prevents zombie processes:** Constitution should require annual validation that adoption >50% or governance is amended. Without this, outdated process docs erode trust.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Borg Queen's key contribution:** Adversarial review identified 3 unstated assumptions and 3 failure modes. Proposed 5 prerequisites: (1) Decision gates — clarify which work requires speckit, (2) Reviewer compatibility — clarify agent + manual verification interaction, (3) Overhead accounting — track spec/plan/tasks time vs. implementation, (4) Constitution lock-in — annual process review, (5) Acknowledge project stability — most PRs are maintenance.

**Cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.
- **Picard coordinating amendment:** Will incorporate Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

**Critical finding:** Without Borg Queen's prerequisites, adoption will be abandoned theatre in 6 months (40% likelihood overhead killed adoption, 30% likelihood reviewer rejection loop).

**Status:** Phase 1 (Briefing) complete. Phase 2 pending: Picard drafts constitutional amendment v1.1 with ALL inputs incorporated.
