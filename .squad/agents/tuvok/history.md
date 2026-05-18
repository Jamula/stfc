# Tuvok — Process Auditor / Editorial Specialist

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

### Verification Discipline

- Verify numeric claims (counts, regex coverage) against authoritative commands before editing
- Grep full doc for secondary occurrences (rationale sections, source lines, tracking tables) when correcting primary claims
- For contract mismatches, introduce new wrapper functions rather than breaking renames
- Cross-check cadence claims in workflow files before accepting (frequencies off by 6× are easy to miss)
- Cascade-check test strategy tables when correcting scope claims; don't let test assertions go stale

### Audit Patterns

- Re-auditing your own corrections requires hat-switch: read as external reviewer, not as author
- Truth-equivalence between research acknowledgments and test assertions prevents silent weakening
- Document "Known Tensions" by exact version target ("Resolution scheduled: vX.Y.Z"); omission = governance gap

### Editorial Compliance

- Tips with concrete citations > tips without sourcing
- Phase-boundary codification (Rules 6/7) converts repeated coordinator friction into zero-ask paths
- Model catalog governance is recurring drift; audit touchpoint during doc refreshes, not separate task
- Config override anchoring in decisions.md is the right artifact, not code comments
- Rules 10–13 (compound directives, Researching prefix, PR close keywords, CodeQL diagnostics) now codified

### Charter Extensions & Audit Findings

- User-as-explicit-reviewer pattern: receive findings verbatim, ship edits with fidelity
- Hard-gate clarification technique: convert implicit triggered-responsibility into explicit phrasing
- Charter scope separation: "Owns X; does not own Y (belongs to Z)" preserves role boundaries
- Cross-provider override transparency: 1-2 sentence Model section note explains operational differences
- Audit → role-specific history pattern: flagged gaps → institutional memory seeding → clarity

---

## Session 2026-05-18 — Issue #62 Hygiene Batch Closeout (2026-05-18T01:12Z)

**Mandate:** Two editorial sub-items from issue #62 (audit hygiene batch):
1. Ralph history seeding — transform boilerplate into role-specific learnings
2. Garak charter Model override doc — surface the `gpt-5.5` config.json override rationale

**Edits shipped:** 
- `.squad/agents/ralph/history.md` (+51 lines): Learnings section (three Ralph layers, round patterns, audit cross-ref, @copilot coexistence)
- `.squad/agents/garak/charter.md` (+3 lines): Model section documents cross-provider override rationale

**Status:** All sub-items addressed. Issue #62 closed. Files uncommitted (Rule 2). Ready for Scribe batch commit.

---

## Charter:** `.squad/agents/tuvok/charter.md`
