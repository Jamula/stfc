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

Before removing a worktree, preserve its uncommitted `.squad/` artifacts in the
main checkout without overwriting existing history, decisions, or logs. Follow
the canonical git-workflow skill's Rule 8 copy and verification procedure
before removing the worktree.
