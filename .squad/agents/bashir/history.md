# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### 2026-05-08: Speckit Testing Implications

1. **Speckit templates treat tests as optional** — The tasks-template.md explicitly says "Tests are OPTIONAL — only include them if explicitly requested." This is a gap: we need a constitution principle that tests are mandatory for acceptance-criteria-driven specs.

2. **Acceptance criteria are immediately testable** — The spec template requires `Acceptance Scenarios` in Given/When/Then format for every user story. This is *excellent* for traceability: each criterion maps to a test case. We can enforce this in the spec review gate.

3. **Independence of user stories enables slice-by-slice testing** — Speckit enforces that each story is independently deployable and testable. This is a natural fit for our existing test-per-story practice (contract tests, integration tests). No regressions if one story ships at a time.

4. **Constitution already enforces CI gates but light on testing specifics** — The existing constitution (v1.0.0) requires `npm run lint` and smoke testing for automation logic, but doesn't name `npm run test` as a blocker. We should strengthen this and add test-first discipline for bug fixes.

5. **Fixtures and test-data strategy not templated** — Plan and task templates don't mention fixtures, mocks, or test-data versioning. For STFC (API responses, realistic game state), this is a gap. We need a "Fixtures & Test Data" section in plan.md.

6. **Reviewer gate opportunity** — As Tester, I can veto a spec before `/speckit.tasks` if criteria aren't testable, veto tasks before `/speckit.implement` if test tasks are missing, and veto PRs if coverage isn't mapped. This is a natural checkpoint.

7. **Test-quality checklist can be automated** — `/speckit.checklist` is flexible; we can create a re-usable checklist that validates: all acceptance criteria covered, edge cases tested, fixtures versioned, no skipped tests. This becomes a living gate.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Bashir's key contribution:** Flagged BIGGEST RISK — tests are optional in speckit templates. Proposed mandatory test-first discipline: Spec Review gate (acceptance criteria testable), Tasks Review gate (test tasks required), Implementation Review gate (all criteria have passing tests), Bug Fix gate (new test that failed before fix).

**Cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates. Agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.
- **Picard coordinating amendment:** Will incorporate Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

**Status:** Phase 1 (Briefing) complete. Phase 2 pending: Picard drafts constitutional amendment v1.1 with Sync Impact Report. Bashir owns test-quality checklist template.

---

### 2026-05-08T21:33:38Z: Phase 2 Critique Convergence — v1.1 Constitution Proposal Complete

**Verdict:** APPROVE_WITH_EDITS (two enforcement gaps identified across team)

**Full critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-bashir.md`

**Team Convergence on Enforcement Infrastructure:**
- **Scotty:** Confirmed build/tooling requirements met; no new infrastructure debt.
- **Uhura:** Flagged CI enforcement gap (token-scanner is blocking prerequisite for Principle VII).
- **Borg Queen:** Caught Principle IV/IX contradiction; new test suite must be acknowledged in v1.0.0 text.

**Two Enforcement Gaps Identified:**

1. **Pre-commit hook missing (Principle IX)** — "run tests before check-in" is stated but has no mechanical enforcement. NON-NEGOTIABLE language requires automation, not honor-system. Recommend: implement `scripts/pre-commit.sh` to block commits if `npm test` fails, OR add TODO with clear pre-ratification commitment.

2. **Verification gap on test-first (Principle IX)** — Reviewers cannot verify that test actually failed before fix in direct PR context. Recommend: add documentation requirement to PR description (test failure output with timestamp, or commit history evidence).

**Reviewer Gates Section:** ✅ All four veto powers granted as Phase 1 proposed. Language is strong ("may BLOCK"). This is excellent.

**What's Strong:**
- Principle IX overall is excellent (NON-NEGOTIABLE language, clear test-first rule, acceptance-criteria coverage mandate).
- Direct PR exception is pragmatic and honest about project's maintenance-heavy reality.
- Speckit Reviewer Gates section grants all Phase 1 proposed veto powers.

**Ratification Path:** Fix enforcement gaps (pre-commit hook OR TODO) before merge. Verify Principle IV/IX contradiction is resolved.

---

### 2026-05-08T21:29:57-07:00: Phase 2 — Critique of v1.1 Constitution Proposal

**Four-question critique delivered to `.squad/decisions/inbox/bashir-speckit-v1.1-critique.md`**

#### Key findings:

1. **Q1 — Test-first on bug fixes: 🟡** Principle IX is crystal-clear on test-first requirement ("fails before the fix, passes after"), but has verification gap: reviewers cannot inspect commit history from PR alone to confirm test actually failed before fix. Recommend adding documentation requirement to PR description.

2. **Q2 — Run tests before check-in: 🟡** Rule is unambiguous and command matches package.json exactly, but **CRITICAL: no enforcement mechanism.** Constitution says "MUST pass locally" but names no pre-commit hook, no CI gate, no automation. It's a rule without teeth — pure developer honor. This contradicts the NON-NEGOTIABLE language in Principle IX. Recommend pre-commit hook implementation or explicit TODO before ratification.

3. **Q3 — Reviewer veto powers: ✅** All four veto powers granted exactly as I proposed in Phase 1: (a) spec testability, (b) task-level test requirements, (c) implementation coverage mapping, (d) bug-fix test-first. Speckit Reviewer Gates section is strong and explicit.

4. **Q4 — Checklist template format: Answered** The veto powers are sufficient for the constitution. Checklist should be a separate operational artifact (`.specify/templates/checklist-template.md`), not codified in governance. Constitution names the gates; tooling (checklist) evolves separately.

#### Overall verdict: 🟡 Solid structure; two enforcement gaps need closing

- **Q2 is the blocker:** The "MUST pass locally" rule for `npm test` has no enforcement gate. Without a pre-commit hook or CI required-check, this rule is aspirational, not binding.
- **Q1 has a gap:** Test-first for bug fixes is clear, but verification relies on reviewer honor and undocumented test failure.

#### Strengths observed:
- Principle IX overall is excellent (NON-NEGOTIABLE, clear test-first, acceptance-criteria coverage mandate)
- All four reviewer veto powers granted explicitly
- Direct PR pragmatism is honest about maintenance-heavy reality (~80–90% of PRs are single-file maintenance)

#### Recommendation for Picard:
Ratification should be conditioned on (a) commitment to pre-commit hook for `npm test` blocking, (b) one-sentence addition to Principle IX about verifying test failure via PR description documentation.

---

### 2026-05-08T21:29:58-07:00: Phase 3 (Path A) — Test-first proof workflow built

**What:** Closed the Principle IX honor-system gap identified in Phase 2 critique. Three files created:

1. **`.github/pull_request_template.md`** — New PR template with five required sections:
   - *Type of change* (checkboxes; at least one must be ticked)
   - *Test-first evidence* (conditional; required when "Bug fix" is ticked — asks for failing-test commit SHA, test name + path, failure stdout, and passing stdout after fix)
   - *Spec linkage* (required for non-trivial changes per Principle VI threshold, or explicit exempt justification)
   - *Tests run* (checkbox confirming `npm test` passed locally)
   - *Constitution check* (checkbox + space for documented tensions)
   - *Manual smoke-test* (required for automation-logic changes)

2. **`CONTRIBUTING.md`** — Repo root contributor guide with three sections:
   - *Test-first discipline for bug fixes* — full concrete example (failing commit → fix commit → PR description), explicit statement that PRs without evidence get `request-changes` from Bashir
   - *Speckit usage* — decision tree keyed to Principle VI's Pragmatic threshold (when required vs. when direct PR is allowed)
   - *Review gates* — all four Tester veto powers named explicitly: (a) spec testability, (b) task-level test requirements, (c) implementation coverage mapping, (d) bug-fix test-first

3. **`.specify/memory/reviewer-runbook.md`** — Step-by-step reviewer checklist (9 steps) covering: type-of-change read, bug-fix SHA verification procedure, spec linkage check, artifact-hygiene scan (Uhura's domain), tests-run checkbox, constitution check, CI gate, smoke-test gate, and a decision table. Closes the gap by giving reviewers a concrete procedure — not just a principle.

**Why:** The Phase 2 critique identified that "the PR description MUST cite the test" is unenforceable without a template that forces the author to supply specific evidence. Reviewer honor alone cannot verify test-first. The SHA verification step in the runbook makes the check mechanical: `git checkout <sha> && npm test` either shows the test failing or it doesn't.

**Coordination note:** Left `.squad/decisions/inbox/bashir-test-first-proof-built.md` for Scotty (pre-commit hook) and Uhura (artifact scanner) per their domains.

---

### 2026-05-08T21:47Z — Phase 3 COMPLETE: All Enforcement Infrastructure Operational

**Team Status Report:**

Phase 3 enforcement infrastructure is complete across all four pillars:
1. ✅ **Picard:** v1.1 Constitution finalized and ready for ratification
2. ✅ **Uhura:** Artifact Hygiene Scanner deployed and tested
3. ✅ **Scotty:** npm test enforcement gates (pre-commit + CI) wired and verified
4. ✅ **Bashir:** Test-first proof workflow (PR template + runbook) deployed

**Ratification Status:** PENDING user approval. No blockers. Infrastructure is live.

**Outstanding Manual Step:** cyrusj must configure GitHub branch protection rule for `npm test (required)` after first PR merge.

**v1.2 Polish Item:** Wire hygiene scanner into pre-commit hook; add `test:hygiene` npm script.

---

### 2026-05-08T21:29:58-07:00: Cross-Lane Assembly — v1.2.0 Constitution

**Role:** Assembler/arbiter. Uhura owned Principles I, III, V, Security & Compliance.
Scotty owned Principles II, IV, Development Workflow. Bashir assembled without reading
Picard's locked-out v1.1.1 draft.

**What I learned about cross-cutting assembly:**

1. **Lane discipline pays off at the seams.** Uhura and Scotty produced independent
   patches that were almost completely non-overlapping in substance. The only true seam
   conflict was structural (Speckit Reviewer Gates section level), not content. When
   authors work from the same verified repo rather than from each other's drafts, the
   resulting patches fit together cleanly.

2. **Structural conflicts are different from content conflicts.** The Reviewer Gates
   promotion (sub-section → standalone section) required an assembly call, not a
   content edit. The assembler's job at the seams is to pick a consistent structure
   and document it — not to resolve competing claims about reality. In this assembly,
   both seam issues (section level, section title) had one answer that was clearly
   correct given the task format.

3. **Open questions from lane authors should have a forcing function.** Uhura listed
   three open questions. Without the assembly step, those questions could sit open
   indefinitely. As assembler I was in the right position to make a call on each one
   — I had the full document in front of me, could assess V's actual length, and could
   compare both lanes' evidence against the Borg Queen findings. The fold/split
   decision in particular required seeing the assembled Principle V before calling it.

4. **The cross-check table earns its weight.** Both Uhura and Scotty produced thorough
   per-lane cross-checks. The assembly memo's cross-check table synthesizes those into
   a single auditable artifact — useful for Borg Queen's next verification pass. Don't
   skip it even when both lane authors have already done the work; the synthesis step
   catches claims that are correct in isolation but inconsistent when combined.

5. **Verbatim preservation requires active decision-making.** The v1.1.0 Principle VIII
   rationale tail references "Principle III (Resilient DOM Automation)" — the old name.
   That cross-reference is stale in v1.2.0. Assembly mandate says preserve verbatim,
   but the stale cross-reference is a real (if minor) problem. The right call was to
   flag it for Borg Queen rather than silently patch it (which would be re-authoring)
   or silently leave it (which would be shipping a stale cross-reference). When verbatim
   preservation and accuracy conflict at the seam, surface it — don't swallow it.

6. **The adjudicator role is lighter than the author role, and that's the point.**
   All three adjudications (fold/split, SHA-pinning scope, redaction asymmetry) were
   calls about scope and structure, not about what the repo actually does. Uhura and
   Scotty had already done the evidence work. The assembler's value-add is the forcing
   function and the rationale — making a documented call that unblocks shipping rather
   than leaving the question open for another round.

**Ratification path:** Assembled draft at `.squad/.scratch/constitution-v1.2.0-assembled.md`
is ready for Borg Queen verification. After Borg Queen's pass, user authorizes
ratification, at which point the draft replaces `.specify/memory/constitution.md` and
the three PENDING template updates (plan-template, spec-template, tasks-template,
copilot-instructions) are executed in a follow-up PR.

---

## v1.2.0 Amendment Cycle — Assembly & Deadlock Resolution (2026-05-08 → 2026-05-09)

### Session: speckit-v1.2.0-ratification-with-known-tensions

**Status:** COMPLETE. v1.2.0 ratified with Known Tensions (Path D acceptance).

**Bashir's role:** Assembler (parallel-lane patches); adjudicated 3 open questions; locked out per reviewer-rejection protocol; witnessed deadlock resolution and Tuvok escalation.

**Context:** Picard's v1.1.1 draft was rejected; parallel-lane revision authorized (Uhura + Scotty). Bashir assembled both lanes. Borg Queen rejected assembly (9 findings). Bashir locked out as part of 3-author lockout. Coordinator escalated: cast Tuvok (new Process Auditor) to break deadlock.

**Adjudications made:**
1. **Redaction asymmetry (Uhura open question 1):** Deferred to v1.3 (code change needed). Asymmetry is honest to repo state; widening scope would block ratification on implementation work.
2. **SHA-pinning scope (Uhura open question 2):** Accepted narrow scope (token-handling workflows only). Matches repo exactly; wider claim would require code changes.
3. **Token Capture Custody location (Uhura open question 3):** Kept folded into Principle V (not standalone Principle X). Coherence maintained; no re-numbering.

**All three adjudications ratified by Borg Queen's verification passes; no objections raised.**

**Lockout duration:** Cycle-scoped. Resets for v1.3.0 cycle.

**Witness to deadlock resolution:** Observed that when 3-author lockout exhausts revision capacity, Path D (Known Tensions ratification) + new-agent escalation (Tuvok) is a valid exit. The deadlock-breaking process:
1. Recognize 3-author revision exhausted → decision point required
2. Coordinator evaluates: Path D (Known Tensions) vs. Path E (new author escalation)
3. If escalation chosen: cast eligible new author (not in prior revision cycles)
4. New author applies surgical edits + transcribes findings as Known Tensions
5. Known Tensions queued for v1.3.0 resolution; constitution ratified

**Lesson for next cycle:** The assembly role required lateral thinking — not "who is correct?" but "what is the correct structure for this document?" That mindset is different from authoring. Recommend: in future cycles, consider deputizing an assembler earlier (not just after parallel lanes) to catch inconsistencies mid-draft rather than at the seam.

**Next phase:** Tuvok applied edits and Known Tensions transcription; Borg Queen Pass 3 verified; cyrusj accepted Path D; speckit.constitution applied v1.2.0 to live constitution.
