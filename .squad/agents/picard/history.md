# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.1.0 → v1.2.0 Amendment Cycle (2026-05-08 → 2026-05-09)

**Cycle Summary:**
- **v1.1.0 proposal:** Incorporated Phase 1 briefing feedback from Scotty (trigger threshold, checkpoints), Uhura (artifact hygiene), Bashir (test-first gates), Borg Queen (prerequisites).
- **Blocking defect found:** Principle IV/IX contradiction (Principle IV claims "no automated test suite" while Principle IX mandates tests). Fixed by amending Principle IV rationale to acknowledge Principle IX requirement.
- **v1.2.0 assembly:** Parallel lanes coordinated—Uhura built artifact hygiene scanner, Scotty built npm test gate, Bashir built test-first reviewer gates.
- **Verification cycle:** Borg Queen performed 4 passes; v1.2.0 ratified with Path D acceptance (Known Tensions documented).

**Critical Lesson Learned:** Critique framing matters. "Verify my concerns are defused" (too narrow) vs. "Does every concrete claim match the repository?" (broader, catches inherited baseline overclaims). Full-document verification against live repo code is the distinguishing factor between real governance and hollow process.

**Post-Ratification Roadmap:**
- **Blocking (pre-first-speckit-merge):** Artifact hygiene CI gate (Uhura) + smoke-test runbook (WHO/WHEN/HOW).
- **Within 30 days:** Scope-assessment rubric for "scope creep" gate; adoption meter script for 50% annual review.
- **v1.3.0 cycle:** Resolve 3 Known Tensions (Principle III/IX/VII accuracy issues).

**Status:** v1.2.0 ratified and operational. Constitution is now the source of truth for governance in stfc-gift-redeemer.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
