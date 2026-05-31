# Picard — Lead / Code Review

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

> **Note:** Prior learnings (2026-05-08 through 2026-05-30) summarized in `history-archive.md`.

---

## 2026-05-31T19:50:00Z — Issue #77: crew-optimizer speckit pipeline + v1 constitution amendment (PR #97)

**Verdict:** SHIPPED to reviewer gate. PR #97 opened with `Closes #77`. Constitution bumped v1.5.0 → v1.6.0 (MINOR).

**Phases completed (Rule 5 phase-boundary commits):**

- Phase 0 — `spec.md` (T001) — 6 user stories, 26 FRs, pre-resolved Q1/Q2/Q3/Q4/Q5 baked in inline.
- Phase 1 — clarify — encoded inline; no separate commit needed.
- Phase 2 — `plan.md` + `research.md` + `data-model.md` + `quickstart.md` + 4 contract docs (T002–T007).
- Phase 3 — v1 amendment + Tuvok editorial + Rule 1 plan-template re-sync (T008–T010).
- Phase 4 — `speckit.analyze` cross-artifact sweep, fixed issue cross-refs against live board (T011).
- Phase 5 — `tasks.md` (T012–T013).

**Final SIR "Templates needing re-sync" line (Rule 1 grep, verbatim):**

```
$ grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml' .specify/templates/*.md
.specify/templates/plan-template.md:44   (UPDATED in this PR — Principle V cell now references v1.6.0)
```

## Learnings (2026-05-31)

### Constitution-amendment pinning-test collision (new failure mode)

`tests/constitution/discord-ops-carveout.test.ts` reads the constitution via `indexOf("scripts/discord-ops/")` and asserts a ±1500-char window contains the carve-out body text. My v1.6.0 SIR mentioned `scripts/discord-ops/` literally in a "carve-out unchanged" closing sentence — that became the first hit, and the ±1500 window stopped short of the actual carve-out body. Pre-commit hook tripped.

**Fix:** rephrase the SIR to reference the carve-out by its subsection title ("Operator-Only One-Shot Ops Scripts") rather than the literal path. Test passes; semantics preserved.

**Pattern (to memorialise in `speckit-pipeline-driver` SKILL):** before writing a new SIR, scan `tests/constitution/*.test.ts` for any `indexOf(literal)`-style assertion and avoid those literals in the SIR.

### Issue cross-reference audit is mandatory in Phase 4

I drafted spec/plan with issue numbers derived from the source plan's draft `#1..#19` numbering. The live board's actual numbers are `#77..#95`. The off-by-N matters: "issue #79" in my draft meant the OCR POC, but #79 on the board is the engine implementation. Phase 4 caught this via:

```bash
gh issue list --state all --search 'crew-plan-id in:body' --json number,title --limit 30
```

**Lesson:** the `speckit.analyze` phase MUST include a live-board lookup, not just internal cross-ref check. Encoded in `.squad/skills/speckit-pipeline-driver/SKILL.md`.

### Pre-resolved clarify answers encode inline; no separate commit needed

Phase 1 (`speckit.clarify`) is a no-op file-wise when the Coordinator's dispatch has already locked the answers (Q3 roster privacy pre-decided; Q1/Q2/Q4/Q5 recommended in the source plan). Bake the answers into spec.md FRs with `(Clarified Qn.)` annotations. Saves a commit and avoids a stub `clarify.md` artifact.

### Constitution version footer lives in two places

`.specify/memory/constitution.md` carries `**Version:** X.Y.Z` near the top of the principles section AND `**Version**: X.Y.Z | **Ratified**: ... | **Last Amended**: ...` as the final line. Both MUST be bumped or the SIR is inconsistent with the body.

### Don't bundle v1.5 / v2 amendments with v1

Each phase's amendment is independent. Filing them as separate PRs (issues #87 v1.5, #93/#94 v2) means each ships with its own Rule 1 re-sync grep, its own Tuvok editorial pass, and its own reviewer-gate cycle. Bundling them would force a multi-version SIR that's harder to review and harder to revert if a later phase is dropped.

### Skill extracted

New skill at `.squad/skills/speckit-pipeline-driver/SKILL.md` codifying the phase-boundary commit pattern + the Phase 4 live-board lookup + the SIR-vs-pinning-test collision avoidance + the dual version footer.

