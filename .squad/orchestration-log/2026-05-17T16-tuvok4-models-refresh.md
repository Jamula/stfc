# Tuvok Session 4 — docs/models.md Refresh + Config Overrides

**Date:** 2026-05-17T~16:00Z
**Agent:** Tuvok (Process Auditor / Editorial Specialist)
**Work:** docs/models.md refresh (195 → 264 lines) + model override decisions + governance drift issue

## Summary

- Refreshed docs/models.md: added opus-4.7 family + gpt-5.5, restructured per-member rationale, surfaced 2 anomalies
- Anomaly 1: `squad.agent.md` references 6 obsolete model IDs, missing opus-4.7 → filed issue #21 (governance PR, maintainer scope)
- Anomaly 2: Scotty's gpt-5.5 config override had no decisions.md anchor → escalated for Cyrus decision
- Applied Cyrus decisions: Uhura opus-4.7-1m → sonnet-4.6; Scotty gpt-5.5 → gpt-5.3-codex; Garak + new gpt-5.5; Kirk rule documented in #21
- Config changes: .squad/config.json (3 edits); issue #21 filed

**Deliverables:** docs/models.md refresh (uncommitted), .squad/config.json updates, issue #21
