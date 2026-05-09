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
