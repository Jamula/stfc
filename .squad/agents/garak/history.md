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
