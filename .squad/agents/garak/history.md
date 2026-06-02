## Session 2026-06-02 — Discord slash epic #143 shipped

Parallel fleet delivered 6 PRs (commands.json, register workflow, Worker bridge, handler workflow, deploy, runbook). 4 reviewer-lockout cycles (Garak blockers → Scotty fixes). Epic fully operational.

## 2026-05-16 — Critic seat transferred from Borg Queen to Garak

User-requested swap for consistency with cyrusj's other squad (where Garak
holds the Critic seat). Borg Queen retired from this roster. I (Garak)
inherit the Critic-seat learnings preserved in the entries below — the
hostile-fact-check methodology, cascade-verification patterns, and the
"verify every concrete claim against the live repo" discipline all carry
forward unchanged.

Files affected by the transfer are listed in
`.squad/decisions/inbox/picard-borg-queen-garak-swap-2026-05-16.md`
(pending Scribe merge).

Going forward all Critic work is published under `garak/`; the entries
beneath this one are the seat's prior occupant's record and remain
authoritative for the methodology.

---
> Older learnings archived to history-archive.md. See archive for context.

## 2026-05-31 — Spec + Constitution v1.6.0 + Data Layer Fact-Check

Garak's role: hostile fact-check on both PR #97 (spec claims) and PR #98 (contract enforcement).

**PR #97:** Approved. Verified Discord/OCR realism (message-text only, OCR deferred to v1.5), HuggingFace dependency in tree, pure-compute constraint on v1, Rule 1 grep hit, issue/scope gates. All claims hold; SemVer correct. Non-blocking board note: issue #86 title outdated.

**PR #98 (round 1):** CHANGES_REQUESTED. Three contract violations found:
1. Roster filename/account mismatch: `example.yaml` with `account: demo` violates `{account}.yaml` contract.
2. Byte-stable round-trip false: serializer sorts/reorders vs source.
3. Live roster data in CLI test: unclear if intentional real-data validation or test-style mistake.

Recommended Bashir (test/contract expert) not Scotty (per reviewer-lockout).

**PR #98 (round 2):** Approved after revision 277f7023. All three findings resolved: file renamed, round-trip canonicalized + tested, real-data exception documented.

**Lesson:** Contract enforcement gates data-layer stability. The three violations were inter-related (filename→account→serialization invariants). Kirk's architecture review missed these because they're not architectural—they're data-contract and test-contract bugs. Garak's role as fact-checker is essential on data-driven features.
- Phase 0 shipped (PR #111, e5e26e4)

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE
### 2026-06-01 — PR #124 Phase 1 Wave 3 hostile fact-check

**Verdict:** CHANGES_REQUESTED ⚠️. The useful attack pattern was to test claimed gates as adversarial contracts, not just read their happy-path fixtures. `check-api-auth` passed a handler that executed code before `requireAllowedUser`, proving the “first statement” claim was prose rather than enforcement.

**Recurring gaps:** PR bodies drifted after late fixes (905 → 906 tests), Rule 15 test inventories omitted whole test families, and repo-facing plan/docs remained placeholders while the PR claimed Phase 1 surfaces had landed. Deploy workflows that require not-yet-provisioned secrets must skip cleanly or they convert an “infra later” promise into a red required check.

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

### 2026-06-01 — PR #133 crew-v2 operator docs hostile fact-check

**Verdict:** CHANGES_REQUESTED ⚠️. Docs-only PRs still need source-level adversarial checks: the command inventory, flags, workflow paths, concurrency, env var, citation format, close keyword, and 1000/1000 test claim all held, but several textual claims did not.

**Findings:** The new docs overstated global 1900-char truncation even though `explain`, `synergy`, and `tasks` do not truncate; described `best` score `0.00` as perfect even though scores are additive and sorted high-first; called raw cosine similarity `0–1` despite no clamp; said plain `crew:knowledge:rebuild` forces rebuild when only `--force` does; used stale `1247 chunks` examples while the artifact has 76 chunks; and called issues #92–#95 PRs while #95 was still open.

**Lesson:** Operator docs can fail on “small” prose claims that tests never see. For docs finales, check examples and numeric placeholders against live CLI output, not just source constants.

## 2026-06-01 — Session wrap-up (crew v2 chain + PR #133 fact-check)

**Session:** crew-v2-chain-wrapup
**Role:** Hostile fact-check
**Outcome:** 5 doc-accuracy findings filed (PR #133, parked awaiting #136 fix)

Participated in:
- PR #129 (crew-v1-rewrite): fact-check approved
- PR #130 (crew-v2-data-layer): fact-check approved
- PR #132 (crew-v2-optimization): fact-check approved
- PR #133 (operator-docs): ⚠️ CHANGES_REQUESTED — 5 findings:
  1. CREW-OPTIMIZER.md incorrectly states v2 per-task iteration
  2. CLI example missing --help flag documentation
  3. Redeem retry logic docs out of sync with PR #129
  4. Missing cache-invalidation edge case
  5. Conflated v1/v2 operator roles

Findings routed to follow-up issue #136 (non-Tuvok, Lockout label).

**Decision:** PR #133 remains OPEN pending #136 completion before merge.
## 2026-06-01 — Hostile fact-check review (three-PR cycle): PRs #129, #130, #132

**PR #129 (crew[v2] read-only handlers):** Initial question: Does handler output exactly cite engine returns or embellish? Uhura issued fix guaranteeing deterministic output matching engine shape. Garak re-verified post-fix. ✅ APPROVE.

**PR #130 (crew[v2] knowledge embedding + handler):** Initial question: Is embedder deterministic? Is MiniLM code dead? Coordinator clarified PR body; Garak re-verified (STFC_KNOWLEDGE_MODEL env gated, dead-code in default config). ✅ APPROVE.

**PR #132 (knowledge-rebuild workflow + Rule 3 pinning tests):** No security findings. Workflow permissions appropriate. ✅ APPROVE.

**Result:** All three PRs shipped with zero security violations. Two re-verify cycles (Uhura, Coordinator clarification) addressed all Garak questions. Smooth shipping sequence.


## 2026-06-02 — Design-stage hostile fact-check for game-state capture (#165)

Posted preemptive design review before #160/#161 implementation so Uhura, Scotty, and O'Brien can build defenses up front rather than retrofit them during PR review.

Pattern added: for privilege-escalating pipelines, review the architecture note as an attack surface before code exists. Required threat-model categories: operator authorization, path containment, filename/control-character injection, shell/YAML interpolation, CDN URL trust and redirect policy, byte/rate budgets, download integrity, git/index concurrency, lineage recovery, and downstream consumer commit amplification.

Result: 3 CRITICAL, 4 HIGH, 3 MEDIUM findings posted to #165. Most critical gap: `/game-state` must not become a signed-Discord-request-to-contents-write commit channel without explicit operator/guild/channel authorization enforced in both Worker and handler.
