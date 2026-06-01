# O'Brien — DevOps / Platform Engineer

- **Owner:** cyrusjamula
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours via `redeem.yml`).
- **Stack:** TypeScript, Node.js, GitHub Actions, CodeQL, Dependabot, Hugging Face (ML cache)
- **Created:** 2026-05-18

## Hiring context

Hired by Picard on 2026-05-18 in response to the squad-capability audit at
`session-state/.../research/are-all-squad-members-needed-are-they-adding-value.md`.

The audit's R7 (workflow ownership ambiguity), R11 (no Platform/Tooling charter),
and R13 (Release engineering vacuum) all converged on the same underlying gap:
nobody owned `.github/workflows/*.yml` end-to-end, and security toolchain +
release pipeline + ML cache strategy were homeless. Picard's audit-resolution
decision (issue #65/#66 disposition) was to fold all four concerns into one
new charter rather than spread them across Scotty/Uhura with per-file splits.

I am that charter.

## Initial scope at hire (open issues to triage)

- **#8–#12** and **#24–#32** — flagged in audit-resolution for re-triage from
  whichever `squad:*` label they currently carry → `squad:obrien` where they
  fall in my domain (workflow automation, pre-commit/CI enforcement, security
  toolchain). Picard's issue-#66 comment notes a separate re-triage issue may
  be filed for this carryover; pick it up first.
- **ML cache invalidation strategy** (audit #69) — coordinate with Uhura's
  charter extension (Tuvok handling that edit in parallel). I own
  infrastructure; she owns API + integration.

## Operating rules I inherit

- Repo rules 1–13 in `.github/copilot-instructions.md` — especially:
  - **Rule 2:** never commit `.squad/` paths. Scribe owns those.
  - **Rule 3:** workflow YAML changes ship with pin-test updates in the same commit.
  - **Rule 4:** rebase before every push to `main` (the 15-min cron commits to `docs/redeem-history.md`).
  - **Rule 7:** auto-merge on reviewer-approved + CI-green.
  - **Rule 9b:** verdicts via `gh pr comment` with greppable header, not `gh pr review`.
  - **Rule 12:** one `Closes #N` per line in PR bodies.
  - **Rule 13:** CodeQL 403 in Codespaces = token scope, not Advanced Security.
- The new **Garak hard-gate** routing rule (routing.md §Rules, 2026-05-18) —
  any feat(*) PR I open that touches `src/` requires Garak adversarial review.

## Learnings

2026-05-18T02:35Z — **First charter exercise: `.github/workflows/discord-ops.yml`** (commit `6ea61c8` on `discord-ops-automation`, Phase 1 fan-out of Cyrus's override-to-(a) directive). Four reusable platform patterns crystallised here; future operator workflows should reach for these by default.

1. **Manual-only `workflow_dispatch` is the right shape for ops scripts that mutate external state.** When a workflow exists to issue PATCH/PUT/POST calls against a third-party API (Discord, Stripe, Cloudflare, etc.), the trigger surface MUST be `workflow_dispatch` only — no `schedule:`, no `push:`, no `pull_request:`. Every outbound write should be traceable to a human button-press in the Actions UI. This is what makes the corresponding constitutional carve-out safe: there is no automation path that can issue a surprise write. Compare to `redeem.yml` / `discord-monitor.yml`, which DO have cron triggers because they only write to repo files (`docs/redeem-history.md`, `data/discord/`) — repo writes are recoverable; third-party writes often are not.

2. **Env-only secret consumption — secrets stay out of `permissions:`.** GitHub workflow `permissions:` controls what the *workflow's GITHUB_TOKEN* can do (e.g. `contents: write` to push commits, `id-token: write` for OIDC). Custom repository secrets like `DISCORD_BOT_TOKEN` are NEVER granted via `permissions:` — they're injected via `env:` on the single step that needs them, scoped as narrowly as possible. So the discord-ops workflow has `permissions: contents: read` (just enough for checkout) AND `env: DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}` on the one step that calls the script. Don't conflate the two namespaces. Additionally: never `echo $TOKEN`, never `set -x`, never expand the token into a command-line argument — env-var-only end to end, and the called script is responsible for redacting it from any thrown error (FR-012 pattern via `redactString`).

3. **`concurrency: { group, cancel-in-progress: false }` serialises operator clicks.** Two operators clicking "Run workflow" within a few seconds of each other will race to PATCH the same endpoint, producing undefined ordering. Setting a named concurrency group (`stfc-discord-ops`) with `cancel-in-progress: false` queues the second run behind the first instead of cancelling it. Distinct groups for distinct write targets — discord-ops uses `stfc-discord-ops`, NOT the existing `stfc-gift-redeemer` group, because their blast radii are unrelated (Discord app metadata vs repo git push lock). Use the same group only when you actually need the runs to share a serialised lock (e.g. `redeem.yml` + `discord-monitor.yml` both share `stfc-gift-redeemer` because they both `git push` to the repo and would otherwise collide).

4. **`curl -sSfL --max-filesize <bytes>` for any untrusted HTTP download.** Operator-supplied URLs are inputs — treat them like user data. The recipe: `-s` silent, `-S` show errors so failures surface in logs, `-f` fail-fast on HTTP 4xx/5xx (otherwise curl writes the error body to disk and exits 0), `-L` follow redirects (otherwise CDN-fronted assets break), and `--max-filesize <bytes>` to cap the download at the upstream service's documented limit (Discord avatar = 10 MiB = 10485760 bytes). Combined, these prevent: silently downloading an HTML 404 page, writing a 50 GB iso to disk via a malicious URL, and stalling on an unbounded stream. Bonus: also add a `timeout-minutes` on the job so even a slow-drip download terminates.

**Cross-cutting Rule 3 reminder confirmed in practice.** The pre-commit hook (`scripts/pre-commit.mjs`) refused my first commit attempt because `tests/workflows/discord-ops-workflow.test.ts` (Bashir's pin test, drafted in parallel) referenced `discord-ops.yml` but wasn't staged. Per my charter, workflow-pin tests are mine to ship in the same commit even when another agent drafts them — Rule 3 puts both files in one atomic unit. Resolution: read Bashir's test, verified it pinned my values (9/9 assertions matched), staged both, committed together. This is the workflow / pin-test handoff pattern: drafter writes the test, owner stages both in the workflow commit. Skill candidate (`.copilot/skills/workflow-pin-test-handoff/`) if it recurs.

**Adjacent uncommitted work in the worktree** (Phase 1 parallel fan-out, not mine to commit per Rule 2 / charter boundary): `.specify/memory/constitution.md` + `.specify/templates/plan-template.md` (Tuvok), `scripts/discord-ops/set-discord-app-metadata.mjs` + `tests/fixtures/discord-ops/fetch-stub.mjs` + `tests/scripts/discord-ops/set-discord-app-metadata.test.ts` + `tests/constitution/discord-ops-carveout.test.ts` + `tests/index.test.ts` edit (Scotty + Bashir). My commit is workflow-only; other agents own their commits.

2026-05-18T00:57Z: Hired as DevOps/Platform Engineer by Picard, resolving audit issues #65 + #66. Squad context now includes 10 active members + @copilot.
## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---


2026-05-31T18:59:25Z — **Crew optimizer issue-board setup (#77–#95)**. Reusable issue-board patterns: use a hidden `<!-- crew-plan-id: ... -->` marker as the stable idempotency key, discover existing issues by body search before creating anything, write bodies through repo-local scratch files, and do a second body-edit pass after all issue numbers are known so dependency references resolve cleanly. For Squad-labeled work, add only the exact `squad:{member}` labels from the plan; never add the plain `squad` label, because that is a workflow trigger and will re-route otherwise already-routed work. Multi-owner issues are safest when each owner label is passed as a separate label flag and then spot-checked with a plain-`squad` label search.
- Phase 0 shipped (PR #111, e2e463c)

## 2026-06-01T01:25:00Z — Wave 3 close-out + Wave 4 fanout audit
Wave 1–2 committed (#113–#116). Wave 3 close-out (#117 auth + #119 shell + #120 ETag + #122 contracts) ready for Kirk review on PR #124. Wave 4 fanout: #118 (your runbook) + #121 (Scotty routes) queued; both dispatch after Wave 3 PR gate, parallel-safe to each other.
