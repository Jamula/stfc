# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Spec Kit & SDD (2026-05-08)

**What it is:** Spec-Driven Development inverts code-first thinking—specifications become the executable source of truth via a spec → plan → tasks → implement loop. Spec Kit is the GitHub open-source toolkit that operationalizes SDD. The constitution is the meta-spec that governs all downstream artifacts; violation requires amendment with explicit team consensus.

**The workflow:** /speckit.specify (requirements) → /speckit.clarify (ambiguity resolution) → /speckit.plan (tech + architecture) → /speckit.tasks (task breakdown) → /speckit.implement (code generation) → /speckit.checklist (acceptance) → /speckit.analyze (consistency). Git hooks auto-commit at each phase. Teams adopt selectively; once adopted, adherence is enforced.

**Current constitution alignment:** The constitution already gates Spec Kit adoption via the "Spec-driven changes" rule: non-trivial features MUST use Spec Kit; trivial fixes (typos, docs, bumps) are exempt. The constitution is versioned (semantic); amendments trigger a Sync Impact Report that lists affected templates and documents needing updates.

**Key project files:**
- `.specify/memory/constitution.md` — Current v1.0.0 (ratified 2026-05-08); already embeds Spec Kit adoption.
- `.specify/templates/{spec,plan,tasks,checklist}-template.md` — Provide structure for each phase artifact.
- `.specify/integrations/speckit.manifest.json` — Tracks Spec Kit installation (v0.8.8.dev0).
- `.specify/extensions.yml` — Pre-configures git hooks to auto-commit at each phase.
- `.specify/workflows/speckit/workflow.yml` — Defines full SDD cycle with review gates.

**Implications for stfc-gift-redeemer:**
- Spec Kit clearly helps: new redemption features, significant refactors, integrations. Forces clarity on acceptance criteria before code.
- Spec Kit overkill for: typos, docs, routine bumps (already exempt). Hotfixes to unblock runs can skip Spec Kit but must flow back into spec later.
- Gray zone: single-file bug fix, new CLI option. Constitution's "non-trivial" phrasing is vague; team should define examples.

**Next steps:** Propose constitutional amendment (MINOR bump, Option B recommended) to add Principle VI: "Specification-First Governance." This makes Spec Kit adoption explicit, not implicit. Full proposal is in `.squad/decisions/inbox/picard-speckit-briefing.md`.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Key cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed to prevent zero-coverage features from shipping.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without (1) decision gates, (2) overhead accounting, (3) annual review lock-in. Also: agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.

**Picard's role:** Coordinate constitutional amendment that incorporates Uhura's secret hygiene rule (essential), Bashir's test-first gates (essential), Scotty's trigger threshold and checkpoints, and Borg Queen's five prerequisites. Phase 2 drafting; Phase 3 merge into constitution.

**Status:** Phase 1 (Briefing) complete. Awaiting Phase 2 convergence.

---

### Constitution v1.1 Drafting — Phase 2 Complete (2026-05-08T21:14:47-07:00)

---

### Team Critique & Convergence — Phase 2 Complete (2026-05-08T21:33:38Z)

**Session:** speckit-v1.1-critique — All five agents submitted critiques of v1.1 proposal.

**Verdicts Summary:**
- **Scotty:** APPROVE_WITH_EDITS (verify `.specify/features/` structure pre-ratification)
- **Uhura:** READY_WITH_CONDITION (CI token-scanner MUST be implemented before ratification, not deferred)
- **Bashir:** APPROVE_WITH_EDITS (two enforcement gaps: pre-commit hook for test rule; verification doc for bug-fix test-first)
- **Borg Queen:** PHASE_2_COMPLETE (Principle IV/IX contradiction MUST be fixed before ratification)

**Convergent Findings — Two Classes of Follow-Up:**

1. **Drafting Fixes** (must complete before ratification):
   - Fix Principle IV (v1.0.0 text) — resolve "no test suite" contradiction with Principle IX
   - Assign artifact hygiene reviewer (recommend: Uhura)
   - Clarify `package.json` scripts exemption in Principle VI (optional edit)
   - Tighten test-first verification (add documentation requirement)

2. **Enforcement Infrastructure** (pre-ratification blockers):
   - Implement CI token-scanner for Artifact Hygiene (Uhura: blocking prerequisite, not TODO)
   - Implement pre-commit hook for `npm test` gate OR document pre-ratification commitment (Bashir)
   - Verify `.specify/features/` directory structure (Scotty)

**Critical Issues Identified by Team:**
- **Borg Queen caught Principle IV/IX contradiction** — v1.0.0 "has no automated test suite" vs. v1.1 "npm test MUST pass." This creates ambiguity for implementation.
- **Uhura flagged CI enforcement gap** — Principle VII (Artifact Hygiene) is strong but unenforceable without CI token-scanner. Deferring to post-ratification is unacceptable.
- **Bashir flagged pre-commit hook gap** — NON-NEGOTIABLE language in Principle IX requires mechanical enforcement, not honor-system.
- **Smoke-test operational runbook undefined** — WHO performs smoke-test, HOW to document, WHEN, WHERE. Needs follow-up.

**Adoption Threshold Decision:** Keep 50% as stated (Borg Queen recommendation accepted).

---

### Constitution v1.1 Drafting — Phase 2 Complete (2026-05-08T21:14:47-07:00)

**What was produced:** Full v1.1.0 constitution proposal (`.squad/.scratch/constitution-v1.1-proposal.md`) and decision memo (`.squad/decisions/inbox/picard-speckit-v1.1-proposal.md`).

**Key synthesis decisions:**

1. **Trigger threshold (Pragmatic/Option B) is explicit and operational.** Listed as bullet criteria in Principle VI — not a hand-wave. "Multi-file, cross-skill, >4h, API-contract, or build/config changes" → speckit required. "One-liners, typos, bumps, single-file bug fixes, doc edits" → direct PR.

2. **Test command is `npm test`** (confirmed from `package.json`: `node --import tsx --test tests/index.test.ts`). Encoded as a hard rule in Principle IX — no skip clauses, no CI-deferred exceptions.

3. **Borg Queen's concerns answered structurally, not dismissed.** Brownfield reality acknowledged in Known Tensions §1; smoke-test collision resolved as "agents implement, humans verify" in §2; abandonment risk addressed with 3-consecutive-skip retro rule in §3; annual review in §4.

4. **Reviewer gates name specific veto powers.** Bashir blocks: untestable specs, missing test tasks, uncovered acceptance criteria. Picard blocks: scope creep, principle violations, speckit bypass without justification.

5. **All v1.0.0 principles preserved unchanged.** No modifications, no removals, no weakening. New principles are additive (MINOR bump).

**What I learned about constitutional drafting:**
- Synthesizing 5 team briefings requires respecting each viewpoint while making hard calls about what goes in the constitution vs. what stays as operational guidance. Bashir's full 20-item checklist is too granular for the constitution — named it as a follow-up artifact instead.
- The Borg Queen's pre-mortem was the most structurally important input. Without answering those concerns directly in the document, the proposal would be aspirational rather than credible.
- Uhura's Artifact Hygiene principle extends Principle I into the development process itself — a gap the v1.0.0 constitution didn't cover. This is the highest-urgency addition.
