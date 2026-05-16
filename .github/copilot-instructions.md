<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at `specs/001-discord-monitor/plan.md`.
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
