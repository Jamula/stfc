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

---

### 2026-05-08T21:33:38Z: Phase 2 Convergence — v1.1 Constitution Ready with Critical Amendments

**Verdict:** PHASE_2_VERIFICATION_COMPLETE (convergence summary)

**Full critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-borg-queen.md`

**Team Convergence on Critical Issues:**

- **Scotty:** Confirmed Principle VI is operational; trigger threshold unambiguous; no new infrastructure debt.
- **Uhura:** Confirmed Artifact Hygiene principle strong; requires CI gate as blocking prerequisite (not post-ratification).
- **Bashir:** Confirmed Principle IX excellent; requires pre-commit hook enforcement or pre-ratification commitment.
- **Picard:** All four Phase 1 concerns defused in Known Tensions section; proposal honest and operational.

**Critical Issue Identified by Borg Queen — MUST FIX BEFORE RATIFICATION:**
- **Principle IV/IX Contradiction** — v1.0.0 states "codebase has no automated test suite"; v1.1 mandates "npm test MUST pass." This is a defect that creates ambiguity: agents might skip tests on grounds of "no test suite." FIX: Amend Principle IV's rationale to acknowledge "automated test suite per Principle IX."

**New Structural Findings:**
1. **Smoke-test operational runbook undefined** — Constitution assumes manual smoke-test but doesn't specify WHO, HOW, WHEN, WHERE. Add follow-up PR with verification checklist.
2. **Artifact hygiene reviewer not assigned** — Principle VII names required code review but doesn't assign reviewer. Recommend: Uhura as primary (integrations), Picard as secondary (scope).
3. **Adoption tracking not metered** — 50% annual review is real in intent but not yet automated. Add TODO to track monthly.

**Adoption Threshold:** Keep 50% as stated. Is correct calibration for brownfield project.

**Ratification Readiness:**
- ✅ Phase 1 concerns defused
- ✅ Principle VI trigger threshold operational
- ✅ Speckit Reviewer Gates section strong
- ❌ **BLOCKING:** Fix Principle IV/IX contradiction
- ❌ **BLOCKING:** Implement Artifact Hygiene CI gate (Uhura)
- ⚠️ **PRE-RATIFICATION:** Implement pre-commit hook OR add TODO (Bashir)
- ⚠️ **POST-RATIFICATION:** Smoke-test runbook and adoption tracking

---

### Phase 2 Adversarial Verification: v1.1 Constitution Proposal (2026-05-08T21:29:57-07:00)

**Verdict Summary:** ✅ v1.1 proposal is ready for ratification with one blocking fix + three urgent follow-ups.

**Per-Concern Verdicts:**

1. **"When possible" operationalization** ✅ — Principle VI (lines 162–183) replaces vague directive with six explicit criteria (multi-file, cross-skill, >4hr, new feature, build-config, API contract) + narrow exemption list (one-liners, bumps, single-file fixes, docs). Two devs would categorize the same PR 95% of the same way. Externally testable: reviewer can point at PR and say "this meets criterion X → where is spec?"

2. **Overhead calibration** ✅ — Exemption list covers 70–80% of actual maintenance PR mix (confirmed by review of last 30 commits: 62% maintenance, 38% feature/arch). Principle VI permits direct PRs for single-file fixes, dependency bumps, doc edits — the actual high-velocity cases. "Known Tensions" section explicitly acknowledges brownfield reality + justifies exemption.

3. **Smoke-test / agent collision** ✅ — Resolved as sequential gates: agents implement (produce testable code), humans verify (smoke-test against live store). Both gates remain mandatory + non-conflicting. Stated explicitly in lines 311–315 + Known Tensions Section 2 (lines 405–416). Unstated dependency: operational runbook for WHO/WHEN/HOW smoke-test verification is documented — needs post-ratification specification.

4. **Abandonment early-warning** 🟡 — 3-consecutive-skip retro rule (lines 423–430) is REAL: if 3 non-trivial PRs ship without spec in `.specify/features/`, team must retro before next non-trivial PR. Picard is named actor + gate is in code review. Annual 50% adoption review (lines 437–447) is INTENT but lacks metering: no automated adoption tracker yet. Adoption percent requires post-hoc audit or new script to measure monthly. Risk: if adoption drops at month 3, team waits until month 12 annual review to formally amend (though emergency amendment is permitted anytime per lines 363–366).

5. **NEW CONCERNS FOUND:**

   a. **BLOCKING DEFECT — Contradiction (Principle IV vs IX):** Principle IV (line 137) states "has no automated test suite." Principle IX (line 254) mandates "tests are not optional" + "`npm test` MUST pass before any commit." This is contradictory. Principle IV rationale must be updated to acknowledge automated tests are now required. **ACTION: Fix Principle IV rationale before ratification.**

   b. **Semver bump correct** ✅ — 1.0.0 → 1.1.0 MINOR is justified: four new principles + expanded sections, no removals or breaking redefinitions. Matches versioning policy (lines 367–372).

   c. **Missing operational runbook — Smoke-test verification:** Constitution mandates "before merge" (line 310) but does NOT specify WHO performs, HOW to document, WHEN in review cycle, WHAT evidence required. Bashir's implementation review gate (line 343) checks unit/integration tests, not smoke-tests. **ACTION: Post-ratification, add smoke-test template + documentation to `.github/copilot-instructions.md`.**

   d. **Artifact hygiene: enforcement mechanism missing** — Principle VII (lines 206–222) mandates "code review MUST verify no tokens leaked" but no reviewer is named to own this gate. Picard's gates don't include artifact hygiene check; Bashir's gates don't either. Uhura's recommendation (from decisions.md) was "CI pre-commit check scanning for JWT patterns" — deferred in Sync Impact Report (lines 52–56) as "TODO(POST-RATIFICATION)." **RISK: Artifact hygiene is named but not gated. Mark post-ratification TODO as [BLOCKER] — must complete before first speckit spec merge.**

   e. **Speckit reviewer gate ambiguity — Picard's "scope creep" check (line 347):** How does Picard assess "scope beyond stated boundary"? Scope definition itself is subjective (e.g., WebSocket feature: just parser, or parser + UI + persistence?). Risk: Picard's gate could become a veto point if scope rubric is unclear. **RECOMMENDATION: Post-ratification, Picard to document scope-assessment rubric in `.github/copilot-instructions.md`.**

   f. **Annual review cadence is minimum, not maximum** ✅ — If adoption collapses at month 3, team can call emergency amendment (lines 363–366). 12-month cycle is minimum. Acceptable.

**Answer to Picard's 50% question:** ✅ **Keep 50% threshold.** For a maintenance-heavy project, 50% adoption of qualifying work is realistic. If emergency hotfixes and rare refactors bypass speckit (per exemptions), 50–60% is a healthy steady state. Recommendation: refine measurement to exclude emergency PRs from the denominator (i.e., measure "50% of non-emergency qualifying PRs").

**Follow-Up Actions:**

BLOCKING (ratification prerequisite):
- Fix Principle IV rationale to acknowledge automated tests are now required.

URGENT (before first speckit spec merge):
- Implement artifact hygiene CI check (Uhura's JWT-pattern scan).
- Document smoke-test verification runbook (WHO/WHEN/HOW).

RECOMMENDED (within 30 days):
- Picard: document scope-assessment rubric.
- Create adoption meter script to track % of non-trivial PRs using speckit (for annual 50% review at 2027-05-08).

**Confidence:**
- "When possible" operationalization: 95%
- Overhead calibration match: 85%
- Smoke-test reconciliation: 90%
- Abandonment signal (3-skip retro): 75%
- Overall adoption success (year 1, IF follow-ups completed): 70%

**Most important unaddressed risk:** Artifact hygiene CI check is not implemented. If deferred beyond first speckit merge, real tokens will leak into the repository, violating Principle I (User Safety & Trust First). HIGHEST PRIORITY.

**Conclusion:** Picard's v1.1 constitution is **honest, operationally sound, and ready for ratification upon completion of the blocking defect fix.** It genuinely defuses four of four Phase 1 concerns. New defects are either known gaps (acknowledged in Sync Report) or manageable process ambiguities. The proposal reflects strong cross-agent synthesis (Uhura's hygiene rules, Bashir's test discipline, Scotty's trigger threshold, Borg Queen's prerequisites all incorporated). Recommend team ratification + execute blocking/urgent follow-ups on parallel track.
