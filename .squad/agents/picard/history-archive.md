# Picard — Lead / Code Review (Archive)

Condensed history of learnings from 2026-05-16 through 2026-05-18, pre-archival.

## Learnings Summary

### Governance Template Re-sync — plan-template.md P0-1 fix (2026-05-16)
SIR template re-sync claims must be verified by literal grep/search of template content, not just structural change analysis.

### PR #6 supersession + owner-bypass merge (2026-05-17)
- Always `gh pr diff <N> --name-only` before forming verdict
- "action_required" with `jobs: []` is a manual-approval gate, not test failure
- CLOSE-without-merge is a legitimate fourth verdict
- Owner-bypass merges need paper trail on governance amendments
- Mixed-scope PR descriptions should derive from `gh pr diff --stat`, not PR body

**Skill registered:** `.squad/skills/superseded-pr-detection/SKILL.md`

### Learnings — Triage-bot overcorrection re-triage (2026-05-17)
- Triage-bot default to `squad:bashir` had ~1-in-11 signal-to-noise; verify by spot-reading
- Route by artifact (file/dir path), not keyword matching
- "Documented in CLAUDE.md" ≠ "done" — automated enforcement required
- Parallel `gh issue edit` + `gh issue comment` is faster than one-per-issue

### Squad self-test epic batch, #24–#32 (2026-05-17)
- "Self-test" is a per-role taxonomy, not a uniform surface
- Ralph is load-bearing exception (pure monitor, not LLM-driven)
- File separately + link when issues share substrate but differ in consumer/cadence
- Bulk filing via bash helper is much faster than individual `gh issue create` calls
- Missing `squad:scribe` label was silent gap — verify labels on new roster member
- Skill registered: `.squad/skills/agent-self-test/SKILL.md`

### Squad audit R1–R16 review + filing (2026-05-18)
- Batch by *decision*, not *recommendation* (e.g., R7+R11+R13 → one issue)
- "Warm seat with zero output" needs forced choice (activation OR retirement)
- Reject taxonomy invention (R15 D-NNN scheme — don't invent until load-bearing)
- Audits surface blind spots; re-frame soft-pedaled risk findings as governance gates
- "Suggested GitHub Issues" table is suggestion, not spec — compress by clustering decisions

### Audit-resolution dispatch — O'Brien hired, @copilot activated (2026-05-18)
- Name role for function, not authority (O'Brien = working-class fixer, not seat-at-table)
- Consolidate convergent recommendations under one charter, not three half-roles
- @copilot activation needs written tier profile, not vibe
- Registry hygiene IS real even when nothing broken; use `legacy_named: true` for utility roles
- Garak hard-gate codification: verdict greppability > ceremony (use `**APPROVE** ✅` header)

## Decisions

Full decision memos in `.squad/decisions.md`:
- `picard-squad-audit-review-2026-05-18.md`
- `picard-audit-resolution-2026-05-18.md`
