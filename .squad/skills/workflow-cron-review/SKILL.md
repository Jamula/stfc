# Skill: workflow-cron-review

> Reusable review pattern for PRs that change a cron expression (or any literal value) in `.github/workflows/*.yml`. Distilled from Kirk's review of PR #20.

## When to apply

A PR that:

- Edits one or more `.github/workflows/*.yml` files
- Changes a `schedule.cron` value, a `concurrency.group` name, a `permissions:` scope, or any other literal that downstream code might pin

## The four-check pattern

### 1. Decode the cron literal explicitly

GitHub Actions cron format: `MIN HOUR DOM MONTH DOW`, where **DOW=0 is Sunday** and **DOW=6 is Saturday** (some other systems treat 7 as Sunday — GitHub does not).

Always restate the decoded meaning in plain English in the review body. Don't assume the PR author got the day-of-week right just because the comment claims they did.

### 2. Check the pinning-test rule (repo Rule 3)

Per `.github/copilot-instructions.md`, workflow-YAML literal changes and the tests that pin them must land in the **same commit**.

Run two greps from the repo root:

```bash
grep -rn '<workflow-file-stem>' tests/         # e.g. 'refresh-token'
grep -rn '"<new-literal>"\|<old-literal>' tests/  # cron, group name, etc.
```

- **Both empty:** Rule 3 does not apply. Note this explicitly in the review.
- **Either matches:** Verify the matching test was updated in the same commit. If not, REQUEST CHANGES and route to Tuvok (pinning-test sync) per the reviewer-rejection lockout.

### 3. Permissions and concurrency sanity

- `permissions:` should be the minimum the job needs. Default `contents: read` is fine; anything broader (`contents: write`, `secrets: write`, `id-token: write`) needs an in-comment justification or a decision-record link.
- If the workflow touches `STFC_ACCOUNTS` or any other shared mutable state, it MUST be in `concurrency.group: stfc-gift-redeemer` (or whatever the project's established serialization group is). `cancel-in-progress: false` is the safe default for work that shouldn't be dropped mid-flight.
- Secret writes go through dedicated PATs (e.g. `STFC_REFRESH_PAT`), not `GITHUB_TOKEN`. If the PR introduces a new secret write path via `GITHUB_TOKEN`, that's a red flag.

### 4. Surgical scope

For a cron-only change, the diff should be ≈1–10 lines in a single workflow file. Comments documenting rationale (cadence reason, dependency on other issues/workflows, concurrency interactions) ARE acceptable scope expansion — they're architecture-as-comment and belong in the workflow file where future editors will see them, not in the PR description that gets buried.

Anything beyond that — touching source, tests, or other workflows — needs explicit justification. If unjustified, REQUEST CHANGES.

## Operational gotchas

- **`gh pr review --approve` fails when authed as the PR author** ("Can not approve your own pull request"). Workaround: post the approval body as `--comment`, then `gh pr merge`. The squad's textual sign-off + the merge action are the record.
- **`gh pr merge --delete-branch` fails the local-branch step in worktree mode** when another worktree has the target branch checked out (`fatal: '<branch>' is already used by worktree at '<path>'`). The **remote** branch deletion still succeeds before this error. Verify with `git ls-remote --heads origin <branch>` and clean local branches via the owning worktree.

## Template review body

```
## APPROVE — <Reviewer> (<Role>)

### Checks against review criteria

1. **Cron expression** — `<literal>` decodes to <plain English UTC time + day>. ✅
2. **Pinning-test regression guards** — `grep -rn '<stem>' tests/` returns <N> matches. <Rule 3 N/A | Tests updated in same commit at <SHA>>. ✅
3. **Permissions / concurrency** — `permissions: <scope>` (minimal). `concurrency.group: <group>` correctly serializes <shared resource>. ✅
4. **Scope** — <N-file diff, +X/-Y>. <Justification for any non-trivial additions>. ✅

### Notes for the record

- <CI status>
- <Architectural intent of the cadence/change>
- <Any side-effect or interaction worth flagging>
```

## Citations / origin

- Established 2026-05-17 by Kirk while reviewing PR #20 (Issue #14, refresh-token.yml Saturday 00 UTC).
- Builds on `.github/copilot-instructions.md` Rule 3 (workflow YAML + pinning tests same commit).
- Builds on constitution Principle II (reviewer-rejection lockout) for the REQUEST CHANGES path.
