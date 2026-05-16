# Picard — Lead / Code Review

> Older entries archived to history-archive.md on 2026-05-16.

### BLOCKER Resolution — 001-discord-monitor analyze (2026-05-16)

**Pattern: Constitution-led vs Plan-led BLOCKER resolution.**

When /speckit.analyze surfaces a BLOCKER (artifact inconsistency), there are two resolution paths:
- **Constitution-led (Option A):** Preserve the constitution's wording; amend the plan/contracts/data-model to match.
- **Plan-led (Option B):** Amend the constitution to match the plan's design.

**Decisions on 001-discord-monitor BLOCKERs:**

1. **BLOCKER #1 (suppression.json writer mismatch):** Chose **Option A** — split into operator-written `suppression.json` + skill-written `cooldowns.json`. Reasoning: Preserves Principle V's bright-line separation between policy (operator) and telemetry (skill). The cost is one additional enumeration entry in constitution v1.3.0, which is minimal.

2. **BLOCKER #2 (digest module path mismatch):** Chose **Option A** — moved digest writer from `src/discord/digest.ts` to `src/digest/index.ts`. Reasoning: Matches constitution exactly; the digest is conceptually downstream of Discord (it summarizes redemption activity too), so it belongs in its own module.

**Heuristic for future BLOCKERs:** When the plan's design is logically sound but contradicts the constitution's literal text, prefer the constitution-led fix (Option A) unless the constitution's wording reflects a genuine oversight. This preserves the governance invariant that Principle VI ("Constitution wins") actually means something.

---

### Governance Template Re-sync — plan-template.md P0-1 fix (2026-05-16)

## Learnings

**SIR template re-sync claims must be verified against actual template content, not just structural change.**

When a constitution amendment's Sync Impact Report (SIR) concludes "Templates needing re-sync: NONE" on the basis that no principles were renamed/added/removed, that structural argument does not cover *content drift* — a template row that made a factual claim about durable inputs was silently superseded by the very enumeration the amendment added. Takeaway: any SIR re-sync verdict must include a literal grep/search of template content for load-bearing claims, not just a structural diff of principle headings.
