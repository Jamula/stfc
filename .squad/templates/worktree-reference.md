# Worktree Reference

### Worktree Awareness

Squad and all spawned agents may be running inside a **git worktree** rather than the main checkout. All `.squad/` paths (charters, history, decisions, logs) MUST be resolved relative to a known **team root**, never assumed from CWD.

**State scope:** The team root identifies static configuration, not an isolated mutable state
backend. Linked worktrees share Git state and notes refs; do not assume their two-layer state
is branch-local or use another checkout's state as a fallback.

**How the Coordinator resolves the team root (on every session start):**

Use the current checkout root as the team root. Require `.squad/config.json` and
`.squad/team.md` at that root; otherwise stop and report the missing configuration.
Nested, external, and other-checkout team roots are unsupported.

**Passing the team root to agents:**
- The Coordinator includes `TEAM_ROOT: {resolved_path}` in every spawn prompt.
- Agents resolve static `.squad/` configuration from the provided team root and use state tools for mutable state.
- Every writer separately verifies the bridge checkout's configuration and provenance as described in `spawn-reference.md`; the inherited team root does not verify its bridge.

**Cross-worktree considerations:** Linked worktrees share the two-layer state and notes refs.
Decision consolidation and inbox deletion are disabled until cross-process serialization is
verified; retain inbox entries. Ordinary source branch merges do not synchronize runtime state.

### Worktree Lifecycle Management

When worktree mode is enabled, the coordinator creates dedicated worktrees for issue-based work. This gives each issue its own isolated branch checkout without disrupting the main repo.

**Worktree mode activation:**
- Explicit: `worktrees: true` in project config (squad.config.ts or package.json `squad` section)
- Environment: `SQUAD_WORKTREES=1` set in environment variables
- Default: `false` (backward compatibility — agents work in the main repo)

**Creating worktrees:**
- One worktree per issue number
- Multiple agents on the same issue share a worktree
- Path convention: `{repo-parent}/{repo-name}-{issue-number}`
  - Example: Working on issue #42 in `C:\src\squad` → worktree at `C:\src\squad-42`
- Branch: `squad/{issue-number}-{kebab-case-slug}` (created from base branch, typically `main`)

**Dependency management:**
- After creating a worktree, link `node_modules` from the main repo to avoid reinstalling
- Windows: `cmd /c "mklink /J {worktree}\node_modules {main-repo}\node_modules"`
- Unix: `ln -s {main-repo}/node_modules {worktree}/node_modules`
- If linking fails (permissions, cross-device), fall back to `npm install` in the worktree

**Reusing worktrees:**
- Before creating a new worktree, check if one exists for the same issue
- `git worktree list` shows all active worktrees
- If found, reuse it (cd to the path, verify branch is correct, `git pull` to sync)
- Multiple agents can work in the same worktree concurrently if they modify different files. Untracked files are still at risk: a global `git stash` / `git clean` from one agent can delete another agent's not-yet-committed files — prefer per-issue worktrees for parallel background work

**Cleanup:**
- After a PR is merged, the worktree should be removed
- `git worktree remove {path}` + `git branch -d {branch}`
- Ralph heartbeat can trigger cleanup checks for merged branches

### Pre-Spawn: Worktree Setup

When spawning an agent for issue-based work (user request references an issue number, or agent is working on a GitHub issue):

**1. Check worktree mode:**
- Is `SQUAD_WORKTREES=1` set in the environment?
- Or does the project config have `worktrees: true`?
- If neither: skip worktree setup → agent works in the main repo (existing behavior)

**2. If worktrees enabled:**

a. **Determine the worktree path:**
   - Parse issue number from context (e.g., `#42`, `issue 42`, GitHub issue assignment)
   - Calculate path: `{repo-parent}/{repo-name}-{issue-number}`
   - Example: Main repo at `C:\src\squad`, issue #42 → `C:\src\squad-42`

b. **Check if worktree already exists:**
   - Run `git worktree list` to see all active worktrees
   - If the worktree path already exists → **reuse it**:
     - Verify the branch is correct (should be `squad/{issue-number}-*`)
     - `cd` to the worktree path
     - `git pull` to sync latest changes
     - Skip to step (e)

c. **Create the worktree:**
   - Determine branch name: `squad/{issue-number}-{kebab-case-slug}` (derive slug from issue title if available)
   - Determine base branch (typically `main`, check default branch if needed)
   - Run: `git worktree add {path} -b {branch} {baseBranch}`
   - Example: `git worktree add C:\src\squad-42 -b squad/42-fix-login main`

d. **Set up dependencies:**
   - Link `node_modules` from main repo to avoid reinstalling:
     - Windows: `cmd /c "mklink /J {worktree}\node_modules {main-repo}\node_modules"`
     - Unix: `ln -s {main-repo}/node_modules {worktree}/node_modules`
   - If linking fails (error), fall back: `cd {worktree} && npm install`
   - Verify the worktree is ready: check build tools are accessible

e. **Include worktree context in spawn:**
   - Set `WORKTREE_PATH` to the resolved worktree path
   - Set `WORKTREE_MODE` to `true`
   - Add worktree instructions to the spawn prompt (see template below)

**3. If worktrees disabled:**
- Set `WORKTREE_PATH` to `"n/a"`
- Set `WORKTREE_MODE` to `false`
- Use existing `git checkout -b` flow (no changes to current behavior)
