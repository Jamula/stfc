---
name: "git-workflow"
description: "Main-only branching, protected pull requests, and safe worktree state"
domain: "version-control"
confidence: "high"
source: "team-decision"
---

## Context

`main` is the only persistent development and release branch. Feature and issue
branches normally start from and target `main`; use a different base only for an
explicitly requested or genuinely dependent stack. Issue branches follow
`squad/{issue-number}-{kebab-case-slug}` when the host permits branch naming.

## Pull requests

Work in the assigned checkout or app-managed worktree. Stage only intended
changes, inspect the staged diff, and respect the repository's hooks and tests.
When a PR is requested, follow its template and target the intended base. Opening
a PR does not authorize marking it ready, merging, enabling automatic merging,
deploying, or spending money. Preserve required reviews and branch protections.
The existing `Release` and `Deploy SWA` workflows run from `main`; do not create
competing release or deployment paths.

## Parallel worktrees and state

Use separate worktrees when parallel changes can safely be isolated. Do not
switch branches in a checkout shared by another session. Before removing a
worktree, inspect it for uncommitted changes, ongoing work, and local state.
Resolve the configured state backend first: for local/worktree fallback, make
and verify a snapshot of mutable state before removal; local state tools alone
do not transfer that state. For a non-local backend, use its state tools
exclusively and do not copy, merge, or rewrite runtime state through Git.

In this repository the `two-layer` bridge owns mutable Squad state. Read
`decisions.md` and agent histories through the bridge; submit proposals through
`decisions/inbox/`. The tracked casting registry, history, and commit marker use
the native atomic casting protocol. Never bypass an unavailable bridge with
local files or Git operations.
