# Contributing to STFC Gift Redeemer

This document covers the practices that keep the project healthy.
For the authoritative rules, read `.specify/memory/constitution.md`.
When this file conflicts with the constitution, the constitution wins.

---

## Test-first discipline for bug fixes

**The rule (Principle IX):** Every bug fix MUST include a test that reproduces the
bug — the test must fail before the fix is applied and pass after. The PR
description MUST provide proof that this sequence actually happened.

### Why the paper trail matters

A reviewer cannot inspect your local git history. If you just write a passing
test and attach it to the fix commit, there is no way to verify it ever failed.
The failing-test commit SHA in the PR description closes that gap: anyone can
check out that commit and run `npm test` to confirm the test failed there.

### Concrete example

**Step 1 — Write the failing test (commit this alone):**

```
git add tests/lib/promoCodes.test.ts
git commit -m "test(promoCodes): reproduce #42 — empty code string crashes parser"
# commit SHA: abc1234
```

Run `npm test` on this commit. It fails:

```
FAIL tests/lib/promoCodes.test.ts
  ● parsePromoCode › crashes on empty string
    TypeError: Cannot read properties of undefined (reading 'trim')
      at parsePromoCode (src/lib/promoCodes.ts:17:14)
```

Copy that output. You will paste it into the PR.

**Step 2 — Write the fix (commit this separately):**

```
git add src/lib/promoCodes.ts
git commit -m "fix(promoCodes): guard against empty code string (#42)"
# commit SHA: def5678
```

Run `npm test` again. It passes.

**Step 3 — Fill in the PR template:**

Under "Test-first evidence":
- Failing-test commit SHA: `abc1234`
- Test name + file: `parsePromoCode › crashes on empty string   tests/lib/promoCodes.test.ts`
- Failure output: _(paste the stdout from Step 1)_
- Passing output: _(paste the stdout from Step 2)_

**What happens if you skip this:** The Tester reviewer (Bashir) will leave a
`request-changes` review citing the missing evidence. The PR will not merge
until the evidence is supplied.

---

## Speckit usage

Use this decision tree to decide whether to open the Spec Kit workflow before
writing code.

### Is speckit required for my change?

**Speckit is REQUIRED if ANY of these apply (Principle VI — Pragmatic threshold):**

- The change touches more than one module or file boundary
- The change crosses more than one skill entry point
- It introduces a new user-facing capability
- You estimate more than 4 hours of implementation effort
- The change touches build configuration, CI workflows, or `package.json` scripts
- The change modifies the STFC API contract (request/response shapes, auth flow)

Start with `/speckit.specify`, then `/speckit.clarify` if anything is ambiguous,
then `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`.
Run `/speckit.analyze` and `/speckit.checklist` before opening the PR.

**Direct PR is allowed (speckit NOT required) for:**

- One-line fixes and typos
- Version bumps and routine dependency updates
- Single-file bug fixes that do not cross module boundaries or touch the API contract
- Documentation-only edits

**If you're unsure:** Use speckit. The cost of an unnecessary spec is one hour.
The cost of an unreviewed architectural decision can be weeks of rework.

---

## Review gates

PRs go through the following gates. Named reviewers hold explicit veto powers
granted by the constitution (Speckit Reviewer Gates, Development Workflow & Quality Gates).

### Bashir (Tester) — four veto powers

Bashir may issue `request-changes` or block merge at any of these four gates:

1. **Spec testability** _(before `/speckit.tasks`)_ — Acceptance criteria that
   are untestable, vague, or lack Given/When/Then structure. Edge cases listed in
   the spec with no plan to cover them.

2. **Task-level test requirements** _(before `/speckit.implement`)_ — Task lists
   that omit test tasks for user stories that have acceptance criteria. Task
   ordering that places implementation tasks before the corresponding test task
   (violates test-first).

3. **Implementation coverage mapping** _(before merge)_ — Features where one or
   more acceptance criteria in the spec do not have a corresponding passing test.

4. **Bug-fix test-first** _(before merge)_ — Bug-fix PRs without a reproducing
   test, or where the PR description does not supply the failing-test commit SHA
   and failure output proving the test was written before the fix.

### Picard (Lead) — veto powers

Picard may block at spec review (scope creep, constitutional conflicts), plan
review (architectural violations, missing Constitution Check section), and
implementation review (speckit bypass without justification).

### Artifact hygiene scan

Before merge, run Uhura's artifact-hygiene scanner on any spec, plan, or tasks
files in the diff. The scan flags JWT-shaped strings, session cookies, and real
account data that must not appear in committed artifacts (Principle VII).
See Uhura's script for invocation instructions.

### CI

All CI checks must be green before merge. The `test.yml` workflow runs
`npm test`; Scotty's pre-commit hook enforces the same gate locally.
