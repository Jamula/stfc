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

## Session 2026-05-18 — Rules 10–13 Review & Ship (2026-05-18T00:50:13Z)

### Input & Mandate

**Request:** User affirmed "1 & 2" (review-then-commit) for Rules 10–13 (+115 lines uncommitted on main).

**Mandate:** Surgical review → rebase → test → commit → push → decision drop.

### Work Log

1. **Diff review:** Rules 10 (compound list-review ritual), 11 (Researching: prefix → multi-agent chain), 12 (per-line Closes #N), 13 (CodeQL 403 = token-scope, not Advanced Security). 
   - **Findings:** No typos, merge markers, contradictions, secrets/PII, or formatting issues. Numbering correct (10 follows 9, 13 is last). Editorial quality consistent with Rules 1–9.
   - **Edits required:** None.

2. **Pre-commit gate:** `npm test` passed: 531 tests, 0 failures (7.0s).

3. **Rebase:** `git rebase origin/main` successful. 1 commit (chore(history) from redeem.yml cron) rebased ahead. No conflicts (docs/redeem-history.md unaffected per Rule 4 design).

4. **Commit SHA:** Before rebase: 046bae5 → After rebase: 40e62dc (expected rewrite).

5. **Push:** Landed at origin/main without CodeQL delay (Rule 4 subsection inapplicable).

### Learnings

- **Chronicle-tip persistence:** Rules 10–13 now codified in main; captures recurring user-typed compound directives from `/chronicle improve` rounds. Reduces friction cycle on "list + review + ask" (10), "Researching:" prefix (11), PR close-keyword hygiene (12), CodeQL diagnostic (13).
- **Rebase-before-push discipline:** Rebase was needed (1 cron commit ahead). Surgical single-file staging (`git add --`) and pre-commit hook passed before commit, ensuring push succeeded clean.
- **No editorial fallout:** All rules well-formed; no secondary cross-references needed update (Rules 1–9 untouched; constitution.md check per Rule 1 inapplicable).

### Status

**Commit shipped:** 40e62dc (docs(copilot-instructions): add Rules 10–13)

**Decision memo:** `.squad/decisions/inbox/tuvok-rules-10-13-shipped.md`

---

## Session 2026-05-18 — Charter Extensions (Uhura ML, Garak Hard-Gate, Kirk Reviewer Carve-Out)

### Input & Mandate

**Request:** User affirmed three audit findings from session 2026-05-18 (explicit mandate form); requested surgical edits to three charter files + decision drop + history append.

**Mandate:** Surgical edits per explicit reviewer findings (no invention, no scope creep).

### Work Log

1. **Charter edits — three files, three findings:**
   - **.squad/agents/uhura/charter.md** (lines 12–21): Appended ML classifier API integration to "What I Own" — model loading, SHA-256 verification, model selection, privacy invariant. Infrastructure scope (cache, SHA rotation, decisions) delegated to DevOps Engineer.
   - **.squad/agents/garak/charter.md** (lines 13–20): Appended hard-gate adversarial review to "What I Own" — every `feat(*)` PR touching `src/` requires mandatory `**APPROVE** ✅` / `**CHANGES_REQUESTED** ⚠️` comment.
   - **.squad/agents/garak/charter.md** (lines 31–37): Added "Hard-gate clarification" sub-section in Boundaries to signal hard-gate is _triggered responsibility_, not discretionary.
   - **.squad/agents/kirk/charter.md** (lines 39–50): Appended Kirk-as-author-and-reviewer carve-out to Boundaries — when Kirk authors a design, Garak must co-review per routing.md mitigation rule.

2. **Issue #69 comment:** Posted charter-extension completion status; flagged that infrastructure scope (HF cache, SHA rotation) remains Picard/DevOps work.

3. **Decision drop:** `.squad/decisions/inbox/tuvok-charter-extensions-2026-05-18.md` (documents all three findings, file locations, cross-check for secondary references).

4. **Cross-check discipline:** Verified no secondary references in routing.md, constitution.md, or team.md require update (charter edits self-contained).

### Learnings

- **User-as-explicit-reviewer pattern:** This is the 2nd firing of this pattern in the current session (first: Rules 10–13 shipping, second: these three charter extensions). User passes explicit findings verbatim; Tuvok's job is _fidelity to the finding_, not reinterpretation or scope expansion. No ambiguity threshold crossed — all three findings were actionable.
- **Hard-gate clarification technique:** The clarifying sub-section (adding "Hard-gate clarification" to Garak's Boundaries) converts implicit triggered-responsibility into explicit opt-out-is-not-allowed phrasing. This pattern can be reused for other mandatory-gated responsibilities.
- **Charter scope separation discipline:** The Uhura edit cleanly separates API+integration ownership from infrastructure ownership. Pattern: "Owns X; does not own Y (belongs to Z)" preserves role boundaries without encroachment.

### Status

**Edits shipped:** 3 charter files + 1 decision drop + issue comment posted.

---

## Status

**Most recent work:** Session 2026-05-18 — Charter extensions shipped (2026-05-18T00:57:58Z)

**Next session prep:** Constitution automation (issue #8 — enforcement gate for re-sync rule); triage bot fix (issue pending Kirk routing-rules decision); #15 token-usage telemetry epic (TBD with Bashir driver reuse); Picard's DevOps engineer charter parallel track for #69 infrastructure scope.

**Charter:** `.squad/agents/tuvok/charter.md`
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; #69 extended; #64, #68 resolved via charter edits

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.
