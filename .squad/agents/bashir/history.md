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
