---
name: "git-workflow"
description: "Squad branch workflow for Jamula/stfc: main-only development"
domain: "version-control"
confidence: "high"
source: "team-decision"
---

## Context

Jamula/stfc uses a **main-only** branch model. The repository does not have persistent `dev`, `preview`, `insider`, or `insiders` branches, and issue and pull-request work targets `main` directly.

| Branch | Purpose | Publishes |
|--------|---------|-----------|
| `main` | Default branch for feature work, fixes, scheduled workflows, and releases | Release workflows and scheduled automation run from main |

## Recorded Decision

- **Picard (scope):** Retire the dormant multi-branch promotion path for this repository and document `main` as the supported branch model.
- **Kirk (technical):** Do not implement code or workflow paths that depend on persistent `dev`, `preview`, `insider`, or `insiders` refs unless a future architecture decision first defines branch creation, protection, validation, rollback, and ownership.
- **O'Brien (operations):** Keep CI and release workflows aligned with the refs that actually exist on the remote. Retired promotion, preview, docs, insider, and legacy CI workflow templates must stay absent so operators cannot dispatch an unreachable release train.

## Branch Naming Convention

Issue branches MUST use: `squad/{issue-number}-{kebab-case-slug}`

Examples:
- `squad/195-fix-version-stamp-bug`
- `squad/42-add-profile-api`

## Workflow for Issue Work

1. **Branch from main:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b squad/{issue-number}-{slug}
   ```

2. **Mark issue in-progress:**
   ```bash
   gh issue edit {number} --add-label "status:in-progress"
   ```

3. **Create draft PR targeting main:**
   ```bash
   gh pr create --base main --title "{description}" --body "Closes #{issue-number}" --draft
   ```

4. **Do the work.** Make changes, write tests, commit with issue reference.

5. **Push:**
   ```bash
   git push -u origin squad/{issue-number}-{slug}
   ```

5a. **Mark ready for review (explicit-request only, issue #220):** `gh pr ready` is a handoff action, not a normal workflow step. Do **not** run it automatically after pushing. Only run `gh pr ready` when the user explicitly requests that exact action in the current, active conversation — a prior turn, stale context, or an inference from CI/review status never authorizes it. Until that request happens, leave the PR in draft and report that it is ready for review.

6. **After merge to main:**
   ```bash
   git checkout main
   git pull origin main
   git branch -d squad/{issue-number}-{slug}
   git push origin --delete squad/{issue-number}-{slug}
   ```

## Parallel Multi-Issue Work (Worktrees)

When the coordinator routes multiple issues simultaneously (e.g., "fix bugs X, Y, and Z"), use `git worktree` to give each agent an isolated working directory. No filesystem collisions, no branch-switching overhead.

### When to Use Worktrees vs Sequential

| Scenario | Strategy |
|----------|----------|
| Single issue | Standard workflow above — no worktree needed |
| 2+ simultaneous issues in same repo | Worktrees — one per issue |
| Work spanning multiple repos | Separate clones as siblings (see Multi-Repo below) |

### Setup

From the main clone:

```bash
# Ensure main is current
git fetch origin main

# Create a worktree per issue — siblings to the main clone
git worktree add ../stfc-195 -b squad/195-fix-stamp-bug origin/main
git worktree add ../stfc-193 -b squad/193-refactor-loader origin/main
```

**Naming convention:** `../{repo-name}-{issue-number}` (e.g., `../stfc-195`, `../stfc-pr-42`).

Each worktree:
- Has its own working directory and index
- Is on its own `squad/{issue-number}-{slug}` branch from main
- Shares the same `.git` object store (disk-efficient)

### Per-Worktree Agent Workflow

Each agent operates inside its worktree exactly like the single-issue workflow:

```bash
cd ../stfc-195

# Work normally — commits, tests, pushes
git add -A && git commit -m "fix: stamp bug (#195)"
git push -u origin squad/195-fix-stamp-bug

# Create PR targeting main
gh pr create --base main --title "fix: stamp bug" --body "Closes #195" --draft
```

All PRs target `main` independently. Agents never interfere with each other's filesystem.

### .squad/ State in Worktrees

The `.squad/` directory exists in each worktree, but Git merge does not reconcile its mutable state:
- Mutable `.squad/` state (history, decisions, logs) is owned by the configured state backend and addressed through logical keys (e.g. `agents/{agent}/history.md`, `decisions/decisions.md`). A worktree's physical `.squad/` path is a local/worktree-backend fallback only, never a cross-branch reconciliation mechanism.
- Do not rely on `.gitattributes` `merge=union` to reconcile `.squad/` runtime state across worktrees or branches — union merge is not a persistence mechanism for backend-owned state.
- **Rule:** Never rewrite or reorder `.squad/` files in a worktree — append only. Persist mutable state through the configured backend; see `.squad/templates/worktree-reference.md` for backend resolution.

### Cleanup After Merge

After a worktree's PR is merged to main:

Before removing a worktree, resolve its configured state backend. For
`local`/`worktree` backends, use the configured state tools with canonical
logical paths when available; the checkout-snapshot fallback below is
permitted only when those tools are unavailable. For `orphan`, `two-layer`, or
`git-notes` backends, reconcile and clean mutable state only through the
configured state tools using canonical logical paths (for example,
`agents/{agent}/history.md`, `decisions/decisions.md`, `identity/now.md`, and
`log/{timestamp}-{topic}.md`). Never read or copy a worktree `.squad/`
checkout snapshot for these backends. If any required state tool is
unavailable, fail closed, leave the worktree in place, and report the missing
bridge.

#### Local/worktree checkout-snapshot fallback (only when state tools unavailable)

Use a unique staging directory under `.squad/worktree-inbox/`; never overwrite
the main checkout's state or reuse an existing destination. Scribe consumes and
verifies each snapshot before deleting it. The commands below are only for
`local`/`worktree` backends when configured state tools are unavailable.

On Linux or macOS:

```bash
source="../stfc-195/.squad"
snapshot=".squad/worktree-inbox/stfc-195"
set -e
test -d "$source"
test ! -e "$snapshot" || { echo "Choose a new snapshot path" >&2; exit 1; }
head_sha=$(git -C ../stfc-195 rev-parse HEAD)
mkdir -p "$snapshot/squad"
cp -a "$source/." "$snapshot/squad/"
printf '{"worktree_id":"stfc-195","head_sha":"%s"}\n' "$head_sha" > "$snapshot/manifest.json"
diff -qr "$source" "$snapshot/squad"
```

On Windows PowerShell:

```powershell
$source = "..\stfc-195\.squad"
$snapshot = ".squad\worktree-inbox\stfc-195"
if (-not (Test-Path -LiteralPath $source)) { throw "Missing .squad source" }
if (Test-Path -LiteralPath $snapshot) { throw "Choose a new snapshot path" }
$headSha = git -C ..\stfc-195 rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or -not $headSha) { throw "Failed to read worktree HEAD" }
$squadSnapshot = Join-Path $snapshot "squad"
New-Item -ItemType Directory -Path $squadSnapshot -Force | Out-Null
$manifest = @{ worktree_id = "stfc-195"; head_sha = $headSha } | ConvertTo-Json -Compress
Set-Content -LiteralPath (Join-Path $snapshot "manifest.json") -Value $manifest -Encoding utf8
robocopy $source $squadSnapshot /E /COPY:DAT /DCOPY:DAT
if ($LASTEXITCODE -ge 8) { throw "Failed to preserve .squad artifacts" }
robocopy $source $squadSnapshot /E /COPY:DAT /DCOPY:DAT /L /NJH /NJS /NDL /NFL
if ($LASTEXITCODE -ne 0) { throw "Snapshot verification found differences" }
```

```bash
# From the main clone. Preserve any non-.squad changes before force-removing.
git -C ../stfc-195 status --short
git worktree remove --force ../stfc-195
git worktree prune          # clean stale metadata
git branch -d squad/195-fix-stamp-bug
git push origin --delete squad/195-fix-stamp-bug
```

Do not force-remove a worktree until the snapshot is verified and any
non-`.squad/` uncommitted changes are preserved separately. If a worktree was
deleted manually, `git worktree prune` recovers the metadata but cannot
recover its files.

---

## Multi-Repo Downstream Scenarios

When work spans multiple repositories (for example, an external tool or app depends on Jamula/stfc):

### Setup

Clone downstream repos as siblings to the main repo:

```
~/work/
  stfc/              # main repo
  downstream-sdk/    # downstream dependency
  user-app/          # consumer project
```

Each repo gets its own issue branch following its own naming convention. If the downstream repo also uses Squad conventions, use `squad/{issue-number}-{slug}`.

### Coordinated PRs

- Create PRs in each repo independently
- Link them in PR descriptions:
  ```
  Closes #42

  **Depends on:** downstream-sdk PR #17 (downstream changes required for this feature)
  ```
- Merge order: dependencies first, then dependents.

### Local Linking for Testing

Before pushing, verify cross-repo changes work together:

```bash
# Node.js / npm
cd ../downstream-sdk && npm link
cd ../stfc && npm link downstream-sdk

# Go
# Use replace directive in go.mod:
# replace github.com/org/downstream-sdk => ../downstream-sdk

# Python
cd ../downstream-sdk && pip install -e .
```

**Important:** Remove local links before committing. `npm link` and `go replace` are dev-only — CI must use published packages or PR-specific refs.

### Worktrees + Multi-Repo

These compose naturally. You can have:
- Multiple worktrees in the main repo (parallel issues)
- Separate clones for downstream repos
- Each combination operates independently

---

## Anti-Patterns

- ❌ Branching from missing persistent refs such as `dev`, `preview`, `insider`, or `insiders`
- ❌ PRs targeting missing persistent refs instead of `main`
- ❌ Non-conforming branch names (must be `squad/{number}-{slug}`)
- ❌ Committing directly to main (use PRs)
- ❌ Switching branches in the main clone while worktrees are active (use worktrees instead)
- ❌ Using worktrees for cross-repo work (use separate clones)
- ❌ Leaving stale worktrees after PR merge (clean up immediately)

## Release and Promotion

- There is no supported multi-branch promotion train in Jamula/stfc.
- Release and scheduled workflows must be defined against branches that exist, primarily `main`.
- A future multi-branch release train requires an explicit decision and specification before creating branches or changing workflow behavior.
