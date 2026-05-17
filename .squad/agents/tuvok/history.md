# Tuvok — Process Auditor / Editorial Specialist

**Role:** Audits process compliance, enforces governance rules, writes editorial passes on governance and architectural documents. Also authors tactical skills and decision synthesis.

**Recruited:** 2026-05-13 (to resolve 3-author deadlock on constitution v1.2.0 amendment).

**Project:** stfc-gift-redeemer — TypeScript CLI for automating store-gift redemption on GitHub Actions cron (every 4 hours).

---

## Session 2026-05-17 — Chronicle Commands + Rules Shipping (5 parallel tracks)

### Session 1: /chronicle tips synthesis (2026-05-17T07:12:40Z)

**Input:** `.squad/skills/` (7 files), `.copilot/skills/` (2 files), `.github/copilot-instructions.md`, `.squad/decisions.md` top entries, 2 inbox decision memos from Ralph round 1+2 + 3 new skills released this session (superseded-pr-detection, workflow-cron-edit, workflow-cron-review).

**Output:** 15 working tips across 5 sections: PR review (empty-diff detection, self-approval, admin-bypass), CI/workflows (cron decoding, test pinning, concurrency), governance (SIR re-sync from grep, Known Tension tracking), `.squad/` hygiene (Rule 2, Bashir auto-assignment caveat, merge conflict resolution), gotchas (15-min main cadence, superseded-PR, keyword bleed, worktree cleanup).

**Every tip cites concrete artifact** (skill, rule, file + line). Delivered as decision inbox memo (`tuvok-chronicle-tips-2026-05-17.md`); will consolidate to decisions.md as part of final sweep.

### Session 2: Rules 6/7 addition + Rule 5 extension (2026-05-17T07:19:38Z)

**Request:** Cyrus approved all 4 findings from `/chronicle improve` session (2026-05-16). Surgical edits to `.github/copilot-instructions.md` to codify:

- **Rule 6 (ship it ritual):** 5 user-phrasing variants (*"merge to main and sync"* / *"ship it"* / *"yes merge"*) → single bash sequence (fetch+rebase→merge→cleanup), no confirmation loop
- **Rule 7 (auto-merge gate):** reviewer-approved + CI-green + no CHANGES_REQUESTED = immediate merge without asking
- **Rule 5 extended:** phase-boundary auto-commit + 4-step resume protocol ("continue from where you stopped" suppresses clarification friction)

**Evidence base:** 9+ merge phrasings in one session; 5+ "continue" prompts across feature cycles; redundant coordinator confirmation after approval gate clears (Rule 7).

**Output:** copilot-instructions.md +69 lines (124 → 193 lines); file left uncommitted per Cyrus (outside Scribe allowlist). Decision memo written; will consolidate to decisions.md.

### Session 3: docs/models.md catalog refresh (2026-05-17T16:41:42Z)

**Request:** Cyrus walked through 5 open questions in docs/models.md § 5. Tuvok refreshed full document (195 → 264 lines).

**Key changes:**
- Added opus-4.7 family (4 variants) + gpt-5.5 (both absent from 2026-05-16)
- Restructured per-member recommendations with explicit rationale + override conditions
- Surfaced anomaly: `.github/agents/squad.agent.md` references 6 obsolete model IDs (gemini-3-pro-preview, gpt-5.1-* variants, claude-opus-4.6), missing opus-4.7 entirely
- Surfaced anomaly: Scotty's gpt-5.5 config override lacks decisions.md anchor
- Recommended Uhura downgrade: opus-4.7-1m → sonnet-4.6 (integration workload doesn't justify 1M-context cost)
- Confirmed Picard/Kirk 1m-internal justified by session `06e05633` evidence (105-turn full-artifact review)
- Recommended task-aware split for Tuvok (haiku for mechanical, sonnet for editorial/prompt) instead of single override

**Learnings:** Model-catalog-vs-governance drift is 6+ IDs wide and recurring. Config overrides without decisions.md anchors are invisible to auditors. Honest "untested in this repo" > inventing performance claims.

**Output:** docs/models.md refresh (uncommitted, per Cyrus); decision inbox memo (governance drift issue + per-agent overrides); issue #21 filed (governance drift, maintainer scope).

### Session 4: Model override decisions applied (2026-05-17T16:58:02Z)

**Cyrus answers to § 5 questions:**
- **Uhura:** `claude-opus-4.7-1m-internal` → `claude-sonnet-4.6`
- **Kirk:** `claude-opus-4.7-1m-internal` unchanged; rule "scope to architecture/multi-file; sonnet-4.6 for narrow review" documented
- **Scotty:** `gpt-5.5` → `gpt-5.3-codex` (code-writing specialist; TypeScript/CLI beat)
- **Garak:** new `gpt-5.5` (cross-provider diversity post-gemini-removal)

**Output:** .squad/config.json (3 edits); decision memo written; issue #21 filed.

### Session 5: Parallel Scribe sweep work tracking

No direct output from Tuvok; work logged in orchestration-log entries for cross-reference.

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

---

## Status

**Most recent work:** Session 2026-05-17 sweep (5 parallel agent tracks, final consolidation to decisions.md + history summarization pending)

**Next session prep:** Constitution automation (issue #8 — enforcement gate for re-sync rule); triage bot fix (issue pending Kirk routing-rules decision); #15 token-usage telemetry epic (TBD with Bashir driver reuse).

**Charter:** `.squad/agents/tuvok/charter.md`
