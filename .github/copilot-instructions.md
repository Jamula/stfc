<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at `specs/003-discord-oauth/plan.md`.
<!-- SPECKIT END -->

# Repo-specific operating rules

These rules came out of `/chronicle improve` on 2026-05-16 and address
patterns that have repeatedly bitten past sessions. Read them before
touching governance, workflows, `main`, or `.squad/`.

## 1. Constitution amendments must re-sync the plan template

`.specify/memory/constitution.md` and `.specify/templates/plan-template.md`
both enumerate sanctioned secrets, durable inputs, and outbound network
destinations. They drift independently and the SIR cannot detect it.

**Required after editing the constitution:**

```bash
# After any edit to .specify/memory/constitution.md:
grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com' .specify/templates/*.md
```

Cross-check every match against the body of `constitution.md`. Update any
template that lags. The SIR's `Templates needing re-sync` line MUST be
derived from a real grep, NOT from the "no principles renamed" structural
argument — that argument has shipped false negatives before.

## 2. `.squad/` write boundary — only Scribe commits there

`.squad/agents/{name}/history.md`, `.squad/decisions/inbox/*`,
`.squad/decisions.md`, `.squad/log/*`, `.squad/orchestration-log/*` —
all of these are **Scribe-owned commits**.

When dispatching an agent that will:
- Append to its own history.md
- Drop a file in `decisions/inbox/`
- Write a session/orchestration log

…the agent MUST leave those files uncommitted. The spawn prompt should
explicitly say:

> Do NOT stage or commit `.squad/` paths. Scribe will commit them in a
> separate session.

When committing your own work in a non-Scribe role, stage each path
individually (`git add -- <path>`). Never use `git add .squad/` or any
broad glob that could sweep in Scribe-owned files.

## 3. Workflow YAML changes need their pinning tests updated in the same commit

Several tests pin workflow values literally as regression guards. Examples
on `main` as of 2026-05-16:

- `tests/skills/discordMonitor.test.ts` pins `redeem.yml` cron and
  `discord-monitor.yml` cron, and the shared `concurrency.group: stfc-gift-redeemer`.

**Required when editing `.github/workflows/*.yml`:**

```bash
# Replace <workflow-file> with the filename you edited (e.g. redeem.yml).
grep -rn '<workflow-file>' tests/
```

Any matching test that pins a literal value (cron string, group name,
permission scope) must be updated in the **same commit**. Failing to do so
trips the pre-commit hook and forces a redo cycle.

## 4. `main` diverges from `origin/main` constantly — rebase before every push

A scheduled `redeem.yml` workflow runs every 15 minutes and commits
`chore(history): append 1 new claim row(s)` to `docs/redeem-history.md`
on `origin/main`. Local `main` will be behind `origin/main` within minutes
of any local commit.

**Required before any work that touches local `main` (commit, merge, push):**

```bash
git fetch origin
git rebase origin/main           # only if your local main is behind
```

The `chore(history)` commits only touch `docs/redeem-history.md` — no
feature work modifies that file — so rebase is always conflict-free.
**Never** force-push or `git push` to `main` without rebasing first; the
push will be rejected and the recovery is annoying.

## 5. `/speckit.implement` commits at phase boundaries, never at the end

A full `tasks.md` run is long enough to be interrupted (session timeout,
context window, manual stop). Past sessions show 5+ "continue from where
you stopped" prompts in a single feature cycle.

**Required behavior for any multi-phase agent dispatch:**

- Commit at each phase boundary (e.g. `feat(NNN-feature): Phase N — {name}
  (T{XXX}–T{YYY})`).
- Never accumulate WIP across phases.
- On resume after interruption, derive state from:
  1. The most recent `feat(NNN-feature): Phase N` commit subject.
  2. The working tree's uncommitted changes.
  3. The phase checkbox state in `specs/NNN-feature/tasks.md`.

  Do NOT re-derive state by re-reading `tasks.md` from the top.
- **Phase boundaries auto-commit; the user must NEVER type `speckit.git.commit`.** The
  implementer agent commits as the LAST step of every phase. If the user types
  `speckit.git.commit` mid-flight, that is a Rule 5 violation — log it and self-correct
  on the next phase.

### When the user types "continue from where you stopped"

When the user sends *"continue"*, *"continue from where you stopped"*, *"what's next"*,
or any variant during a multi-phase speckit run:

1. Read the most recent `feat(NNN-feature): Phase N` commit subject (1 `git log` line).
2. Read the phase checkbox state in `specs/NNN-feature/tasks.md`
   (`grep '^- \[ \]' specs/NNN-feature/tasks.md | head -1`).
3. Skip directly to the next unchecked task. Do NOT re-read `tasks.md` from the top.
   Do NOT ask the user "where were we?".
4. The Coordinator answers in 1 line ("Resuming Phase N at T0XX, dispatching {Agent}")
   and dispatches the implementer in the same response.

## 6. The "ship it" ritual — codify the merge-to-main sequence

Past sessions show the user typing *"merge to main and sync"*, *"push to origin / merge
to main / sync to main"*, and *"yes merge tge branch to main"* repeatedly (9+ times in
one session). These are the same ritual under different phrasings.

**When the user says any of:** *"merge to main and sync"* · *"push to origin, merge to
main, sync to main"* · *"ship it"* · *"yes merge"* · *"merge it to main"* — execute this
sequence WITHOUT asking for confirmation:

```bash
# 1. Rebase the current feature branch onto latest main
git fetch origin
git rebase origin/main

# 2. Push and merge (auto-merge if CI not yet green; immediate if green)
git push --force-with-lease   # only if rebase rewrote history
gh pr merge <N> --squash --delete-branch --auto

# 3. Return to main and pull the merge commit
git checkout main
git pull --rebase origin main

# 4. Sweep .squad/ artifacts from the worktree before removal (Rule 2 + Rule 8)
#    Agents leave .squad/ files uncommitted per Rule 2 (Scribe-only commits).
#    Copy them to the main checkout so Scribe can commit them later.
if [ -d "<worktree>/.squad" ]; then
  rsync -a --ignore-existing <worktree>/.squad/ .squad/
fi

# 5. Clean up the local worktree (Rule 4 + worktree mode)
git worktree remove <path> --force 2>/dev/null || true
git branch -D <branch> 2>/dev/null || true
```

Do NOT prompt *"are you sure?"* — the user said it; do it. If any step fails (rebase
conflict, CI red), STOP and report the specific failure with the recovery command; do
not improvise around it.

## 7. Reviewer-approved + CI-green PRs auto-merge without asking

When ALL of these are true for a PR:
- A Reviewer agent (Kirk for code, Picard for governance, Garak for hostile fact-check)
  has posted APPROVE
- All required CI checks are green (`gh pr checks <N>` shows no `fail` or
  `action_required`)
- No `CHANGES_REQUESTED` review is outstanding

…the Coordinator MUST merge immediately (`gh pr merge <N> --squash --delete-branch`)
without asking the user *"should I merge?"*. The approval gate has already cleared;
asking again is redundant friction.

**Override:** The user can say *"hold the merge on #N"* or *"don't auto-merge governance
PRs"* before approval lands; otherwise ships on green.

**Governance carve-out (optional):** PRs that touch `.specify/memory/constitution.md`
MAY require an explicit human ack before merge — but only if the user has previously
stated this preference for this repo. Default is auto-merge.

## 8. Worktree cleanup must sweep `.squad/` artifacts first

Rule 2 forbids agents from committing `.squad/` paths — Scribe owns those commits.
In worktree mode, agents write `.squad/` files (history.md, decisions/inbox/*, logs)
inside the worktree. When `git worktree remove` runs, uncommitted files are silently
destroyed.

**Required before every `git worktree remove`:**

```bash
# From the main checkout — sweep uncommitted .squad/ artifacts before removal.
# --ignore-existing preserves any newer content already in the main checkout.
if [ -d "<worktree>/.squad" ]; then
  rsync -a --ignore-existing <worktree>/.squad/ .squad/
fi
```

This applies to:
- The "ship it" ritual (Rule 6, step 4)
- Manual worktree cleanup after PR merge
- Ralph heartbeat–triggered cleanup
- Any agent that removes a worktree for any reason

After the sweep, Scribe commits the `.squad/` artifacts from the main checkout as
usual. The sweep is idempotent — running it twice is harmless.

## Project quick reference

- **Tests:** `npm test` (full suite, ~2s, 90+ tests via node:test/tsx).
- **Typecheck:** `npm run typecheck`.
- **Pre-commit hook:** `scripts/pre-commit.mjs` runs `npm test`. Never
  use `--no-verify` — fix the failure instead.
- **Single test file:** `npm test -- --test-name-pattern '<name>'` or
  `node --import tsx --test tests/<path>.test.ts`.
- **Node version:** pinned via `.nvmrc`.
- **Speckit chain:** `specify → clarify → plan → constitution? → analyze
  → tasks → implement`, each step gated. Artifacts under
  `specs/NNN-feature/`. See `.github/agents/speckit.*.agent.md`.
- **Squad roster:** `.squad/team.md` + `docs/squad.md`. Decisions:
  `.squad/decisions.md`. Routing: `.squad/routing.md`.
- **Skills inventory:** `.copilot/skills/` (coordinator-level) and
  `.squad/skills/` (team-level). Address by name when relevant
  (e.g. *"use the session-recovery skill"*).
