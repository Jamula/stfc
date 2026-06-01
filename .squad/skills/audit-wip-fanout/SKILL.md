# SKILL: audit-wip-fanout

**Slug:** `audit-wip-fanout`
**Author:** Picard
**Extracted:** 2026-06-01T01:22:44Z
**Source:** P1 fanout triage (005-web-control-panel, Ralph cycle)

## When to use

When a feature branch has accumulated WIP across multiple parked/interrupted agents and the Coordinator needs to:
1. Know what's done vs. in-flight vs. untouched before dispatching the next wave
2. Identify which WIP can be committed immediately vs. needs more work
3. Produce a parallel-safe dispatch plan for the next wave

Trigger phrase: *"squad triage the fanout"* or *"audit the worktree and recommend next wave"*.

---

## Steps

### 1. Audit the branch

```bash
# What's committed on the branch vs origin/main?
cd <worktree> && git --no-pager log --oneline origin/main..HEAD

# What's uncommitted?
cd <worktree> && git status --short

# How big is each uncommitted file? (helps judge completeness)
cd <worktree> && wc -l <path-to-untracked-files>

# Is the test suite green with uncommitted work in place?
cd <worktree> && npm test
```

### 2. Map uncommitted files → issues

Cross-reference each untracked (`??`) and modified (`M`) file against the open issue list and plan.md ownership table.

```bash
gh issue list --repo <owner>/<repo> --state open --json number,title,labels --limit 20 \
  | python3 -c "import sys,json; issues=json.load(sys.stdin); [print(f'#{i[\"number\"]} [{\" \".join(l[\"name\"] for l in i[\"labels\"])}] {i[\"title\"]}') for i in issues]"
```

Classify each issue as:
- **COMMITTED** — already in a commit on the branch (even if not yet merged/PR'd)
- **FULLY DONE (uncommitted)** — all expected files present, tests green
- **PARTIALLY DONE** — some files present but incomplete or tests failing
- **UNTOUCHED** — no files, no commits — true fanout candidate

### 3. Read the ownership table

Look for the ownership table in `specs/<NNN>-<feature>/plan.md`. Flag any **cross-cutting files** that multiple issues touch — these serialize the fanout:

```bash
# Common cross-cutting files to watch for:
# - tests/index.test.ts (master test barrel)
# - docs/*.md sections shared by multiple issues
# - package.json / package-lock.json
# - staticwebapp.config.json
# - shared/contracts/
```

If `plan.md` is a placeholder (pointing to session state), note the risk and recommend migration.

### 4. Classify fanout candidates

For each untouched issue, determine:
- Can it start immediately (no dependency on uncommitted WIP)?
- Does it share files with another in-flight issue?
- What worktree path and branch name? (Convention: `/workspaces/stfc-<N>`, branch `squad/005-p1-<N>-<slug>`)

**Serialization rules:**
- Issues sharing `tests/index.test.ts` — serialize (only one adds imports per wave)
- Issues sharing a doc file — serialize (the one that adds the base section first)
- Issues sharing `package-lock.json` — serialize or assign one to install

### 5. Output

Write triage to `.squad/decisions/inbox/picard-p1-fanout-triage.md` with:
- Current state table (committed / uncommitted / untouched)
- Plan.md ownership summary + shared-file callouts
- Wave close-out plan (owner, files to commit, PR Closes list per Rule 6)
- Wave 4 fanout table (issue | owner | worktree | files | parallel-safe?)
- Risk callouts (anything needing Kirk or Picard escalation)
- One-line recommendation

Deliver a compact summary table in the response for the Coordinator.

---

## Output template (compact summary for Coordinator)

```
| Issue | Status | Agent | Action |
|---|---|---|---|
| #N | COMMITTED | O'Brien | Close in Wave 3 PR |
| #M | FULLY DONE (uncommitted) | Uhura | Commit now → close in Wave 3 PR |
| #P | UNTOUCHED | Scotty | Wave 4 worktree /workspaces/stfc-P |
```

Risk callouts:
- ⚠️ `<file>` shared by #X and #Y — serialize
- ⚠️ `plan.md` is a placeholder — recommend migration

**Recommendation:** [one line]

---

## Pitfalls

- **Tests green ≠ work complete.** A partial implementation can pass tests if the tests themselves are incomplete. Inspect file sizes and whether all expected files are present.
- **"Committed" on branch ≠ merged.** Issues may be committed to the epic branch but not yet in a merged PR. They still need a PR + close-out.
- **plan.md placeholders.** The binding plan may be in session state. Check for a "Source of truth:" pointer in the file.
- **Issue board labels can have multiple squad labels** (e.g. `squad:obrien squad:bashir`). The first non-Bashir label is usually the implementer; Bashir writes tests.
