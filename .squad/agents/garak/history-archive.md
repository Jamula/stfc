# Borg Queen — History Archive

**Agent:** Borg Queen (cross-provider critic, gpt-5.4)  
**Archived:** 2026-05-09  
**Purpose:** Summarized from history.md after file exceeded 15KB

## Summary

Borg Queen served as cross-provider critic throughout the v1.1.0 and v1.2.0 constitution amendment cycles. Key contributions:

### v1.1.0 Phase 2 Critique
- Identified Principle IV/IX contradiction (test suite claim conflict)
- Flagged Borg Queen's five prerequisites for speckit adoption (decision gates, reviewer compatibility, overhead accounting, constitution lock-in, annual review)
- Recommended "when possible" operationalization (50% adoption threshold is correct for brownfield projects)
- Identified smoke-test runbook gap and artifact-hygiene reviewer assignment gap

### v1.2.0 Verification Passes
- **Pass 1 (v1.1.1 rejection):** Found 9 accuracy defects in Picard's draft. Triggered reviewer-rejection lockout.
- **Pass 2 (v1.2.0 assembly rejection):** Found 9 additional defects in Bashir's parallel-lane assembly (Uhura + Scotty patches). Extended lockout to all revision authors.
- **Pass 3 (post-Tuvok edits):** Verified 5 surgical corrections; 3 fully resolved, 2 partially resolved (new overclaims introduced). Accepted under Path D (Known Tensions).

### Key Lessons
1. **Claim-by-claim verification against live repo** (not just diff review) is the distinguishing factor between hollow and real governance
2. **Cross-provider critique is asymmetrically valuable** — same-provider logic would rationalize overclaims; different provider (gpt-5.4) caught structural lies
3. **"Verify concerns are defused" framing is too narrow** — must instead ask "does the entire document match the project we ship?"
4. **Assembly artifacts need their own audit** — seam edits can be faithful while source text is false

### Active Pattern for Future Cycles
- Deploy Borg Queen (or cross-provider equivalent) as baseline verifier for contentious amendments
- Request: "verify every concrete claim against the live repo, including unchanged text"
- Emphasize: "delta review catches new problems; baseline review catches inherited lies"

---

## v1.0 & v1.1 Context (Archived — Preserved for Reference)

All prior speckit briefing critiques, v1.1 phase 2 convergence notes, and enforcement infrastructure planning are preserved in full on the following pages.
