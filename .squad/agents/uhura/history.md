# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### 2026-05-08: Spec Kit & API Integration Briefing

- **Spec-first model fits external API work (7/10 fit).** The spec-template naturally accommodates API flows, acceptance criteria, technical context, and functional requirements. However, it needs explicit additions: (1) API Contract sections (request/response shapes, HTTP codes, error modes), (2) edge case handling for network failures and upstream changes.
  
- **Biggest speckit risk for integrations: secret leakage into artifacts.** Specs, plans, and tasks get committed to feature branches. Developers might paste real JWTs or captured account data into examples. **Fix: Constitutional principle + pre-commit CI check to reject tokens/account-data in artifacts.**
  
- **Wire-first discovery must be a constitutional principle.** The STFC store is third-party and unversioned. Our code must be driven by captured traffic, not assumptions. When the store changes and breaks us, that's a spec amendment, not a bug.
  
- **Recommended constitutional additions: Principle VI (Artifact Hygiene) + Principle VII (Wire-First Discovery).** These codify safe handling of secrets during development and reinforce defensive coding for upstream changes.
  
- **CI gate needed: scan spec.md, plan.md, tasks.md for JWT-shaped strings before merge.** This is a governance problem, not a speckit design problem.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Uhura's key contribution:** Flagged secret-leakage risk (tokens/account-data in artifacts) as HIGH urgency. Proposed Constitutional Principle VI (Artifact Hygiene) + Principle VII (Wire-First Discovery). Essential blocker for speckit adoption.

**Cross-cutting themes:**
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates. Agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.
- **Picard coordinating amendment:** Will incorporate Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

**Status:** Phase 1 (Briefing) complete. Phase 2 pending: Picard drafts constitutional amendment v1.1 with Sync Impact Report.
