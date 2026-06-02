## Session 2026-06-02 — Discord slash epic #143 shipped

Parallel fleet delivered 6 PRs (commands.json, register workflow, Worker bridge, handler workflow, deploy, runbook). 4 reviewer-lockout cycles (Garak blockers → Scotty fixes). Epic fully operational.

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
> Older learnings archived to history-archive.md. See archive for context.

2026-05-31T18:59:25Z — **Crew optimizer issue-board setup (#77–#95)**. Reusable issue-board patterns: use a hidden `<!-- crew-plan-id: ... -->` marker as the stable idempotency key, discover existing issues by body search before creating anything, write bodies through repo-local scratch files, and do a second body-edit pass after all issue numbers are known so dependency references resolve cleanly. For Squad-labeled work, add only the exact `squad:{member}` labels from the plan; never add the plain `squad` label, because that is a workflow trigger and will re-route otherwise already-routed work. Multi-owner issues are safest when each owner label is passed as a separate label flag and then spot-checked with a plain-`squad` label search.
- Phase 0 shipped (PR #111, e2e463c)

## 2026-06-01T01:25:00Z — Wave 3 close-out + Wave 4 fanout audit
Wave 1–2 committed (#113–#116). Wave 3 close-out (#117 auth + #119 shell + #120 ETag + #122 contracts) ready for Kirk review on PR #124. Wave 4 fanout: #118 (your runbook) + #121 (Scotty routes) queued; both dispatch after Wave 3 PR gate, parallel-safe to each other.

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE
2026-06-01T02:52Z — **PR #124 deploy job failure — OIDC secrets not provisioned**

**Diagnosis pattern learned:** When `azure/login@v3` errors with `Using auth-type: SERVICE_PRINCIPAL. Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied`, the first hypothesis is NOT a workflow misconfiguration — it is **missing secrets**. The action falls back to SERVICE_PRINCIPAL auth when OIDC inputs (`tenant-id`, `client-id`) evaluate to empty strings, which is what happens when the repo secrets are absent. The workflow was structurally correct throughout.

**Diagnostic sequence that confirmed missing-secrets hypothesis:**
1. Read the workflow YAML — OIDC form was correct (`client-id: ${{ secrets.AZURE_CLIENT_ID }}`).
2. Attempted `gh secret list --repo Jamula/stfc` — 403 (Codespaces token lacks `security_events` + secrets scopes). Inconclusive.
3. Cross-referenced `git diff origin/main --name-only -- .github/workflows/` — `swa-deploy.yml` is new to this PR. Secrets for a brand-new OIDC workflow were never provisioned.
4. Confirmed with the PR status check rollup — all other checks green; only `deploy` failing; `teardown` skipped correctly (closed-event condition not met). Pattern consistent with absent secrets, not a bug.

**Decision tree exercised:**
- Secrets absent → Deploy failing (not informational) → **Option B**: gate jobs on `secrets.AZURE_CLIENT_ID != ''` so unprovisioned state = skip, not fail.
- Filed issue #127 for Picard to provision AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID.

**Pre-commit hook nuance — `checkWorkflowPinningTests`:** The hook greps ALL test files for the workflow filename and requires every referencing file to be staged — even if the reference is only in a comment. `tests/skills/swaProject.test.ts` referenced `swa-deploy.yml` in its file-header comment; the hook rejected the commit until it was staged. Fix: add a substantive cross-reference comment to the file so the staging is meaningful, not just a git trick.

**Reusable secret-presence guard pattern for GitHub Actions:**
```yaml
jobs:
  deploy:
    if: secrets.AZURE_CLIENT_ID != '' && <event conditions>
```
Both jobs (`deploy` + `teardown`) must carry the guard. Skipping only `deploy` while leaving `teardown` ungated would cause `teardown` to fail on PR close when no SWA environment was ever created.

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01 — Session wrap-up (crew v2 chain complete)

**Session:** crew-v2-chain-wrapup
**Role:** Crew optimization logic + shared dependency orchestration
**Outcome:** Crew v2 optimization shipped (PR #132); SWA deployment parallel track in #124

Participated in:
- PR #124 (005-web-control-panel Phase 1 Wave 3): SWA deploy orchestration, parallel OIDC secrets work (Azure action forthcoming)
- PR #132 (crew-v2-optimization): Primary implementation, refactored crew iteration (per-crew single pass vs prior per-task naive loop)

**Lesson:** Stacked PRs with shared test suite enable clean parallel dispatch. Test count grew 965 → 1,000 (+35) in #132 without blocking #130 merge or #124 deployment track.

**Next:** DISABLE_WRITES dead-code follow-up (routed by Kirk's #124 review) — awaiting assignment.
## 2026-06-01 — PR #132 shipped: knowledge-rebuild workflow + Rule 3 pinning tests (issue #94)

**Workflow:** knowledge-rebuild.yml (triggers on data/crew/knowledge-embeddings.json staleness; runs rebuild CLI with hashed-bow-v1 embedder)
**Rule 3 pinning tests:** Added to tests/skills/discordMonitor.test.ts (17 assertions: trigger, no-cron, concurrency group, action SHAs, permissions, npm command, commit message, staged path, rebase pattern)
**Dependency:** PR #132 stacked on PR #130 (knowledge artifact shape must exist first); rebased onto main per Rule 4 after #130 merge
**Reviewers:** Kirk ✅, Bashir ✅, Picard ✅, Garak ✅
**Outcome:** PR merged 05:46Z. No governance impact. Next dispatch: #94 queued for Batch 3 (pending #93 PR open and artifact schema stable).


---

## 2026-06-02T03:38Z — Discord Worker deploy workflow #148 assigned

Epic #143 filed. O'Brien owns #148 (deploy workflow). Responsibility: `wrangler deploy` on `worker/**` push-to-main. Depends on #146 (Worker code). Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to be set (human provisioning from local terminal per Rule 21 — never pasted in chat). Expected complexity: medium. New infra surface: Cloudflare Workers free tier.
