# Reviewer Runbook — STFC Gift Redeemer

**Audience:** Bashir (Tester) and Picard (Lead), acting as PR reviewers.

This runbook makes Principle IX and the Speckit Reviewer Gates real.
Principles without a checklist are theatre. Follow these steps in order.

---

## Step 1 — Read the type of change

Open the PR. Find the "Type of change" section. Confirm at least one box is
ticked. If no box is ticked, request changes immediately — the template was
not filled in.

Note which boxes are ticked. Your subsequent steps depend on them.

---

## Step 2 — Bug fix? Verify test-first evidence

**Only if "Bug fix" is ticked.**

The PR description must contain:
- A failing-test commit SHA (or intra-PR commit hash)
- The test name and file path
- Failure output from `npm test` on the failing commit
- Passing output from `npm test` after the fix commit

**Verification procedure:**

```bash
git fetch origin
git checkout <failing-test-sha>
npm test 2>&1 | grep -A 5 "<test name from PR>"
```

The test named in the PR MUST appear in the failure output on that commit.
If the test passes on the failing-test commit, the test-first claim is false.
Issue `request-changes`: "Test named in PR description does not fail on commit
`<sha>`. Cannot confirm test was written before the fix. Please provide a
commit where the test exists and fails."

If the failing-test SHA is an intra-PR commit (not yet on `main`), fetch the
PR branch and check out that commit:

```bash
git fetch origin pull/<PR-number>/head:pr-<PR-number>
git checkout <intra-pr-sha>
npm test
```

**Common failure mode to watch for:** Author writes test and fix in the same
commit, then claims the SHA is "the failing test commit." One commit cannot
be both. Ask for the commit where only the test exists.

---

## Step 3 — Non-trivial change? Verify spec linkage

A change is non-trivial if it meets any of the Principle VI criteria:
multi-file, cross-skill, new feature, >4 hr, build-config, API contract.

If the PR description claims "exempt" but the diff spans multiple modules or
touches the API layer, challenge that claim: "This diff touches `src/lib/` and
`src/api/` — that is multi-file/cross-module. Please link the corresponding spec
or open one before this PR proceeds."

If a spec is linked, open `.specify/features/<NNN-slug>/spec.md` and verify:
- The spec covers the change described in the PR (not a different feature).
- Every acceptance criterion that the PR claims to address has a corresponding
  test in the diff or in the existing test suite.
- The plan's Constitution Check table lists the principles touched and confirms
  non-violation (or documents a justified deviation).

---

## Step 4 — Run the artifact-hygiene scan (mentally or via script)

For any PR that modifies a file under `.specify/features/` (spec, plan, tasks),
invoke Uhura's artifact-hygiene scanner on those files. The scan looks for:
- JWT-shaped strings (`eyJ...`)
- Session cookies or bearer tokens
- Real account names, player IDs, or gift IDs
- Raw HTTP response bodies from live accounts

If the scanner is not yet wired as a CI check, run it locally:

```bash
# Per Uhura's scanner script — check her domain for invocation details
```

Flag any hit as a blocker. Real tokens in committed artifacts are a security
incident, not a style issue (Principle VII).

---

## Step 5 — Check the "Tests run" checkbox

The PR description must have `npm test` checkbox ticked. If unticked:
- If Scotty's pre-commit hook is active, the author could not have committed
  without tests passing — treat as an oversight in the form, not a red flag.
- If the hook is not yet active (early project phase), verify CI `test.yml`
  is green. If CI is red and the checkbox is unticked, that is a blocker.

---

## Step 6 — Check the "Constitution check" checkbox

The constitution check box must be ticked. If there is a tension noted, read
it against the relevant principle. Tensions require:
- An entry in the plan's Complexity Tracking table (if a plan exists), OR
- A clear, defensible justification in the PR description.

Vague justifications ("it's fine for now," "we'll fix later") are not
acceptable. Constitutional deviations require explicit acknowledgment and a
path back to compliance.

---

## Step 7 — Verify CI checks are green

Do not approve a PR with a failing `test.yml` run. Ever. Even if "it's a
flake." If it's a flake, the author must fix the flake or file a tracked
issue explaining why the test is unreliable.

Other CI failures (lint, build) are equally blocking per the Development
Workflow & Quality Gates.

---

## Step 8 — Smoke-test gate (automation changes only)

If the diff touches redemption flow, selector logic, or auth detection, the
PR description must confirm manual smoke-testing against the live STFC store
(both extension and web app). Agent-authored code is not exempt from this
gate (see "Known Tensions — Smoke-Test / Agent-Implementation Collision" in
the constitution).

If the smoke-test section is blank and the diff touches automation logic:
issue `request-changes`. Agents implement; humans verify.

---

## Step 9 — Decide

| Condition | Action |
|---|---|
| All steps pass | **Approve** |
| Fixable gaps (missing evidence, blank sections) | **Request changes** — be specific about what is missing |
| Test-first claim is provably false | **Request changes** — name the exact commit that disproves the claim |
| Constitutional violation with no justification | **Request changes** — cite the principle number |
| Spec-bypass for non-trivial work | **Block** — route to speckit workflow before review restarts |
| Token/secret found in artifact | **Block** — flag as security issue; do not merge |

---

## Principles this runbook enforces

- **Principle VI** — Specification-First Governance (spec linkage, trigger threshold)
- **Principle VII** — Artifact Hygiene (token scan)
- **Principle IX** — Test-First Discipline (bug-fix evidence, npm test gate)
- **Speckit Reviewer Gates** — Bashir's four veto powers; Picard's three veto powers
- **Development Workflow & Quality Gates** — smoke-test requirement, CI gates

Without this runbook, those principles are aspirational. With it, they are checkable.
