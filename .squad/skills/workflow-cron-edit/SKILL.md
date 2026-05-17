# Skill: workflow-cron-edit

**Owner:** Uhura (integrations) — but applicable to any agent touching
`.github/workflows/*.yml`.

**When to use:** Any task that changes a `cron:`, `concurrency:`,
`permissions:`, or other literal value inside a workflow file.

## The 4-step recipe

1. **Read the cron field semantics out loud.**
   GitHub Actions cron is `MIN HOUR DOM MONTH DOW`. DOW uses
   `0=Sunday … 6=Saturday`. State the resulting cadence in plain
   English in both the in-file comment and the PR body (e.g.
   `0 0 * * 6` → "every Saturday at 00:00 UTC"). Reviewers should
   not need to mentally parse the cron string.

2. **Run the pinning-test grep BEFORE committing.**
   ```bash
   grep -rn '<workflow-file>' tests/
   ```
   - If any test pins a literal from this workflow (cron string,
     concurrency group, permission scope), update it in the **same
     commit** (per `.github/copilot-instructions.md` Rule 3). The
     pre-commit hook will reject mismatches anyway, but landing
     both edits together avoids a redo cycle.
   - If the grep is empty, **say so explicitly in the PR body** so
     reviewers know the one-file diff was intentional rather than an
     oversight.

3. **Document the concurrency surface in a comment.**
   Workflows that share `concurrency.group` (today:
   `stfc-gift-redeemer` ties `refresh-token.yml`, `redeem.yml`, and
   the incoming `discord-monitor.yml`) can queue or cancel each other.
   When you move a schedule, add a 1–2 line comment above
   `schedule:` describing the new cadence AND the worst-case
   interaction with neighbours. Future readers should not have to
   reconstruct the trade-off.

4. **Rebase on `origin/main` immediately before pushing.**
   `redeem.yml`'s every-15-minute `chore(history): append …` commits
   move `origin/main` constantly (Rule 4). Always:
   ```bash
   git fetch origin
   git rebase origin/main   # only if behind
   git push -u origin <branch>
   ```
   The `chore(history)` commits only touch `docs/redeem-history.md`,
   so rebases are conflict-free in practice.

## PR norms

- Single-file workflow tweaks ship as **normal PRs** (not drafts) when
  tests pass and the diff is one cron / group / permission line.
- Commit message format: `feat(workflows): #<issue> <one-line scope>`.
- Commit body (HEREDOC) MUST include `Closes #<issue>` and a short
  rationale. The PR description should mirror the rationale and add
  the pinning-test note from step 2.

## Don'ts

- Don't `git add .github/` or any broad glob — it can sweep in
  unrelated Scribe-owned files. Stage the workflow path explicitly:
  `git add -- .github/workflows/<file>.yml`.
- Don't `git commit --no-verify`. The pre-commit hook runs `npm test`;
  if it fails, fix the failure rather than bypass the hook.
- Don't commit `.squad/` paths from this skill's session — Scribe
  owns those commits. History/decision/skill files you write in this
  session should stay uncommitted.

## Provenance

Captured 2026-05-17 from Issue #14 / PR #20 (refresh-token.yml moved
from Sunday 04:00 UTC to Saturday 00:00 UTC). See
`.squad/agents/uhura/history.md` and
`.squad/decisions/inbox/uhura-14-refresh-cron.md` for the full
narrative.
