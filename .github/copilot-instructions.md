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

### CodeQL scanning lag can also reject pushes

Branch protection rulesets on `main` require a green CodeQL run for the
**newly pushed** SHA, not the previous one. If `git push` rejects with a
CodeQL or "required status check" error and the previous commit shows
CodeQL green:

1. **Wait 30–60s** for the CodeQL Analyze workflow to start on the new SHA
   (it auto-triggers on push; the rejection happens because the ruleset
   evaluates BEFORE the workflow registers).
2. Retry `git push` once. If it succeeds, done.
3. If it still rejects, check `gh run list --workflow="CodeQL" --limit 3`
   — the run should now be `in_progress` or `queued`. Wait for it.

Do **NOT** amend the commit, force-push, or `--no-verify` your way past
this. It's a timing race, not a real failure.

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

### The compound ritual — "continue + ship + switch + ralph"

A common chained directive is the multi-line block (observed verbatim across multiple
sessions on 2026-05-17):

> *"please continue / when finished then merge to main / sync to main / then switch to
> main / then ralph, go"*

This is **one** instruction, not five. Recognize the chain and execute it as a single
pipeline without re-prompting between steps:

1. **continue** — resume the in-flight speckit phase per Rule 5 ("continue from where
   you stopped" protocol).
2. **when finished then merge to main / sync to main** — run the Rule 6 ship-it ritual
   (rebase → push → `gh pr create` if no PR → `gh pr merge --squash --delete-branch
   --auto`).
3. **then switch to main** — `git checkout main && git pull --rebase origin main`.
4. **then ralph, go** — activate Ralph's work-check loop (per `squad.agent.md` Ralph
   section).

Do not stop between steps to confirm. Only stop if a step actually fails (rebase
conflict, CI red, branch not deleted) — then report the specific failure and the
recovery command.

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

## 9. `gh` command hygiene — branch re-verify + self-review fallback

Two recurring friction patterns from past sessions, both with simple fixes.

### 9a. Re-verify current branch after any branch-mutating `gh` command

`gh pr checkout`, `gh pr merge`, `gh pr create --head <branch>`, and a few
others **silently switch the working branch**. Past sessions show the agent
committing against the wrong head after one of these calls.

**Required:** the very next command after any branch-mutating `gh` call must be:

```bash
git branch --show-current
```

Confirm the branch matches what you expect **before** staging, committing, or
running tests. One extra line of git output is cheap; recovering from a
commit on the wrong branch is not.

### 9b. Single-maintainer PRs — use `gh pr comment`, not `gh pr review`

GitHub blocks `gh pr review --approve` (and `--request-changes`) when the
reviewer's `gh` identity matches the PR author. For this repo (and any
single-maintainer repo), Squad reviewer agents (Kirk, Picard, Garak) MUST
post verdicts via `gh pr comment`, not `gh pr review`:

```bash
gh pr comment <N> -b "$(cat <<'EOF'
**APPROVE** ✅ — Kirk (code review)

- {one-line summary of what was checked}
- {one-line summary of what passed}

Ship it.
EOF
)"
```

Use an explicit `**APPROVE** ✅` / `**CHANGES_REQUESTED** ⚠️` / `**COMMENT** 💬`
header so the verdict is greppable. Do not call `gh pr review` first and fall
back on failure — go straight to `gh pr comment`. The Rule 7 "reviewer-approved
+ CI-green auto-merge" gate reads these comment headers.

## 10. The compound "list + review comments + ask remaining questions" ritual

The phrase **"show me the list of open issues and questions for me / review my comments
in the open issues and ask me any remaining questions"** appears verbatim repeatedly
(6+ times in a single session on 2026-05-17). Rule 9's "Fast board scan phrase" only
covers the first half. The full multi-line variant is a different ritual:

1. **Scan the board** — `gh issue list --state open` + `gh pr list --state open` +
   `ls .squad/decisions/inbox/`
2. **Diff user comments since last review** — for each open issue:
   ```bash
   gh issue view <N> --json comments \
     --jq '[.comments[] | select(.author.login == "cyrusjamula") | .body]'
   ```
3. **Surface only NEW unanswered questions** — do NOT re-ask resolved ones. If a
   user comment provided a decision (re-triage, disposition, cross-link), treat it
   as answered.
4. **Present open questions via `ask_user`** with a structured form, not free text.
   If there are no unanswered questions, say so explicitly: *"No open questions
   from you right now."*

This is **Direct Mode** (no agent spawn). Execute the scan + diff in one batch.
Never silently skip step 3 — if step 1 found 5 open issues but the user has already
left dispositions on all of them, the correct output is "no questions" plus the
status table, not a re-prompt of the resolved items.

## 11. The `Researching:` prefix triggers a multi-agent research → review → file chain

The user-typed prefix **`Researching: ...`** (observed 2× on 2026-05-17 — *"Researching:
review the squad configuration"* and *"Researching: are all squad members needed?"*)
is a structured trigger for deep-research mode, not a free-form question.

**Recognized chain when input starts with `Researching:`:**

1. **Dispatch multiple research subagents in parallel** (3–7 depending on scope),
   each scoped to a non-overlapping investigation area.
2. **Synthesize findings** into a single report at
   `~/.copilot/session-state/.../research/<topic-slug>.md` with prioritized
   recommendations.
3. **If the prompt includes "let picard review" or "have {agent} review"** — dispatch
   that reviewer agent with the report.
4. **If the prompt includes "promote necessary ones as gh issues"** — file each P0/P1
   finding as a `gh issue create` and route to the appropriate `squad:*` label per
   `.squad/routing.md`. Group minor findings into batched issues so the board stays
   manageable.

Do NOT treat `Researching:` as a normal request. The user expects the full pipeline
(research → synthesize → review → file) in one continuous session, not piecemeal.

## 12. PR body close keywords — one `Closes #N` per line

GitHub's auto-close on merge **does not reliably parse multi-issue close lists** like
`Closes #48, #49`. Observed on 2026-05-17: PR #54 said `Closes #48, #49` — only #48
auto-closed; #49 stayed open and required manual `gh issue close 49`.

**Required PR body format:**

```markdown
Closes #48
Closes #49
Closes #50
```

Never `Closes #48, #49, #50` on one line. The comma-list parses inconsistently —
sometimes the second issue closes, sometimes it doesn't. Per-line is the only
reliable form.

**Post-merge sweep (belt and suspenders):** when a PR merges, parse its body for
`Closes #N` references and verify each is `state: CLOSED`:

```bash
gh pr view <N> --json body --jq '.body' \
  | grep -oE 'Closes #[0-9]+' \
  | grep -oE '[0-9]+' \
  | while read issue; do
      state=$(gh issue view "$issue" --json state --jq '.state')
      [ "$state" = "OPEN" ] && gh issue close "$issue" --comment "Closed by PR #<N> (squash merge)"
    done
```

Run this as part of the Rule 6 ship-it ritual.

## 13. CodeQL alerts API 403 in Codespaces — token scope, not Advanced Security

When `gh api repos/{owner}/{repo}/code-scanning/alerts` returns
`403 Advanced Security must be enabled` **from inside a Codespace**, the diagnosis is
almost certainly **wrong**. The actual cause is the Codespaces-injected `GITHUB_TOKEN`
not carrying the `security_events` scope.

**Do NOT report to the user:** *"no actionable CodeQL issues — would need Advanced
Security enabled"*. That's misleading. Advanced Security may already be enabled; the
token just can't see it.

**Correct diagnosis sequence:**

1. Check whether CodeQL workflows are actually running and uploading SARIF:
   ```bash
   gh run list --workflow="CodeQL" --limit 3 \
     --json status,conclusion --jq '.[] | "\(.status) \(.conclusion)"'
   ```
   If runs are succeeding, CodeQL IS analyzing — the API access is the only gap.
2. Confirm the token-scope hypothesis:
   ```bash
   gh auth status 2>&1 | grep -i scope
   # Codespaces-injected tokens will show a fixed scope list missing security_events
   ```
3. Tell the user: *"CodeQL is running and clean on main, but the Codespaces token
   lacks `security_events` scope to fetch alerts via API. The fix is in
   `devcontainer.json` (see PR #16) which adds the scope on rebuild. Alternatively,
   view alerts in the GitHub UI at `https://github.com/{owner}/{repo}/security/code-scanning`."*

The `gh auth refresh --hostname github.com -s security_events` workaround **does not
work** inside Codespaces (the runtime won't let you re-auth the injected token). Don't
suggest it as a fix; mention only as a diagnostic if needed.

## 14. gh-issues-driven workflow

Every non-trivial task has a tracking issue with the appropriate `squad:{member}` label before work starts. The Coordinator does not start work that lacks an issue.

**Non-trivial** means: anything that produces a commit visible in `git log`, excluding trivial typo fixes in agent histories.

**Required before dispatching any agent:**

```bash
gh issue list --state open --label "squad:<member>" --limit 5
# Confirm the issue exists; if not, create it first:
gh issue create --title "<task>" --label "squad:<member>" --body "<scope>"
```

## 15. Per-phase test scope

Every phase PR enumerates tests added or updated in its body under a `## Tests` heading.

The underlying test-first obligation is constitutional Principle IX (Test-First Discipline, NON-NEGOTIABLE) — do not duplicate that text here. This rule governs the PR-body disclosure form only.

**Required PR body section:**

```markdown
## Tests

- Added `tests/foo.test.ts` — covers <scenario>
- Updated `tests/bar.test.ts` — adds <case> for the new edge case
```

If no tests were added or modified, state explicitly: *"No test changes — behaviour covered by existing suite (see <test file>)."*

## 16. Per-capability doc updates

Any change that adds a user-facing surface, endpoint, environment variable, secret, or behaviour updates the relevant doc (`README.md`, `docs/*.md`, `specs/<feature>/quickstart.md`) in the same PR.

The underlying hygiene obligation is constitutional Principle VII (Artifact Hygiene) — do not duplicate that text here. This rule governs routing and gate enforcement.

**Gate:** Bashir's pre-push check verifies the docs diff reflects the new capability. Kirk's review is code-only; missing docs scope routes to Tuvok. Garak's hostile fact-check confirms the docs claim matches what the code actually does.

## 17. Rubber-duck multi-phase plans (enforceable)

The Coordinator MUST consult the rubber-duck agent on any plan touching more than one phase or more than one component before exiting plan mode. P0 findings must be incorporated, not deferred.

**Mechanism:** `specs/*/plan.md` files MUST contain the following checkbox (added to `.specify/templates/plan-template.md`) checked before the plan is considered approved:

```markdown
- [x] Rubber-duck review: <agent_id / findings link>
```

A CI gate on `specs/*/plan.md` enforces that this checkbox is present and checked. An unchecked or missing checkbox blocks the phase transition.

## 18. Fleet + worktree execution

Implementation work uses fleet-dispatched agents in per-issue worktrees per `.squad/config.json` `"worktrees": true`. The shared-file ownership table (in the feature's `plan.md`) must be consulted before parallel dispatch to avoid merge conflicts.

**Required before parallel agent dispatch:**

```bash
# Confirm worktrees key in squad config
jq '.worktrees' .squad/config.json   # must be true

# Check ownership table in plan.md for shared files
grep -A 20 'ownership\|shared.file\|Shared File' specs/<NNN>-<feature>/plan.md
```

If two agents own the same file, serialize their work or split the file boundary before dispatch.

## 19. Sequence shorthand `"X, Y, Z, ..."` is inclusive, not exhaustive

When the user describes a schedule, cron, or any sequence using a partial list ending
in `...`, they mean "continue this pattern" — they are NOT excluding the unmentioned
terms at the start of the standard cycle.

**Observed on 2026-05-31 (session `0a6be0be`):** user wrote
*"start at the 10 mins mark, so 10, 20, 30, ..."*. The agent picked
`10,20,30,40,50 * * * *` (excluded `:00`). The user immediately corrected
*"also add the top of the hour"*. The correct read was `*/10 * * * *` —
which includes `:00, :10, :20, :30, :40, :50`.

**Rule of thumb when interpreting partial sequences:**

| User input | Correct interpretation | Wrong interpretation |
|---|---|---|
| `"every 10 mins, so 10, 20, 30, ..."` | `*/10 * * * *` (includes `:00`) | `10,20,30,40,50` (excludes `:00`) |
| `"every 15 mins, so 15, 30, 45, ..."` | `*/15 * * * *` (includes `:00`) | `15,30,45` (only 3 runs/hour) |
| `"every 4 hours, so 4, 8, 12, ..."` | `0 */4 * * *` (includes `0:00`) | `0 4,8,12,16,20 * * *` |

**Default to the inclusive `*/N` form** unless the user explicitly says *"skip the
top of the hour"*, *"only between X and Y"*, or otherwise excludes a value. If the
interpretation is genuinely ambiguous (e.g. *"every 7 minutes"* — no clean `*/N`
fit), ask once via `ask_user` rather than guessing.

This rule also applies to non-cron sequences: *"port 8080, 8081, 8082, ..."* means
"the contiguous range starting from 8080", not "exactly these three ports".

## 20. Codespaces idle-timeout is the keepalive answer — not `systemd`, `tmux`, `screen`, or cron-keepalive

Squad routinely fans out 5+ background agents per session, each running 10–30
minutes. The Codespaces default idle timeout is **30 minutes** of UI inactivity,
which kills the container mid-fleet and orphans in-flight subagents.

**Observed on 2026-05-31 (session `7c85ff3b`):** user typed
*"sudo apt install systemd"* trying to install an init system, then clarified
*"want to keep the codespace / machine active while background agents are running"*.
`systemd`, `tmux`, `screen`, `nohup`, and cron-keepalive scripts do **NOT** solve
this — Codespaces shut down based on the runtime's idle heuristic, not on PID 1
or active TTY sessions.

**The actual fixes, in order of preference:**

1. **Raise the per-user default** (one-time, applies to all Codespaces):
   - https://github.com/settings/codespaces → **Default idle timeout** → bump to
     **240 minutes** (the maximum the UI allows).
2. **Raise the per-Codespace timeout** (this session only):
   ```bash
   gh codespace edit -c "$CODESPACE_NAME" --idle-timeout 240m
   ```
3. **For fully unattended monitoring after the board clears**, use the standalone
   watchdog from a local machine (NOT inside the Codespace):
   ```bash
   npx @bradygaster/squad-cli watch --interval 10
   ```

**Do NOT propose:** installing `systemd`, running `screen`/`tmux` sessions, a
background `while true; do sleep 60; done` loop, a self-pinging cron, or any
"keepalive" trick that pretends activity. The runtime is the authority and these
either no-op or get killed with the container.

If 240 min isn't enough for a single fleet run, **split the work** across two
sessions rather than fighting the timeout.

## 21. Refuse-and-rotate protocol for credentials pasted into chat

Any string matching a credential pattern that appears in user input MUST be
treated as **compromised the moment it left its source system** and the agent
MUST refuse to echo, log, or persist it anywhere.

**Observed on 2026-05-17/18 (session `63fb899e`):** user pasted a Discord
Client Secret verbatim into chat (turn 8) and offered the bot token (turn 6).
Both incidents were handled correctly by ad-hoc judgment; this rule codifies
the response so it's uniform.

**Credential patterns to refuse on sight:**

| Pattern | Examples |
|---|---|
| Discord bot token | `OTk…`, `MT…` (long base64) |
| Discord client secret | 32-char alphanumeric value from Developer Portal |
| GitHub PAT | `ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*` |
| OpenAI / Anthropic API key | `sk-*`, `sk-ant-*` |
| AWS access key | `AKIA*` (paired with secret) |
| Azure connection string | `DefaultEndpointsProtocol=…AccountKey=…` |
| Raw JWT | `eyJ…` (three base64 segments separated by `.`) |
| Generic `*_SECRET` / `*_TOKEN` / `*_KEY` env-var values | (context-detected) |

**Required response when one is detected in the user's message:**

1. **STOP — do not write the value anywhere.** No decision inbox, no agent
   history, no log, no commit, no echo back in the assistant response, no diff.
2. **Tell the user the value is compromised** the instant it entered the chat
   transcript (transcripts persist in the session store, ship to model
   providers, and may be reviewed for telemetry).
3. **Provide the rotation path** specific to the credential class:
   - Discord: https://discord.com/developers/applications/{app-id}/oauth2 →
     **Reset Secret** (for client secret) or **/bot → Reset Token** (for bot token).
   - GitHub PAT: https://github.com/settings/tokens → **Delete** the leaked token,
     create a fresh one.
   - Repo secret: `gh secret set <NAME>` from the user's *local terminal*
     (NOT pasted into chat) — see step 4.
4. **Provide the correct ingestion path** for the new value:
   ```bash
   # Run this in YOUR LOCAL TERMINAL — never paste the value into the chat.
   gh secret set DISCORD_BOT_TOKEN --repo Jamula/stfc
   # gh prompts for the value with hidden input.
   ```
5. **Do NOT request the value again** in any form. If the agent needs to verify
   the secret is set, use `gh secret list --repo <repo>` (which shows names
   only, never values).

**Inbox-write exception:** the only piece of information that MAY be logged
about a leaked secret is the **fact of the leak and the rotation status** —
e.g. *"User leaked DISCORD_CLIENT_SECRET on 2026-05-18; rotated at HH:MM UTC;
new value set via `gh secret set` from local terminal"*. The value itself is
never logged. This log entry is fine in `.squad/decisions/inbox/` because
it's an operational record, not the secret.

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
- **Fast board scan phrase:** *"show me the list of open issues and
  questions for me"* (or *"status check"*). Treat as **Direct Mode** —
  no agent spawn. Run in one batch:
  ```bash
  gh issue list --state open --json number,title,labels,assignees --limit 20
  gh pr list   --state open --json number,title,author,isDraft,reviewDecision --limit 10
  ls .squad/decisions/inbox/ 2>/dev/null   # unanswered questions / undelivered decisions
  ```
  Present as a compact table grouped by squad member. Do **not** re-read
  charters, history, or routing — this is a status report, not a routing
  decision.
