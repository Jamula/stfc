# Picard History Archive

> This archive contains summarized learnings from sessions prior to 2026-05-31 or superseded by more recent entries.
> See `history.md` for current session and recent learnings.

## 2026-05-08 through 2026-05-30 (Historical Summary)

**Pre-May-31 learnings:** 20+ learnings on governance template sync (Rule 1), superseded-PR detection (Rule 7), triage-bot patterns, self-test taxonomy, audit compression heuristics, "ping on idle" pattern for cross-agent coordination, decision-memo deduplication, and reviewer-verdict greppability conventions.

**Key repeating patterns:**
- When constitution clauses assert a property at BOTH the module level AND the secret level, the secret-level binding wins (not module-routable).
- Pinning-test SIRs MUST avoid literal path strings mentioned in `indexOf()` style assertions elsewhere.
- Mid-flight user directives that strengthen an existing pattern are cheaper to fold into an open PR than to file as follow-up issues.

**Completed deliverables:** PR #71 discord-ops automation (merged), PR #74 community-sheet ingest (open), PR #75 sheet ingestion (open, awaiting merge), decision governance on lineage tracking (retroactive + forward directive). All phase-boundary commits recorded.

**Status at end of prior session:** Awaiting triage on Issue #76 Discord channel ingest (blocked on bot guild invite).

