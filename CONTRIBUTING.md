# Contributing to STFC Gift Redeemer

This document covers the practices that keep the project healthy.
For the authoritative rules, read `.github/copilot-instructions.md`.
When this file conflicts with repo rules, the repo rules win.

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

Reviewers can request the missing evidence before approving a bug-fix PR.

---

## Planning expectations

Use a short written plan in the issue or PR description for non-trivial work,
especially when the change crosses modules, touches CI/build config, or changes
API contracts. Single-file fixes, typos, and docs-only edits can go straight to
implementation.

---

## Review and CI

Review changes for correctness, security, and coverage of the documented
acceptance criteria. Do not commit credentials or real account data: the
pre-commit hook and `artifact-hygiene.yml` scan applicable files for leaks.

The `test-gate.yml` workflow runs `npm run typecheck` and `npm test` for both
the root package and the worker. Run the relevant commands locally and report
the results in the pull request. The pre-commit hook runs the root test suite.

Ready PRs from branches in this repository targeting the default branch are
automatically enrolled in squash auto-merge. The workflow also reconciles open
PRs every 15 minutes, including those created by GitHub Actions, and will
re-enable auto-merge if it is manually disabled. Drafts and fork PRs are excluded.
Use a draft to keep a same-repository PR from being enrolled.

The default-branch ruleset must strictly require the GitHub Actions checks
`npm test (required)` and `verify` (Protected paths). GitHub also enforces any
other required checks, reviews, and rules before merging. Do not require checks
from workflows that do not run on every PR; they can leave PRs blocked. The
automation fails if its two baseline required checks are missing, and reports
other API or permission failures in its workflow run. GitHub Actions must be
allowed to create and approve pull requests for its token to enable auto-merge.
