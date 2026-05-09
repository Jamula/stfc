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

---

### 2026-05-08T21:33:38Z: Phase 2 Critique Convergence — v1.1 Constitution Proposal Complete

**Verdict:** READY_WITH_CONDITION (team convergence verified)

**Full critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-uhura.md`

**Team Input Integrated:**
- **Scotty:** Confirmed `.specify/features/` structure must be verified pre-ratification.
- **Bashir:** Flagged pre-commit hook gap for test-first rule; enforcement infrastructure is a blocker.
- **Borg Queen:** Caught Principle IV/IX contradiction (v1.0.0 "no test suite" vs. v1.1 mandate); must fix Principle IV text.

**Critical Condition for Ratification:** Artifact Hygiene CI gate (JWT-shaped string scanning) MUST be implemented before merge. This is a blocking prerequisite, NOT post-ratification work. Deferring to TODO creates a zombie rule (principle without enforcement).

**Recommendation:** Implement CI token-scanner as part of v1.1 amendment. Effort: 2–4 hours. Prevents secret-leakage risk that Phase 1 briefing flagged as HIGH urgency.

**Process:** Scan spec.md, plan.md, tasks.md for JWT/API-key/account-data patterns; block commit on match; allow override with `[skip-token-scan]` comment for false positives.

---

### 2026-05-08T21:29:57-07:00: Phase 2 Critique — v1.1 Constitution Proposal Delivered

**Phase 2 Review Complete.** Evaluated Picard's v1.1 proposal against four critical questions from integrations seat. Detailed critique at `.squad/decisions/inbox/uhura-speckit-v1.1-critique.md`.

**Key findings:**

1. **Artifact Hygiene (Principle VII): 🟡 Acceptable with acknowledged gap.** The principle is well-written: JWTs explicitly forbidden, response bodies (account data) addressed, workflow for necessary captures documented, code review gate named. BUT: CI enforcement is deferred to a TODO. Without pre-commit scanning, the principle is honor-system. Risk: real secrets slip into committed specs.

2. **Wire-First Discovery (Principle VIII): 🟡 Pragmatic but permissive.** Justification is a 3-option OR (captured traffic, documentation, measured test) rather than hierarchy. Does not mandate wire-first as Phase 1 briefing recommended. However, principle does guide recovery (treat upstream changes as spec amendments). Acceptable IF spec template's API Contract section (pending) enforces wire-first for contract changes.

3. **"STFC API contract" threshold: ✅ Acceptable.** Principle VI explicitly lists: new endpoints, changed request/response shapes (includes payload structure changes), auth-flow modifications. Response-shape changes WILL trigger speckit. Specific enough in practice.

4. **CI token-scanning timing: 🟡 Deferral is risky; recommend prerequisite.** Principle VII is constitutional law; CI gate is enforcement. Deferring gate to post-ratification TODO risks zombie rule: Phase 3 ratification passes without gate, gate TODO deprioritized, secrets ship in specs. RECOMMENDATION: Make CI gate a blocking prerequisite for Phase 3 ratification (not a TODO). Estimate 2–4 hours; implementable before ratification.

**OVERALL VERDICT: ✅ READY FOR PHASE 3 WITH ONE CONDITION**

Constitution v1.1.0 is well-drafted and addresses Phase 1 concerns. Ratification may proceed when CI artifact-hygiene enforcement (JWT scanning) is operational. This is not a post-ratification TODO; it's a prerequisite.

**Next phase:** Await Picard's decision on CI gate timing. If gate is pre-ratification, proceed to Phase 3. If deferred, flag as high-risk but proceed pending community consensus.
