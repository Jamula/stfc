# Tuvok — Process Auditor / Editorial Specialist (Archived)

**Role:** Audits process compliance, enforces governance rules, writes editorial passes on governance and architectural documents. Also authors tactical skills and decision synthesis.

**Recruited:** 2026-05-13 (to resolve 3-author deadlock on constitution v1.2.0 amendment).

**Project:** stfc-gift-redeemer — TypeScript CLI for automating store-gift redemption on GitHub Actions cron (every 4 hours).

---

## Consolidated Learnings

### v1.2.0 Amendment Work (2026-05-13 → 2026-05-15)

- Branch naming: `squad/governance-*` for constitutional amendments (signals governance prerequisite)
- PR body checklists with source-labeled findings (P0/P1/P2 from reviewer rounds)
- Worktree pre-commit hooks need node_modules symlink before first commit
- P0 findings → tasks.md acceptance criteria (checkbox-style)
- P1 findings risk dropout across phase boundaries; explicitly flag carry-forward vs. defer

### Verification Discipline (from plan corrections 2026-05-13)

- Verify numeric claims (counts, regex coverage) against authoritative commands before editing
- Grep full doc for secondary occurrences (rationale sections, source lines, tracking tables) when correcting primary claims
- For contract mismatches, introduce new wrapper functions rather than breaking renames
- Cross-check cadence claims in workflow files before accepting (frequencies off by 6× are easy to miss)
- Cascade-check test strategy tables when correcting scope claims; don't let test assertions go stale

### Audit Patterns (v1.3.0 round 2 + addendum)

- Re-auditing your own corrections requires hat-switch: read as external reviewer, not as author
- Truth-equivalence between research acknowledgments and test assertions prevents silent weakening
- Document "Known Tensions" by exact version target ("Resolution scheduled: vX.Y.Z"); omission = governance gap

### Editorial Compliance (2026-05-17)

- Tips with concrete citations > tips without sourcing
- Phase-boundary codification (Rules 6/7 shipping this session) converts repeated coordinator friction into zero-ask paths
- Model catalog governance is recurring drift; audit touchpoint during doc refreshes, not separate task
- Config override anchoring in decisions.md is the right artifact, not code comments
- Rules 10–13 (compound directives, Researching prefix, PR close keywords, CodeQL diagnostics) now codified — reduces friction cycle

### Charter Extensions & Audit Findings (2026-05-18)

- User-as-explicit-reviewer pattern: receive findings verbatim, ship edits with fidelity (no reinterpretation)
- Hard-gate clarification technique: convert implicit triggered-responsibility into explicit "opt-out-is-not-allowed" phrasing
- Charter scope separation: "Owns X; does not own Y (belongs to Z)" preserves role boundaries
- Cross-provider override transparency: 1-2 sentence Model section note explains `.squad/config.json` operational differences
- Audit → role-specific history pattern: flagged gaps → institutional memory seeding → clarity (reusable for other squad members)

---

## Most Recent Sessions Summary

**2026-05-18 Latest Work (Issue #62 Hygiene Batch Closeout)**

- Ralph history: +51 lines, Learnings section (three activation layers, round patterns, audit cross-ref, @copilot boundary)
- Garak charter: Model section now documents `gpt-5.5` config.json override (cross-provider diversity rationale)
- Issue #62: closed with completion comment
- All files uncommitted per Rule 2 (awaiting Scribe batch commit)

**Status:** Ready for Scribe collection. No blockers.
