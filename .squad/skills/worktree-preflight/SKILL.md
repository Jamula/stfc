---
name: "worktree-preflight"
description: "Preflight ritual for fresh git worktrees — verify node_modules, run npm ci, confirm tests pass before staging any work"
domain: "devops, platform, worktree-management"
confidence: "medium"
source: "observed — O'Brien PR #118 invitation runbook close-out (2026-06-01) + Picard P1 fanout triage forward-flag to Wave 4 #121 (2026-06-01)"
tools:
  # No MCP tools required; all steps use bash
---

## Context

When `git worktree add` creates a new worktree at `/workspaces/stfc-<N>`, the
`node_modules/` directory inside that worktree is typically a **symlink** to the
main checkout's `node_modules/`. If `package.json` has gained a dependency since
the main checkout was last installed — or if the symlink target is otherwise stale —
the worktree will fail the pre-commit hook (`npm test`) with a missing-module error.
The failure is silent until the first commit attempt and looks like a real test break.

**Rule 22 companion.** This skill is the "how" companion to Rule 22's "what"
(`copilot-instructions.md` Rule 22: "Fresh worktrees require `npm ci` before any
commit"). Rules state the what/why; this skill carries the executable procedure.

**Cross-reference:** See `.squad/skills/audit-wip-fanout/SKILL.md` for when
worktrees get spawned in the first place (wave-dispatch triage). Run this skill
immediately after `git worktree add` and before any `git add` / `git commit`.

**Evidence (≥ 2 independent observations — Picard improve-cycle bar met):**
- `decisions.md` lines 1297–1348: Rule 22 proposal — O'Brien PR #118 worktree
  missing `json-schema-to-typescript` despite being in `package.json`
- `decisions.md` lines 1307–1313: Picard P1 fanout triage forward-flagged the
  same risk to Wave 4 #121 (Scotty) on same date (2026-06-01)

---

## Procedure

Run these steps **in order** after `git worktree add` and before staging anything.

### Step 1 — Confirm working directory and branch

```bash
pwd                        # must match expected worktree path, e.g. /workspaces/stfc-118
git branch --show-current  # must match expected branch, e.g. squad/005-p1-118-runbook
```

If either is wrong, stop and reorient. Committing from the wrong branch is
irreversible without a rebase. (See Rule 9a: re-verify branch after any
branch-mutating `gh` command.)

### Step 2 — Inspect node_modules

```bash
ls -la node_modules 2>/dev/null | head -1
```

| Output starts with | Interpretation | Action |
|---|---|---|
| `lrwxrwxrwx` | Symlink to main checkout's node_modules | Run `npm ci` (Step 3) |
| `drwxr-xr-x` | Real directory | Run `npm ci` unless you're confident it's fresh |
| *(no output / error)* | node_modules missing entirely | Run `npm ci` (Step 3) |

Default is **always run `npm ci`** — it's idempotent and ~5–15 s when cache is warm.
Only skip it if you created the worktree within the same session AND have not pulled
any dependency changes.

### Step 3 — Install / refresh dependencies

```bash
cd <worktree-path>
npm ci
```

- `npm ci` installs exactly from `package-lock.json`. It is safe, repeatable, and
  does **not** rewrite `package-lock.json`.
- Do NOT use `npm install` — it can rewrite `package-lock.json` and produce a
  spurious diff that will trip the pre-commit hook.

**Cross-device symlink fallback:** On some Codespace configurations the symlink
creation for `node_modules` may fail with a cross-device link error. In that case
`npm ci` from inside the worktree is the correct fallback — it creates a real
`node_modules` dir local to the worktree. No further action needed.

### Step 4 — Verify build tools accessible

After `npm ci`, spot-check the tools your work will use:

```bash
node_modules/.bin/tsx --version    # required for npm test (tsx runner)
node_modules/.bin/tsc --version    # required for npm run typecheck
```

If either is missing after `npm ci`, the package is not in `package.json`.
That is a real dependency gap — raise it before proceeding; do NOT work around it.

### Step 5 — Run the test suite on the clean base

```bash
npm test
```

A green run here proves:
1. The pre-commit hook will pass your commit.
2. Any test failures introduced by your work are **your** failures, not inherited
   from a broken base state.

A red run here means something is broken in the base worktree — fix THAT before
adding your work. Do NOT paper over base failures with your commits.

**Only after Steps 1–5 all pass should you begin staging changes (`git add`).**

---

## Failure modes

| Symptom | Likely cause | Remedy |
|---|---|---|
| `Cannot find module 'json-schema-to-typescript'` and package is in `package.json` | Stale symlinked `node_modules` | `npm ci` in the worktree |
| `vite: not found` (or any CLI tool from devDependencies missing) | Same root cause as above | `npm ci` in the worktree |
| `Cannot find module 'xxx'` and `xxx` is NOT in `package.json` | Real test break | Fix the test or the source; don't `npm install` the missing dep without adding it to `package.json` first |
| Pre-commit passes once, then fails on next commit in same worktree | Background process modified `node_modules` | `npm ci` again to reset |
| `npm ci` itself fails with EINTEGRITY or lock-mismatch | `package-lock.json` out of sync with `package.json` | Run from main checkout: `npm install && git add package-lock.json && git commit -m "chore: update lockfile"` then re-run `npm ci` in worktree |
| Cross-device symlink error creating `node_modules` symlink | Host filesystem doesn't support cross-device links | `npm ci` without symlink — creates real dir in worktree; proceed normally |

If `npm ci` itself fails and you cannot self-remediate, **stop and report to
O'Brien.** The base worktree state is broken and needs platform attention. Do NOT
try to work around a broken install — you'll produce commits that only build on
your machine.

---

## Anti-Patterns

- ❌ **`npm install` instead of `npm ci`** — rewrites `package-lock.json`, creates
  spurious diff, can introduce version drift.
- ❌ **Skipping Step 5** — if the base state is red and you commit on top of it, it
  looks like your changes broke tests. Discovering this mid-review is expensive.
- ❌ **Working around missing modules** — if `tsx` or another tool is absent after
  `npm ci`, the issue is structural; adding `node_modules/.bin/tsx` manually or
  patching PATH is not a fix.
- ❌ **Skipping the preflight when re-using an existing worktree** — stale worktrees
  from interrupted sessions carry the same dependency-freshness risk as brand-new ones.
  Run at least Step 5 (`npm test`) when picking up a parked worktree.
- ❌ **Running preflight from the main checkout** — all steps must execute from inside
  `<worktree-path>`. `npm ci` installs into the CWD.

---

## Examples

### Happy path — new worktree for issue #121

```bash
# Coordinator dispatches Wave 4 agent for #121 (Scotty's routes issue)
git worktree add /workspaces/stfc-121 -b squad/005-p1-121-scotty-routes origin/main
cd /workspaces/stfc-121

# Step 1
pwd                        # /workspaces/stfc-121 ✓
git branch --show-current  # squad/005-p1-121-scotty-routes ✓

# Step 2
ls -la node_modules | head -1  # lrwxrwxrwx → symlink detected

# Step 3
npm ci                     # ~10s, exits 0

# Step 4
node_modules/.bin/tsx --version  # 4.x.x ✓
node_modules/.bin/tsc --version  # 5.x.x ✓

# Step 5
npm test                   # 90 tests passed ✓

# All green — begin work
```

### Recovery path — O'Brien PR #118 observed failure (2026-06-01)

```bash
cd /workspaces/stfc-p1

# First commit attempt hit: "Cannot find module 'json-schema-to-typescript'"
# json-schema-to-typescript IS in package.json → stale symlinked node_modules

npm ci                     # resolves the stale symlink; exits 0
npm test                   # confirms green pre-commit gate

# Commit proceeds successfully
```
