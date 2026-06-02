# Picard — Engineering Manager / Scope Reviewer

> Entries prior to 2026-06-01 archived to `history-archive.md` (227 lines, 21KB).

## 2026-06-01 — Multi-PR scope/governance review + backlog triage: PRs #129–#132; 12 open issues

**PR #129 (crew[v2] read-only handlers):** No constitution amendment required (handlers in sanctioned src/crew/** namespace); PR body uses per-line `Closes #92` format (Rule 12); no new outbound destinations. ✅ APPROVE.

**PR #130 (crew[v2] knowledge embedding + handler):** No amendment needed (hashed embedder, no network); MiniLM carveout deferred to future ticket (routed to Tuvok). ✅ APPROVE.

**PR #132 (knowledge-rebuild workflow + Rule 3 pinning tests):** No governance impact; O'Brien's workflow pin tests per Rule 3 verified. ✅ APPROVE.

**Backlog triage (04:57Z):** 12 open issues classified; 0 immediately dispatchable; PR #129 MERGED unblocks #93; user-action gates on #127 (Azure secrets, Rule 21), #85 (20 screenshots), #76 (guild access); Batch 2–8 fan-out plan queued with ≤4 concurrent worktree cap. Recommendation: hold autonomous; ask user on #127/#85/#76; dispatch #93 when ready.

**Smooth cycle:** All PRs merged 05:43–05:46Z. Decisions inbox merged. Ready for Batch 2.

---

## Archived Learnings

**See `history-archive.md` for:**
- Plan v2 feedback (005-web-control-panel scope review)
- Constitution v2.0.0 amendment review
- Constitution review decision notes
- Backlog classification methodology
- And 200+ more lines of scope/governance decisions (2026-05-18 through 2026-05-31)

Status: COMPLETE

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01T05:59:13Z — PR #133 review: crew v2 docs + final gates (scope/governance)

**Verdict:** APPROVE ✅ — PR ships on merge.

**Summary of findings:**
- All 8 governance gates pass: acceptance criteria ✅, scope-only docs ✅, no constitution amendment ✅, Rule 12 closes ✅, Rule 15 Tests section ✅, Rule 16 Docs N/A ✅, roadmap accurate ✅, v2 chain complete ✅.
- v2 chain #91→#92→#93→#94→#95 closes on this merge; all four predecessor PRs are merged.
- Knowledge embedding docs correctly note hashed bag-of-words default (offline) + optional MiniLM flag; both already HF-carve-out-covered per constitution.
- Roadmap maintains consistent messaging (v1 ✅ shipped, v1.5 🔬 in development gated on OCR POC, v2 ✅ shipped, v3 📋 future/planned).

**Crew v2 delivery timeline (within this session):**
- 2026-06-01T02:22:04Z: Identified Batch 4 v2 PRs (#129 handlers, #130 knowledge, #132 workflow, #95 docs) as cleanups.
- 2026-06-01T03:14Z: PR #124 merged (SWA + auth round 2).
- 2026-06-01T05:59:13Z: PR #133 approved; ready to ship.

**Status:** v2 backlog is CLEAR. Next blocker on backlog is #112 epic (005-web-control-panel Phase 1), which depends on PR #127 (Azure OIDC).

## 2026-06-01 — Session wrap-up (constitution v2.0.0 + governance reviews)

**Session:** crew-v2-chain-wrapup
**Role:** Scope validation + governance amendment
**Outcome:** Constitution v2.0.0 shipped (v1.6.0 amendment), 4 governance issues filed

Participated in:
- PR #125 (constitution v2.0.0): APPROVE ✅ + self-amendment authored (3 MAJOR changes: SWA surface, untrusted-input class, workflow_dispatch inputs; 5 additive MINOR changes)
- PR #133 (operator-docs): scope review APPROVE ✅ — 5 new + updated docs, clean alignment

**Constitution v2.0.0 amendments:**
- Principle IV: new SWA + linked Functions surface (alongside headless CLI)
- Principle I: chat input declared UNTRUSTED for tool dispatch (HMAC-signed gate required)
- Security & Compliance Constraints: uniform workflow_dispatch inputs (correlation_id, triggered_by, reason)
- Plus 5 additive changes (new secrets, durable artifacts, outbound destinations, hard isolation invariants)

**Governance follow-ups filed:**
- #131 (closed via #125 merge)
- #136 (operator-docs fixes, routed to Tuvok pending Lockout clear)
- #137 (rule-reference CI workflow discovery)
- #138 (trigger-string smoke tests)

**Next:** Phase 0 continuation on stfc-76 (frozen worktree).


## 2026-06-02 — Triage: PR #96 (discord-channels stub, blocked on guild access)

**Verdict:** Option C — un-drafted PR #96 and posted ship-it rationale.

**Why:** PR ships standalone-useful artifacts (blocker README + directory convention + ready-to-run `scripts/fetch-discord-channel.mjs`) with zero runtime risk (567/567 tests pass; script is dead-on-arrival until bot joins guild). Closing the PR would discard durable preparation work for an external blocker we don't control.

### Learnings

**Reusable heuristic — external-blocker PR triage:**

When a PR is blocked by an external party (third-party API access, vendor credential, guild admin sitting on an invite, etc.) and ships **standalone-useful artifacts** — docs of the blocker, ready-to-run script, directory/schema convention — with **no runtime risk**, prefer Option C (ship preparation, defer execution) over closing.

- Artifacts capture the analysis work and provide a one-command path forward when the blocker clears.
- The README itself becomes the runbook for whoever tries next (probe URLs, invite templates, server invite, exact permission scopes).
- Close (A/B) only when prep is genuinely throwaway OR when leaving it in the tree creates ongoing confusion.
- Don't pre-file a "do the actual work" follow-up ticket — file it when the external blocker clears. Pre-filing is board noise.
- Don't hold at draft (Option D) — it ages without value and clutters the board.

Per Rule 7, did NOT enable auto-merge — Kirk may want a quick technical scan of the script before merge, even though scope/docs is clean.


## Triage heuristic: Ship preparation, defer execution (external blockers)

**Date:** 2026-06-02T03:03:50Z

When a PR is blocked by an external party (third-party API access, vendor credential, guild admin, etc.) and ships **standalone-useful artifacts** (blocker docs, ready-to-run script, directory/schema convention) with **no runtime risk**:

**Prefer:** Ship the prep work (Option C) and file a fresh ticket when the blocker clears.
**Avoid:** Close PR (options A/B) — throws away analysis and makes restart harder.

The artifacts capture the work and provide a one-command path forward. Zero runtime risk means no downside to shipping.

Reserved for cases where prep work is genuinely throwaway or creates ongoing confusion.

Applied to PR #96 (discord-channels ingest): shipped script + blocker README + directory convention despite bot lacking guild membership. When access lands, fresh issue re-files the ingest task.

— Scribe (logged from orchestration)
