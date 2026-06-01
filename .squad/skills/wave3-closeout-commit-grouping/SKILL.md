# Wave 3 Close-out Commit Grouping

Use this skill when an epic branch has multiple fully-finished WIP groups from different owners and needs a clean close-out PR.

## Goal

Convert mixed uncommitted Wave WIP into reviewable, issue-aligned commits without leaking files across issue boundaries.

## Procedure

1. Run pre-flight in the worktree: fetch, `log origin/main..HEAD`, `status --short`, and a quick test run.
2. Stage files **individually** per issue group (especially shared dirs like `tests/ci/`).
3. Commit each group with explicit issue references and co-author trailers.
4. Push branch, then create/update one PR whose body has one `Closes #N` per line.
5. Verify with `gh pr view` + `gh pr checks` and hand off reviewer-specific focus points.

## Guardrails

- In worktrees, do not write commit-message files under `.git/`; use repo-root temporary files.
- Never use broad `git add` patterns that can sweep unrelated files.
- If checks are pending, treat non-zero `gh pr checks` as status feedback, not a merge blocker yet.
