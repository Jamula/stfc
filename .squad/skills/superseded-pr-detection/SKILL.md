# Skill: Superseded-PR Detection (pre-review filter)

**Owner:** Picard (M2 / EM) — also applicable to Kirk (Lead) on technical reviews.
**Created:** 2026-05-17
**Triggered by:** PR #6 (governance v1.3.0 amendment) where the substantive
content reached `main` via a parallel path before the review session ran,
leaving the PR diff content-empty of the work it claimed to do.

## When to use

Before drafting any review verdict (approve / request-changes / escalate /
close) on a long-lived PR. Especially:

- Governance / constitution amendment PRs
- Any PR older than the most recent `main` HEAD by a non-trivial number of
  commits
- Any PR with a `mergeStateStatus` other than `CLEAN` or `BLOCKED` for a
  visible reason
- Any PR that has been touched by autonomous conflict-resolution
  (`@copilot` edits, GitHub auto-merge resolver, etc.)

## The 30-second check

```bash
# 1. Files actually changing on main vs. PR head.
gh pr diff <N> --name-only

# 2. Read the PR body's "files changed" / "edit summary" section.
gh pr view <N> --json body -q .body | head -80
```

If `(1)` does not substantively overlap with `(2)`, the PR is superseded.
Confirm with:

```bash
# 3. Cheap content spot-check on main for the claimed edits.
git fetch origin main
git show origin/main:<path-the-PR-claims-to-edit> | grep -nE '<load-bearing-token>'
```

For governance PRs the load-bearing tokens are typically:
- Constitution version line (`Version change: X.Y.Z → A.B.C`)
- Section heading the amendment introduces or renames
- Concrete new enumeration values (e.g., `DISCORD_BOT_TOKEN`, path lists)

## Verdict options when superseded

| Residual diff | Right action |
|---|---|
| Empty | Close without merge. |
| Scribe-owned only (`.squad/agents/*/history.md`, `.squad/decisions/*`, `.squad/log/*`, `.squad/orchestration-log/*`) | Close without merge; ask Scribe to port the residue to `main` in a normal Scribe commit. |
| Non-trivial substantive bytes | Treat as a fresh PR — review on its real scope, not the original framing. |

## What this skill is NOT

- It is **not** a substitute for reviewing the PR on its merits when the
  diff IS substantive.
- It is **not** an excuse to skip the
  `.specify/templates/plan-template.md` re-sync grep on governance
  amendments — that check still runs against the **content on main** if
  the PR is superseded.

## Anti-patterns this skill prevents

1. **Approving an empty PR** that looks substantive because the body
   describes the work that has already merged elsewhere.
2. **Requesting changes on an empty PR** — wastes a revision cycle on a
   PR that should just be closed.
3. **Wasting a Borg Queen / Garak hostile-fact-check pass** on content
   that the PR doesn't actually change.
4. **Triggering or waiving a stuck required check** on a PR that should
   be closed regardless of check status (the check is a symptom; the
   real issue is the PR itself).

## Cross-references

- `.github/copilot-instructions.md` §2 (`.squad/` write boundary — only
  Scribe commits there)
- `.github/copilot-instructions.md` §4 (`main` diverges from `origin/main`
  constantly — rebase before every push) — same root cause class
- `.squad/skills/amendment-audit/SKILL.md` — runs AFTER this skill confirms
  the PR is real
