# Research Agent (Officer DB) Orchestration Log — 2026-05-31T20:10:41Z

**Status:** Idle (completed earlier in session)

**Constraint:** No write tools available; Coordinator salvaged memo to `.squad/decisions/inbox/` for Scribe merge.

**Work Summary:**
Officer DB seeding research for crew optimizer v1. Evaluated four data sources:
- Option A (RECOMMENDED): Hand-curate ~35–40 officers from `docs/stfc-game-knowledge.md` + community fringe officers. 1–2 days effort, zero licensing risk, covers all synergy groups.
- Option B: Blocked (stfc.space scrape — no API, high licensing risk).
- Option C: Blocked (official STFC DB — gated + Scopely TOS prohibits scraping).
- Option D: Reference only — use community sources for manual authoring, not bulk copy.

**Recommendation:** Use Option A for v1; plan v1.x outreach to STFC Officer Tool Discord #data-collection for licensed snapshot.

**Deliverable:** Merged into `.squad/decisions.md` by Scribe.

**Next:** Picard can now finalize clarification phase with this research data.
