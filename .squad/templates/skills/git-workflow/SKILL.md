---
name: "git-workflow"
description: "Pointer to Jamula/stfc's canonical main-only git workflow"
domain: "version-control"
confidence: "high"
source: "team-decision"
---

## Canonical Source

The canonical git workflow skill for Jamula/stfc lives at `.github/skills/git-workflow/SKILL.md`. Keep this template as a pointer instead of duplicating the full workflow so the supported branch model cannot drift between copies.

## Supported Branch Model

Jamula/stfc uses a **main-only** branch model. Issue branches use `squad/{issue-number}-{kebab-case-slug}` and pull requests target `main`.

## Recorded Decision Summary

- **Scope:** `main` is the supported branch model for this repository.
- **Technical:** Do not implement code or workflow paths that depend on persistent `dev`, `preview`, `insider`, or `insiders` refs unless a future architecture decision first defines branch creation, protection, validation, rollback, and ownership.
- **Operations:** Keep CI and release workflows aligned with refs that actually exist on the remote, and keep retired promotion, preview, docs, insider, and legacy CI workflow templates absent.

## Push and Review Handoff

Push the issue branch with:

```bash
git push -u origin squad/{issue-number}-{slug}
```

`gh pr ready` is a handoff action, not a normal workflow step. Do not run it
automatically. Only run `gh pr ready` when the user explicitly requests that
exact action in the current, active conversation.
In particular, a prior turn, stale context, or an inference from CI/review status never authorizes it.
This handoff guard follows issue #220.

## Worktree Cleanup

Before removing a worktree, resolve its configured state backend and
team-root strategy. For `local`/`worktree` backends using the
**worktree-local** strategy,
branch-local `.squad/` state exists only inside that worktree and is lost
when the worktree is removed; snapshot and verify it into the main checkout
using the procedure below regardless of state-tool availability. Skip the
snapshot only when the worktree uses the **main-checkout** strategy, where
`.squad/` state already lives in the main checkout and nothing is isolated.
For `orphan`, `two-layer`, or `git-notes` backends, reconcile and clean
mutable state only through the configured state tools using canonical
logical paths (for example, `agents/{agent}/history.md`,
`decisions/decisions.md`, `identity/now.md`, and `log/{timestamp}-{topic}.md`).
Never read or copy a worktree `.squad/` checkout snapshot for these backends.
If any required state tool is unavailable for these backends, fail closed,
leave the worktree in place, and report the missing bridge.

#### Local/worktree checkout-snapshot transfer (required for the worktree-local strategy)

Follow the canonical git-workflow skill's snapshot and verification procedure.
Do not use that checkout-snapshot procedure for `orphan`, `two-layer`, or
`git-notes` backends, or when the worktree used the main-checkout strategy
(state already lives in the main checkout).
