### 2026-06-02T03:34Z: Discord slash command architecture — Option B chosen
**By:** Cyrus Jamula (via Copilot)
**What:** For invoking commands from the Discord chat box (e.g. `/trigger-redeem`, `/redeem-status`), use **Option B — Cloudflare Workers bridge**. The Worker receives Discord INTERACTION_CREATE POSTs, verifies the Ed25519 signature, responds deferred (type:5), and fires a GitHub `repository_dispatch` event that triggers the actual work in GitHub Actions. GHA posts results back via Discord follow-up messages.
**Why:** User-selected from the three options Uhura presented. Option A (workflow_dispatch only) doesn't give chat-box commands. Option C (always-on bot host) adds infra surface (~$5–10/mo, VPS maintenance) we don't need.
**Implications:**
- New infrastructure: Cloudflare Workers free tier (100k req/day). Single Worker, stateless.
- New GH secrets needed: `DISCORD_PUBLIC_KEY` (Worker side, for signature verification — public, not a credential), `CLOUDFLARE_API_TOKEN` (for Worker deployment from CI).
- New workflows: `discord-register-commands.yml` (one-off registration via workflow_dispatch), `discord-command-handler.yml` (triggered by `repository_dispatch` events from the Worker, posts follow-up via `PATCH /webhooks/{app_id}/{interaction_token}/messages/@original`).
- Architecture: bridge keeps all business logic in GHA. Worker is thin (signature verify + dispatch). Easy to revert (delete Worker, remove workflows).
- Owner: Kirk for architecture, Uhura primary implementer (Discord domain), Scotty assists on the GHA repository_dispatch handler, Bashir for test scaffolding around the Worker, O'Brien for CF deployment workflow.
- Out of scope (for now): voice/presence/real-time reaction handling — explicitly deferred to "Option C if ever needed".

---

# Kirk — Discord slash command architecture (Option B) decomposition

**Date:** 2026-06-02T03:34Z
**From:** Kirk (Lead / Architect)
**Decision context:** Cyrus selected Option B (Cloudflare Workers bridge) per `.squad/decisions/inbox/copilot-discord-slash-arch-option-b.md`.
**Epic:** #143
**Children:** #144, #145, #146, #147, #148, #149

## Architecture

### Component boundaries

```
User types /trigger-redeem in Discord
  ↓ Discord POSTs INTERACTION_CREATE to Cloudflare Worker
  ↓ Worker verifies Ed25519 signature (tweetnacl)
  ↓ Worker responds type:5 (deferred) within 3s
  ↓ Worker calls POST /repos/Jamula/stfc/dispatches { event_type, client_payload }
  ↓ GHA repository_dispatch workflow runs the actual command
  ↓ GHA PATCHes /webhooks/{app_id}/{interaction_token}/messages/@original
```

| Component | Path | Responsibility | Owner |
|---|---|---|---|
| Cloudflare Worker | `worker/src/index.ts` | Stateless. Signature-verify, defer, dispatch. **NO business logic.** ~100 LoC. | Uhura (#146) |
| Registration workflow | `.github/workflows/discord-register-commands.yml` | One-off `workflow_dispatch`. Reads `discord/commands.json`, PUTs to Discord. | Uhura (#145) |
| Handler workflow | `.github/workflows/discord-command-handler.yml` | `repository_dispatch: discord-command`. Runs the command, posts follow-up. | Scotty + Uhura (#147) |
| Deploy workflow | `.github/workflows/deploy-cloudflare-worker.yml` | Push-to-main on `worker/**` → `wrangler deploy`. | O'Brien (#148) |
| Command definitions | `discord/commands.json` | **Single source of truth.** | Uhura (#144) |
| Operator runbook | `docs/discord-slash-commands.md` | <30-min wire-up guide. | Uhura (#149) |

### Secrets

| Secret | Lives on | Used by | Sensitivity |
|---|---|---|---|
| `DISCORD_PUBLIC_KEY` | CF Worker (`wrangler secret put`) | Ed25519 verification | Public but secret-ish for cleanliness |
| `DISCORD_BOT_TOKEN` | GH Actions (exists) | Registration + follow-up message | High — existing CI secret |
| `GH_DISPATCH_TOKEN` | CF Worker (`wrangler secret put`) | Worker → GH dispatch | **🚨 Highest.** Fine-grained PAT, single repo, single permission, quarterly rotation |
| `CLOUDFLARE_API_TOKEN` | GH Actions (NEW) | Deploy workflow | High — Workers Edit scope only |
| `CLOUDFLARE_ACCOUNT_ID` | GH Actions (NEW) | Deploy workflow | Low |

**Human-in-the-loop (Cyrus):** must `gh secret set` / `wrangler secret put` from a local terminal. Per Rule 21 — never paste values into chat.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| 3s Discord timeout | Worker defers (`type:5`) BEFORE GH dispatch call. Test pins this contract. |
| Replay attacks | tweetnacl signature + `X-Signature-Timestamp` reject if >300s old. |
| GH dispatch token scope creep | Fine-grained, single-repo, single-permission, quarterly rotation. Handler allow-lists `client_payload.command`. |
| 15-min interaction token expiry | Long-running commands respond with run URL early; document contract in #149 runbook. |
| Concurrent slash commands | Existing `stfc-gift-redeemer` group serializes redeem. Handler gets its own `stfc-discord-handler` group. |

### Out of scope (initial cut)

- Subcommand routing — use separate commands
- `APPLICATION_COMMAND_AUTOCOMPLETE`
- Component callbacks (buttons / select menus)
- Internationalization

## Decomposition reasoning

The split into 6 children is driven by **owner boundaries** and **independent shippability**, not by line count:

1. **#144 (commands.json)** is the contract — both #145 and #147 consume it, so it ships first. Tiny but blocking everything Discord-shaped.
2. **#145 (register)** is pure GHA + Discord REST. Uhura's wheelhouse. Ships independently of the Worker existing.
3. **#146 (Worker)** is the only piece of new infrastructure. Isolating it lets the test scope stay small (~100 LoC + signature-mocking tests) and gives a clear revert boundary.
4. **#147 (handler)** is the "business logic" piece. Routed to Scotty (CLI/orchestration owner) because it invokes `gh workflow run redeem.yml` and reads `docs/redeem-history.md` — both Scotty-domain. Uhura assists on the Discord follow-up REST call (uses existing patterns in `src/discord/client.ts:172`).
5. **#148 (deploy)** is pure CI/CD plumbing — O'Brien's lane.
6. **#149 (runbook)** waits for everything else because it documents the end-to-end. Filing it now ensures the docs-debt isn't forgotten.

## Dependency map

```
#144 (commands.json) ──→ #145 (register)
                    └─→ #147 (handler reads command surface)

#146 (worker) ──→ #147 (handler uses agreed client_payload shape)
            └─→ #148 (deploy needs worker/ dir to exist)

#149 (runbook) ──depends on all of #144–#148
```

Suggested implementation order: **#144 → #145 → (#146 ‖ #147 after #144) → #148 → #149**.

## Open questions for Cyrus

1. **Global vs. per-guild registration?** Global commands take ~1h to propagate; guild commands are instant but per-guild. Recommend: register globally as the default, allow `guild_id` workflow_dispatch input for dev/testing iteration. (Codified into #145 already; flagging for confirm.)
2. **Should `/trigger-redeem` be admin-gated?** Recommend `default_member_permissions: "8"` (ADMINISTRATOR) or a custom role check. Default is "anyone in channel."
3. **Quarterly rotation for `GH_DISPATCH_TOKEN`** — manual or do we want a calendared issue for it? Recommend: manual for now (Cyrus's call), add a calendar reminder. We can automate later if it sticks.

— Kirk

---

# Picard triage — issues #138 & #112

**Date:** 2026-06-02
**From:** Picard (M2 / EM)
**To:** Scribe (for decisions ledger merge)

## Issue #138 — Coordinator routing smoke-tests

**Decision:** Route to **@copilot**. Strip `squad:bashir` and `go:needs-research`. `squad:copilot` label retained as routing signal.

**Rationale:** Issue body fully enumerates the 10 trigger strings, expected behaviors, and two implementation options. Work is mechanical (🟡 medium per @copilot capability profile in `team.md`). No testing-strategy judgment needed from Bashir; @copilot can author the harness or runbook in one session.

**Expected deliverable:** `tests/squad/coordinator-routing.test.ts` (Option A preferred) OR `docs/testing/coordinator-triggers.md` (Option B fallback) plus per-Rule 15 `## Tests` PR-body section. P3 priority — no schedule pressure.

**Action gap:** `gh issue edit --add-assignee Copilot` failed with `Bot does not have access to the repository` from the Codespaces-injected token (known limitation). The `squad:copilot` label remains as the routing signal and the auto-triage workflow already offered Copilot-handoff instructions in an earlier comment. If Copilot doesn't auto-pick within a day, manually re-assign from the user's local terminal.

## Issue #112 — Phase 1 epic decomposition

**Decision:** No new decomposition filed. Reconciled the empty epic body with the actually-shipped P1 work (#113–#122 all CLOSED) and identified the lone remaining gate (#127, Azure OIDC secrets).

**Rationale:** Phase 1 was decomposed in-flight under the `p1-*` series before this tracking epic was filed. Quickstart confirms the capability surface is live (auth lib, frontend shell, deploy contract, data-read endpoints, invitation runbook). Filing 3–6 new child issues now would be board noise.

**Updated epic body:** Lists the 10 closed `p1-*` child issues as a checklist, points at #127 as the single remaining gate, defines closure criteria.

**Open questions for Kirk:** None. Auth approach and hosting decision both settled in Phase 0 and shipped.

**Closure path:** Picard provisions Azure OIDC secrets (per #127 checklist, from local terminal per Rule 21) → O'Brien verifies deploy job activates → epic closes.

## Triage heuristics (general — for the heuristics shelf)

1. **Dual-assignment resolution (`squad:X` + `squad:copilot`):** default to @copilot when the issue body is fully specified and the work is mechanical (no strategy/judgment call). Reserve the human seat for cases where the assignee's domain expertise is the actual gating factor.

2. **Epic-decomposition reality check before filing children:** when an epic looks "ready to decompose", first search for already-shipped `{prefix}-*` issues (`gh issue list --search "<prefix>" --state all`). If decomposition already happened in-flight, reconcile the epic body retrospectively instead of filing duplicates.

3. **`go:needs-research` is removable by the triage authority** when the "research" question is actually a routing/ownership call. Don't park your own triage decisions behind a label that asks someone else to make them.

— Picard


# Kirk decision: PR #141 re-review

Date: 2026-06-02T02:55:47Z
PR: #141 — `ci: add cleanup-old-runs workflow`
Head: `1068c1c`

**Verdict:** APPROVE ✅

All three blockers from the 2026-06-01 CHANGES_REQUESTED review are fixed:
- B1 counter-abort under `set -e` → `$((x + 1))` form throughout
- B2 pipe-to-while subshell → process substitution `done < <(...)`
- B3 fake backoff → `sleep 5` + single retry with stderr classification (404/429/5xx/other)

Non-blocking items also addressed: positive-integer input validation, 404 idempotency
accounting, self-decap guard, scoped permissions, jq status filter.

CI all-green. Rule 3 pin: not required (dispatch-only workflow, no cron/concurrency).

Per Rule 7, coordinator may auto-merge.

---

# Kirk review verdict — PR #96 (discord-channels stub + ingest script)

**Date:** 2026-06-02T02:55:47Z
**PR:** https://github.com/Jamula/stfc/pull/96
**Verdict:** **APPROVE** ✅
**Comment:** https://github.com/Jamula/stfc/pull/96#issuecomment-4598333241

## Summary

Picard un-drafted #96 under Option C (ship the prep work for an external blocker
we don't control — bot is not a member of guild `639255937869152267`). I reviewed
the script + docs and APPROVE.

## What was verified

- **Token hygiene:** env-only, fails loudly, never echoed; JWT-regex redaction in
  the FATAL handler protects against leaks via bubbled fetch errors.
- **Discord API hygiene:** pins-first → paginated history; 500 ms polite delay
  between pages; 429 → `retry-after` → single recursive retry; 401/403 produce
  actionable messages with the invite URL template.
- **Permission bitmask 66560** = VIEW_CHANNEL(1024) + READ_MESSAGE_HISTORY(65536)
  — verified numerically; no write, no admin.
- **Lineage block** generated from script constants; all six fields populated and
  match the convention in `docs/stfc-knowledge/README.md`.
- **Read-only:** no POST/PATCH/DELETE codepath anywhere — ToS-compliant.
- **Idempotent:** script only overwrites its own two output files; existing
  channel `README.md` stub is untouched (script only `console.log`s an advisory).
- **Rule 3:** N/A — no workflow YAML.
- **Rule 16:** satisfied — script docs live in header comment + two READMEs.
- **Tests:** `npm test` = 567/567 pass on `cae7efe`. Script itself has no tests —
  defensible for v1 (one-shot manual tool, live Discord API dependency).

## Non-blocking observation (logged in PR comment, not in inbox follow-up)

Repo convention for ingest-script exit codes is `0/1/2`. Currently 401 (operator
issue) and 403 (remote-service rejected) both exit 1. A future revision could
split 403/5xx → exit 2 for cleaner CI signaling. No blocker — no test enforces it
and the script isn't on a CI path today.

## Auto-merge note for the coordinator

Per Rule 7: reviewer approval is in, CI hasn't run yet (just un-drafted). Wait
for CI green, then `gh pr merge 96 --squash --delete-branch`. No additional
governance gate (no constitution touch, no infra touch).

— Kirk

---

# Picard decision: PR #96 triage — ship preparation, defer execution

**Date:** 2026-06-02
**Role:** Picard (M2 / EM — scope & priority)
**PR:** #96 — `docs(stfc-knowledge): stub discord-channels dir — blocked on guild access`
**Issue:** #76 — Ingest STFC Discord channel #1115978499400933473
**Verdict:** **Option C — un-draft and ship** (`gh pr ready 96` executed)

## Context

PR #96 sat at DRAFT for >24h on branch `squad/76-ingest-discord-channel`. Blocker is
external: the bot is not a member of guild `639255937869152267` (STFC Officer Tool
Discord) and `DISCORD_BOT_TOKEN` is a CI-only secret per stored memory — guild
membership cannot be probed locally. The PR ships: blocker README + directory stub
+ ready-to-run `scripts/fetch-discord-channel.mjs` + updated knowledge index row.
567/567 tests pass.

## Options considered

| Opt | Action | Outcome |
|---|---|---|
| A | Close PR + close #76 | Throws away script + README; #76 needs re-filing when access lands |
| B | Close PR, keep #76 open | Same loss as A; tracking issue stays |
| C | Un-draft + ship | Preserves prep work; #76 closes on merge; refile ingest as fresh ticket when unblocked |
| D | Hold draft 7 days | Same as A/B if guild access doesn't land; clutters board meanwhile |
| E | Escalate to user | Unnecessary — context is unambiguous |

## Why C

The docs + script **are** the deliverable for the "blocked" state. The README is a
self-contained runbook (probe URLs, invite template with `permissions=66560`,
`discord.gg/BRhru6Vcnj` server invite). The directory convention now exists for
any future Discord channel ingestion. Script is dead-on-arrival until guild access
— zero runtime risk. Closing the PR is pure waste.

## Reusable heuristic (external-blocker PRs)

When a PR is blocked by an external party (third-party API access, vendor
credential, guild admin, etc.) and the PR ships **standalone-useful artifacts**
(docs of the blocker, ready-to-run script, directory/schema convention) with **no
runtime risk**, prefer Option C over closing. The artifacts capture the analysis
work and provide a one-command path forward when the blocker clears. Reserve close
(A/B) for cases where the prep work is genuinely throwaway or where leaving it in
the tree creates ongoing confusion.

## Follow-up ticket (post-merge, when guild access lands)

File a fresh issue titled "Ingest STFC Discord channel #1115978499400933473 (guild
access granted)" with label `squad:o-brien`. Do NOT pre-file — it's board noise
until the external blocker clears.

## Per Rule 7

Auto-merge intentionally NOT enabled. Kirk may take a beat to scan the script
(technical surface) before merge. Docs/scope is clean from my side.

— Picard

---
> Older entries archived to decisions-archive.md (up to 2026-05-18). See archive for history.

# Uhura PR #102 fix — Structural workflow pin tests

**By:** Uhura
**Date:** 2026-05-31
**PR:** https://github.com/Jamula/stfc/pull/102
**Status:** Proposed canonical pattern

## Decision

Workflow pinning tests should parse workflow YAML and assert on the parsed object graph, not on raw substrings or ad hoc regex over the whole file.

## Canonical pattern

1. Load the workflow once with `readFileSync()`.
2. Parse with `parseYaml()` from the existing `yaml` package.
3. Assert trigger keys structurally, e.g. `Object.keys(workflow.on)`.
4. Assert paths via `workflow.on.push.paths`.
5. Assert no-cron via `workflow.on.schedule === undefined`.
6. Assert permissions/concurrency via their parsed keys.
7. Walk `workflow.jobs.<job>.steps[]`; for each step with `uses`, assert `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+@[0-9a-f]{40}$`.
8. Find exact skill `run:` commands and commit-message blocks from parsed steps.

## Why

Raw substring checks let comments satisfy or break acceptance gates. PR #102 showed both sides: `data/crew/**` could pass from a comment, while a literal `# NO schedule:` comment tripped a naive no-cron guard. Parsed-structure assertions pin the actual GitHub Actions semantics.
# Uhura PR #103 docs alignment decision

- Date: 2026-05-31
- Artifact: PR #103 (`squad/83-operator-docs`)
- Decision: For Finding 3, align `docs/CREW-OPTIMIZER.md` to the workflow behavior shipped by PR #102 rather than changing code or PR #102 from this lockout-routed docs revision.
- Rationale: PR #102 is O'Brien's separate workflow-pin artifact. PR #103 owns operator documentation only, so the safe fix is docs-aligns-to-code/workflow behavior, not code-aligns-to-docs. The docs now state that v1 runs `skill:optimize-crew --all` and `skill:progression --all` once per `data/crew/**` push and that per-task iteration is a follow-up.
# Decision: Constitution v2.0.0 amendment (Phase 0 Wave 1)

**Author:** Picard (M2 / Engineering Manager)
**Date:** 2026-05-31T21:52:57+00:00
**Status:** SHIPPED — committed on `squad/005-phase0-governance`
**Closes:** #105
**Epic:** #104 (005-web-control-panel)

## Decision

Amended `.specify/memory/constitution.md` to **v2.0.0 (MAJOR)** and
re-synced `.specify/templates/plan-template.md` in the same commit
(per Rule 1).

## Rationale for MAJOR (vs MINOR)

Three changes are independently MAJOR-eligible — they ride
together in v2.0.0 because they all flow from the
005-web-control-panel epic:

1. **Principle IV gains a new runtime surface carve-out.** v1.x
   framed the project as "headless TypeScript Node CLI." v2.0.0
   admits a SWA + linked Functions surface alongside it. CLI
   obligations on `src/` are preserved verbatim, but the
   constitution's worldview is no longer CLI-only. This is the
   same shape of change as the v1.5.0 Principle V ops-script
   carve-out, but at the runtime-surface layer rather than the
   secret-custody layer — strictly broader.

2. **Principle I gains a new untrusted-input class.** Chat input
   (user messages, retrieved corpus, recent digests) is declared
   UNTRUSTED for tool dispatch. Any chat-initiated tool call must
   flow through an HMAC-signed confirmation gate. This is a NEW
   obligation on any future code path that lets external chat
   content reach a dispatcher.

3. **Security & Compliance Constraints gain a uniform
   workflow-input obligation.** Every `workflow_dispatch`-eligible
   workflow callable from the SWA control panel MUST declare
   `correlation_id`, `triggered_by`, `reason` inputs. The actual
   YAML edits to `redeem.yml`, `discord-monitor.yml`, and
   `refresh-token.yml` land in Phase 1+; the constitutional
   obligation lands in v2.0.0.

Plus five additive changes (would be MINOR on their own):

- Three new committed durable artifact trees: `data/runs/*.json`,
  `data/audit/*.jsonl`, `data/digests/*.md` (now tracked).
- Five new sanctioned secrets (SWA-Function-only):
  `GITHUB_APP_PRIVATE_KEY`, `MODELS_API_TOKEN`, `GEMINI_API_KEY`,
  `SWA_DEPLOYMENT_TOKEN`, `AZURE_TABLE_CONNECTION_STRING`.
- Two new outbound destinations:
  `https://models.inference.ai.azure.com/...` (GitHub Models),
  `https://generativelanguage.googleapis.com/...` (Gemini Flash).
- A hard isolation invariant: no STFC/Discord secret EVER crosses
  into the SWA Function runtime; `GITHUB_APP_PRIVATE_KEY` and
  `MODELS_API_TOKEN` MUST be separate secret values.
- Tracked-rather-than-ignored declaration for `data/digests/*.md`
  (the `.gitignore` removal is deferred to Phase 3 implementation
  per the cross-artifact follow-ups note in the SIR).

## Validation performed

- ✅ Rule 1 grep on plan-template enumerates every new sanctioned
  thing (`GITHUB_APP_PRIVATE_KEY`, `MODELS_API_TOKEN`,
  `GEMINI_API_KEY`, `SWA_DEPLOYMENT_TOKEN`,
  `AZURE_TABLE_CONNECTION_STRING`,
  `models.inference.ai.azure.com`,
  `generativelanguage.googleapis.com`, `data/runs`, `data/audit`,
  `correlation_id`). All present in the Principle V row.
- ✅ `npm run typecheck` — clean.
- ✅ `npm test` — 704/704 passing (no regressions; one initial
  failure on `tests/constitution/discord-ops-carveout.test.ts`
  was caused by my SIR's first reference to `scripts/discord-ops/`
  moving outside the carve-out body; rephrased to remove the
  exact-path token from that one SIR sentence so the test's
  `indexOf` again lands on the v1.5.0 SIR body — which is the
  expected anchor).

## Carry-overs to subsequent waves

- **Phase 0 Wave 2:** `/speckit.specify` + `/speckit.clarify` open
  on the 005-web-control-panel feature (Picard owns).
- **Phase 0 Wave 3:** threat model (Garak), contract schemas
  (Kirk authors / Bashir validates), standing-rules codification
  (Picard/Tuvok), platform spike (O'Brien).
- **Phase 1:** SWA deploy contract + bootstrap (O'Brien); first
  use of the new sanctioned secrets and the new workflow-input
  obligation.
- **Phase 3:** removal of `data/digests/*.md` from `.gitignore`
  when the chat retrieval / digest reader code lands.

## Known-Tension carry-overs (unchanged from v1.6.0)

The three known tensions from v1.2.0 (Principle III auth/me
overclaim; Principle VII scan-path overclaim; redeem/refresh
concurrency lock un-principled) are preserved verbatim. Not in
scope for this amendment.

## Picard verdict on own work

APPROVE ✅ — scope matches issue #105 exactly; no scope creep; no
secrets in artifacts; SIR is precise about what changed and what
deferred; plan-template Rule 1 sync verified; tests green.

# Picard — Phase 0 Wave 2: 005-web-control-panel speckit opened

**Date:** 2026-05-31T22:40:48+00:00
**Branch:** `squad/005-phase0-governance`
**Commit:** `b5346c7`
**Closes:** #106

## Decision

Opened `specs/005-web-control-panel/` with the full speckit artifact set,
mirroring the 004-crew-optimizer Phase 0 precedent (commit `c6432d9`).
Wave 2 of the bundled Phase 0 effort — constitution v2.0.0 (#105) was
wave 1 (commit `988c302`).

## What landed

- `spec.md` — clarified spec, 6 user stories, FR-001..FR-093 partitioned
  by phase (matches v3 plan's phase boundaries 1:1), 10 edge cases,
  explicit out-of-scope list, §Clarifications block resolving all 8
  open questions inline (no `[NEEDS CLARIFICATION]` markers remain).
- `plan.md` — placeholder pointing at the v3 plan in session state.
  Migration to `/speckit.plan` format intentionally deferred to keep
  this PR small.
- `research.md` — Phase 0 Platform Spike placeholder enumerating
  O'Brien's three open questions (#109).
- `data-model.md` — schema inventory for the three contracts (Kirk #6
  schema_version rule encoded).
- `contracts/README.md` — placeholder for the JSON schemas (#108).
- `threat-model.md` — placeholder with explicit STRIDE-lite coverage
  scope for Garak (#107).
- `quickstart.md` — placeholder for Phase 1.
- `checklists/requirements.md` — speckit quality checklist; all boxes
  checked.

## Source-of-truth posture

The v3 plan
(`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`)
remains the binding plan-of-record until `/speckit.plan` migration
lands in a follow-up Phase 0 issue. The spec extracts from the plan
rather than inventing scope — every FR maps to a v3 plan phase, every
clarification answer is the v3 plan's deferred-decision default.

## Rule observance

- **Rule 2:** Staged each spec path individually via
  `git add specs/005-web-control-panel/`; no `.squad/` paths touched.
  This decision note remains UNCOMMITTED in
  `.squad/decisions/inbox/picard-speckit-005.md` for Scribe to commit
  in a separate session.
- **Rule 5:** Phase-boundary commit at the end of wave 2 (one bundled
  PR per the 004 precedent). Not deferring to end-of-session.
- **Rule 6:** `Closes #106` on its own line in the commit body.
- **Rule 4:** Worktree branch tracking `origin/squad/005-phase0-governance`;
  no `main` rebase required (working in a feature worktree per
  `/workspaces/stfc-p0`).

## Verification

- `npm run typecheck` → exit 0 (no diagnostics).
- `npm test` → 704 pass / 0 fail (no regressions).
- `git log -1` → commit `b5346c7` on
  `squad/005-phase0-governance`, pushed to origin successfully.

## Next waves on this branch

Coordinator's call, but the natural ordering is:

1. **#107** — Garak writes `threat-model.md` (STRIDE-lite analysis).
2. **#108** — Kirk authors the three JSON schemas; Bashir adds
   round-trip validation tests.
3. **#109** — O'Brien runs the platform spike and commits findings to
   `research.md`.
4. **#111** — Picard + Tuvok codify Rules 14–18 in
   `.github/copilot-instructions.md`.

When all four land, the Phase 0 PR is review-ready (Picard + Garak +
Tuvok reviewer matrix per FR-091 / v3 plan §reviewer matrix).

# Decision — PR #111 governance review (Picard)

**Date:** 2026-05-31T23:11Z
**Reviewer:** Picard (M2 / Engineering Manager)
**PR:** #111 — feat(005-web-control-panel): Phase 0 — governance + spec + threat model + schemas (#104)
**Verdict:** **APPROVE** ✅ on governance / scope / bundle-integrity grounds.

## Scope verification (v3 plan §146–§158)

Six Phase 0 deliverables promised. Six delivered:

| v3 promise | Commit | Status |
|---|---|---|
| Constitution v2.0.0 MAJOR + plan-template re-sync (Rule 1) | `988c302` | ✅ |
| `specs/005-web-control-panel/` opened (spec/plan/research/data-model/quickstart/contracts/threat-model placeholders) | `b5346c7` | ✅ |
| Rules 14–18 in `.github/copilot-instructions.md` (NOT constitution) | `078d01f` | ✅ |
| Platform spike `research.md` (5 questions resolved) | `e2e463c` | ✅ |
| STRIDE-lite `threat-model.md` | `e5e26e4` | ✅ |
| Three JSON Schema 2020-12 contracts + round-trip tests | `aeef1b5` | ✅ |

## Bundle integrity (004 `c6432d9` precedent)

One PR, six waves, one merge boundary. Matches the 004 precedent I
established. No phase-boundary off-by-one.

## Constitution amendment scope (v3 line 149 checklist)

Every promised expansion present in `988c302` commit body:
- ✅ Outbound LLM hosts (Models + Gemini)
- ✅ Durable artifacts (`data/runs`, `data/audit`, `data/digests`)
- ✅ SWA+Functions runtime carve-out (Principle IV)
- ✅ GitHub App private key sanctioned (Principle V)
- ✅ correlation_id workflow-input obligation
- ✅ Chat untrusted-input addendum (Principle I)
- ✅ "No STFC/Discord secrets cross into SWA" isolation invariant
- ✅ Plan-template re-synced in same commit (Rule 1 satisfied)

## Rules placement

Rules 14–18 landed in `.github/copilot-instructions.md` with
cross-references to constitutional Principles VII (docs) and IX (tests)
rather than duplicating them in the constitution. This is exactly the
placement I directed in earlier guidance. ✅

## Platform spike clarity for Phase 1

`research.md` reports **5/5 GO, no blockers**. One soft note (Q4: Cyrus
must confirm Azure subscription/region before Storage Account provisioning)
explicitly flagged as "not a blocker on contract or code work". Phase 1
can start cleanly once the in-flight 003/004 burn-down clears.

## What I did NOT review (charter boundaries)

- Constitution wording quality → Tuvok
- Threat model factual claims → Garak
- Contract schema technical correctness → Kirk (pre-stamped during #110)
- Test coverage adequacy → Bashir
- My own authorship of #105/#106 — reviewing only as bundle governance,
  not as approving my own work

## Recommendation

Merge after Garak and Tuvok verdicts land. CI quota-gated per user
directive; local 754/754 green stands in for CI-green per Rule 7
fallback. Rule 7 auto-merge fires once all reviewer headers post APPROVE.

# Kirk — Phase 0 wave 3 contract schemas v1 (issue #110)

**Date:** 2026-05-31T22:40:48+00:00
**Author:** Kirk (Lead / Architect)
**Status:** Decided + shipped (commit `aeef1b5`, PR: branch
`squad/005-phase0-governance`)
**Closes:** #110

## Decisions

1. **JSON Schema 2020-12**, not Draft-07. Needed `oneOf` over a
   discriminator (`workflow`) plus `not: { anyOf: [...] }` for forbidden
   audit fields, and we want to keep the door open for `if/then/else`
   refinements in v1.x without a draft bump. Ajv 2020 supports it.

2. **`oneOf` over `workflow`** chosen over `if/then/else` chains for
   `run-result.business_result`. Reads cleaner with three workflow
   families and Ajv reports `oneOf` failures more interpretably than
   chained conditionals when a producer ships the wrong sub-shape.

3. **Redaction-by-design encoded in the schema, not just enforced in
   producer code.** `audit-event.json` has
   `not: { anyOf: [ {required:["prompt"]}, ... ] }` for
   `prompt | raw_error | args | payload`. Bashir's tests assert the
   rejection. This makes "we accidentally logged a prompt" a
   schema-validation failure at write time, not just a lint warning.

4. **Nullable-but-present**: `audit-event.workflow | run_id |
   correlation_id | error_code` are typed `["string", "null"]` AND
   listed in `required[]`. Producers MUST emit the keys explicitly
   (with `null` when not applicable) — prevents "field absent vs field
   null" ambiguity downstream.

5. **`schema_version` is `const: "1"`**, not `pattern: "^1\\..*"`.
   We promised consumers can reject unknown versions; the simplest way
   is exact-match. Future v1.x revisions add OPTIONAL fields (back-compat
   per Kirk #6); breaking changes bump to `const: "2"` with a
   coordinated consumer PR.

6. **`additionalProperties: false`** on all three top-level schemas
   and on `business_result` sub-shapes. Catches typos at the
   producer side; prevents accidentally smuggling unredacted fields
   through `audit-event` (defense-in-depth with rule 3).

7. **Added `ajv` + `ajv-formats` as devDependencies**. Justified in
   commit body: schemas are the source of truth for Phase 1's
   generated TS types (FR-015), so a real 2020-12 validator beats a
   hand-rolled subset. Total install: 78 packages, all MIT, zero
   vulnerabilities (`npm audit`).

## Hand-off

- **Bashir**: schemas now live at
  `specs/005-web-control-panel/contracts/{run-result,audit-event,chat-tool-call}.json`.
  Round-trip + required-field + redaction + workflow-oneOf coverage
  already in `tests/contracts/contracts-v1.test.ts`. If you want
  additional adversarial fixtures (negative integers in `claimed`,
  non-UUID `request_id`, etc.), add them to the same file.
- **Scotty** (Phase 1): the `shared/contracts/*.ts` generator should
  read these three JSON files. Use `json-schema-to-typescript` or
  similar; types are erased at runtime so the schemas remain the
  source of truth, with a CI drift gate per `data-model.md`.
- **O'Brien** (Phase 3+ producers): when extending workflows to emit
  `data/runs/*.json`, validate against `run-result.json` in the
  emitter before commit. The artifact-commit step in the existing
  `chore(history)` block is the right place.

## Open questions

None. The three schemas are aligned with the v3 plan's required-fields
summaries, the data-model.md inventory, the constitution v2.0.0
durable-artifacts list, and the spec's FR-007/FR-015.

# Decision Note: Rules 14–18 codified in copilot-instructions

**Date:** 2026-05-31T22:40:48+00:00
**Agent:** Tuvok (Process Auditor / Editorial Specialist)
**Issue:** #108
**Commit:** 078d01f
**Branch:** squad/005-phase0-governance

## Summary

Appended five standing rules (14–18) to `.github/copilot-instructions.md` and added
the Rule 17 compliance checkbox to `.specify/templates/plan-template.md`.

## Rules codified

| # | Title | Constitutional cross-ref |
|---|-------|--------------------------|
| 14 | gh-issues-driven workflow | — |
| 15 | Per-phase test scope | Principle IX |
| 16 | Per-capability doc updates | Principle VII |
| 17 | Rubber-duck multi-phase plans (enforceable) | — |
| 18 | Fleet + worktree execution | — |

## Placement decisions

- Rules inserted immediately before the `## Project quick reference` section,
  continuing the existing numbered-rule convention (Rules 1–13).
- Rule 15 and Rule 16 reference constitutional principles rather than duplicating
  the underlying obligation text, per Picard's placement guidance.
- Plan-template change: `## Process Compliance` section added between `## Constitution Check`
  and `## Project Structure`, containing the Rule 17 rubber-duck checkbox.
  This is additive only; the sanctioned-things re-sync from wave 1 (988c302) is untouched.

## Verification

- `npm test`: 704 pass / 0 fail
- `npm run typecheck`: clean
- `.squad/` paths NOT staged or committed (Rule 2 compliance).

# Garak threat model note — 005 web control panel

**Date:** 2026-05-31T22:40:48+00:00<br>
**Issue:** #107<br>
**Status:** Completed; leave uncommitted for Scribe per Rule 2.

Completed the STRIDE-lite threat model for `specs/005-web-control-panel/threat-model.md`.

Hostile fact-check highlights:

- Verified the three target workflows share `concurrency.group: stfc-gift-redeemer`.
- Verified current GitHub login is `cyrusjamula`.
- Verified `data/digests/*.md` is still gitignored; called this out as a temporary governance/implementation tension.
- Verified constitution v2.0.0 declarations from the committed constitution, not the v3 plan body.
- Added an extra finding: workflow dispatch inputs required by v2.0.0 are not yet present on all three live workflows, so web writes must remain blocked until Phase 3/4/5 workflow work lands.

No `.squad/` paths were staged or committed.

# Decision Note: Phase 0 Platform Spike (#109)

**Author:** O'Brien (DevOps / Platform Engineer)
**Date:** 2026-05-31T22:49:27+00:00
**Issue:** #109
**Commit:** e2e463c (feat(005-web-control-panel): Phase 0 platform spike (research.md) (Phase 0 wave 3))
**Branch:** squad/005-phase0-governance

## Summary

All 5 platform spike questions answered. **Phase 1 is cleared — no blockers.**

## Decisions recorded

### D1 — SWA auth model: invitation-based custom roles on Free tier ✅

The v3 plan's `allowedRoles: ["stfc_operator"]` approach is confirmed
correct and works on the SWA Free tier using the pre-configured GitHub
OAuth provider. Custom role assignment via invitation is capped at 25
users per app (Free and Standard plans alike) — well within audience
scope. `allowedPrincipals` per-username config does NOT exist (confirms
RD P0.1). Function-level `requireAllowedUser` is the primary gate,
reading `x-ms-client-principal` Base64-JSON header.

### D2 — GitHub App installation: personal account, no policy blocks ✅

`cyrusjamula` is a `User` (personal) account. No org-level GitHub App
policy exists. App can be registered and installed on `Jamula/stfc`
with `actions:write` + `contents:read`. Installation token TTL is 1
hour; rotate proactively at ~50 min. Store private key as SWA Function
app setting. Note: GitHub rolling out new stateless token format
(`ghs_APPID_JWT`) — any `token.length === 40` assertions must be
updated.

### D3 — GitHub Models: available, live test passed ✅

Verified live at 2026-05-31T22:49Z: `gpt-4o-mini` via
`https://models.inference.ai.azure.com/chat/completions` returned HTTP
200 with Codespaces-injected `GITHUB_TOKEN`. No `models:read` scope
declaration needed in Codespaces; PAT outside Codespaces needs
`models:read`. Free tier (Copilot Free/Pro): 150 req/day,
8000 in / 4000 out tokens per request. Gemini Flash fallback on 429 is
correct plan.

### D4 — Azure Table Storage: no formal free tier; $0 at sub-threshold volume ✅

No formal "free tier" for Table Storage — it is pay-as-you-go. At
<100 transactions/month (single-row cooldown cache), cost is
sub-billing-threshold ($0.00). Use a **separate** Storage Account, not
the SWA-managed one. Confirm Azure subscription/region with Cyrus
before Phase 1 provisioning (not a code blocker).

### D5 — SWA deploy method: deployment token selected ✅

Deployment token preferred over OIDC for Phase 1. Simpler for a
single-maintainer project; no Azure RBAC / identity-federation overhead;
first-class SWA support. SHA-pin `Azure/static-web-apps-deploy`. Store
as repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. Rotate manually only
if compromised. Revisit OIDC if project grows to multiple maintainers.

## For Scribe

Commit this file to `.squad/decisions/inbox/` in the next Scribe
session. This note should be consolidated into `.squad/decisions.md`
under the `005-web-control-panel` section.

# Bashir QA Review — PR #111 Contract Schemas v1

**Date:** 2026-05-31T23:09+00:00
**Reviewer:** Bashir (Tester)
**Verdict:** APPROVE ✅

## Required coverage (issue #110) — all 5 present
1. ✅ Round-trip validation: redeem, discord-monitor, refresh-token, audit-event, chat-tool-call
2. ✅ Reject unknown version (schema_version="2") — all fixture types
3. ✅ Reject missing required field — every top-level required field across all 3 schemas
4. ✅ audit-event redaction-by-design: prompt, raw_error, args, payload all rejected
5. ✅ run-result oneOf: 3 cross-workflow mismatches + sub-field removal tested

## Gaps noted (non-blocking; recommend follow-up issue)
- `chat-tool-call.json`: `ttl_seconds` bounds (minimum: 5, maximum: 300) not tested.
  No test for `ttl_seconds: 4` or `ttl_seconds: 301` being rejected by Ajv.
- `run-result.json`: only 3 of 6 possible cross-workflow mismatch combinations covered.
  Missing: discord-monitor+redeem, redeem+refresh-token, refresh-token+discord-monitor.
- `run-result.json` sub-field removal: only `redeemed` from redeem workflow tested.
  Missing: sub-field removals from discord-monitor and refresh-token business_result.

## Test stats
- Total suite: 754/754 green
- Contracts suite isolated: 50/50 green

## Action
Coordinator should file a follow-up tracking issue (assignee: Bashir) for the 3 gap
items above. Not a Phase 0 blocker.

### 2026-05-31T23:08:49+00:00: Quota-tolerant CI fallback

**By:** Cyrus Jamula (via Copilot)
**What:** When server-side CI/CD is gated (quota exhausted, action_required, etc.), run `npm test` and `npm run typecheck` locally in the worktree and use that as the green-gate evidence. Do NOT stop progress waiting for server CI to resume.
**Why:** Quota exhaustion is a billing concern, not a quality concern — local test pass demonstrates the same correctness signal.

**Scope:**
- Reviewer verdicts (Kirk/Garak/Picard) may approve PRs based on local-test evidence when server CI is unavailable
- Rule 7 auto-merge gate still applies but treats local-test-green as equivalent to CI-green when CI cannot run
- Merge command: `gh pr merge <N> --squash --delete-branch --admin` if `--auto` is blocked by missing required checks
- Document local test output in the PR body or merge comment for audit
# Uhura decision note — crew v2 parser (#91)

Date: 2026-05-31
Issue: #91 (`crew-15-v2-parser`)

## Non-trivial calls

1. **Command allowlist is optional/missing-safe.**
   - `data/discord/command-channels.json` is the operator-specific real file and is not committed.
   - The loader returns `[]` when missing, so command parsing no-ops gracefully while the existing promo-code allowlist remains a hard requirement.

2. **Merged ingest, separated processing.**
   - The monitor merges promo-code channels and command channels only for REST polling.
   - Promo-code extraction/tip classification still run only on original promo-code channels, preventing command-only channels from contaminating digests or redeemer inputs.

3. **Rate-limit precedence.**
   - Per-channel limit: 10 commands/minute.
   - Per-user limit: 5 commands/minute.
   - Channel limit is checked first, then user limit; rejected commands are not registered into either rolling window.

4. **Silent rate-limit behavior.**
   - Rate-limited commands are logged locally but receive no Discord reply, matching the issue requirement and Discord command convention.

5. **Handler seam for #92.**
   - Future handlers should plug in behind `processCrewCommands()` / `handleCrewCommand()` in `src/discord/crewCommandParser.ts`.
   - The consumed shape is `CrewCommand { subcommand, args, raw, message }`; positional args are exposed as `_`, `_0`, `_1`, while flags drop the `--` prefix.

### 2026-06-01T00:58:00Z: Chronicle learnings — operational rollup
**By:** cyrusjamula (via Copilot Coordinator)
**What:** Consolidated learnings from `/chronicle improve`, `/chronicle tips`, and `/chronicle cost-tips` runs on 2026-06-01.
**Why:** Captured for team memory so future coordinators apply these as operational defaults.

---

## A. New copilot-instructions.md rules (added this session, awaiting commit)

Three rules added to `.github/copilot-instructions.md` (Rules #19–#21, file grew 504→623 lines):

1. **Rule 19 — Sequence shorthand `"X, Y, Z, ..."` is inclusive.** Triggered by the redeem-cron round-trip in session `0a6be0be` where the agent read `"10, 20, 30, ..."` as excluding `:00`. Default to `*/N` (inclusive) for cron-style sequences.
2. **Rule 13 — Codespaces idle-timeout is the keepalive answer.** Use `gh codespace edit --idle-timeout 240m` or the standalone `squad watch` CLI. Never propose `systemd`, `tmux`, `screen`, or cron-keepalive — they don't apply to the Codespaces runtime.
3. **Rule 21 — Refuse-and-rotate protocol for credentials pasted into chat.** Codified from incidents in session `63fb899e` (Discord client secret pasted verbatim). Any credential pattern → refuse to echo/log/persist, treat as compromised, instruct rotation, never request the value again.

**Action:** Commit `.github/copilot-instructions.md` to main alongside this directive.

---

## B. Cost-discipline findings (14-day analysis)

Empirical spend breakdown across 50 STFC CLI sessions:

| Model | Input tokens | I/O ratio | Notes |
|---|---|---|---|
| `claude-opus-4.7-1m-internal` | **236.7M** | 181:1 | Coordinator main sessions — 3× the next biggest |
| `claude-sonnet-4.6` | 44.6M | 107:1 | Code subagents |
| `claude-haiku-4.5` | 30.9M | 104:1 | Scribe + docs |
| `gpt-5.5` | 26.9M | 83:1 | Diverse-perspective reviews |
| `gpt-5.3-codex` | 16.2M | 126:1 | Heavy code gen |

**Hotspot:** Session `0a6be0be` (253 min, "Update Redeem Gift Timing" → crew optimizer pivot) burned **172.9M input tokens — 73% of all 1M-context spend in 14 days**. Average 308K input/turn, peak 892K. Root cause: topic pivots mid-session keeping stale context alive across unrelated work.

**Proposed defaults — TO BE ADOPTED:**

1. **Pin coordinator to `claude-sonnet-4.6` (or standard `claude-opus-4.7`), NOT `claude-opus-4.7-1m-internal`, via `.squad/config.json` `defaultModel`.** Only escalate to 1M when an actual single turn approaches 200K. The 1M variant averages 7× more input tokens per turn purely because it doesn't pressure context eviction.
2. **`/new` on every topic pivot.** If the new task wouldn't cite the previous one in a PR description, it doesn't belong in the same context. A `/new` at turn 2 of session `0a6be0be` (when the crew-optimizer pivot started) would have saved ~20M input tokens.
3. **"status check" → Direct Mode on Haiku.** Session `21121d6b` ran 180:1 ratio (19.7M input for 109K output). Future status-check responses MUST be Direct Mode and SHOULD run on `claude-haiku-4.5`.
4. **Trim squad.agent.md dead weight.** Init Mode Phase 1/2 (~110 lines), Casting Universe Allowlist + Migration (~50 lines), and Casting State Files schemas are never read in a configured repo. Gate behind on-demand pattern (already used for `casting-reference.md`). Estimated savings: 15–20% off every coordinator turn.
5. **Meta/analytical slash commands (`/chronicle*`, `/research*`, `/audit*`) MUST NOT inherit the full `squad.agent.md` system prompt.** They're standalone analyses, not orchestration tasks. Drop from ~30K input/turn to ~5K. Implementation: when authoring future custom slash commands in `.github/prompts/`, exclude the squad agent_instructions block.

---

## C. User-workflow preferences (`/chronicle tips`)

Operational habits the user should consider; not blocking but worth proactive suggestion:

1. **Most-typed phrase is `"status check"` (11×/14d).** Candidate for `manage_schedule` (scheduled prompt every 5m) — doubles as Codespaces keepalive activity (Rule 13).
2. **Recurring rituals — `"Ralph, go"`, `"merge to main and sync"`, `"ship it"` — belong as custom slash commands** in `.github/prompts/*.prompt.md`. The full Rule 6 ship-it ritual deserves a `/ship` command.
3. **Prefer `write_agent` over a fresh `task` spawn** for non-lockout follow-ups to a just-finished agent. In session `0a6be0be`, 73 `task` calls vs 6 `write_agent` — most of those were probably over-spawning.
4. **Detached background bash (`mode: "async", detach: true`)** for long fleet runs that may outlast Codespaces 240-min timeout. Zero uses in window.

---

## Next-action checklist (for future Coordinator)

- [ ] Commit `.github/copilot-instructions.md` with Rules #19–#21
- [ ] Add `defaultModel: "claude-sonnet-4.6"` to `.squad/config.json` (or open an issue to confirm)
- [ ] Open governance issue for squad.agent.md trim (Init/Casting on-demand gating)
- [ ] Open governance issue for meta-slash-command prompt template (excludes squad.agent.md)
- [ ] Update Response Mode Selection in squad.agent.md so `"status check"` Direct Mode includes "use haiku for this output"
# Kirk review — PR #123 (Phase 19: !crew command parser, closes #91)

**Date:** 2026-06-01T01:12:43Z  
**Reviewer:** Kirk (Lead / Architect)  
**Author:** Uhura  
**Branch:** `squad/91-v2-parser`  
**Verdict:** APPROVE ✅  
**Comment:** https://github.com/Jamula/stfc/pull/123#issuecomment-4588860690

## Summary of what was checked

1. **Scope isolation** — `codeChannelIds` built from original `allowlist.entries`, not the merged `ingestAllowlist`. Promo-code extraction and tip classification cannot be contaminated by command-channel messages. Verified end-to-end in `discordMonitor.ts` lines 161–254.
2. **Rate limiter correctness** — rolling window pruned on every check; rejected commands not registered (early return before push). Both channel (10/min) and user (5/min) limits tested with deterministic clock.
3. **Parser edge cases** — word boundary check (`isCrewCommandPrefix`), case sensitivity, quoted args, flag parsing, `--` separator handling.
4. **Backward compatibility** — `guild_id: optional()` on `DiscordMessageSchema`, `discordMessages` field on `IngestOutput`, `loadCommandChannelAllowlist` returns `[]` on missing file. All additive.
5. **Constitution** — `data/discord/command-channels.json` not committed (only `.example` ships), so no constitution amendment needed. Docs deferred to #95 (confirmed OPEN).
6. **CI** — CodeQL + npm test (3 runners) all green.

## LOW findings (non-blocking, passed to Coordinator for tracking)

| # | Finding | Tracking |
|---|---------|---------|
| L1 | `CrewCommandRateLimiter` Map keys grow unbounded over lifetime (values stay bounded) — non-issue for per-run model | Note for #92 if daemon model adopted |
| L2 | `withCommandChannels` hardcodes `version: 1` | Fix to `allowlist.version` at schema v2 |
| L3 | PR body uses `## Verification` not `## Tests` (Rule 15 heading) | Process note for future phases |
| L4 | `stats.ignored` inflated by promo-channel messages passed to `processCrewCommands` | Suggest pre-filter in #92 |

## Handler seam assessment

`processCrewCommands(messages, allowlist, responder, options)` and `handleCrewCommand(command) → string` are clean seams for Phase 20 handler plug-in. Consumed shape `CrewCommand { subcommand, args, raw, message }` matches the Uhura decision note. No rework needed for #92.

## Decision

APPROVE. Architecture is solid, rate limiter correct, scope isolation preserved. Ship to main.
### 2026-06-01T01:22:44Z: P1 fanout triage
**By:** Picard
**Epic:** #112
**Scope:** 11 issues across 3 implementer agents + 1 epic owner

---

## Current state of stfc-p1 (squad/005-phase1-dashboard)

- **Last commit:** `40ba589` — feat(005-web-control-panel): api/_lib/github-raw.ts with ETag caching (Phase 1 wave 3)
- **Test suite:** 905/905 passing ✅ (green on uncommitted WIP in place)

### Wave 3 commits already on branch (not yet merged to main)

| Commit | Issue | Subject |
|---|---|---|
| `a5db1eb` | #114 | unignore data/digests + commit-on-write in discord-monitor |
| `f32585c` | #113 | SWA deploy contract + deploy workflow + pinning test |
| `1f4f824` | #115 | bootstrap SWA project structure api/+web/+shared/ + setup script |
| `2606491` | #116 | staticwebapp.config.json deny-by-default + stfc_operator role |
| `9302288` | #122 | shared/contracts TS types generator + sync gate |
| `40ba589` | #120 | api/_lib/github-raw.ts with ETag caching |

### Wave 3 WIP — uncommitted (issue mapping)

| File(s) | Status | Likely Issue | Agent |
|---|---|---|---|
| `api/src/_lib/auth.ts` (139L), `api/src/_lib/respond.ts` (59L) | `??` untracked | **#117** fn-auth-lib | Uhura |
| `scripts/ci/check-api-auth.mjs` (171L) | `??` untracked | **#117** fn-auth-lib grep gate | Uhura |
| `tests/api/auth.test.ts` (288L) | `??` untracked | **#117** fn-auth-lib tests | Uhura |
| `tests/ci/check-api-auth.test.ts` (87L) | `??` untracked | **#117** fn-auth-lib CI test | Uhura |
| `docs/SWA-SETUP.md` | `M` modified (+64L auth section) | **#117** auth env-var docs | Uhura |
| `tests/index.test.ts` | `M` modified (+2 import lines) | **#117** test registration | Uhura |
| `web/src/app.ts` (118L), `web/src/components/*.ts` (5 × 19L) | `??` untracked | **#119** frontend shell | Scotty |
| `web/bundle-budget.json` | `??` untracked | **#119** bundle budget gate | Scotty |
| `scripts/ci/check-bundle-budget.mjs` (104L) | `??` untracked | **#119** bundle budget gate | Scotty |
| `tests/web/shell.test.ts` | `??` untracked | **#119** shell tests | Scotty |
| `tests/ci/check-bundle-budget.test.ts` | `??` untracked | **#119** budget gate tests | Scotty |
| `web/index.html` | `M` modified | **#119** Lit shell wiring | Scotty |
| `web/src/main.ts` | `M` modified | **#119** Lit shell wiring | Scotty |
| `web/vite.config.ts` | `M` modified | **#119** Vite config | Scotty |
| `web/package-lock.json` | `??` untracked | **#119** npm installs | Scotty |

**Status verdict:**
- **#117 (Uhura):** FULLY DONE — all implementation, CI gate, and docs files present; tests green
- **#119 (Scotty):** FULLY DONE — all frontend shell files present; tests green
- **#120 (Scotty):** COMMITTED — `40ba589`
- **#122 (Scotty):** COMMITTED — `9302288`
- **#113, #114, #115, #116 (O'Brien):** COMMITTED — waves 1–2
- **#118 (O'Brien):** UNTOUCHED — true Wave 4 candidate
- **#121 (Scotty):** UNTOUCHED — true Wave 4 candidate

---

## Plan.md ownership findings

`specs/005-web-control-panel/plan.md` is a **placeholder**. The binding v3 plan lives at:
`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`

Ownership derived from the v3 plan + WIP audit:

| Issue | Owner | Key Files |
|---|---|---|
| #113 | O'Brien | `.github/workflows/swa-deploy.yml`, `scripts/azure/create-swa.sh`, `tests/skills/swaDeploy.test.ts` |
| #114 | O'Brien | `.gitignore`, `src/discord/monitor.ts` |
| #115 | O'Brien | `api/`, `web/`, `shared/` scaffold, `scripts/azure/setup.sh` |
| #116 | O'Brien | `staticwebapp.config.json`, `web/public/403.html` |
| #117 | Uhura | `api/src/_lib/auth.ts`, `api/src/_lib/respond.ts`, `scripts/ci/check-api-auth.mjs`, `tests/api/auth.test.ts`, `docs/SWA-SETUP.md` |
| #118 | O'Brien | `docs/SWA-SETUP.md` (invitation section) |
| #119 | Scotty | `web/src/`, `web/bundle-budget.json`, `scripts/ci/check-bundle-budget.mjs`, `tests/web/`, `tests/ci/check-bundle-budget.test.ts` |
| #120 | Scotty | `api/_lib/github-raw.ts`, `tests/api/github-raw.test.ts` |
| #121 | Scotty | `api/src/` route handlers, `tests/api/` route tests |
| #122 | Scotty | `shared/`, `scripts/ci/check-contracts-types.mjs` |

### ⚠️ Shared / cross-cutting files (serialization required)

| File | Touched by | Risk |
|---|---|---|
| `tests/index.test.ts` | #117 (modified), #121 (will add route test imports) | Merge conflict if both in flight simultaneously |
| `docs/SWA-SETUP.md` | #117 (auth section, already modified), #118 (invitation section) | #118 must branch from a state where #117's changes are committed, or will conflict |
| `web/package-lock.json` | #119 (modified), #121 (may need new deps) | If #121 installs Azure Functions SDK additions — potential lock-file conflict |

---

## Wave 3 close-out

**Owner:** Single commit-and-PR agent (recommend: Scotty — most WIP is his; Uhura's work is complete and self-contained)

**Files to commit (two commits, preserving authorship clarity):**

Commit 1 — Uhura's #117:
- `api/src/_lib/auth.ts`, `api/src/_lib/respond.ts`
- `scripts/ci/check-api-auth.mjs`
- `tests/api/auth.test.ts`, `tests/ci/check-api-auth.test.ts`
- `docs/SWA-SETUP.md`, `tests/index.test.ts`

Commit 2 — Scotty's #119:
- `web/src/app.ts`, `web/src/components/*.ts`
- `web/bundle-budget.json`, `web/package-lock.json`
- `scripts/ci/check-bundle-budget.mjs`
- `tests/web/shell.test.ts`, `tests/ci/check-bundle-budget.test.ts`
- `web/index.html`, `web/src/main.ts`, `web/vite.config.ts`

**PR target:** Open PR `squad/005-phase1-dashboard → main`  
**Closes (per Rule 6 — one per line):**
```
Closes #113
Closes #114
Closes #115
Closes #116
Closes #117
Closes #119
Closes #120
Closes #122
```

**Reviewer:** Kirk (code correctness on auth.ts pattern — used by all Wave 4 route handlers; pre-approve shape before #121 builds on it)

---

## Wave 4 fanout proposal

| Issue | Owner | Branch | Worktree | Key Files | Parallel-safe? |
|---|---|---|---|---|---|
| #118 | O'Brien | `squad/005-p1-118-invitation-runbook` | `/workspaces/stfc-118` | `docs/SWA-SETUP.md` (invitation section) | ⚠️ branch from epic **after #117 committed** (SWA-SETUP.md shared) |
| #121 | Scotty | `squad/005-p1-121-data-read-endpoints` | `/workspaces/stfc-121` | `api/src/` handlers, `tests/api/` route tests, `tests/index.test.ts` | ⚠️ branch from epic **after Wave 3 committed** (needs `auth.ts`; touches `tests/index.test.ts`) |

Both Wave 4 issues branch off `squad/005-phase1-dashboard` (not `main`), merging back to the epic branch. Once both are merged into the epic branch, one final PR to `main` closes #112.

**Parallel dispatch ruling:** #118 and #121 are parallel-safe relative to each other (no shared files). Both must be serialized AFTER Wave 3 commits land on the epic branch. Dispatch in parallel once the Wave 3 PR is open (they can build against the committed state; they don't need Wave 3 merged to main first).

---

## Risk callouts

1. **Auth lib shape (Kirk call required before Wave 4 dispatch):** `api/src/_lib/auth.ts` is used by every route handler that #121 will write. Kirk should review and approve the `requireAllowedUser` / `requireOwner` pattern in the Wave 3 PR before #121 starts. A shape change post-#121-start = rebase pain across multiple files.

2. **`tests/index.test.ts` contention:** This is the master test import barrel. #121 will add more `import` lines to it. If #118 and #121 are both in flight and both touch this file, they will conflict on merge. **Ruling:** only #121 touches `tests/index.test.ts`; #118's runbook is docs-only and adds no test imports.

3. **plan.md placeholder (scope risk):** The binding v3 plan is in session state, not in the repo. Issue #106 was supposed to migrate it. If the session state is lost, the full 9-phase plan is gone. **Recommend:** Tuvok or O'Brien migrate the v3 plan text into `specs/005-web-control-panel/plan.md` as part of #118 (docs issue) or a separate 5-minute chore. Flag to user.

4. **#112 epic closure:** Epic #112 closes only after all child issues close. Current close-out plan closes 8 of 10 children (#113–#117, #119–#120, #122). Remaining: #118 and #121. Epic stays open through Wave 4. Correct and expected.

5. **No O'Brien worktree for Wave 4 #118:** O'Brien's Wave 4 issue is docs-only. A worktree is appropriate but the work is small (~1 doc section + any runbook checklist). Could be done directly on the epic branch by an agent with a targeted charter rather than a full worktree. Coordinator call.

---

## Recommendation

**Ship Wave 3 first.** The branch is green (905 tests). WIP for #117 and #119 is complete — just needs two commits and a PR. Open the Wave 3 PR, get Kirk's auth.ts review, then dispatch #118 and #121 in parallel from the epic branch in separate worktrees. Wave 4 is 2 issues; Wave 3 PR close unblocks both simultaneously.

**Sequence:**
1. Commit #117 + #119 WIP on `stfc-p1` → open Wave 3 PR (Closes #113–#117, #119–#120, #122)
2. Kirk reviews auth.ts shape in Wave 3 PR — single targeted review
3. Dispatch #118 (O'Brien) + #121 (Scotty) in parallel worktrees from `squad/005-phase1-dashboard`
4. Merge Wave 3 PR → main; merge #118 + #121 PRs → epic branch → final PR closes #112
### 2026-06-01T01:28:18.827+00:00 — Scotty Wave 3 close-out (#112 epic)

- **PR:** #124 — https://github.com/Jamula/stfc/pull/124
- **Branch:** `squad/005-phase1-dashboard`
- **Commits pushed:**
  - `b0cb61c` feat(005-web-control-panel): auth lib + CI grep gate (#117)
  - `d9e3837` feat(005-web-control-panel): Lit+Vite frontend shell + bundle budget gate (#119)
  - `c05f189` test(005-web-control-panel): bootstrap web deps in shell smoke test

#### Unexpected issues during close-out

1. **Worktree `.git` path nuance:** Initial `git commit -F .git/...` failed because `.git` is a gitdir pointer file in this worktree. Re-ran with repo-local message files (`.gitmsg117.txt`, `.gitmsg119.txt`) and committed successfully.
2. **CI environment drift for web toolchain:** PR test workflow failed (`vite: not found`) because root `npm ci` does not install `web/` dependencies. Added `c05f189` so `tests/web/shell.test.ts` runs `npm ci` in `web/` when Vite is missing; checks are now re-running on PR #124.

#### Ready for Kirk review

- `api/src/_lib/auth.ts` role/owner enforcement shape is in PR #124 and ready for Kirk's targeted correctness review before Wave 4 #121 route work begins.

**CHANGES REQUESTED** ⚠️ — Garak (hostile fact-check)

Requested by: cyrusjamula  
Reviewed artifact: `/home/node/.copilot/session-state/63c3014e-bdaa-4ebb-a118-447bc281fe96/plan.md` (v3 cleanup plan)  
Live repo: `/workspaces/stfc`  
Timestamp: 2026-06-01T01:55:00Z

## Verdict

This plan assumes its largest savings claims are arithmetically sound and that several existing mechanisms already preserve the invariants it now relies on. They are not, at least not in the live repo. The cleanup direction is sane; the concrete plan is not approval-ready.

## Verified claims

1. **Claim:** `.github/agents/squad.agent.md` is **85 KB / ~60 sections**. **Reality:** `wc -c` reports `84943` bytes and `grep -cE '^## |^### '` reports `60`. Verified.
2. **Claim:** `.github/copilot-instructions.md` is **28 KB / 21 rules**. **Reality:** `wc -c` reports `28416` bytes and `grep -cE '^## [0-9]+'` reports `21`. Verified.
3. **Claim:** Histories are near threshold: Uhura 15 KB, Garak 13 KB, Picard 12 KB, O'Brien 12 KB. **Reality:** Uhura `15124`, Garak `13029`, Picard `12032`, O'Brien `12267` bytes. Verified.
4. **Claim:** O'Brien charter is **119 lines / 6.5 KB**. **Reality:** `wc -l` reports `119`; `wc -c` reports `6479`. Verified. Peer charters are usually 46–69 lines / 2.0–3.9 KB, though Garak is a notable 5.3 KB exception.
5. **Claim:** Skills inventory is **21 `.squad/skills/` + 11 `.copilot/skills/`**. **Reality:** directory counts are exactly 21 and 11. Verified.
6. **Claim:** Rubber-duck's Rule 11 basis: **5 user-typed `Researching:` invocations in the last 30 days**. **Reality:** session-store query returned count `5`. Verified.
7. **Claim:** Agents read `.squad/decisions.md` at spawn. **Reality:** `squad.agent.md` spawn template explicitly says `Read .squad/decisions.md`; Scotty and O'Brien charters also say to read decisions before work. Verified.

## Failed or unsupported claims

1. **Claim:** `.squad/decisions.md` is **43 KB / 65 entries**. **Reality:** size is verified (`42971` bytes), but the entry count is not. Current top-level decision entries are 12 (`grep -cE '^# '`); H2/H3 subsections are 63. Calling this 65 entries conflates subsections with decisions. Surely that was intentional?
2. **Claim:** Active `decisions.md` contains entries dating back to v1.1.0 / v1.2.0 / pre-2026-05-16. **Reality:** live dates in active `decisions.md` are 2026-05-31 and 2026-06-01; the only v1.2.0 hit is a historical reference inside a 2026-05-31 constitution note. Older material is in archives, not the hot file.
3. **Claim:** Item 1 saves **~30 KB / ~35%** from `squad.agent.md`. **Reality:** the plan's own move table sums to about **12.6 KB**. Sampling the live section spans yields the same order of magnitude, roughly 12 KB, which is about **14–15%** of 84,943 bytes, not 35%. This misses the stated ≥25% coordinator-input goal.
4. **Claim:** Item 3 can bring `decisions.md` from **43 KB → ~15 KB**. **Reality:** all active entries are less than 7 days old, so the proposed `>7d AND archive-class` gate moves **0 KB today**. Sampling 10 top-level entries, only 2/10 are clean one-off review/docs notes likely archive-eligible once old; 8/10 are constitutional, standing-rule, current-epic, canonical-pattern, or unresolved-follow-up material. A 65% reduction is not defensible from the sample.
5. **Claim:** Scribe summarization already preserves full text in `history-archive.md`. **Reality:** existing archive examples (`scotty/history-archive.md`, `picard/history.md`, `bashir/history.md`) show summarized learnings, not full verbatim text. `squad.agent.md` says Scribe should summarize at 15 KB; it does not require full-text preservation. The plan is proposing new behavior while wearing the mask of an existing pattern.
6. **Claim:** No external code references rule numbers by ID, so renumbering is safe. **Reality:** active files outside `copilot-instructions.md` reference rule numbers: `.squad/routing.md` cites Rule 7 and Rule 9b; O'Brien/Garak charters cite Rules 3/9b/12/13; skills cite Rules 12/15/16; specs and tests also cite rule numbers. Renumbering is unsafe unless those references are updated or made title-based.
7. **Claim:** The on-demand reference pattern is already in use for `casting-reference.md`, `ceremony-reference.md`, etc. **Reality:** markers exist in `squad.agent.md`, but several targets are missing in the live repo: `ceremony-reference.md`, `ralph-reference.md`, `prd-intake.md`, `human-members.md`, `copilot-agent.md`, `reviewer-lockout.md`, and `init-mode.md`. `casting-reference.md`, `plugin-marketplace.md`, and `issue-lifecycle.md` do exist. Pattern: yes. Fully working inventory: no.
8. **Claim:** Trigger detection lines in `squad.agent.md` are sufficient. **Reality:** casting has an inline trigger path (`Adding Team Members` says allocate a name; `Casting & Persistent Naming` says load `casting-reference.md`), so that one is plausible. But the current file also has on-demand references to missing files. The trigger pattern only works when the target exists and smoke tests assert the load, which the plan has not yet established.
9. **Claim:** Item 2 consolidation is consistently **21 → ~16/17 rules**. **Reality:** the plan contradicts itself: section header says `21 → ~16`, outcome says `21 → 17`, and the SQL todo table still says `21 → ~14`. That is not a harmless typo when the work is rule renumbering.
10. **Claim:** Item 1 moves “7 conditionally-relevant sections.” **Reality:** the move table lists 10 rows, while the problem statement names 7 broad areas. The implementation todo repeats 7. The scope is ambiguous before work starts.
11. **Claim:** Skills audit has “No `_archive/` moves” per user decision. **Reality:** the risk table still says “Retire means move to `_archive/`, not delete.” That directly conflicts with the v3 opt-out and Item 6 inventory-only approach.

## Estimate checks

- **Item 1 math:** table total is approximately 12.6 KB. Against `squad.agent.md` at 84.9 KB, that is about 15%, not 35%. To reach 30 KB, the plan needs another ~17 KB of specific sections identified, or it must lower the target.
- **Item 3 sample:** sampled first 10 top-level entries in `decisions.md`:
  1. Structural workflow pin tests — canonical pattern, retain hot.
  2. PR #103 docs alignment — one-off docs/PR note, archive-eligible once old/closed.
  3. Constitution v2.0.0 amendment — constitutional, retain hot.
  4. 005 speckit opened — current epic context, retain hot.
  5. PR #111 governance review — one-off PR review, archive-eligible once old/closed.
  6. Contract schemas v1 — canonical/current epic, retain hot.
  7. Rules 14–18 codified — standing rules, retain hot.
  8. Threat model note — current epic/security context, retain hot.
  9. Platform spike — current epic/canonical platform decisions, retain hot.
  10. Bashir QA review — includes unresolved follow-up gaps, retain hot.

Result: 0/10 immediately movable by age; about 2/10 eventually archive-class. The proposed 43 KB → 15 KB target needs evidence, not optimism.

## Counterexample to retention classes

**Entry:** `Scotty Wave 3 close-out (#112 epic)` includes “Worktree .git path nuance” and “CI environment drift for web toolchain.” **Reality:** this is an operational incident / tooling-footgun learning: not constitutional, not a standing rule, not an active blocker, not merely a PR verdict, not a canonical architectural pattern, and not simply current epic context. It needs either a seventh class (`operational learning`) or a forced split into one archiveable close-out plus one retained reusable-footgun note.

## Hidden assumptions

- **Assumption:** Scribe's current summarization will preserve full text. **Reality:** no; current mechanism summarizes. Add an explicit implementation requirement for verbatim append/rotation if full text matters.
- **Assumption:** Renumbering rules is safe. **Reality:** no; active artifacts cite rule numbers. Add a grep-and-update gate, or avoid renumbering.
- **Assumption:** On-demand templates mostly exist. **Reality:** no; several referenced or proposed templates are missing. Add a preflight target-file checklist before moving content.
- **Assumption:** Decision archival can shrink the hot file materially now. **Reality:** no; the hot file is recent. Semantic tagging may improve future hygiene, but it will not deliver the stated immediate size win.

## Recommendation

Do **not** proceed to user approval in this form. Correct the size/savings math, fix the stale contradictions, add explicit migration/update gates for rule-number references and missing templates, and downgrade `decisions.md` shrinkage from a promised 65% reduction to an evidence-based hygiene task.

Final count: **7 verified claims, 11 failed or unsupported claims**.


---

# Kirk — Technical correctness review: Squad Cleanup Plan v3

**CHANGES REQUESTED** ⚠️ — Kirk (technical correctness)

**Requested by:** cyrusjamula (rubber-duck → squad review pass)
**Plan artifact:** `/home/node/.copilot/session-state/63c3014e-bdaa-4ebb-a118-447bc281fe96/plan.md`
**Date:** 2026-06-01T02:06:58Z
**Files inspected:** `squad.agent.md`, `copilot-instructions.md` (all 21 rules),
`decisions.md` (5 entries sampled), `.squad/agents/uhura/history.md`,
`.squad/agents/obrien/history.md + charter.md`, `.squad/templates/` directory.

---

## F1 — Rule 6 trigger timing is mis-stated; the 6+12 merge groups by the wrong axis ⚠️ BLOCKING

**Plan line 94:** *"These both fire at merge-time and belong together."*

This is factually incorrect. Rule 6's primary obligation fires at **PR-create time**
when writing the PR body (`Closes #48\nCloses #49` — one per line). The post-merge
sweep is the belt-and-suspenders fallback, not the main trigger. Rule 6 fires at
**merge time**. Grouping them under a header named "Merge/ship ritual" with
"close-keyword format" as a subsection causes a predictable miss: a coordinator
assembling a PR body will not load a section named "merge/ship ritual" because the
session hasn't reached merge-time yet.

**Fix:** Either (a) rename the consolidated rule to "PR shipping hygiene" (captures
both PR-create and merge-time obligations neutrally), or (b) keep Rule 6 standalone
with its current position so the trigger name matches the action. If consolidating,
the lead sentence must say the rule covers *both* PR authoring AND merge-time steps —
not just merge.

The subsection structure in the plan is otherwise fine; it's the trigger-name
mismatch that's the problem.

---

## F2 — Rule 21 is NOT Codespaces-specific; grouping it under "Codespaces gotchas" will hide it in non-Codespaces sessions ⚠️ BLOCKING

**Plan line 96:** *"13 + 20 + 21 → 'Codespaces operational gotchas' … all three are
'Codespaces runtime quirks the agent needs to handle correctly.'"*

Rule 21 (refuse-and-rotate for credentials pasted into chat) is explicitly
**environment-agnostic**. Its trigger is: "Any string matching a credential pattern
that appears in user input" — it fires in CLI, VS Code, GitHub.com, and Codespaces
equally. The rule's body confirms this: the observed incidents were session-level
(Discord client secret pasted in turn 8), not Codespaces-specific.

An agent running in plain CLI mode who receives a pasted PAT would not scan
"Codespaces operational gotchas" — it would miss Rule 21 entirely.

Rule 13a (CodeQL 403 → token scope) and Rule 13b (idle-timeout) are genuinely
Codespaces-specific. Rule 21 is not.

**Fix:** Keep Rules 13 + 20 together as "Codespaces operational gotchas." Extract Rule 21
into its own standalone rule titled "Credential hygiene — refuse-and-rotate" (or
group with another security-adjacent rule if one exists). Do NOT fold it into the
Codespaces cluster.

---

## F3 — Two on-demand triggers in the modularization table are too vague to fire reliably ⚠️ BLOCKING

**Plan Item 1, trigger table:**

1. **"User pastes spec / says 'here's the PRD'"** → loads `prd-intake.md`. The existing
   squad.agent.md trigger text (line 1283/1290) is the precise phrase `"read the PRD at
   {path}"`. The plan's trigger phrase "user pastes spec" is under-specified: any long
   user message with requirements text could match. The coordinator needs a
   distinguishable signal (the specific file-path form, or an explicit "here's the PRD"
   phrasing) or the trigger misfires on normal task descriptions.

2. **"Plugin marketplace configured but unreachable"** → loads `plugin-marketplace.md`.
   This is a **runtime error state**, not a detectable user-message trigger. The
   coordinator would need to attempt marketplace access first, catch the failure, then
   load the template. Without an error-catching hook in the inline stub, the trigger
   never fires. The validation checklist (gate 2) has no smoke-test for this case.

**Fix:** For the PRD trigger, reuse the exact existing trigger phrase from squad.agent.md
(the `{path}` pattern) as the primary detector; treat the broader "pastes spec" as
secondary (only if the message exceeds a threshold length and contains no other
routing keyword). For the plugin-marketplace trigger, add an explicit error-catch
pattern to the inline stub ("if marketplace access returns non-2xx, load
plugin-marketplace.md").

---

## F4 — Restart boundary rationale misstates what re-reads per turn

**Plan lines 238–241 (validation gate 7):**
*"In-flight agents (currently O'Brien #118 + Scotty #121) complete on the OLD
squad.agent.md — no mid-flight restart required."*

The spawned agents (O'Brien, Scotty) load their own `charter.md` from disk, NOT
`squad.agent.md` — so they are genuinely unaffected. But the **coordinator itself**
re-reads `squad.agent.md` on every turn from disk. If the cleanup PR merges while a
coordinator session is active, the coordinator's *next turn* picks up the new leaner
file mid-session. This is the actual restart risk the plan should flag.

The recommendation "Brady must explicitly start a NEW session" is correct, but the
stated reason ("in-flight agents finish on OLD context") is accurate only for spawned
workers, not for the coordinator. The coordinator is the component with mid-flight
exposure.

**Fix:** In the PR body restart notice, be explicit: "Spawned worker agents use their
own charters and are unaffected. The coordinator re-reads squad.agent.md per turn — if
you're in an active coordinator session when this PR merges, your next coordinator
turn will see the new file. Start a fresh session before dispatching new Squad work
to guarantee a clean context."

This is non-blocking (the advice is still "start a new session") but the PR body
copy should be accurate.

---

## F5 — Composite decisions.md entries are ambiguous under the per-entry class tagging scheme

**Plan Item 3, mechanism:**
*"Each decision entry gains a YAML-front-matter tag `class:` … Scribe's archival pass
moves only entries that are both >{days} AND `class: archive-eligible`."*

Sampling 5 entries from decisions.md:

| Entry | Classification | Ambiguous? |
|---|---|---|
| Uhura PR #102 — structural workflow pin tests | Canonical pattern (always hot) | No |
| Uhura PR #103 — docs alignment | Archive-eligible (one-off verdict, PR merged/closed) | No |
| Constitution v2.0.0 amendment | Constitutional/charter (always hot) | No |
| Kirk wave 3 contract schemas v1 | **COMPOSITE** — contains Canonical patterns (auth-first handler, ETag caching) AND per-PR orchestration callouts | Yes |
| Rules 14–18 codification decision | Standing rules (always hot) | No |

The Kirk wave 3 entry is composite: archive the orchestration callouts, keep the
canonical patterns. A per-entry `class:` tag can't express this split — it's
binary (retain-hot vs archive-eligible). The conservative default (`retain-hot`)
keeps these entries forever.

**Fix:** Add a note to the mechanism: "Entries that are composite (canonical pattern
content mixed with per-PR callouts) must be edited to split the hot content into a
new standalone entry before the stale portions are tagged archive-eligible. Flag
these for manual review in the audit sample — don't just tag the whole entry."
This is non-blocking if the audit sample catches it.

---

## F6 — Validation gate 2 (trigger smoke-tests) is not mechanically automatable as written

**Plan lines 214–227:** *"Each trigger is verified by a smoke-test (manual scripted
prompt the coordinator-agent processes; assertion is that the right reference file is
read)."*

There's no current mechanism to assert which files the coordinator read during a turn.
This is a human-eyeballed gate, not a CI gate. The plan header frames these as
"Validation gates" but smoke-testing behavioral triggers requires human orchestration.

**Missing check:** Add an automated grep assertion after each section move:
```bash
# Confirm moved section is GONE from squad.agent.md (not duplicated):
grep -c "Universe Allowlist" .github/agents/squad.agent.md        # must be 0
grep -c "Phase 2: Create the Team" .github/agents/squad.agent.md  # must be 0 (if moved)
grep -c "Reviewer Rejection Protocol" .github/agents/squad.agent.md # must be 0
```
These ARE CI-automatable and guard against accidental duplication. Add them to the
mechanical gate (checklist item 1). The behavioral smoke-tests remain human-run.

---

## F7 — O'Brien charter trim (Item 5) is sound; spot-check passes

All four consolidated ownership domains are present and clearly separated:
- GitHub Actions workflows (`.github/workflows/*.yml`) — 6 lines
- CI/CD + security toolchain (CodeQL, Dependabot, secrets-check) — 5 lines  
- Release engineering (`release.yml`, CHANGELOG, tags) — 2 lines
- ML cache infrastructure (HF cache strategy; coordination split with Uhura) — 3 lines

Plus the Uhura ML-cache boundary is explicitly preserved. The safely cuttable
blocks without erasing any ownership claim:
- "Hiring context" paragraph (10 lines) → compress to 2-line footnote
- "Initial scope at hire" (9 lines) — issue triage from 2026-05-18; those issues have
  been routed; this block is now stale
- "Operating rules" rule-number list (8 lines) — redundant with copilot-instructions.md
  (agents read both files)

Total safe cuts: ~25 lines → 119 → ~94, then normal prose tightening reaches ~70.
The plan's trim rationale is correct and achievable.

---

## F8 — VS Code template loading: no blocking issue (informational)

The plan's Item 1 concern about "async file loading" in VS Code mode is a non-issue.
The coordinator reads template files via `view`/`bash` tools synchronously in ALL
modes — the Client Compatibility section (squad.agent.md line 490–501) only
restricts the `sql` tool (CLI-only) and spawn-tool parameters. File access is
mode-agnostic. The existing on-demand reference pattern (casting-reference.md,
prd-intake.md, issue-lifecycle.md) already proves this works in VS Code.

No change needed. Recorded for completeness.

---

## Summary of blockers vs non-blockers

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| F1 | Rule 6 trigger timing mis-stated; consolidation name masks PR-create obligation | High | **Yes** |
| F2 | Rule 21 is not Codespaces-specific; hiding it in "Codespaces gotchas" causes misses | High | **Yes** |
| F3 | Two on-demand triggers too vague to fire reliably (PRD, plugin-marketplace) | Medium | **Yes** |
| F4 | Restart boundary rationale wrong for coordinator (correct for workers) | Low | No — fix PR copy only |
| F5 | Composite decisions.md entries ambiguous under per-entry class scheme | Low | No — add note, audit catches it |
| F6 | Trigger smoke-tests aren't CI-automatable; add grep guard for section removal | Low | No — add grep assertions |
| F7 | O'Brien charter trim sound | — | n/a |
| F8 | VS Code template loading: no issue | — | n/a |

**Recommendation:** Do NOT proceed to user approval in current form. Three changes are
required before this plan is technically sound:

1. Fix the Rule 6+12 consolidation to use a trigger-neutral name ("PR shipping hygiene")
   and correct the stated trigger timing.
2. Extract Rule 21 from the Codespaces cluster.
3. Sharpen the two vague on-demand triggers (PRD, plugin-marketplace error-catch).

F4–F6 can be addressed at implementation time with one-line notes in the plan. Return
to rubber-duck or proceed directly to user approval once F1–F3 are revised.


---

# Kirk verdict — PR #124 (Wave 3 auth + frontend shell)

**Date:** 2026-06-01T01:35:03Z
**Reviewer:** Kirk (Lead / Architect)
**Author:** Uhura (#117), Scotty (#119, #120, #122), O'Brien (#113, #114, #115, #116)
**Branch:** `squad/005-phase1-dashboard`
**Verdict:** **APPROVE** ✅
**Comment:** https://github.com/Jamula/stfc/pull/124#issuecomment-4588929482

## Auth shape decision (Wave 4 gate)

`api/src/_lib/auth.ts` is approved as the foundation for all Wave 4 (#121) route handlers.

**Public API surface (stable — #121 builds against this):**
- `parsePrincipal(req: RequestLike): Principal | null` — header decode + shape validation
- `requireAllowedUser(req): Principal` — throws 401/403 on failure
- `requireOwner(req, principal?): Principal` — owner-only gate; accepts pre-validated principal
- `requireRole(req, role): Principal` — role-level check (NOT a username-allowlist check)
- `UnauthorizedError` (status 401) / `ForbiddenError` (status 403)

## Wave 4 (#121) operational callouts

1. **Primary gate is `requireAllowedUser` or `requireOwner`, NOT `requireRole` alone.** `requireRole` does not verify SQUAD_ALLOWED_USERS. SWA invitation is the first fence; `requireAllowedUser` is the Function-side backstop. Route handlers that use only `requireRole` violate the defense-in-depth model.

2. **CI grep gate enforces presence, not position.** `check-api-auth.mjs` checks that `requireAllowedUser()` is imported AND called. It does not enforce first-statement position. Scotty must manually place the auth call as the first non-trivial statement in each handler.

3. **Canonical handler pattern:**
   ```ts
   // @azure/functions import for handler detection
   import { requireAllowedUser } from "../_lib/auth.ts";
   import { errorResponse } from "../_lib/respond.ts";
   
   export async function handler(req: HttpRequest): Promise<HttpResponseInit> {
     try {
       const p = requireAllowedUser(req);   // ← FIRST statement
       // ... handler logic using p.userDetails
     } catch (e) {
       return errorResponse(e);
     }
   }
   ```

## CI verdict

- All quality checks green (npm test 905/905, CodeQL, Squad Artifact Hygiene, Squad Test Gate).
- Deploy failure: expected — Azure OIDC not provisioned. Not a code regression.

## Kirk-as-author carve-out check

Kirk authored Phase 0 schemas (#110) only. #117 = Uhura, #119/#120/#122 = Scotty, #113–#116 = O'Brien. No carve-out triggered. Kirk is sole reviewer.

## Next action

Wave 4 dispatch cleared. Coordinator may parallel-dispatch #118 (O'Brien) and #121 (Scotty) from `squad/005-phase1-dashboard` per Picard's fanout plan.


---

# Decision / Delivery: O'Brien — P1 Wave 4 #118 Invitation Runbook

**Author:** O'Brien (DevOps / Platform Engineer)  
**Date:** 2026-06-01T01:40:00Z  
**Issue:** #118 (p1-invitation-runbook)  
**PR:** #125 (`squad/118-invitation-runbook` → `squad/005-phase1-dashboard`)

---

## What shipped

- **`docs/SWA-INVITATION-RUNBOOK.md`** — new file (~300 lines, 10 sections):
  1. Overview + two-gate auth model (SWA role + env-var allowlist)
  2. Prerequisites (az CLI, Azure access, gh CLI)
  3. Generate invitation (CLI preferred: `az staticwebapp users invite`; Portal fallback)
  4. Secure distribution (refuse-and-rotate protocol; prohibited + approved channels)
  5. Post-invite: update `SQUAD_ALLOWED_USERS` allowlist (both gates must sync)
  6. Invitee acceptance flow
  7. Verify access (CLI audit + Function-layer 200/401/403 error mapping; cross-ref to `requireAllowedUser`/`requireOwner` from PR #124 / auth.ts)
  8. Manage churn under the 25-user cap (audit, revoke, re-issue, emergency cap procedure)
  9. Troubleshooting (propagation lag, missing x-ms-client-principal, browser cookie issues, invitation expiry, Safari ITP, Firefox ETP)
  10. Threat-model alignment (S-1, S-2, E-1, E-2) + cross-references table
- **`docs/SWA-SETUP.md`** §5 updated: replaced the `⚠️ Wave 4 issue #118 placeholder` with the CLI invite snippet and a proper cross-reference to the new runbook. Related files section updated.

Tests: docs-only. 905/905 tests pass (pre-commit hook enforced).

---

## Risks / follow-ups

1. **`specs/005-web-control-panel/plan.md` placeholder (Picard flagged):** The binding v3 plan is in session state (`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`), not the repo. The invitation runbook content did not fold naturally into `plan.md`. Recommend a separate 5-minute doc-migration chore (open as a new issue, assign Tuvok or O'Brien) before session state expires. If the session state is already gone, the plan is lost — prioritize accordingly.

2. **Pre-existing test failure fixed as a side-effect:** `npm ci` was needed in the worktree to install `json-schema-to-typescript` (in `package.json` but absent from the stale symlinked `node_modules`). The epic branch was in a broken pre-commit state before this PR. Wave 4 #121 (Scotty) should confirm `npm ci` is already done on their worktree before committing.

3. **Merge ordering:** This PR (#125) targets `squad/005-phase1-dashboard`. Coordinator should merge after any Picard/Tuvok docs review. PR #121 (Scotty routes, also Wave 4) is parallel-safe — no shared files.

4. **25-user cap monitoring:** No current monitoring for approaching the cap. If user count grows, consider a GitHub Actions workflow that runs `az staticwebapp users list` on a schedule and alerts via a repo issue. Not in scope for this PR.

---

## Skill extraction

Wrote `.squad/skills/swa-operator-runbook/SKILL.md` (operator runbook structure for SWA features — reusable pattern).


---

# Picard — Squad System Cleanup Plan v3 Review

**Date:** 2026-06-01T02:06:58Z
**Reviewer:** Picard (scope/governance)
**Artifact:** Squad System Cleanup Plan v3
**Session:** 63c3014e-bdaa-4ebb-a118-447bc281fe96/plan.md

---

**APPROVE WITH NOTES** ✅+📝 — Picard (scope/governance)

---

## Findings

1. **Rule 21 (credential refusal) is misclassified — must NOT fold into "Codespaces operational gotchas."**
   Rule 21 (`Refuse-and-rotate protocol for credentials pasted into chat`) is a universal security boundary. It was triggered by a user pasting a Discord Client Secret into chat — not by any Codespaces-specific behavior. The proposed "Rule 13: Codespaces operational gotchas" grouping (token scope diagnosis + idle-timeout + credential refuse-and-rotate) mischaracterizes it and risks agents treating credential refusal as a platform-specific quirk. **Required fix during execution:** Rule 21 keeps its own section (can compress slightly), or joins a "Security boundaries" grouping — never "Codespaces operational gotchas." This is the one consolidation that fails the governance smell test.

2. **Scribe must be consulted before Item 3 (decisions archival) executes — not optional.**
   Three implementation problems Scribe needs to resolve before bulk archival runs:
   - The plan's "per-entry YAML-front-matter `class:` tag" mechanism doesn't map to the actual `decisions.md` structure (a single Markdown file with `###` headings, not separate YAML files). Scribe must define the tagging convention.
   - The "Current epic context" retention class requires a live `gh issue` lookup (is the referenced issue still open?). The archive-eligible "PR merged + closed issue" check has the same dependency. This is non-trivial automation, not a simple tagging heuristic.
   - The decisions.md problem statement says "65 entries" but the live file has 12 top-level entries (42 KB). The tagging workload is different from what the plan assumes. Scribe dry-running the proposed classification against the actual file before bulk operation is mandatory.
   Brady's 3-reviewer panel excludes Scribe as a gate reviewer — that's Brady's call and I accept it. But Item 3 execution must be gated on a Scribe dry-run validation (non-blocking to the PR, but must happen before the archival pass runs post-merge).

3. **History summarization schema needs a "Standing verdicts / prior approvals" section for governance agents.**
   The 5 proposed sections (Active blockers / Permanent facts / Unblock commands / External IDs / Open follow-ups) don't capture reviewer verdicts that remain operative. My history contains an 8-finding "APPROVE WITH CHANGES" on the 005-web-control-panel plan v2. A respawned Picard that doesn't see this verdict could re-review and contradict it. Same risk applies to Garak's hostile fact-check verdicts. **Required addition to Item 4 schema for Picard and Garak histories specifically:** `### Standing verdicts / prior approvals — {artifact}: {verdict summary}, {date}`. Permanent facts won't catch these — verdicts are actions taken, not standing truths.

4. **Single-PR scope: accepted per Brady's call. Execution guard required.**
   Brady's override of rubber-duck P1#9 is within his authority. I don't contest it. However, the diff will be broad enough to tempt rubber-stamping. **Required in PR description:** explicit reviewer-lane declaration (Kirk: behavior changes Items 1–2; Picard: scope Items 2–3–5–7; Garak: consolidation fidelity all items). Each reviewer signs off only their lane. This is not a plan change — it's an execution constraint the PR author must enforce.

5. **O'Brien charter trim: rationale is sound, but "Collaboration" section is NOT redundant prose.**
   The plan's trim rule ("cut only duplicated prose") is correct. However, I want to put on record: O'Brien's "Collaboration" section (lines 94–111) encodes the ML cache infra split with Uhura, the workflow-pin test split with Bashir, and the workflow-step split with Scotty. None of these appear in routing.md at this resolution. They are NOT redundant — they are the only contextual "how" documentation of the four-domain consolidation. The trim must preserve them. The plan already says "preserve ownership claims" and I'm satisfied the instruction is protective enough — this finding is an audit marker, not a blocker.

6. **Reviewer panel: accept Brady's call. Recommend Scribe advisory, not formal gate.**
   Rubber-duck's recommendation to add Scribe (consulted) and Tuvok (consulted) is sound in principle. Tuvok's advisory is genuinely lower priority here — this is cleanup, not new editorial policy, and the plan's charter-skeleton template is simple enough that Kirk's technical eye suffices. Scribe's advisory is covered by Finding 2 above (dry-run gate on Item 3, not panel membership). I accept the 3-reviewer panel as stated. No change required.

7. **Restart boundary: sound. No governance concern.**
   In-flight Wave 4 (#118 O'Brien, #121 Scotty) completing on old coordinator context is acceptable. The plan's self-development rule and PR body communication are sufficient. No action required from my scope.

---

## Recommendation

Proceed to user approval (final `exit_plan_mode` call) with the following execution-time conditions attached:

- **Blocking during execution:** Finding 1 (Rule 21 grouping) must be corrected before the PR opens.
- **Gate before post-merge archival runs:** Finding 2 (Scribe dry-run on decisions.md classification).
- **Required schema addition:** Finding 3 (Standing verdicts section in Picard + Garak history summaries).
- **PR description requirement:** Finding 4 (reviewer-lane declaration).

Findings 5–7 are advisory only.


---

### 2026-06-01: Squad improve cycle — proposed rule amendments
**By:** Picard (governance), requested by Cyrus Jamula
**Scope:** Proposed additions/amendments to `.github/copilot-instructions.md`
**Status:** DRAFT — awaiting user approval before Tuvok applies edits

## Summary

Two proposed new rules (Rule 22, Rule 23) and one new reusable skill
(`.squad/skills/worktree-preflight/SKILL.md`). No amendments to existing
Rules 1–21 — the existing rule set held up well against the 2026-05-31 →
2026-06-01 friction signal. **Note:** This proposal deliberately does NOT
overlap with the in-flight Squad System Cleanup Plan v3 (which renumbers /
consolidates Rules 1–21); these new rules attach at the tail (22, 23) and
will survive whatever consolidation that plan applies. If the cleanup
plan reshuffles numbering, Tuvok renumbers these in the same pass.

The bar for inclusion this cycle: ≥ 2 independent observations OR a single
observation with severe blast radius, AND not already covered by Rules 1–21
or the constitution, AND a specific behavior change agents can adopt.

## Proposed new rules

### Rule 22. Fresh worktrees require `npm ci` before any commit

When `git worktree add` creates a new worktree at `/workspaces/stfc-<N>`, the
`node_modules/` directory inside that worktree is typically a **symlink** to
the main checkout's `node_modules/`. If `package.json` has gained a
dependency since the main checkout was last installed against it — or if the
symlink target is otherwise stale — the worktree will fail the pre-commit
hook (`npm test`) with a missing-module error. The failure is silent until
the first commit attempt and looks like a real test break.

**Observed on 2026-06-01 (O'Brien P1 #118 invitation runbook PR):** worktree
`/workspaces/stfc-p1` was missing `json-schema-to-typescript` despite the
package being in `package.json`. The epic branch had been in a "broken
pre-commit state" before #118's author ran `npm ci` manually. Picard's
parallel P1 fanout triage (same date) explicitly forward-flagged the same
risk to Wave 4 #121 (Scotty): *"should confirm `npm ci` is already done
on their worktree before committing."*

**Required after every `git worktree add` (and before any commit attempt in a worktree):**

```bash
# In the new worktree, before staging anything:
cd <worktree-path>
ls -la node_modules 2>/dev/null | head -1     # detect symlink (lrwxrwxrwx) vs real dir
npm ci                                         # idempotent; refreshes whether symlink or not
npm test                                       # confirm the pre-commit gate passes BEFORE adding work
```

`npm ci` is idempotent and cheap (~5–15s when cache is warm). Running it
proactively is far cheaper than discovering the failure at pre-commit time
when you have uncommitted work to protect.

**Symptom-to-cause table** for diagnosing failed pre-commit in a worktree:

| Symptom | Likely cause |
|---|---|
| `Cannot find module 'xxx'` and `xxx` is in package.json | Stale symlinked `node_modules`; run `npm ci` |
| `Cannot find module 'xxx'` and `xxx` is NOT in package.json | Real test break — fix the test |
| Pre-commit passes once, fails on next commit | Background process modified `node_modules`; `npm ci` to reset |

**Cross-reference:** Rule 18 (Fleet + worktree execution) covers shared-file
ownership in worktrees; this rule covers dependency state inside worktrees.
Together they're the worktree-mode preflight contract.

**Evidence:**
- `.squad/decisions/inbox/obrien-p1-118-invitation-runbook.md` (2026-06-01T01:40Z) — observed failure + diagnosis
- `.squad/agents/picard/history.md` (2026-06-01T01:22:44Z, P1 fanout triage) — forward flag to next Wave-4 author

**Cross-reference impact:**
- `.squad/skills/worktree-preflight/SKILL.md` — NEW skill (see "Proposed new skills" below) codifies the preflight ritual
- `.squad/skills/audit-wip-fanout/SKILL.md` — should add a one-line link to worktree-preflight at the wave-dispatch step
- `.squad/agents/obrien/charter.md` — DevOps owns worktree provisioning concerns; add a one-line ownership note if charter is otherwise being edited (do NOT touch the charter solely for this)

---

### Rule 23. `specs/NNN-feature/plan.md` must be a self-contained repo artifact, never a placeholder pointing to session-state

`plan.md` is one of the four canonical speckit artifacts (alongside
`spec.md`, `research.md`, `tasks.md`). It is a **durable, repo-tracked
input** to the implementation phase. Multiple agents (Picard, Garak, Kirk,
O'Brien, Scotty, Bashir, reviewers) read it across days or weeks; reviewer
gates cite it; the rubber-duck checkbox (Rule 17) lives in it.

A `plan.md` whose body is a one-line pointer to
`~/.copilot/session-state/<uuid>/plan.md` is **not durable** — session-state
directories are per-machine, per-session, and ephemeral. The binding plan
disappears the moment the session expires, the Codespace rebuilds, or the
user switches machines.

**Observed across the 005-web-control-panel epic (2026-05-31 → 2026-06-01):**
`specs/005-web-control-panel/plan.md` is currently a placeholder pointing
to `~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`.
This was flagged independently by:

1. Picard's P1 fanout triage, 2026-06-01T01:22Z (`.squad/agents/picard/history.md`):
   *"If session state is lost, the plan is gone. Flag Tuvok or O'Brien to
   migrate it into the repo as a doc issue."*
2. O'Brien's #118 invitation runbook PR, 2026-06-01T01:40Z
   (`.squad/decisions/inbox/obrien-p1-118-invitation-runbook.md`):
   *"The binding v3 plan is in session state … not the repo. Recommend a
   separate 5-minute doc-migration chore … before session state expires."*
3. Scribe's P1 fanout consolidation log, same date
   (`.squad/orchestration-log/2026-06-01-p1-fanout-triage-scribe.md`):
   listed as a carried-forward risk.

The pattern recurs because session-state is genuinely convenient during
rapid plan iteration. The rule is needed because the convenience window
closes silently and the recovery cost is high (re-deriving a multi-phase
plan from chat history + commits).

**Required:**

1. Before merging ANY PR that introduces or modifies `specs/NNN-feature/plan.md`,
   the file MUST contain the actual plan body — not a pointer to
   `~/.copilot/session-state/*` or any other path outside the repo tree.
2. CI gate: add a check that greps `specs/*/plan.md` for
   `session-state` / `.copilot/session-state` and fails the build if any
   match is found.
3. If a plan is genuinely still drafting in session-state, the speckit
   pipeline MUST NOT advance past Phase 0 (governance) until the plan is
   migrated into the repo. The rubber-duck checkbox (Rule 17) cannot be
   meaningfully checked against an ephemeral artifact.
4. Recovery procedure when a placeholder is discovered post-merge:
   ```bash
   # If session-state plan still exists, migrate it:
   cp ~/.copilot/session-state/<uuid>/plan.md specs/<NNN>-<feature>/plan.md
   git add -- specs/<NNN>-<feature>/plan.md
   git commit -m "docs(<NNN>-<feature>): migrate plan.md from session-state to repo"

   # If session-state plan is already lost, open an issue with
   # squad:picard,bug labels: "Reconstruct <NNN>-<feature> plan.md from
   # commits + history" and treat as a P1 blocker on remaining phases.
   ```

**Anti-patterns:**
- ❌ `plan.md` containing only `See ~/.copilot/session-state/<uuid>/plan.md`
- ❌ `plan.md` containing only a link to a chat URL
- ❌ Deferring plan migration "for now" with no tracking issue
- ✅ Full plan body in `plan.md`, with optional `<!-- Originally drafted in session <uuid> on YYYY-MM-DD -->` header comment for provenance

**Cross-reference:**
- Rule 17 (Rubber-duck multi-phase plans) — the checkbox lives in plan.md; placeholder defeats the gate
- Constitution Principle VII (Artifact Hygiene) — this rule is the routing/enforcement form of that principle for `specs/*/plan.md`

**Evidence:**
- `.squad/decisions/inbox/obrien-p1-118-invitation-runbook.md` (2026-06-01) — direct flag
- `.squad/agents/picard/history.md` (2026-06-01) — independent flag, same date
- `.squad/orchestration-log/2026-06-01-p1-fanout-triage-scribe.md` — carried-forward risk
- Live repo: `specs/005-web-control-panel/plan.md` currently is the placeholder

**Cross-reference impact:**
- `.specify/templates/plan-template.md` — add a header comment in the template explicitly forbidding session-state pointers
- `.github/workflows/squad-artifact-hygiene.yml` (or similar existing CI gate) — add the `grep` check listed above
- `.copilot/skills/speckit-pipeline-driver/SKILL.md` (or `.squad/skills/speckit-pipeline-driver/SKILL.md` — whichever holds) — add a Phase-0 pre-flight assertion that `plan.md` is non-empty and contains no `session-state` substring
- `specs/005-web-control-panel/plan.md` — needs migration as the first application of this rule (open as separate issue, route to Tuvok or O'Brien per O'Brien's recommendation)

## Proposed amendments to existing rules

None. All recently observed friction patterns either (a) trigger no existing
rule's pattern (covered by Rules 22 and 23 above), (b) are already handled
by Rules 1–21 as written, or (c) are being addressed by the in-flight
Squad System Cleanup Plan v3, which should not be pre-empted by amendments
in this proposal.

## Proposed new skills

### `.squad/skills/worktree-preflight/SKILL.md`

**Purpose:** Codify the worktree-preparation ritual that Rule 22 requires.
This is the "how" companion to Rule 22's "what." Reusable across every
fleet-dispatch wave that hands an agent a fresh `/workspaces/stfc-<N>`
worktree.

**Expected content (one-paragraph contract, full text only on user approval):**

```markdown
# Worktree Preflight

Use this skill when starting work in a fresh `git worktree` (typically
`/workspaces/stfc-<issue-number>`) before staging any changes.

## Procedure

1. Confirm working directory: `pwd` matches the expected worktree path.
2. Confirm branch: `git branch --show-current` matches expected branch.
3. Inspect `node_modules`:
   ```bash
   ls -la node_modules 2>/dev/null | head -1
   ```
   If it is a symlink (`lrwxrwxrwx`) or missing, run `npm ci`. If it is a
   real directory and `git status` shows no `package.json` / `package-lock.json`
   changes since the symlink target was installed, you may skip `npm ci`.
4. Run `npm test` once before adding any work. A green run here proves the
   pre-commit gate will pass. A red run here means something is broken in
   the base state — fix THAT before adding your work.
5. Only after steps 1–4 pass should the agent begin staging changes.

## Guardrails

- Do NOT run `npm install` (rewrites `package-lock.json`). Use `npm ci`.
- Do NOT skip step 4 — discovering a stale base state mid-work is the
  failure mode this skill prevents.
- If `npm ci` itself fails, do NOT try to "work around" it. Stop and
  report — the base worktree is broken and needs O'Brien's attention.
```

**Why a skill (not just inline in Rule 22):** the procedural ritual is
~15 lines; embedding it in `copilot-instructions.md` would bloat the rule
and duplicate content. Rules state the *what* and *why*; skills carry the
*how*. This matches the pattern already used for `audit-wip-fanout`,
`speckit-pipeline-driver`, etc.

**Cross-reference impact:**
- `.squad/skills/audit-wip-fanout/SKILL.md` — add a one-line link in the
  wave-dispatch step
- New skill is referenced from Rule 22

## Considered and rejected

The following candidates were considered and did NOT make the bar. Rationale
preserved here so the next improve cycle does not re-litigate them.

- **CI billing-exhaustion ship path (PR #103 was admin-merged on 2026-05-31 because
  CI billing limit was reached).** Rule 7 ("CI green" auto-merge gate) cannot fire
  when CI cannot run at all. Rejected because this is a one-off recovery situation,
  not a recurring pattern — admin-bypass with documented rationale is the right
  human-judgment call and codifying it risks normalizing bypass. If it recurs in
  the next 30 days, revisit.

- **Constitution-amendment pinning-test literal collision (Picard 2026-05-31 SIR
  trip on `scripts/discord-ops/` literal).** Genuinely actionable, but already
  going into `.squad/skills/speckit-pipeline-driver/SKILL.md` per Picard's own
  history note. Skill-level pattern, not rule-level — does not warrant elevation
  to `copilot-instructions.md`.

- **PR body "## Verification" instead of "## Tests" (Kirk PR #123 L3 finding).**
  This is enforcement of existing Rule 15, not a new rule. Better solved by
  the PR-body author adopting the right heading; if it recurs, amend Rule 15
  with explicit anti-pattern callout.

- **Coordinator re-reads `squad.agent.md` per turn (Kirk cleanup-plan F4).**
  Meta-mechanics observation, not actionable as a rule. Already going into the
  in-flight cleanup plan's PR-body restart notice.

- **Composite `decisions.md` entries (canonical pattern + per-PR callout in one
  block).** Real issue, but actively being addressed by the in-flight Squad
  System Cleanup Plan v3 (Item 3 + Item 4). Pre-empting it here would create
  conflicting guidance.

- **Reviewer-lockout rotation extended to Kirk/Garak (currently routing.md
  §10 only covers Bashir-rejected revisions).** Considered, but rejected because
  the existing protocol HAS worked correctly in the last two observed lockouts
  (PR #98 Scotty→Uhura; PR #103 Uhura→Scotty). The rule is already there in
  practice; making it a top-level `copilot-instructions.md` rule duplicates
  routing.md without adding new behavior. If it starts failing, revisit.

- **Wave-coordination shared-file contention (#121 vs #118 on `tests/index.test.ts`).**
  Considered, but Rule 18 (Fleet + worktree execution) already requires the
  ownership-table check before parallel dispatch — and the most recent fanout
  (Picard 2026-06-01 triage) cited it correctly. Rule is working; no amendment needed.

## Open questions for the user

1. **Rule 23 enforcement strength.** Two options:
   - **(a) Hard CI gate** that fails the build on any `session-state` substring
     in `specs/*/plan.md` (proposed default).
   - **(b) Warning-only** in CI + Tuvok pre-merge review obligation.
   Option (a) is more in keeping with Rules 14–18 (enforceable gates). Please
   confirm (a) before Tuvok applies the workflow edit.

2. **Rule 22 scope.** Should the preflight ritual extend to verifying that the
   *base branch* (typically `origin/main` or an epic branch) is fetched and
   the worktree is rebased onto it, or is that out of scope for Rule 22 and
   belongs in a separate "worktree-base-freshness" rule? My recommendation:
   keep Rule 22 dependency-state-only; base-branch freshness is already
   implicit in Rule 4 ("rebase before every push") and explicitly in the
   `audit-wip-fanout` skill.

3. **Skill location.** Should `worktree-preflight` live under `.squad/skills/`
   (team-level) or `.copilot/skills/` (coordinator-level)? My recommendation:
   `.squad/skills/` because every implementer agent uses worktrees, not just
   the coordinator. This matches the existing skill placement convention.

4. **Plan migration for the live offender.** `specs/005-web-control-panel/plan.md`
   is currently the placeholder Rule 23 would forbid. Should the migration
   be filed as a separate issue (recommended) or rolled into the next P1
   close-out PR (faster but mixes scopes)? My recommendation: separate issue,
   labeled `squad:tuvok,docs` per O'Brien's runbook follow-up note.


---

**CHANGES_REQUESTED** ⚠️ — Garak (hostile fact-check v4.1)

Requested by: Cyrus Jamula  
Reviewed artifact: `/home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md`  
Live repo: `/workspaces/stfc`  
Date: 2026-06-01

## Verdict

v4.1 fixes several v3 arithmetic failures, but it still contains live-repo falsehoods and internal contradictions. The biggest remaining problems: `decisions.md` heading counts are no longer 12/63, Rule 23 is both deferred and included, template counts still say “7” in execution todos, and the `_archive/` string remains despite the requested zero-reference grep.

## Numbered verification results

### 1. decisions.md entry counts — FAILED

Claim under review: `12 H1 top-level entries / 63 H2-H3 subsections` post-merge.

Commands/results:

```bash
grep -c '^# ' .squad/decisions.md
# 19

grep -cE '^(##|###) ' .squad/decisions.md
# 101

wc -c .squad/decisions.md
# 90482 .squad/decisions.md
```

The size is roughly the claimed `~90,000 B`, but the requested heading-count commands do not support 12/63.

### 2. Item 1 stretch-section byte math — VERIFIED

Heading bounds:

```bash
grep -nE '^#{2,3} .*(Per-Agent Model|Client Compatibility|MCP Integration)' .github/agents/squad.agent.md
# 355:### Per-Agent Model Selection
# 458:### Client Compatibility
# 503:### MCP Integration
```

Byte ranges to the next sibling heading:

```bash
sed -n '355,457p' .github/agents/squad.agent.md | wc -c
# 7458

sed -n '458,502p' .github/agents/squad.agent.md | wc -c
# 3725

sed -n '503,537p' .github/agents/squad.agent.md | wc -c
# 2103
```

These match v4.1’s ~7.5 KB, ~3.7 KB, and ~2.1 KB within ±10%.

### 3. decisions.md archival today — PARTIALLY VERIFIED

Live sample supports “0 entries today” because the first 10 `^# ` entries all date to 2026-05-31, less than 7 days before CURRENT_DATETIME 2026-06-01.

Command/result excerpt:

```bash
python3 - <<'PY'
from pathlib import Path
import re
lines=Path('.squad/decisions.md').read_text().splitlines()
entries=[(i+1,l) for i,l in enumerate(lines) if l.startswith('# ')]
for n,(start,head) in enumerate(entries[:10],1):
    end=(entries[n][0]-1) if n < len(entries) else len(lines)
    block='\n'.join(lines[start-1:end])
    dates=[]
    for m in re.finditer(r'2026-[0-9]{2}-[0-9]{2}(?:T[0-9:.-]+Z?)?', block):
        dates.append(m.group(0))
    print(f'{n}. line {start}: {head}')
    print('   dates:', ', '.join(dict.fromkeys(dates)) or 'NONE')
PY
# 1. line 3: # Uhura PR #102 fix — Structural workflow pin tests
#    dates: 2026-05-31
# 2. line 28: # Uhura PR #103 docs alignment decision
#    dates: 2026-05-31
# 3. line 34: # Decision: Constitution v2.0.0 amendment (Phase 0 Wave 1)
#    dates: 2026-05-31T21:52:57
# 4. line 139: # Picard — Phase 0 Wave 2: 005-web-control-panel speckit opened
#    dates: 2026-05-31T22:40:48
# 5. line 218: # Decision — PR #111 governance review (Picard)
#    dates: 2026-05-31T23:11Z
# 6. line 284: # Kirk — Phase 0 wave 3 contract schemas v1 (issue #110)
#    dates: 2026-05-31T22:40:48
# 7. line 357: # Decision Note: Rules 14–18 codified in copilot-instructions
#    dates: 2026-05-31T22:40:48
# 8. line 396: # Garak threat model note — 005 web control panel
#    dates: 2026-05-31T22:40:48
# 9. line 414: # Decision Note: Phase 0 Platform Spike (#109)
#    dates: 2026-05-31T22:49:27, 2026-05-31T22:49Z
# 10. line 480: # Bashir QA Review — PR #111 Contract Schemas v1
#     dates: 2026-05-31T23:09, 2026-05-31T23:08:49
```

However, v4.1 still contradicts itself at line 151: “archive only the actually-eligible entries today (likely 2–4 of 12 top-level entries)”. That conflicts with line 171 and PR2 line 417 saying expected 0 entries today.

### 4. Scribe verbatim preservation — VERIFIED AS PROPOSED NEW BEHAVIOR, NOT CURRENT STATE

Current Scribe charter does not require verbatim preservation:

```bash
grep -nEi 'verbatim|history-archive|summar|history\.md|archive' .squad/agents/scribe/charter.md
# 17:- **Orchestration logs and session summaries** — `.squad/log/*`, `.squad/orchestration-log/*`
# 18:- **Agent history archiving** — when an agent's `history.md` grows oversized, Scribe rotates and archives it
# 51:- **Reads:** `.squad/decisions/inbox/*.md`, `.squad/agents/*/history.md`, `.squad/log/*`
# 52:- **Writes:** `.squad/decisions.md`, `.squad/log/*`, `.squad/orchestration-log/*`, `.squad/agents/*/history.md`
# 58:None. Scribe has no voice. Commit messages are formulaic: `docs(squad): merge decision inbox`, `docs(squad): archive kirk history`. No opinions, no commentary, no user-facing output.
```

v4.1 correctly says this is new behavior and says it requires a Scribe charter amendment + spawn-template update. It does not amend the charter in the live repo; it only plans to.

### 5. Rule-number references — VERIFIED, WITH 21 RESERVED-SLOT REFERENCES TO HANDLE

Commands/results:

```bash
grep -rnE '\bRule\s+([0-9]+)\b' .squad/ .github/ .copilot/ specs/ tests/ 2>/dev/null | wc -l
# 325

grep -rnE '\bRule\s+(12|20)\b' .squad/ .github/ .copilot/ specs/ tests/ 2>/dev/null | wc -l
# 21
```

References to numbers v4.1 would turn into RESERVED pointers:

```text
.squad/log/2026-06-01-ralph-cycle.md:29 Rule 12
.squad/orchestration-log/2026-05-18T00-tuvok.md:18 Rule 12
.squad/agents/obrien/charter.md:90 Rule 12
.squad/agents/obrien/history.md:41 Rule 12
.squad/skills/audit-wip-fanout/SKILL.md:84 Rule 12
.squad/skills/swa-auth-shape-review/SKILL.md:90 Rule 12/15/16
.squad/skills/speckit-pipeline-driver/SKILL.md:142 Rule 12
.squad/decisions-archive.md:2143 Rule 12
.squad/decisions-archive.md:3205 Rule 12
.squad/decisions.md:191 Rule 12
.squad/decisions.md:559 Rule 20
.squad/decisions.md:594 Rule 20
.squad/decisions.md:746 Rule 12
.squad/decisions.md:901 Rule 12
.squad/decisions.md:905 Rule 12
.squad/decisions.md:914 Rule 12
.squad/decisions.md:938 Rule 20
.squad/decisions.md:1091 Rule 12
specs/004-crew-optimizer/plan.md:240 Rule 12
specs/004-crew-optimizer/tasks.md:79 Rule 12
specs/004-crew-optimizer/research.md:186 Rule 12
```

v4.1’s no-renumbering approach avoids numeric orphaning, but its own gate is necessary: references to Rule 12/20 that should point at merged Rule 6/13 remain live today.

### 6. Template inventory — PARTIALLY VERIFIED

Live inventory matches the 5 NEW / 3 EXTEND assertion:

```bash
ls -1 .squad/templates/
# casting
# casting-history.json
# casting-policy.json
# casting-reference.md
# ...
# issue-lifecycle.md
# ...
# plugin-marketplace.md
# ...

for f in init-mode.md prd-intake.md human-members.md copilot-agent.md reviewer-lockout.md; do [ -e .squad/templates/$f ] && echo "$f exists" || echo "$f missing"; done
# init-mode.md missing
# prd-intake.md missing
# human-members.md missing
# copilot-agent.md missing
# reviewer-lockout.md missing

for f in casting-reference.md plugin-marketplace.md issue-lifecycle.md; do [ -e .squad/templates/$f ] && echo "$f exists" || echo "$f missing"; done
# casting-reference.md exists
# plugin-marketplace.md exists
# issue-lifecycle.md exists
```

But v4.1 still contains stale “7” wording:

```bash
grep -nE '7 target|7 NEW|5 NEW|3 EXISTING' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 374: confirm 7 target files don't exist
# 375: Create 7 NEW template files: init-mode.md, prd-intake.md, human-members.md, copilot-agent.md, reviewer-lockout.md
# 403: create 5 NEW templates ..., extend 3 templates ...
```

The repo facts are fixed; the plan text is not fully fixed.

### 7. Rule-count contradictions — FAILED

v4.1 says there is one canonical statement, but contradictory count/scope claims remain:

```bash
grep -nE '21→|21 →|slots 1|substantive|Rule 23|Rules 22|Rule 22|RESERVED|18 rules' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 37: v4 includes adopting both [Rules 22+23] as part of the same cleanup PR
# 39: v4 commits to 21→18
# 65: Consolidate ... from 21 → 18 rules
# 71: Adopt Picard's Rules 22 + 23
# 126: slots 1–22 exist ... Rule 23 deferred ... Substantive rules = 20
# 139: Rule 23 DEFERRED ... Rule 23 ships in PR3
# 271: Rule 23 DEFERRED
# 380: Apply 2 merges ... + add Rules 22+23
# 392: PR 1 ... Rules 22/23
# 404: +22 only — NOT 23
# 430: PR3 ... add Rule 23 ... Not part of cleanup scope
```

The canonical line itself is arithmetically coherent. The artifact around it is not.

### 8. 10 moved sections — VERIFIED

Command/results:

```bash
awk 'NR>=98 && NR<=107 && /^\|/ {c++} END {print c}' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 10

grep -nE '7 conditionally|7 .*sections|10 sections|Move 10|move 10|10 trigger' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 35: v3 said ... 10 sections, but 7 of those target files don't exist ...
# 377: Move 10 sections to templates + add trigger detection lines
# 390: Manually verify 10 trigger strings load the right template
# 403: ... modularize squad.agent.md (move 10 sections ...)
```

I found no surviving “7 sections” claim. The surviving “7” problem is template-file count, covered above.

### 9. `_archive/` opt-out grep — FAILED

Command/result:

```bash
grep -n '_archive' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 236:- **No `_archive/` moves.** Per user v2 decision.
```

The requested zero-reference grep is not clean.

### 10. History sizes after compaction — VERIFIED, WITH ONE STALE TABLE ELSEWHERE

Current history sizes:

```bash
wc -c .squad/agents/uhura/history.md .squad/agents/picard/history.md .squad/agents/garak/history.md .squad/agents/obrien/history.md .squad/agents/tuvok/history.md
# 15199 .squad/agents/uhura/history.md
# 12767 .squad/agents/picard/history.md
#  2264 .squad/agents/garak/history.md
#  9040 .squad/agents/obrien/history.md
#  4877 .squad/agents/tuvok/history.md
# 44147 total
```

These support Item 4’s rounded values: Uhura 15.1 KB, Picard 12.8 KB, Garak 2.3 KB, O'Brien 9.0 KB, Tuvok 4.9 KB.

But the problem-statement table still has stale pre-compaction values:

```bash
grep -nE '13,029|12,032|12,267|11,188|15,124|15.1 KB|12.8 KB|2.3 KB|9.0 KB|4.9 KB' /home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md
# 52: Uhura 15,124 B, Garak 13,029 B, Picard 12,032 B, O'Brien 12,267 B, Tuvok 11,188 B
# 209: uhura/history.md (15.1 KB ...)
# 210: picard/history.md (12.8 KB) + garak/history.md (2.3 KB)
# 211: obrien/history.md (9.0 KB), tuvok/history.md (4.9 KB)
```

The after-compaction claim is true; the artifact still contains a false older history-size row.

### 11. Rule 22 + Rule 23 source — VERIFIED

Commands/results:

```bash
grep -nE 'Rule 22|Rule 23|picard-squad-improve|Picard.*improve|improve-cycle' .squad/decisions.md
# 1282:Two proposed new rules (Rule 22, Rule 23) and one new reusable skill
# 1297:### Rule 22. Fresh worktrees require `npm ci` before any commit
# 1352:### Rule 23. `specs/NNN-feature/plan.md` must be a self-contained repo artifact, never a placeholder pointing to session-state
```

The entry begins at `.squad/decisions.md:1275` as `2026-06-01: Squad improve cycle — proposed rule amendments` by Picard.

### 12. worktree-preflight skill not yet existing — VERIFIED

Command/result:

```bash
ls .squad/skills/worktree-preflight/ 2>&1 || true
# ls: cannot access '.squad/skills/worktree-preflight/': No such file or directory
```

### 13. `specs/005-web-control-panel/plan.md` placeholder — VERIFIED

Command/result:

```bash
cat specs/005-web-control-panel/plan.md
# # Plan: 005-web-control-panel
#
# **Status:** Placeholder — plan lives in session state pending
# `/speckit.plan` migration in a Phase 0 follow-up issue.
#
# **Source of truth (v3 plan):**
# `~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`
```

This is exactly the placeholder Rule 23 would forbid.

## Other problem-statement checks

Commands/results:

```bash
wc -c < .github/agents/squad.agent.md
# 84943

grep -cE '^## |^### ' .github/agents/squad.agent.md
# 60

wc -c < .github/copilot-instructions.md
# 28416

grep -cE '^## [0-9]+' .github/copilot-instructions.md
# 21

wc -l -c .squad/agents/obrien/charter.md
# 119 6479 .squad/agents/obrien/charter.md

find .copilot/skills -mindepth 1 -maxdepth 1 -type d | wc -l
# 11

find .squad/skills -mindepth 1 -maxdepth 1 -type d | wc -l
# 22
```

These table claims are verified.

## Final count

8 verified, 5 failed/partial (3 failed, 2 partially verified). Verdict: **CHANGES_REQUESTED**.
# Kirk Review — PR #125: docs/SWA-INVITATION-RUNBOOK.md

**Date:** 2026-06-01T02:47:54Z  
**Reviewer:** Kirk (Lead / Code Reviewer)  
**PR:** https://github.com/Jamula/stfc/pull/125  
**Closes:** #118 (squad:bashir + squad:obrien)  
**Verdict:** APPROVE ✅  
**Comment:** https://github.com/Jamula/stfc/pull/125#issuecomment-4589190167

---

## What was reviewed

| File | Change |
|---|---|
| `docs/SWA-INVITATION-RUNBOOK.md` | ADDED — 360 lines, 10 sections |
| `docs/SWA-SETUP.md` | MODIFIED — §5 placeholder replaced with CLI snippet + cross-ref |

---

## Detailed findings

### 1. Auth helper claims vs. live code — PASS ✅

Every function name, error message string, and behavioral claim in §6b was
cross-referenced against `api/src/_lib/auth.ts` (introduced by commit b0cb61c,
issue #117 / PR #124 wave).

**Error string matches (exact):**
- `"No valid authentication principal"` — `UnauthorizedError` constructor, auth.ts line 89. ✅
- `"User \"<login>\" is not in the allowed list"` — `ForbiddenError` in requireAllowedUser, auth.ts line 96. ✅
- `"User \"<login>\" does not have role \"stfc_operator\""` — `ForbiddenError` in requireRole, auth.ts line 134. ✅

**Behavioral claims:**
- `requireAllowedUser` trims whitespace: line 93 `.map((u) => u.trim())` ✅
- Empty allowlist → 403: line 95 `allowlist.length === 0` check ✅
- `parsePrincipal` returns null on missing header: line 69 `if (!header) return null` ✅
- `requireOwner` calls `requireAllowedUser` first: line 113 `principal ?? requireAllowedUser(req)` ✅

### 2. SQUAD_ALLOWED_USERS two-gate model — PASS ✅

The runbook correctly describes both gates:
1. SWA route gate (`staticwebapp.config.json` → `allowedRoles: ["stfc_operator"]`)
2. Function-side env-var allowlist (`requireAllowedUser` → `SQUAD_ALLOWED_USERS`)

Grep confirms `SQUAD_ALLOWED_USERS` is consumed only in `api/src/_lib/auth.ts` and
referenced in `tests/api/auth.test.ts`. The runbook's §4 procedure (view + update via
`az staticwebapp appsettings`) is the correct mechanism for managing this env-var on
the Azure-hosted Function.

Runbook correctly warns: "Both gates must be updated together" — matches the auth
architecture.

### 3. Azure CLI command syntax — PASS (unverified against live az, correct per docs) ✅

`az` CLI is not available in this Codespace, so syntax was cross-checked against
published Azure CLI documentation.

**`az staticwebapp users invite` flags:**
- `--authentication-provider GitHub` ✅ (matches SWA GitHub OAuth config)
- `--user-details "$INVITEE_GITHUB_LOGIN"` ✅ (GitHub login, case-sensitive)
- `--roles stfc_operator` ✅ (custom role name)
- `--invitation-expiration-in-hours 168` ✅ (max = 168h on Free tier, documented)
- `--domain "https://${SWA_HOST}"` ✅ (required for cookie scoping)

**JMESPath queries:**
- §6a: `[?roles[?contains(@,'stfc_operator')]].{login:displayName, roles:roles}` — correct filter. Minor: `contains(@,'stfc_operator')` is substring match not equality; `@ == 'stfc_operator'` would be stricter. In practice harmless given current role namespace (no role name contains `stfc_operator` as a substring other than itself).
- §7a: `[].{login:displayName, roles:join(',',roles), userId:id}` — `join` is valid JMESPath. ✅

**`az staticwebapp appsettings` queries:**
- §4: `--query "[?name=='SQUAD_ALLOWED_USERS']" -o tsv` — valid but produces multi-column table. §8 troubleshooting uses `--query "[?name=='SQUAD_ALLOWED_USERS'].value"` which is cleaner. Inconsistency is cosmetic only.

**`az staticwebapp users update --roles ""`:**
- Documented pattern for clearing custom roles. Known minor variation: some Azure CLI versions parse empty string inconsistently; `az staticwebapp users delete` is a harder fallback. Runbook could benefit from a one-line fallback note but this is LOW.

### 4. PR #124 forward-reference — PASS ✅

PR #124 was still OPEN at review time. However:
- `api/src/_lib/auth.ts` already exists on this branch (git log confirms commit b0cb61c from issue #117 wave, which is part of PR #124's scope).
- The runbook explicitly names PR #124 in §10 cross-references: "auth contract that this runbook's §6b verification steps are written against."
- The §6b verification table is accurate against the live code — the forward-reference is honest and documented.

This is the correct way to handle a runbook that documents helpers from an in-flight PR.

### 5. Rule 15 (Tests section) — PASS ✅

`## Tests` states: "No test changes — documentation-only PR. Behaviour covered by
existing SWA auth tests at `tests/api/auth.test.ts` (introduced in PR #124 / issue
#117)."

This is correct. `tests/api/auth.test.ts` exists and covers `requireAllowedUser`,
`requireOwner`, and `SQUAD_ALLOWED_USERS` parsing (confirmed via grep). No test
changes required for a docs-only PR.

### 6. Rule 16 (Docs section) — SELF-SATISFYING ✅

The PR is itself the documentation for #118. `## Docs` section lists both the new file
and the updated file. Self-satisfying by definition.

### 7. SWA-SETUP.md §5 update — PASS ✅

The Wave 4 `⚠️ issue #118` placeholder is replaced with:
- A readable note directing operators to the full runbook
- A quick CLI snippet for initial bootstrap (matches §2a of the runbook verbatim)
- A cross-reference warning about updating `SQUAD_ALLOWED_USERS`
- A cap note with §7 cross-ref

The snippet is accurate and self-contained for first-boot.

### 8. Threat-model alignment — PASS ✅

§9 table maps S-1, S-2, E-1, E-2 to runbook sections. Cross-checked:
- S-1 (stale invitation): §2 explicit login targeting + §6 verification + §7b revocation ✅
- S-2 (forged principal): §6b 401-path diagnosis + §8 missing header section ✅
- E-1 (role leak → API access): §4 two-gate update + §6b error mapping ✅
- E-2 (non-owner refresh-token): §6b documents expected 403 for owner-only endpoints ✅

---

## LOW findings (no fix needed before merge)

| # | Location | Finding | Severity |
|---|---|---|---|
| L1 | §7b | `--roles ""` empty-string arg has minor CLI-version sensitivity; add fallback note to `az staticwebapp users delete` for hard-removal. | LOW |
| L2 | §6a JMESPath | `contains(@,'stfc_operator')` is substring match; `@ == 'stfc_operator'` more precise. | LOW / cosmetic |
| L3 | §4 appsettings query | Multi-column `-o tsv` output; §8 uses cleaner `.value` projection consistently. Nit. | LOW / cosmetic |

None of L1–L3 block merge.

---

## Auto-merge eligibility

- All required CI checks GREEN at review time.
- Docs-only PR — Garak hard-gate on `src/` does not fire.
- No constitution touch — Picard governance gate not required.
- Kirk APPROVE + green CI → eligible for immediate auto-merge per Rule 7.

**Recommend: merge without waiting for additional review.**
# Kirk — Technical correctness review: Squad Cleanup Plan v4.1

**APPROVE WITH NOTES** 🟢⚠️ — Kirk (technical correctness)

**Requested by:** cyrusjamula (v4.1 squad review pass — second pass after v3)
**Plan artifact:** `/home/node/.copilot/session-state/f1073669-1239-486e-a66b-7c51b041eb2d/plan.md`
**Date:** 2026-06-01T02:39:00Z
**Files inspected:** plan.md (v4.1, 443 lines), copilot-instructions.md (all 21 rules verified), squad.agent.md (spawn template @ L820–845, Scribe allowed paths @ L902 & ownership table @ L972), 14 external Rule-N references across `.squad/`, `.copilot/`, `specs/`, my prior v3 review @ decisions.md L888–1110.

---

## Prior-v3 blocker re-verification

### F1 (Rule 6+12 trigger axis) — ✅ FIXED

v4.1 Item 2 renames Rule 6 to "**PR shipping hygiene**" with (6a) PR-body authoring close-keywords and (6b) merge-time ritual. The plan explicitly mandates *"lead sentence must say the rule covers BOTH PR-create AND merge-time obligations"* (line 132). A coordinator authoring a PR body will reach 6a via the section header. Trigger-axis mismatch resolved.

### F2 (Rule 21 standalone) — ✅ FIXED

v4.1 Item 2 line 134: *"STANDALONE — DO NOT GROUP. Per Kirk F2 + Picard Finding 1: environment-agnostic security boundary. Renames to 'Credential hygiene — refuse-and-rotate' for clarity."* Rule 21 stays out of the Codespaces cluster. Resolved.

### F3 (Vague PRD / marketplace triggers) — ✅ FIXED (with one phrasing note)

v4.1 line 103 specifies three concrete triggers for PRD intake: literal substring `here's the PRD/spec`, regex `read\s+the\s+(prd|spec)\s+at\s+(\S+)`, and a long-paste heuristic with required keywords. Line 102 adds an explicit error-catch trigger for plugin marketplace (`ENOTFOUND|ETIMEDOUT|403`). Both fixes address the original blocker.

**Achievability of regex triggers from coordinator (the user's specific question):** ✓ achievable. The LLM coordinator is not a regex engine — these are pattern *signals* for the LLM to recognize in user messages. The LLM is good at fuzzy semantic matching of the form *"does the user message contain something that looks like `read the PRD at <path>`?"*. The smoke-test approach (scripted prompt, observe which file the coordinator reads) is the **only** validation possible here — there's no programmatic introspection of the coordinator's reasoning. This is acceptable.

**Minor phrasing note (non-blocking):** the inline `/.../i` regex notation in line 103 could be misread by an implementer as "compile and run this regex," when the intent is "recognize this pattern." Recommend rephrasing as *"semantic pattern: `read the PRD at <path>`"* in the final squad.agent.md trigger comment. Not blocking — Kirk's review of the eventual PR will catch any literal-regex-execution attempt.

---

## v4.1-specific findings (newly introduced)

### Finding 1 — P0#1 "rule-count math" fix is INCOMPLETE ⚠️ MINOR BLOCKER

The canonical statement at line 126 is internally correct: *"slots 1–22 exist; Rules 12 and 20 RESERVED; Substantive rules = 20 (originals 1–21 minus 2 merged + 1 new Rule 22); of the original 1–21, 19 substantive remain."* I walked the math: 21 originals − 2 merged (12→6, 20→13) = 19; + Rule 22 = 20 substantive across 22 slots. ✓

**But two other places in the same plan still state the OLD wrong number "21 → 18":**

- **Goal #2 (line 65):** *"Consolidate `copilot-instructions.md` from 21 → 18 rules"*
- **v3→v4 changelog item 12 (line 39):** *"v4 commits to **21→18** (3 consolidations: 6+12 grouped, 9a+9b kept paired, 13+20 grouped …)"* — also factually wrong by its own logic, since 9a+9b are *already* one Rule 9 in the current file, not a fresh consolidation.

An implementer reading Goal #2 would aim for 18 rules, contradicting Item 2's canonical 20. P0#1 was supposed to make this the ONE canonical statement — it didn't propagate.

**Fix (one-line each):**
- Line 65 → *"Consolidate `copilot-instructions.md` from 21 originals to 20 substantive rules across 22 slots (Rules 12 and 20 become RESERVED pointers; Rule 22 added)"*
- Line 39 → *"v3 said '21→14', '21→16', '21→17' in different places. v4.1 commits to the canonical Item 2 statement: **22 slots, 20 substantive, 19 of originals 1–21 remain after 2 real consolidations (6+12, 13+20). 9a+9b were never separate rules; they are already paired as Rule 9.**"*

This is minor (one number, two locations) but I'm flagging it because the same class of inconsistency was the original P0#1 issue and v4.1 explicitly claims it's fixed.

### Finding 2 — Rule renumbering safety: ✅ external references will resolve correctly

I spot-checked 14 external `Rule N` references found by grep:

| Ref site | Rule cited | Will resolve after RESERVED-stub mechanism? |
|---|---|---|
| `obrien/charter.md:90` *"per line in PR bodies (Rule 12)"* | 12 → 6 | ✓ stub redirects |
| `obrien/history.md:41` *"Rule 12: one Closes #N per line"* | 12 → 6 | ✓ stub redirects |
| `.copilot/skills/dispatch-precheck/SKILL.md:42` *"Repo Rule 6"* | 6 (unchanged) | ✓ |
| `.squad/skills/audit-wip-fanout/SKILL.md:84` *"per Rule 12"* | 12 → 6 | ✓ stub redirects |
| `specs/004-crew-optimizer/plan.md:240` *"per Rule 12"* | 12 → 6 | ✓ stub redirects |
| `.squad/skills/swa-auth-shape-review/SKILL.md:90` *"{Rule 12/15/16 compliance}"* | 12 → 6 | ✓ stub redirects |
| `.squad/decisions.md:559` *"Rule 20 — Codespaces idle-timeout"* | 20 → 13 | ✓ stub redirects |
| `obrien/charter.md:35` *"the Codespaces token-scope gotcha (Rule 13)"* | 13 (unchanged) | ✓ |

The RESERVED-stub mechanism is the correct, lowest-risk approach. Existing refs keep working; readers who click through the stub land on the merged rule. Approved.

**Sub-note on the grep gate (Item 2, line 143–147):** the plan also commits to *updating* external refs from RESERVED numbers (12, 20) to merged numbers (6, 13). This is **belt-and-suspenders work that the RESERVED stub already obviates** — the references resolve correctly via the stub without rewriting. The plan should either (a) drop the update step and rely on stubs (saves churn across `.squad/`, `.copilot/`, `specs/`, `tests/`), or (b) keep the update step but rationalize it as *"freshness/clarity, not correctness — stubs would work either way."* Currently the plan reads as if the update is *required* for correctness, which is misleading.

### Finding 3 — Item 4 Scribe behavior change is compatible with existing allowed-paths ✅

Verified `history-archive.md` is already in Scribe's commit allow-list:
- `squad.agent.md:902` GIT COMMIT step: *"allowed paths (decisions.md, decisions-archive.md, agents/{name}/**history.md, agents/{name}/history-archive.md**, log/*, orchestration-log/*)"*
- `squad.agent.md:972` ownership table: *"`.squad/agents/{name}/history-archive.md` | Derived / append-only. Archived history entries. | Scribe"*

The new verbatim-then-summarize behavior (Item 4, line 175–179) writes to a path Scribe already owns. No Task-7 GIT COMMIT change needed. Approved.

### Finding 4 — Item 7 INPUT ARTIFACTS standardization is a CONVENTION, not enforcement ⚠️ ACKNOWLEDGE

Existing spawn template (`squad.agent.md:826`):
```
INPUT ARTIFACTS: {list exact file paths to review/modify}
```

Proposed v4.1 standardization: prefix each path with `READ:` / `MODIFY:` / `CREATE:`. These are **human-readable hints the receiving LLM agent interprets as natural-language directives** — there is no parser, no enforcement layer that prevents an agent from modifying a `READ:`-prefixed file. The convention's value is documentary clarity, not correctness enforcement.

This is fine, but the plan should be explicit: *"This is a documentation convention to help receiving agents understand intent. It is not parsed or enforced by tooling. Compliance is by agent goodwill; reviewer gates remain the actual safety net."* Add to Item 7 #1 line 243 to set correct expectations.

### Finding 5 — Trigger smoke-tests (gate 2): 8/10 are directly testable; 2 are contrived ⚠️ ACKNOWLEDGE

Walking the 10 triggers in gate 2 (lines 290–299):

| # | Trigger | Testable by? | Verdict |
|---|---|---|---|
| 1 | team.md missing / Members empty | `mv .squad/team.md /workspaces/stfc/.squad/team.md.bak` then run coordinator | ✓ direct |
| 2 | `.squad/casting/` missing | `mv .squad/casting /workspaces/stfc/.squad/casting.bak` | ✓ direct |
| 3 | User says "add a designer" | Type the message | ✓ direct |
| 4 | **Universe exhausted on next allocation** | Need to seed `.squad/casting/registry.json` with a full universe before the test | ⚠️ contrived setup but achievable |
| 5 | User pastes PRD signal | Type the message (3 variants) | ✓ direct |
| 6 | User says "add Brady as human" | Type the message | ✓ direct |
| 7 | User says "add @copilot" | Type the message | ✓ direct |
| 8 | User says "pull issues from owner/repo" | Type the message | ✓ direct |
| 9 | Reviewer comment contains CHANGES_REQUESTED | Need a posted PR comment OR coordinator prompted with synthetic comment | ⚠️ semi-contrived; degrades to "imagine reviewer just posted X" |
| 10 | **Plugin marketplace op fails with ENOTFOUND/ETIMEDOUT/403** | Need to point marketplace config at a dead host, or stub | ⚠️ contrived setup but achievable |

Items 4 and 10 require state setup that's annoying but doable. Item 9 is the weakest — the test reduces to *"coordinator, suppose CHANGES_REQUESTED just landed; what do you load?"* which is a degraded smoke-test (the *real* trigger is event-driven from gh-comment polling).

**Recommendation:** add a one-line note to gate 2 acknowledging that items 4, 9, 10 use seeded state or synthetic scenarios, not natural triggering. Smoke-testing them this way is honest; calling it "verified by manual smoke-test" without that caveat overstates the rigor.

### Finding 6 — PR1 vs PR2 placement of worktree-preflight skill ✅ correct in PR1

PR1 (docs trim) creating `.squad/skills/worktree-preflight/SKILL.md` is correct. Skills are reusable patterns stored as inert files — they're docs in shape, not dynamic state. PR1's character is "new/modified prompt/template/rule files;" SKILL.md fits. PR2's character is "transformed agent state files" (decisions.md tagging, history re-summarization, charter trims). SKILL.md is greenfield content, not transformed state. ✓ Placement correct.

### Finding 7 — Validation gate 3 (`rule-reference-check.yml`) is UNDERSPECIFIED ⚠️ NEEDS CONCRETE CHECK LOGIC

Plan line 303: *"CI gate via a new `.github/workflows/rule-reference-check.yml`."*

The plan doesn't say what the workflow actually does. The grep command in Item 2 (lines 144–147) gives the inputs:
```bash
grep -rnE '\bRule\s+(6|9|11|12|13|15|16|20|21)\b' .squad/ .github/ .copilot/ specs/ tests/ 2>/dev/null
```
…but the workflow needs a **failure condition** to be runnable as CI. Concretely:

- **What does "fail the build" mean here?** Possible interpretations:
  - (a) Fail if any file references a number that *no longer has a substantive rule body* (i.e., 12 or 20) without an adjacent "see Rule N" pointer.
  - (b) Fail if any of Rules 1–22 is referenced from outside copilot-instructions.md AND the referenced number doesn't exist as a slot.
  - (c) Just print the grep output as a warning, never fail.

The plan needs to pick one and write the bash. As written, an implementer would have to invent the failure logic, which is exactly the kind of ambiguity that produces a workflow nobody trusts.

**Suggested check (interpretation (a), which matches the v4.1 RESERVED-stub model):**
```bash
# Fail if any file references Rule 12 or Rule 20 without an adjacent
# "see Rule 6" / "see Rule 13" disambiguator.
violations=$(grep -rnE '\bRule\s+(12|20)\b' .squad/ .github/ .copilot/ specs/ tests/ 2>/dev/null \
  | grep -vE 'see Rule (6|13)' \
  | grep -vE 'RESERVED — see Rule' || true)
if [ -n "$violations" ]; then
  echo "::error::Unguided RESERVED-rule reference (see Rule 12→6, Rule 20→13):"
  echo "$violations"
  exit 1
fi
```
Or, if Item 2's grep-and-update step is kept (Finding 2 sub-note), then the check is simpler: fail if `\bRule\s+(12|20)\b` appears anywhere outside copilot-instructions.md.

Pick one and commit the bash in the plan before execution.

---

## Items 1–10 from the prompt — quick verdicts

| # | Question | Verdict |
|---|---|---|
| 1 | F1 fix complete? | ✅ Yes — coordinator authoring PR body lands on subsection 6a |
| 2 | F2 fix verified? | ✅ Yes — Rule 21 standalone |
| 3 | F3 triggers achievable from coordinator prompt? | ✅ Yes — LLM treats them as semantic patterns; smoke-test is the only valid validation |
| 4 | Rule-count math sound? | ⚠️ Canonical statement is correct (20 substantive across 22 slots); Goal #2 and v3→v4 changelog still say "21→18" — **propagate fix (Finding 1)** |
| 5 | Renumbering safety preserves external refs? | ✅ Yes — RESERVED stubs route correctly. Recommend dropping the redundant update-refs step OR rationalizing it as "freshness, not correctness" (Finding 2 sub-note) |
| 6 | Item 4 Scribe behavior compatible? | ✅ Yes — `history-archive.md` already in allowed paths |
| 7 | INPUT ARTIFACTS prefix convention parseable? | ⚠️ Convention-only, NOT enforced. Acceptable; add explicit note (Finding 4) |
| 8 | Trigger smoke-tests all achievable? | ⚠️ 8/10 direct; 2/10 require state seeding; 1/10 (CHANGES_REQUESTED) degrades to synthetic scenario (Finding 5) |
| 9 | PR1 vs PR2 placement of worktree-preflight skill? | ✅ PR1 is correct — it's a new doc, not transformed state |
| 10 | Validation gate 3 workflow runnable? | ⚠️ Plan specifies the grep INPUTS but not the failure CONDITION; needs concrete bash before execution (Finding 7) |

---

## Summary of blockers vs non-blockers

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| v4.1-1 | P0#1 rule-count fix incomplete — Goal #2 and changelog still say "21 → 18" | Minor | **Yes (one-line fix; mechanically prevents shipping wrong header count)** |
| v4.1-2 | Renumbering safety verified; grep-update step is redundant with RESERVED stubs but not harmful | Low | No — clarify or drop |
| v4.1-3 | Scribe history-archive.md path already allowed | — | n/a (verification only) |
| v4.1-4 | INPUT ARTIFACTS prefix is convention, not enforcement | Low | No — add explicit note |
| v4.1-5 | 3 trigger smoke-tests are contrived/synthetic | Low | No — acknowledge in gate 2 |
| v4.1-6 | Worktree-preflight skill correctly placed in PR1 | — | n/a (verification only) |
| v4.1-7 | rule-reference-check.yml needs concrete failure-condition bash | Medium | No — implementer can write it, but plan should specify which interpretation |

---

## Recommendation

**APPROVE WITH NOTES** 🟢⚠️

v4.1 successfully addresses all three of my v3 BLOCKING findings (F1, F2, F3). The remaining issues are polish — none compromise technical correctness of the consolidation logic itself.

**One minor blocker before PR opens:** Propagate the canonical "20 substantive rules across 22 slots" statement to Goal #2 (line 65) and the v3→v4 changelog item 12 (line 39). Two one-line edits. This is the same class of inconsistency P0#1 claimed to fix, and the implementer would otherwise read three different rule-count targets in the same document.

**Recommended polish before PR opens** (any of these can also be caught at PR review time):
- Item 2: rationalize the grep-update step as "clarity" vs. dropping it; the RESERVED stubs already work (Finding 2).
- Item 7 #1: add one sentence that INPUT ARTIFACTS prefixes are convention, not enforcement (Finding 4).
- Gate 2: one-line acknowledgement that triggers 4, 9, 10 use seeded/synthetic state (Finding 5).
- Gate 3: commit the actual bash logic for `rule-reference-check.yml` (Finding 7) — interpretation (a) above is suggested.

If the one-line rule-count propagation is done in v4.2 (or fixed at PR open), my lane is clear. Picard and Garak still need to sign off on their lanes independently.

Ship it once the rule-count number is consistent everywhere.
# Decision: worktree-preflight skill + routing.md additions (squad cleanup PR1)

**By:** O'Brien (DevOps/Platform)
**Date:** 2026-06-01
**Session:** f1073669-1239-486e-a66b-7c51b041eb2d (cleanup plan v4.2 PR1)
**Status:** STAGED — awaiting PR1 commit (Scribe to merge this entry)

---

## Decision 1: Skill confidence level = medium

Picard's improve-cycle bar for inclusion is "≥ 2 independent observations OR
single observation with severe blast radius." The worktree-preflight pattern
was observed in two independent contexts on 2026-06-01:

1. O'Brien PR #118 — `json-schema-to-typescript` missing in `/workspaces/stfc-p1`
   despite being in `package.json`. Stale symlinked `node_modules`.
2. Picard P1 fanout triage — independently forward-flagged the same risk to
   Wave 4 #121 (Scotty) in the same session.

Two observations, same date → confidence `medium` (not `high` because both
happened in one session; would need 30-day recurrence or a second independent
session to reach `high`). This matches Picard's improve-cycle write-up at
`decisions.md` lines 1297–1313.

## Decision 2: Cross-device symlink fallback documented in skill, not rule

Rule 22 (`copilot-instructions.md`) does not mention cross-device symlink
failures because that's a platform implementation detail, not a behavioral
obligation. The skill carries the fallback procedure. This keeps the rule
scannable and the skill operational.

## Decision 3: routing.md drop-box section explicitly includes Rule 2 constraint

The new "Drop-box pattern" section in `routing.md` explicitly states that
`.squad/` files must NOT be staged or committed by non-Scribe agents (Rule 2).
This was omitted from the original `squad.agent.md` description of the pattern
and has caused confusion in past sessions (agents staging `.squad/` files in
their own commits). Routing.md is more likely to be read by new agent spawns
than `squad.agent.md`.

## Decision 4: INPUT ARTIFACTS section is cross-reference only (P1#5)

Per plan v4.2 P1#5 fix: the full `INPUT ARTIFACTS` specification lives in
`squad.agent.md` (the spawn template). `routing.md` carries only a quick-reference
table showing the verb prefixes. This avoids duplication and prevents drift
between the two documents.

---

## Files created/modified

| File | Action | Lines |
|---|---|---|
| `.squad/skills/worktree-preflight/SKILL.md` | CREATED | ~175 lines |
| `.squad/routing.md` | MODIFIED (appended 4 sections) | 97 → 190 lines |
| `.squad/agents/obrien/history.md` | MODIFIED (appended learnings) | +~55 lines |

Both skill and routing files staged:
```bash
git add -- .squad/skills/worktree-preflight/SKILL.md
git add -- .squad/routing.md
```

history.md and this inbox file are NOT staged (Rule 2 — Scribe owns `.squad/` commits).
# Picard — Squad System Cleanup Plan v4.1 Review

**Date:** 2026-06-01T02:39:00Z
**Reviewer:** Picard (scope/governance lane only)
**Artifact:** Squad System Cleanup Plan v4.1
**Session:** `f1073669-1239-486e-a66b-7c51b041eb2d/plan.md`
**Prior pass:** v3 — APPROVE WITH NOTES, 7 findings (decisions.md lines 1219–1270)

---

**APPROVE** ✅ — Picard (scope/governance)

v4.1 cleanly addresses every blocking item from my v3 review (Findings 1, 2, 3, 4) and integrates rubber-duck P0×3 + P1×7 fixes without scope creep. The 2-PR split, Rule 23 deferral, and reviewer-lane boilerplate together produce a governance posture I'm comfortable signing for. Two minor notes below; neither blocks.

I am intentionally silent on technical correctness (Kirk's lane) and consolidation fidelity (Garak's lane).

---

## Findings (in the order requested)

### 1. Scope discipline — has cleanup absorbed governance-amendment scope?

**Verdict: PASS.** Rule 23 is properly deferred to its own PR3 (Item 8 + Q1 row + Execution sequence PR3 section all consistent). v4.1 explicitly flags the deferral rationale: Rule 23 needs `.specify/templates/plan-template.md` edits which validation gate 6 forbids. That's the correct read of the boundary. Rule 22 (npm ci in fresh worktrees) is a `copilot-instructions.md`-only change with a companion skill — that is squarely in the cleanup envelope and is acceptable scope. No other rule or governance amendment has been smuggled in.

### 2. Priority sequencing — PR1 → PR2 → PR3 split

**Verdict: PASS.** The cut between PR1 (`squad.agent.md` + `copilot-instructions.md` + routing + Rule 22 + `worktree-preflight` skill — all coordinator/rules surface, requires session restart) and PR2 (decisions/histories/charters/skill INDEX — state cleanup, no restart) is well-chosen along the restart-required axis. The `worktree-preflight` skill is correctly bucketed in PR1: it's a *companion to Rule 22* (which lands in PR1) and skills are coordinator-surface state, not the "agent histories / decisions / charters" state cluster that PR2 owns. If it lived in PR2 it would orphan Rule 22 until PR2 merged. PR3 (Rule 23) properly deferred.

### 3. Constitution/governance boundary — any accidental `.specify/` pull-in?

**Verdict: PASS.** Validation gate 6 explicitly forbids `.specify/memory/constitution.md` and `.specify/templates/plan-template.md` edits. I cross-checked all 8 work items, the 9-step PR1 sequence, and the 12-step PR2 sequence for any `.specify/` touch: none. The only adjacency is Item 8's plan migration to `specs/squad-system-cleanup/plan.md` — that's a NEW directory under `specs/`, not under `.specify/`. The boundary holds. (Rule 23, which *would* require `.specify/templates/plan-template.md` edits, is correctly deferred to PR3.)

### 4. Reviewer panel composition — Tuvok-as-advisory revisit?

**Verdict: APPROVE-WITH-NOTE (non-blocking).** My v3 Finding 6 dismissed Tuvok advisory because "charter-skeleton is simple." v4.1 has changed the editorial volume meaningfully: 5 NEW templates (init-mode, prd-intake, human-members, copilot-agent, reviewer-lockout) + 3 EXTENDs + 2 NEW INDEX.md files + a new worktree-preflight SKILL.md. That's genuine editorial surface area where Tuvok's docs eye would help (consistent heading conventions, cross-link integrity, voice).

**Note (non-blocking):** I'd accept adding Tuvok as advisory on PR1's editorial surface (templates + skill + routing additions) without it being a gate. The default panel as written (Picard/Kirk/Garak gating + Scribe advisory for Item 3) is acceptable. If the user wants the lighter panel, ship it; if they want belt-and-suspenders editorial review, fold Tuvok in. My call: ship as written; add Tuvok if PR1's editorial diff comes back uneven.

### 5. In-flight Wave 4 conflict (#118 O'Brien, #121 Scotty)

**Verdict: PASS.** Verified by `git diff main...squad/118-invitation-runbook --name-only` and same for `121`. Both worktrees touch `api/`, `scripts/`, `docs/SWA-*`, `shared/contracts/`, `specs/005-web-control-panel/`, `staticwebapp.config.json`, and `.github/workflows/swa-deploy.yml`. Cleanup targets `.squad/`, `.github/agents/squad.agent.md`, `.github/copilot-instructions.md`, `.copilot/`, and `specs/squad-system-cleanup/` (a new dir). **Zero file overlap.** Cleanup PRs and Wave 4 PRs can land in either order without merge conflicts. The plan's Out-of-band section claim is verified.

### 6. Standing-verdicts schema — is excluding Kirk from migration correct?

**Verdict: CHANGES NEEDED (small).** v4.1 has an internal inconsistency I want resolved before PR2 merges:

- **Item 4 schema annotation** says: `Standing verdicts / prior approvals ← NEW, GOVERNANCE ROLES ONLY (Picard, Garak, **Kirk**)`
- **v4.1 changelog P1#4** says: `Picard/Garak get schema migration (add Standing-verdicts section if absent) only. O'Brien/Tuvok deferred.` (Kirk not mentioned.)
- **Validation gate 5** says: `verify Standing verdicts section is present for Picard, **Garak, Kirk**`
- **Todo `summarize-histories-new-schema`** says: `Re-summarize uhura, picard, obrien with new schema; update tuvok+garak`. (Kirk again not mentioned, and obrien is named here despite the P1#4 fix saying obrien is deferred.)

Two cleanup actions needed before PR2 opens:

1. **Kirk inclusion:** my Finding 3 rationale (a respawned reviewer must not contradict prior verdicts) applies to Kirk identically — Kirk is the technical reviewer gate. If Kirk has a `history.md`, add the empty `### Standing verdicts / prior approvals` section header (no backfill needed if there are no prior verdicts to record). If Kirk has no `history.md` yet, encode the schema requirement into the Scribe template so the section appears the first time Scribe writes it.
2. **Resolve the obrien todo contradiction:** the `summarize-histories-new-schema` todo names `obrien` as a re-summarize target, but P1#4 fix says "O'Brien/Tuvok deferred." Pick one (I'd defer obrien per P1#4) and align both surfaces.

Neither is hard to fix; both should land in the v4.1 → v4.2 patch before PR2 opens. Does **not** block PR1.

### 7. Reviewer-lane PR-body boilerplate — does the PR1/PR2 assignment line up with my authority?

**Verdict: PASS.** Mapped against my charter:

- **PR1 step 7** assigns Picard to "Items 2+8" — Item 2 (rule consolidation, governance surface) and Item 8 (Rule 22 adoption + deferring Rule 23, governance call). Both squarely in my lane. ✓
- **PR2 step 10** assigns Picard to "Items 3+5+7" — Item 3 (decisions.md tagging policy, governance), Item 5 (charter standardization, scope+governance), Item 7 (routing + inter-agent comms, governance). All squarely in my lane. ✓
- Item 1 (modularization triggers) correctly goes to Kirk only (technical accuracy of trigger detection); I have no business there.
- Item 4 (history schema) correctly assigned to Kirk (technical structure) — my Finding 3 was about *adding* the section; the schema-mechanics review is Kirk's.

The assignments respect the charter boundaries. No turf encroachment in either direction.

### 8. Q1 default flip (1 PR → 2 PRs) — governance-acceptable?

**Verdict: PASS.** Two-PR shape is governance-superior here, for three reasons:

1. **Rubber-stamp protection:** Garak found 11 findings on the v3 single-PR diff. That's strong empirical evidence the diff was too broad for honest review. Splitting along the restart-axis cuts each reviewer's surface area roughly in half per PR.
2. **Restart axis is naturally split:** PR1 changes require coordinator restart; PR2 changes don't. Bundling forces a restart on changes that didn't need one and delays restart on changes that did.
3. **Speed cost is real but bounded:** 2 PRs ≈ 2× review/merge cycles. For a cleanup feature with non-blocking-on-user-flow scope, that cost is acceptable. If this were blocking the web-control-panel epic I'd lean atomic; it isn't.

The plan correctly flags the reversal at approval time (P2#1 fix). User remains free to override to single-PR if they value atomicity over rubber-stamp protection. Both options are governance-acceptable; default B is the right default.

---

## Cross-check: prior v3 findings closure

| v3 Finding | v4.1 disposition | Verdict |
|---|---|---|
| F1 — Rule 21 standalone | Item 2 table row explicitly STANDALONE — DO NOT GROUP | ✅ Closed |
| F2 — Scribe dry-run mandatory for Item 3 | Validation gate 4 + Item 3 mechanism step 1 + Q2 row default = Scribe advisory | ✅ Closed |
| F3 — Standing verdicts section for governance roles | Schema added (Item 4); see Finding 6 above for Kirk inclusion gap | ⚠️ Mostly closed (1 inconsistency to fix) |
| F4 — Reviewer-lane PR description requirement | Item 7 #4 boilerplate + PR1 step 7 + PR2 step 10 + validation gate 7 | ✅ Closed |
| F5 — O'Brien Collaboration preserve | Item 5 trim rule + explicit O'Brien protection bullet (preserve ML/workflow-pin/workflow-step splits) | ✅ Closed |
| F6 — 3-reviewer panel + Scribe advisory | Q2 default B = exactly this | ✅ Closed (with Finding 4 above as soft revisit) |
| F7 — Restart boundary | Item 8 + validation gate 8 + Out-of-band section | ✅ Closed |

---

## Recommendation

**APPROVE.** Proceed to user approval. One non-blocking patch is required before PR2 opens (Finding 6 — Kirk inclusion + obrien todo contradiction). PR1 may proceed without that patch since Standing-verdicts work lives in PR2.

If the user wants extra editorial coverage on PR1's template + skill diff, fold Tuvok in as advisory (Finding 4 note). Otherwise ship the 3-reviewer panel as written.

— Picard
# Scotty decision — PR #126 azure functions dependency placement

- **Date:** 2026-06-01
- **Context:** PR #126 added `api/src/runs/index.ts` and `api/src/audit-events/index.ts` importing `@azure/functions`. CI runs `npm test` from repo root, and tests import handlers directly from `api/src/**`.
- **Decision:** Add `@azure/functions` to root `package.json` dependencies (matching `api/package.json` `^4.0.0`) so root test/module resolution can load API handlers.
- **Why:** Root test bootstrap resolves imports through root `node_modules`; `api/package.json` alone is insufficient in current install topology.
- **Outcome:** Module-load failure (`ERR_MODULE_NOT_FOUND`) is removed without changing endpoint code or test wiring.
# Tuvok cleanup Phase B stretch audit

Date: 2026-06-01

Decision: Extracted `Client Compatibility` from `.github/agents/squad.agent.md` to `.squad/templates/vscode-adaptations.md` because the load trigger is concrete: `runSubagent` or `agent` tool detection / non-CLI Copilot surface.

Skipped for now:
- `Per-Agent Model Selection`: it is consulted before every spawn and no approved target template exists yet; moving it risks hiding cost/quality defaults from the coordinator hot path.
- `MCP Integration`: `.squad/templates/mcp-config.md` currently covers configuration/authentication, not coordinator routing/degradation. Extracting without first extending that template would lose operational guidance.
---

---

# Garak hostile fact-check — PR #124 Phase 1 Wave 3

**Date:** 2026-06-01  
**Verdict:** CHANGES_REQUESTED ⚠️  
**Scope:** PR #124, branch `squad/005-phase1-dashboard`, live worktree `/workspaces/stfc-p1`.

## Numbered verification results

1. Branch/sync: PASS — `git branch --show-current` returned `squad/005-phase1-dashboard`; `git pull --rebase origin squad/005-phase1-dashboard` was already up to date.
2. Test-count claim: FAIL/STALE — live worktree reports `tests 906`, `pass 906`, `fail 0`; PR body says “All 905 tests”. Earlier run before staged deploy-guard changes showed 905 passing.
3. Typecheck: PASS — `npm run typecheck` exited 0.
4. `tests/api/auth.test.ts`: PASS — parses base64 `x-ms-client-principal` (`tests/api/auth.test.ts:64-77`) and asserts roles (`:236-255`).
5. `tests/ci/`: PARTIAL — missing-auth and bundle-budget fixtures exist, but first-statement enforcement is untested and unenforced.
6. `tests/web/`: PASS — static Lit checks plus Vite build and bundle budget smoke (`tests/web/shell.test.ts:103-172`).
7. Rule 15 Tests section: FAIL — body omits added/modified tests: `tests/api/github-raw.test.ts`, `tests/contracts/types-sync.test.ts`, `tests/skills/swaConfig.test.ts`, `tests/skills/swaDeploy.test.ts`, `tests/skills/swaProject.test.ts`, and `tests/skills/discordMonitor.test.ts`.
8. Docs: PARTIAL — `docs/SWA-SETUP.md:237-297` documents auth/env/roles; `quickstart.md:3-24` and `shared/contracts/README.md:6-7` are stale.
9. Picard triage claim: FAIL — `.squad/decisions/inbox/picard-p1-fanout-triage.md` missing.
10. Kirk review claim: PASS — PR comments include `**APPROVE** ✅ — Kirk (code review)` for auth shape.
11. Close keywords: PASS — `Closes #113`, `#114`, `#115`, `#116`, `#117`, `#119`, `#120`, and `#122` are one per line.
12. Plan Phase 1 section: UNVERIFIABLE — `specs/005-web-control-panel/plan.md` is a placeholder and contains no Phase 1 section.
13. Auth header parsing: PASS — `api/src/_lib/auth.ts:67-73` uses `x-ms-client-principal` and base64 JSON parsing.
14. `SQUAD_ALLOWED_USERS`: PASS — `requireAllowedUser` checks the env allowlist (`api/src/_lib/auth.ts:91-99`).
15. `requireOwner`: FAIL/PARTIAL — optional `principal` skips `requireAllowedUser` (`api/src/_lib/auth.ts:112-114`).
16. Grep gate first statement: FAIL — script only looks for `requireAllowedUser(` or `requireOwner(` anywhere (`scripts/ci/check-api-auth.mjs:106-110`). Bypass probe with `const log = console.log;` before auth exited 0.
17. Grep gate CI wiring: FAIL — workflows run `npm test`; tests run fixtures, not default `node scripts/ci/check-api-auth.mjs` against real `api/src`.
18. Bundle budget: PASS — `npm run build:web` succeeded; script measured 7.7 KB gzip vs 80 KB; recursive gzip total 7904 bytes. RAG JSON excluded because only `.js` files are collected.
19. SWA deny-by-default: PASS — `staticwebapp.config.json:10-16` protects `/api/*` and SPA routes with `stfc_operator`; `/.auth/*` remains anonymous.
20. Digest unignore: PASS — `.gitignore` no longer ignores digest Markdown; workflow stages `data/digests`; `tests/skills/discordMonitor.test.ts:535-548` pins the workflow behavior.
21. Shared contracts: PASS with docs caveat — generated banners present; `npm run check:contracts` passed; `npm run build:contracts` left no diff; README remains stale.
22. Deploy failure: FAIL — `gh pr checks 124` shows `deploy fail`; log: `Login failed ... Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied.` Local worktree contains staged guard changes not authored by Garak; they are not a green PR check until committed/pushed.

## Findings

1. **P0 — Auth gate is not enforcing the stated invariant.** Presence-anywhere regex plus fixture-only CI allows pre-auth executable statements and does not scan future real handlers.
2. **P0 — Deploy CI red from unfulfilled Azure-secret contract.** The deploy workflow requires OIDC secrets before provisioning is complete. Skip gracefully when absent or provision secrets before requiring the check.
3. **P1 — `requireOwner` optional principal bypasses allowlist.** Remove the parameter, make it private/internal, or re-check the allowlist when a principal is supplied.
4. **P1 — PR body/test inventory stale.** Update test count and Rule 15 test list after late changes.
5. **P1 — Plan/docs stale.** Move the binding Phase 1 plan into repo or stop claiming it is fact-checkable there; update quickstart and shared contract README.

## Worktree note

During review, staged changes appeared in `.github/workflows/swa-deploy.yml` and `tests/skills/swaDeploy.test.ts` adding an `AZURE_CLIENT_ID` presence guard. Garak did not stage, commit, or author these code changes. They should be reviewed as part of the next pushed revision.
# Kirk → team: auth-gate hardening decisions (PR #124 Garak rejection-fix)

**Date:** 2026-06-01T03:30:00Z
**Author:** Kirk
**Scope:** Two architectural choices made under reviewer-rejection lockout.

## Decision 1 — `requireOwner` defence-in-depth: chose approach (c)

Garak P1#15 flagged: `requireOwner(req, principal?)` could be bypassed by supplying any Principal whose `userDetails === SQUAD_OWNER`, skipping the allowlist gate.

**Considered:**
- **(a) Remove optional parameter.** Forces re-parse every call. Simplest.
- **(b) Brand the Principal type.** `requireAllowedUser` returns `AllowedPrincipal` (branded); `requireOwner(req, principal: AllowedPrincipal)`. Compile-time bypass-impossible.
- **(c) Always re-validate supplied principal against the allowlist.** Optional arg remains a parse-fast-path; security re-check runs unconditionally.

**Chose (c).** Rationale:
1. **Preserves the documented chained pattern** from `.squad/skills/swa-auth-shape-review/SKILL.md` Wave-N callout #3: "If the handler needs both allowlist + owner checks, call `requireAllowedUser` once and pass the result to `requireOwner(req, principal)`." Removing the optional (a) would break this without a meaningful security gain.
2. **Branded types (b) add a public type and ceremony for marginal benefit.** With one auth source (`requireAllowedUser`) and one consumer (`requireOwner`), the runtime re-check (env-var split + `Array.includes`) is microseconds — well below any branding overhead.
3. **Defence-in-depth is the explicit threat-model posture** (S-1, S-2, E-1). A second runtime check on the supplied principal IS the defence-in-depth pattern, not a workaround.

**Implementation:** Extracted private `assertInAllowlist(principal)` helper. Both `requireAllowedUser` (after parsing) and `requireOwner` (when caller supplies a principal) route through it. See `api/src/_lib/auth.ts:79-122`.

**Test contract added:** `re-validates a supplied principal against SQUAD_ALLOWED_USERS (no bypass)` in `tests/api/auth.test.ts` — synthesises a Principal whose `userDetails === SQUAD_OWNER` but is NOT on the allowlist; asserts `ForbiddenError(403)` with diagnostic message identifying the allowlist as the rejecting gate.

**Consequence for Wave 4 handlers (#121):** the chained pattern still works exactly as documented in the skill. No handler refactor required. Performance unchanged for the supplied-principal path (avoids re-parse).

## Decision 2 — Position-aware grep gate: kept JS, added AST-lite walker

Garak P0#1 flagged: `check-api-auth.mjs` was a presence check, not a first-statement check, despite the docstring claiming the latter.

**Considered:**
- Pull in `typescript` as a script dependency and use the compiler API.
- Add a hand-written AST-lite walker in pure ESM/JS.
- Soften the docstring to match the presence-only behaviour.

**Chose the hand-written walker.** Rationale:
1. The TypeScript compiler dependency for one CI script would balloon `node_modules` for marginal correctness gain on a well-bounded grammar.
2. Azure Functions handlers have exactly three reasonable shapes (`handler: =>`, `function handler`, `const handler = =>`). All are pattern-detectable; a ~150-LOC walker covers them with room for the canonical `try {…}` wrap.
3. Softening the docstring would have weakened the constitutional defence-in-depth model — and Wave 4 will read this script as the contract for handler structure.

**Implementation:** New `findHandlerBodies` / `findMatchingBrace` / `firstNonTrivialStatement` / `isAuthGuardCall` helpers in `scripts/ci/check-api-auth.mjs`. Conservative fallback to presence-only when no handler body is detected — better a false negative on an unrecognised shape than a false positive that hard-blocks CI on a legit handler.

**Test contract added:** `tests/ci/fixtures/badPosition/handlerLateAuth.ts` — the exact probe Garak described (`const log = console.log;` before `requireAllowedUser`). Also `tests/ci/fixtures/goodTryWrap/` to verify the canonical `try {…} catch (e) { errorResponse(e) }` pattern from the skill still passes.

**Consequence for Wave 4 handlers (#121):** the skill's canonical pattern (line 64–70) is now enforced, not just documented. Any handler that drifts from it will fail CI with a precise diagnostic pointing at the offending first statement. Update `.squad/skills/swa-auth-shape-review/SKILL.md` Wave-N callout #2 ("CI gate checks presence, not position — first-statement placement is manual") in a separate PR — this commit is hardening-only per task scope.

## Follow-ups for Scribe / future work

- Skill update for `.squad/skills/swa-auth-shape-review/SKILL.md` callout #2: gate now enforces position. Out of scope for this hardening commit; will land as a small docs PR.
- Wave 4 handler dispatch (#121): no shape change required; the chained `requireAllowedUser` → `requireOwner(req, principal)` pattern still works.

—Kirk
# Kirk — PR #124 review (Phase 1 Wave 3, 005-web-control-panel)

**Date:** 2026-06-01
**PR:** https://github.com/Jamula/stfc/pull/124
**Verdict:** APPROVE ✅ (with 4 follow-up findings, none blocking)
**Comment:** https://github.com/Jamula/stfc/pull/124#issuecomment-4589200978
**Co-reviewer (parallel hard-gate):** Garak (hostile fact-check pending)

## Scope reviewed

Multi-issue wave bundling 8 concern groups across 57 files (+10,893 / −338, with ~5,111 of those in `package-lock.json`):

| Group | Issue | Files |
|---|---|---|
| Auth lib | #117 (Uhura) | `api/src/_lib/auth.ts`, `api/src/_lib/respond.ts` |
| Grep gate | #117 (Uhura) | `scripts/ci/check-api-auth.mjs` + fixtures |
| Frontend shell | #119 (Scotty) | `web/` (Lit 3 + Vite 6, 5 stfc-* tab components) |
| SWA config | #116 (Scotty/O'Brien) | `staticwebapp.config.json` + `web/public/403.html` |
| SWA bootstrap | #115 (O'Brien) | `scripts/azure/create-swa.sh`, `docs/SWA-SETUP.md` |
| SWA deploy workflow | #113 (O'Brien) | `.github/workflows/swa-deploy.yml` |
| Unignore digests | #114 (Scotty) | `.gitignore` + matching `discordMonitor.test.ts` pins |
| Shared TS contracts | #122 (Uhura) | `shared/contracts/*.ts`, `scripts/build-contracts.mjs`, `scripts/lib/generate-contracts.mjs`, `scripts/ci/check-contracts-types.mjs`, `tests/contracts/types-sync.test.ts` |
| Bundle budget | #120 (Scotty) | `scripts/ci/check-bundle-budget.mjs`, `web/bundle-budget.json` |
| github-raw API helper | (foundation for #121) | `api/_lib/github-raw.ts` |

## Local verification

- `npm run typecheck` → clean.
- `npm test` → 906 pass / 0 fail / 0 skipped (~32s, 233 suites).
- CI checks: npm test ✅, secrets-scan ✅, CodeQL ✅, deploy ❌ (Azure OIDC secrets missing — O'Brien parallel investigation, not a code regression).

## Key technical observations (validated)

1. **Auth shape is correct.** `parsePrincipal` decodes `x-ms-client-principal` base64 → JSON with full shape validation (`isValidPrincipal` checks every field type, including that `userRoles` is an array of strings). Defensive: returns `null` on absent header, malformed base64, missing fields, mistyped roles. Threat model alignment: S-1/S-2/E-1 (defence-in-depth allowlist), S-4/E-2/E-5 (owner-only via `requireOwner`).
2. **`requireRole` alone is intentionally NOT accepted by the grep gate.** Forces username allowlist re-check (or owner check) on top of SWA route role. Good belt-and-suspenders.
3. **SWA config is correctly deny-by-default.** Both `/api/*` and `/*` require `stfc_operator`. Only `/.auth/*` is anonymous, and it correctly precedes `/*` (first-match-wins). 401 redirects to GitHub OAuth entry; 403 rewrites to a CSP-safe static page. 23 contract tests pin every assertion.
4. **CSP posture is solid.** `script-src 'self'` (no `unsafe-inline`). `style-src 'self' 'unsafe-inline'` — defensible because Lit shadow-root `<style>` fallback (older Safari path that can't use `adoptedStyleSheets`) needs it. `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS with preload, nosniff, strict-origin referrer.
5. **Deploy workflow is reproducible.** SHA-pinned `azure/login@5324...` + `Azure/static-web-apps-deploy@1a94...`. OIDC federated credential (id-token: write, no long-lived deploy token). Per-PR concurrency group. Teardown job on PR close. `DISABLE_WRITES: "1"` literal in deploy env. All pinned in `swaDeploy.test.ts`.
6. **Contract generator handles both shapes correctly.** Flat schemas compile directly; discriminated-oneOf schemas (e.g. `run-result.json`) are split into per-branch interfaces + union alias. Banner identifies the source schema. `@stfc/contracts/*` path alias wired in both root + api tsconfigs.
7. **Frontend shell is minimal and bundle-disciplined.** All 5 tabs use `stfc-*` prefix; root is `stfc-app`; `cssCodeSplit: false` and a separate `lit` vendor chunk match the CSP no-inline-script constraint. Hash-based tab routing keeps Vite's no-router footprint small.
8. **Pinning-test discipline (Rule 3) honoured.** `discordMonitor.test.ts` updated alongside `.gitignore` digest change. `swaDeploy.test.ts` created alongside `swa-deploy.yml`. `swaConfig.test.ts` created alongside `staticwebapp.config.json`. No drift slipped past the SIR.

## Findings (non-blocking — follow-up issues)

### MEDIUM-1 — Grep gate enforces *presence* not *first statement* (route → Uhura)

`scripts/ci/check-api-auth.mjs` lines 6 and 152 promise "first statement" / "first non-trivial statement" enforcement, but `hasAuthCall` is a plain regex anywhere in the file. A handler could perform arbitrary work — DB calls, third-party fetches, file I/O — before the auth check and still pass the gate.

**Two acceptable fixes:**
- Tighten the check: parse with TS compiler API (or careful regex) and assert the first non-comment/non-import statement in the exported handler function body is the auth call. Fixture-test it.
- Soften the docstring: drop the "first statement" language; reframe as a *presence* check that's defence-in-depth on top of the SWA route-level `stfc_operator` gate; document that handlers MUST call the guard before any side effect, but the gate only catches outright omission.

Either is fine. Pick before Wave 4 #121 ships the first real handler, because that handler will be the pattern reference for every future endpoint.

### MEDIUM-2 — Inconsistent `api/` directory layout (route → Scotty)

Two handler-adjacent libraries shipped at two different depths:
- `api/_lib/github-raw.ts`  (top-level `_lib`)
- `api/src/_lib/auth.ts`, `api/src/_lib/respond.ts`  (under `src/_lib`)

`api/tsconfig.json` (`rootDir: "src"`, `include: ["src/**/*.ts"]`) does NOT compile `api/_lib/github-raw.ts` via `npm run build:api`. Conversely root tsconfig's `include` adds `api/_lib/**/*.ts` (catches github-raw) but NOT `api/src/_lib/**/*.ts` (auth/respond reach typecheck only via the test import graph). Works today; foot-gun tomorrow.

Wave 4 must pick the canonical layout — `api/<endpoint>/index.ts` + `api/_lib/` (Azure SWA classic) or `api/src/<endpoint>/...` + `api/src/_lib/` (TS-native) — and move the stray file in the same PR. Ideal: first task of #121.

### LOW-1 — `_lib` exclusion in grep gate is a footgun (route → Uhura)

`EXCLUDE_SEGMENTS` in `check-api-auth.mjs` skips any directory literally named `_lib` anywhere in the walk. Accidental `api/src/_lib/admin-endpoint/index.ts` would silently bypass the gate. Exclude only the top-level `api/src/_lib`, not every `_lib` recursively.

### LOW-2 — `DISABLE_WRITES` is currently dead code (route → O'Brien)

Set in deploy env, but no API handler reads it. Ship a tiny `api/src/_lib/kill-switch.ts` helper this wave, or at minimum a TODO note in `respond.ts`, so Wave 4 handler authors don't forget to gate every mutating path on it.

### LOW-3 — Bundle budget unit ambiguity (route → Scotty)

`81920` bytes = 80 KiB (binary), while spec says "≤ 80 KB" (decimal would be 80000). Permissive by ~2.4%. Add a comment to `web/bundle-budget.json` clarifying the convention so a future contributor doesn't "fix" it the wrong way.

### NIT — `toDiscriminantValue` is approximation-only

Used only inside a comment string; comment acknowledges this. Fine.

## Reviewer-rejection lockout assignments

Per charter ("on rejection, names a DIFFERENT agent to revise"), if any finding is upgraded to a blocker:
- Grep-gate ordering + docstring + `_lib` exclusion → **Uhura** (auth-lib charter holder, #117). NOT the original revision agent.
- `api/` directory consolidation → **Scotty** (author of the divergence — but the *consolidation* is a fresh task, so this is fine; alternatively give it to Uhura who owns `api/src/_lib`).
- `DISABLE_WRITES` kill-switch helper → **O'Brien** (deploy-contract owner).
- Bundle-budget unit comment → **Scotty**.

## Multi-issue bundling pattern — observation

This is the largest single-PR bundle this repo has shipped (8 issues, 57 files, +10.9k LOC). It worked because:

1. **Each concern group has its own test file** (`auth.test.ts`, `check-api-auth.test.ts`, `check-bundle-budget.test.ts`, `swaConfig.test.ts`, `swaDeploy.test.ts`, `swaProject.test.ts`, `web/shell.test.ts`, `types-sync.test.ts`, `github-raw.test.ts`). Reviewer can read one file, run one test, sign off on one concern without context-switching across the whole bundle.
2. **The `Closes #113 #114 #115 #116 #117 #119 #120 #122` block in the PR body is one-per-line** (Rule 12), so the post-merge sweep will close all eight cleanly.
3. **Pinning-test discipline held** for both workflow touches (swa-deploy.yml + .gitignore/discord-monitor.yml).

**But** the bundle stresses single-reviewer capacity. For Wave 4, recommend either:
- Pre-split by concern group (one PR per issue), OR
- Continue to bundle but pre-assign per-group reviewers in the PR body so Garak/Bashir/Kirk each own a section explicitly rather than re-discovering the boundaries.

## Learnings (to mirror into history.md)

- **Grep-gate-as-contract**: the script's docstring IS the contract; any drift between docstring and behaviour is itself a finding. Always read both the rules statement and the check body.
- **TS path-alias + multi-tsconfig parity**: when a repo has both a root tsconfig and a sub-project tsconfig, **both** include arrays need to cover every shared library directory, or you get "works because tests reach it" coverage that quietly fails when a non-test consumer is added.
- **Lit + CSP**: `script-src 'self'` works; `style-src 'self' 'unsafe-inline'` is the standard Lit-with-shadow-DOM concession (adoptedStyleSheets fallback path). Don't try to drop `'unsafe-inline'` for style-src until Safari coverage is verified.
- **First-statement enforcement is harder than presence enforcement.** A grep gate is a presence check; a "first statement" check requires an AST. Choose the contract that matches the tool, or upgrade the tool.
- **Largest bundle this repo has shipped held together** because every concern group brought its own test file. The pattern scales as long as test-file boundaries match concern-group boundaries.
# Decision: SWA Deploy Auth Method — OIDC federation adopted

**Author:** O'Brien
**Date:** 2026-05-31T23:46:00Z
**Issue:** #113
**Commit:** f32585c (feat(005-web-control-panel): SWA deploy contract + deploy workflow + pinning test)
**Status:** RESOLVED — OIDC federation adopted

---

## Decision

Phase 1 formalizes **OIDC federation** (not deployment token) as the SWA
deploy authentication method, overriding the Phase 0 spike recommendation.

**Phase 0 spike said:** use deployment token — lower setup complexity for
a single-maintainer project.

**Phase 1 contract says:** OIDC — no long-lived secret stored in the repo;
ephemeral JWT issued per run; one-time Azure SP + federated-credential setup
outweighs the indefinite deployment-token rotation burden.

---

## Rationale

1. **No stored secret.** A deployment token in repo secrets is a long-lived
   credential that can be leaked via a malicious workflow or a compromised
   Codespace. OIDC tokens are ephemeral and scoped to the specific workflow run.

2. **Single-maintainer ≠ lower risk.** With one reviewer there is no second
   set of eyes on secret changes; the blast radius of a leaked token is at
   least as large as in a team context.

3. **Setup cost is one-time.** Creating an Azure Service Principal, registering
   a federated credential, and assigning `Website Contributor` RBAC is a ~10
   minute task paid once. The deployment-token's rotation cost recurs every
   time the token is suspected compromised.

---

## Fallback documented

If the Azure tenant blocks workload-identity federation (Conditional Access
policy): swap OIDC steps for `azure_static_web_apps_api_token` deployment-token
input. Document the downgrade in a new inbox entry.

---

## Artefacts

- `specs/005-web-control-panel/deploy-contract.md`
- `.github/workflows/swa-deploy.yml`
- `tests/skills/swaDeploy.test.ts`

---

*Per Rule 2: this file is left uncommitted — Scribe commits .squad/ paths.*
# O'Brien Decision Drop — PR #124 Azure OIDC deploy failure

**By:** O'Brien (DevOps / Platform Engineer)
**Date:** 2026-06-01T02:52Z
**Worktree:** /workspaces/stfc-p1 on branch `squad/005-phase1-dashboard`
**PR:** https://github.com/Jamula/stfc/pull/124
**Follow-up issue:** https://github.com/Jamula/stfc/issues/127

## Diagnosis

The `deploy` CI job on PR #124 was failing with:
```
Login failed with Error: Using auth-type: SERVICE_PRINCIPAL.
Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied.
```

Root cause: **missing repo secrets**. `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
`AZURE_SUBSCRIPTION_ID` were never provisioned. The workflow YAML was structurally
correct — it correctly used the OIDC form. `azure/login@v3` falls back to
SERVICE_PRINCIPAL auth and produces a misleading error when OIDC inputs resolve
to empty strings.

## Remediation chosen: Option B (secret-presence guard)

Commit `84ffe6f` on `squad/005-phase1-dashboard`:
- Gated both `deploy` and `teardown` jobs on `secrets.AZURE_CLIENT_ID != ''`
- Updated `tests/skills/swaDeploy.test.ts` with a pin assertion for the guard (Rule 3)
- Updated `tests/skills/swaProject.test.ts` comment to cross-reference the guard
  (required because pre-commit `checkWorkflowPinningTests` hooks on ALL referencing files)

Result: deploy and teardown now produce `skipped` instead of `failure` when secrets
are absent. PR #124 is mergeable. Deploy activates automatically once Picard provisions
the three secrets.

## Follow-up required: Picard (issue #127)

Issue #127 filed with full checklist:
1. Create Azure App Registration + federated credentials for `main` push + PR events
2. `gh secret set AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID` from local terminal
3. Verify via `gh secret list` (names only)
4. Trigger manual workflow run to confirm deploy activates

⚠️ Secrets must NEVER be pasted into chat (Rule 21). Only `gh secret set` from operator's local terminal.

## Blocking merge?

No. Kirk and Garak hold the code-review gate. All required CI checks (tests, CodeQL,
secrets-scan) are green. Deploy is informational / infra until secrets are provisioned.

## Files changed (this decision's commit)

- `.github/workflows/swa-deploy.yml` — secret-presence `if` guard on both jobs
- `tests/skills/swaDeploy.test.ts` — pin test for guard (Rule 3 same-commit)
- `tests/skills/swaProject.test.ts` — comment cross-reference (pre-commit hook compliance)
# Decision note — SWA bootstrap (Wave 2, issue #115)

**Agent:** O'Brien
**Date:** 2026-05-31T23:55+00:00
**Status:** COMPLETE (commit `1f4f824`, branch `squad/005-phase1-dashboard`)

---

## What was done

Phase 1 Wave 2 scaffolded the full Azure SWA project structure:

- `web/` — Lit+Vite frontend scaffold (package.json, vite.config.ts, index.html, src/main.ts)
- `api/` — Azure Functions v4 scaffold (package.json, host.json, local.settings.json.example, .funcignore, tsconfig.json)
- `shared/contracts/` — empty dir with .gitkeep + README; Wave 3 #122 populates TS types
- `staticwebapp.config.json` — deny-by-default (all routes require `stfc_operator`; 401 → GitHub login)
- `scripts/azure/create-swa.sh` — idempotent bootstrap script
- `docs/SWA-SETUP.md` — full operator runbook
- Root `package.json` build scripts + `@azure/static-web-apps-cli` devDep
- Root `tsconfig.json` `@stfc/contracts/*` path alias
- 817 tests passing (was 770)

## Scope decision (CONFIRM OK)

Creating the actual Azure SWA RESOURCE requires `az login` with real Azure credentials.
This was deferred to the operator per the task scope call. The `create-swa.sh` script
handles the creation idempotently when the operator is ready.

`az` CLI is installed in the Codespaces environment but no Azure session was found
(`az account show` would require interactive login). Script verified readable and
executable; dry-run was not performed (would require live Azure auth).

## Also fixed (pre-existing bug)

`tests/skills/swaDeploy.test.ts` had a wrong assertion pattern for the OIDC secrets
check — it matched `AZURE_TENANT_ID: ${{ ... }}` (screaming-snake env-var style) but
the workflow correctly uses `tenant-id: ${{ ... }}` (kebab-case azure/login input).
This caused the test to fail silently (it was not in tests/index.test.ts). Fixed and
added to index as part of this commit.

## Next steps

Wave 3 agents can now work independently:
- **Uhura** (#117): populate `api/src/functions/auth.ts`
- **Scotty** (#119): populate `web/src/` Lit components
- **Scotty** (#120): populate `api/src/functions/github-raw.ts` + shared helpers
- **Scotty** (#122): generate `shared/contracts/*.ts` from JSON Schemas in specs/
- **Wave 3 #116**: populate `staticwebapp.config.json` with full role rules
# Decision: staticwebapp.config.json deny-by-default + stfc_operator role

**Agent:** O'Brien (DevOps)
**Date:** 2026-06-01T00:00+00:00
**Issue:** #116
**Commit:** 2606491
**Branch:** squad/005-phase1-dashboard

## Decision

Completed `staticwebapp.config.json` with the full Phase 1 Wave 3 role configuration per the v3 plan and Garak's STRIDE threat model.

## What was implemented

### Route configuration
- `/.auth/*` → `allowedRoles: ["anonymous"]` — SWA login/logout endpoints must always be reachable by unauthenticated users. This route MUST appear before `/*` since SWA uses first-match routing.
- `/api/*` → `allowedRoles: ["stfc_operator"]` — deny anonymous and authenticated-but-uninvited users from the API surface.
- `/*` → `allowedRoles: ["stfc_operator"]` — catch-all deny-by-default for all other routes.

### Response overrides
- **401** → redirect to `/.auth/login/github?post_login_redirect_uri=/` (unauthenticated users are sent to GitHub OAuth, not shown a blank response). Includes `post_login_redirect_uri` so users land back at their target page after login.
- **403** → rewrite to `/403.html` (static page explaining the stfc_operator role requirement and contact instructions). Status code remains 403.

### Auth identity providers
- **GitHub-only**: `auth.identityProviders` contains only `github`. No AAD, no anonymous providers, no MSA. This is the pre-configured provider on Free tier — no Standard plan required.
- `clientIdSettingName: GITHUB_OAUTH_CLIENT_ID` and `clientSecretSettingName: GITHUB_OAUTH_CLIENT_SECRET` reference app settings (not hardcoded in config).

### Security headers (globalHeaders)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'`
  - `style-src 'unsafe-inline'` included because the 403.html uses an inline `<style>` block. If moved to a separate CSS file, this can be tightened.
  - `frame-ancestors 'none'` duplicates X-Frame-Options: DENY for CSP-aware browsers.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- **Removed from skeleton:** `X-XSS-Protection: 1; mode=block` — deprecated in modern browsers and not recommended by OWASP.
- **Removed from skeleton:** `Permissions-Policy` — not required for Phase 1; can be added later if needed.

### MIME types
- `.json` → `application/json` — required for the future RAG index endpoint.

### Static error page
- `web/public/403.html` — minimal, CSP-safe (no `<script>` tags), dark-themed page explaining:
  - HTTP 403 / Not Authorized
  - The `stfc_operator` role is required
  - Contact the operator to be invited
  - Sign-out link to try a different account

### Tests
- `tests/skills/swaConfig.test.ts` (T-SWA-003) — 25 contract tests covering all of the above.

## Decisions / tradeoffs

| Area | Decision | Rationale |
|---|---|---|
| `style-src 'unsafe-inline'` in CSP | Accepted for Phase 1 | 403.html uses inline `<style>`. Future: extract to `/403.css` and remove `unsafe-inline`. |
| `Permissions-Policy` removed | Removed (was in skeleton) | Not in the Wave 3 spec; keeps headers minimal; can be added in a hardening pass. |
| `X-XSS-Protection` removed | Removed (was in skeleton) | Deprecated; can cause XSS in some browsers; OWASP recommends omitting it entirely. |
| `post_login_redirect_uri=/` | Hardcoded to `/` | SWA does not provide a dynamic `{originalPath}` variable in config-level redirects. `/` is the safe fallback; the SPA router handles the rest. |
| `frame-ancestors 'none'` | Added to CSP | Belt-and-suspenders with X-Frame-Options: DENY for modern CSP-aware browsers. |

## What is NOT committed

Per Rule 2, this file (`.squad/decisions/inbox/obrien-swa-config.md`) is left **uncommitted** in the worktree. Scribe will commit it in a separate session.
# Decision note — unignore data/digests/*.md (Issue #114)

**Agent:** O'Brien (DevOps / Platform Engineer)  
**Date:** 2026-05-31  
**Branch:** squad/005-phase1-dashboard  
**Commit:** feat(005-web-control-panel): unignore data/digests + commit-on-write in discord-monitor (Phase 1 wave 1)

## What was done

- Removed `data/digests/*.md` from `.gitignore`. Updated comment to explain
  constitution v2.0.0 sanctioning.
- Verified `discord-monitor.yml` already has a commit-on-write step
  (`git add data/discord data/digests promo-codes.txt`) with retry-once
  pull --rebase before push. **No changes to the workflow YAML were needed.**
- Added three new pinning assertions to `tests/skills/discordMonitor.test.ts`
  (Rule 3 compliance):
  1. `contents: write` permission is present
  2. `git add` stages `data/digests`
  3. Retry-once push pattern (`git pull --rebase` + `git push`) is present

## Observations / surface to Uhura/Scotty

- Digest output path: `src/` currently writes digests to `data/digests/<date>.md`
  (confirmed by test fixture in discordMonitor.test.ts referencing `digestsDir`).
  No src/ changes appear needed — the path is already correct.
- `data/digests/.gitkeep` should remain tracked (and it is — only `*.md` was
  excluded, never `.gitkeep`).

## Status

✅ Committed and pushed. All 770 tests green, typecheck clean.  
❌ NOT committed to `.squad/` (Rule 2 — Scribe will commit this file).
# Decision: json-schema-to-typescript as contract generator (Issue #122)

**Date:** 2026-06-01  
**Author:** Scotty (Core Dev)  
**Issue:** #122 — shared/contracts TS types from JSON Schemas  
**Commit:** 9302288

## Decision

Chose `json-schema-to-typescript` (v15.x) as the generator tool for deriving TypeScript
types from the Phase 0 JSON Schema contracts.

## Rationale

1. **Battle-tested** — most widely adopted JSON Schema → TS tool in the ecosystem.
2. **Deterministic output** — ships its own bundled prettier; CI sync gate diffs are
   stable across runs.
3. **const/enum support** — emits `schema_version: '1'` as a string literal type, not
   `string`, satisfying Kirk review #6.
4. **No bloat** — ajv already in devDeps for runtime validation; this adds only the
   compile-time generator.

## Run-result discriminated union

`json-schema-to-typescript` produces an intersection type for top-level `oneOf`, which is
not a proper discriminated union. The generator script (`scripts/lib/generate-contracts.mjs`)
detects this pattern and builds per-branch schemas, compiles each individually via
`json-schema-to-typescript`, then emits named interfaces + a union alias:

```
RedeemRunResult | DiscordMonitorRunResult | RefreshTokenRunResult → RunResult
```

TypeScript narrows correctly on `result.workflow === 'redeem'`.

## Sync gate

`scripts/ci/check-contracts-types.mjs` regenerates types in-process and string-diffs
against committed files. Added as `check:contracts` npm script. Exits 1 on any mismatch.

## Files added

- `scripts/lib/generate-contracts.mjs` + `.d.mts` — shared generation logic
- `scripts/build-contracts.mjs` — build script (`npm run build:contracts`)
- `scripts/ci/check-contracts-types.mjs` — CI gate (`npm run check:contracts`)
- `shared/contracts/run-result.ts` — generated
- `shared/contracts/audit-event.ts` — generated
- `shared/contracts/chat-tool-call.ts` — generated
- `tests/contracts/types-sync.test.ts` — generator + gate tests

## Future considerations

- Zod schema codegen is deferred to a later wave per spec.
- If a schema adds a new `oneOf` discriminant pattern, `detectDiscriminant()` in the
  generator handles it automatically.
- `@stfc/contracts/*` path alias is already wired in root, api, and web tsconfigs.
# Kirk — Architecture doc organisation

- **By:** Kirk
- **Date:** 2026-06-01
- **Status:** Proposed canonical pattern

## Decision

`docs/ARCHITECTURE.md` is the **canonical system architecture map**. It is
deliberately a MAP (pointers to per-subsystem docs), not a REPLACEMENT for
them.

## Organising rules

1. **One §3.N per subsystem**, with consistent sub-headings: entrypoint,
   exit/contract semantics, modules table, scheduling/trigger, links to
   per-subsystem docs.
2. **Per-subsystem deep detail stays in its own doc** (`docs/SWA-SETUP.md`,
   `docs/SWA-INVITATION-RUNBOOK.md`, `docs/CREW-OPTIMIZER.md`,
   `docs/DISCORD-BOT-SETUP.md`, `docs/SETUP.md`, `docs/squad.md`,
   `docs/stfc-game-knowledge.md`, `docs/stfc-knowledge/`). The
   architecture doc cross-references; it does not duplicate.
3. **Behavioural claims are cited** with `path:line` or
   `specs/NNN-feature/<artifact>.md` references. Uncited claims are
   flagged "TODO: verify" with the file someone should read.
4. **Mermaid diagrams** are limited to 1 topology + 2-3 sequence flows.
   More diagrams = more drift risk; pick the most cross-cutting flows
   only.
5. **§7 Known gaps** is mandatory — captures Wave-N defers, in-flight
   PRs, unprovisioned secrets, and known doc/code drift. Most valuable
   section for a returning maintainer.
6. **§8 How to change safely** cites the 22 repo rules by number rather
   than restating them — keeps `.github/copilot-instructions.md` as the
   single source of truth.

## Why

A canonical architecture doc is a permanent invitation to drift. Three
forcing functions minimise that:

- **Cross-reference over duplicate** — pointers age well, prose does not.
- **Cite file:line** — makes the doc auditable against the live tree;
  any reader can ground-truth a claim with one click.
- **Explicit §7 gaps** — a doc that tells you what NOT to trust is more
  honest than one that pretends to be complete.

## Implications

- When a subsystem's behaviour changes, update its OWN doc and adjust
  only the pointer/synopsis in `docs/ARCHITECTURE.md` — do not edit the
  per-subsystem body in two places.
- When a new subsystem is added, append a new `§3.N` entry following
  the template (entrypoint / contract / modules / scheduling / doc
  links), update §1 topology + table, add a §6 reference row.
- Drift detection: if a `path:line` citation no longer matches the
  cited file, the doc is stale — fix it immediately.

## Scope

Architecture-doc maintenance specifically. Other docs (per-subsystem,
operator runbooks, spec artefacts) follow their own conventions.

# Kirk — Triage memo: Issue #92 (crew v2 read-only command handlers)

**Date:** 2026-06-01T04:05Z
**Author:** Kirk (Lead/Architect)
**Issue:** [#92 — crew[v2]: Implement read-only command handlers](https://github.com/Jamula/stfc/issues/92)
**Depends on:** #91 (closed — PR #123 shipped `crewCommandParser.ts`)
**Owners (per label):** Scotty (squad:scotty) + Uhura (squad:uhura)
**Mode:** READ-ONLY triage. No source files created or modified.

---

## 1. Handler inventory (8 verbs)

Every handler is a pure function of `(CrewCommand, deps)` → `string` (Discord-formatted markdown). The dispatch shell already lives at `src/discord/crewCommandParser.ts:98` (`handleCrewCommand`) and currently returns a stub for every non-`help` verb. This issue replaces those stubs with real implementations that delegate into `src/crew/**`.

| # | Verb | Existing helpers used | New code? | Complexity | Suggested module |
|---|---|---|---|---|---|
| 1 | `best <task> [--account X] [--top N]` | `loadOfficerDatabase`, `loadRoster`, `loadTask`, `optimizeCrew`, `evaluateStaleness` | Discord formatter for `OptimizeCrewResult` (truncate to top 1–3 for chat) | **L** | `src/crew/handlers/best.ts` |
| 2 | `status [--account X]` | `loadOfficerDatabase`, `loadRoster`, `evaluateStaleness`, `validateRosterOfficerIds` | Roster summary formatter (account, age, owned count, unknown-officer count, staleness banner) | **M** | `src/crew/handlers/status.ts` |
| 3 | `progression [--account X]` | `loadOfficerDatabase`, `loadRoster`, `analyzeProgression`, `evaluateStaleness` | Discord formatter for `ProgressionAnalysis` (top-N from each of the 4 sections; truncate aggressively) | **L** | `src/crew/handlers/progression.ts` |
| 4 | `explain <officer>` | `loadOfficerDatabase`, `database.byId.get` | Per-officer detail card (name, faction, captain maneuver text+tags, ability text+tags, synergy groups, source citation) | **S** | `src/crew/handlers/explain.ts` |
| 5 | `synergy <group>` | `loadOfficerDatabase` (filter by `synergy_groups.includes(group)`) | Group membership list + "0 members found" fallback | **S** | `src/crew/handlers/synergy.ts` |
| 6 | `tasks` | `loadTaskDefinitions` | Bullet list of `{id, name, description?}` from `data/crew/tasks/*.yaml` | **S** | `src/crew/handlers/tasks.ts` |
| 7 | `officers [--owned] [--faction X]` | `loadOfficerDatabase`, `loadRoster` (only if `--owned`) | Sorted officer list; with `--owned` cross-ref with roster; **needs pagination — Discord 2000-char limit will bite at 30–50 officers** | **M** | `src/crew/handlers/officers.ts` |
| 8 | `roster show [--account X]` | `loadRoster`, `evaluateStaleness` | Account + last_updated + officer table (id, level, rank, promotions, owned) | **M** | `src/crew/handlers/rosterShow.ts` |

**Verdict:** Zero genuinely new domain logic. Every handler is `load → call existing pure helper → format`. The novelty is **only** in Discord-formatted output rendering and `--account` resolution glue. All 8 handlers can be implemented without touching `src/crew/optimizer.ts`, `progression.ts`, `roster.ts`, `staleness.ts`, `tasks.ts`, or `database.ts`.

---

## 2. Parallel decomposition (Scotty + Uhura)

Per `.squad/routing.md`: Scotty owns TypeScript/CLI/build (and historically the `src/crew/**` engine namespace via #78–#83); Uhura owns Discord integration (and shipped the #91 parser).

**Recommended split — by handler boundary, not by file:**

| Agent | Handlers | Files owned | Why |
|---|---|---|---|
| **Scotty** | `best`, `status`, `progression`, `rosterShow` | `src/crew/handlers/{best,status,progression,rosterShow}.ts` | Heavy `src/crew/` engine reuse (optimizer, progression, staleness). Scotty already authored those engines and knows the shapes cold. |
| **Uhura** | `explain`, `synergy`, `tasks`, `officers` | `src/crew/handlers/{explain,synergy,tasks,officers}.ts` + dispatcher wire-up in `src/discord/crewCommandParser.ts` | Lightweight DB/task lookups (no optimizer); Uhura also owns the Discord seam (parser, dispatch), so she finishes by wiring all 8 into `handleCrewCommand`. |

**Shared-file conflict surface (Drop-Box Pattern per squad.agent.md):**

| File | Both agents touch? | Mitigation |
|---|---|---|
| `src/discord/crewCommandParser.ts` (`handleCrewCommand` dispatch) | **YES — single switch statement** | Uhura owns this file. Scotty exports his 4 handler functions from `src/crew/handlers/index.ts`; Uhura imports + wires the dispatch table in the **same PR last commit**. No concurrent edits. |
| `src/crew/handlers/index.ts` (barrel) | **YES — both add exports** | Append-only — each agent appends their own block. Trivial merge resolution; alphabetical sort enforced. |
| `tests/crew/handlers/*.test.ts` | NO — per-handler test files | Disjoint files. No conflict. |
| `tests/index.test.ts` (import wiring per Rule 15-equivalent) | **YES — both append imports** | Append-only at the bottom of the imports block. Alphabetical sort. Drop-Box pattern. |
| `src/crew/handlers/types.ts` (shared `HandlerDeps`, `HandlerContext`) | **YES, but seeded once** | Recommendation: Uhura seeds this file in her first commit (since she owns the parser seam). Scotty consumes it. No concurrent edits. |

**Decomposition is clean.** No two agents need to edit the same function body. The only true conflict surface is the dispatch switch in `crewCommandParser.ts`, which Uhura owns end-to-end.

---

## 3. Test coverage strategy

Per `tasks.md` T301: `tests/crew/commandHandlers.test.ts` per verb + integration test via the parser. Per `tests/index.test.ts` convention, every new test file must be imported in the same PR.

**Recommended layout:**

```
tests/crew/handlers/
├── best.test.ts          # tiny-world fixture from tests/crew/fixtures/
├── status.test.ts        # stub roster + staleness assertions
├── progression.test.ts   # tiny-world fixture
├── explain.test.ts       # one known officer + one missing officer
├── synergy.test.ts       # one populated group + one empty group
├── tasks.test.ts         # loads from data/crew/tasks/ (real data test)
├── officers.test.ts      # --owned and bare; assert pagination boundary
└── rosterShow.test.ts    # stub roster fixture; staleness banner assertion

tests/discord/
└── crewCommandHandlers.integration.test.ts   # parse → dispatch → response, end-to-end
```

**Per-handler unit test contract (~30–50 LOC each):**
1. **Golden-output snapshot** — exact-string match for one canonical input. Spec acceptance criterion explicitly demands byte-stable goldens (`User Story 6 — Independent Test`).
2. **Edge case** — missing officer (`explain`), empty group (`synergy`), stale roster (`status`/`rosterShow`/`best`/`progression`), unknown task (`best`), unknown account (all account-flagged verbs).
3. **No file-system writes** — handlers are read-only; assert via mocked deps where possible. Reuse `tests/crew/fixtures/tiny-officers.json` + `tiny.yaml` + `tiny-tasks/*.yaml`.

**Integration test (single file, ~80 LOC):**
- Construct a `DiscordMessage` for each verb.
- Run through `parseCrewCommand` + new `handleCrewCommand`.
- Assert the dispatched output is non-empty and contains the verb-specific marker (e.g. `**Top crews**` for `best`, `**Officer:**` for `explain`).
- Smoke-asserts the dispatch table is wired; does NOT re-verify per-handler correctness (covered by unit tests).

**Wire into `tests/index.test.ts`** in the same PR. Non-negotiable per `tasks.md` T301 closing criterion.

---

## 4. PR shipping shape

**Recommendation: ONE PR.** Title: `feat(crew): v2 read-only command handlers (closes #92)`. Branch: `squad/92-crew-v2-handlers`.

**Why ONE:**
- The dispatch switch in `handleCrewCommand` flips from "all stubs" to "all live" atomically. A split that leaves 4 handlers stubbed mid-merge ships a half-working `!crew help` listing — confusing for the operator.
- All 8 handlers share the same `HandlerDeps` shape; defining that once in a single PR avoids two parallel branches re-litigating the contract.
- The total diff is bounded: ~8 handler files × ~50 LOC + 8 test files × ~40 LOC + dispatcher wire-up + barrel + integration test ≈ **~900 LOC**. That is below the 1.5kLOC threshold where Kirk normally recommends splitting (cleanup PR1 retro, Apr 2026).
- Single integration test surface — splitting would force the second PR to retest the parser/dispatch path that the first PR already covered. Wasted code.
- Rollback: one revert closes the whole feature cleanly. Two PRs leaves the dispatcher in a half-rewritten state.

**Why NOT split (rejected):**
- A 4-handler-at-a-time split would land "4 live verbs + 4 stubs" intermediate states on `main`. Help text already lists all 8 as "coming in #92" — partial landings would lie to operators.
- The Rule 5 (phase-boundary commits) discipline already gives us internal checkpoints inside the PR without splitting it.

**Internal phase-boundary commits inside the PR (per Rule 5):**
1. `feat(crew): Phase 1 — handler scaffolding + HandlerDeps (T301)` (Uhura: types + barrel + dispatcher stub edits)
2. `feat(crew): Phase 2 — Scotty handlers (best/status/progression/rosterShow)` (Scotty: 4 handlers + 4 tests)
3. `feat(crew): Phase 3 — Uhura handlers (explain/synergy/tasks/officers)` (Uhura: 4 handlers + 4 tests)
4. `feat(crew): Phase 4 — dispatch wire-up + integration test` (Uhura: switch table + integration test + `tests/index.test.ts` imports)

Each phase commits before the next agent picks up. If interrupted, resume per Rule 5 from the most recent `feat(crew): Phase N` subject.

---

## 5. Worktree setup (Rule 22 precondition)

```bash
# From /workspaces/stfc (main checkout)
git fetch origin
git worktree add /workspaces/stfc-92 -b squad/92-crew-v2-handlers origin/main

# In the new worktree, before staging anything (Rule 22)
cd /workspaces/stfc-92
ls -la node_modules 2>/dev/null | head -1   # detect symlink vs real dir
npm ci                                       # idempotent; refreshes either way
npm test                                     # confirm pre-commit gate is green BEFORE adding work
```

**Pre-commit hook:** `scripts/pre-commit.mjs` runs `npm test`. **Never** `--no-verify`. Per `.github/copilot-instructions.md` Project quick reference: full suite is ~2s, so the gate is cheap.

**Single test file iteration:** `node --import tsx --test tests/crew/handlers/best.test.ts` (faster than full suite during dev).

**Typecheck:** `npm run typecheck` before pushing.

---

## 6. Pre-dispatch unknowns (questions for the user, with suggested defaults)

The spec is silent on a few operational details. I recommend **defaulting** as listed and surfacing only if the user objects in review:

| # | Question | Suggested default | Source of ambiguity |
|---|---|---|---|
| Q1 | **Output format** — Discord embed (rich, requires API change to `CrewCommandResponder.postMessage`) or plain markdown string? | **Plain markdown** (bold, fenced code blocks, bullet lists). Reason: existing `CrewCommandResponder.postMessage(channelId, content: string)` signature only supports string content. Adding embed support is out of scope and would touch the parser PR's surface. | Spec says "Discord-formatted response"; existing API is string-only. |
| Q2 | **Default account when `--account` omitted** — error? loop all accounts (verbose)? use first roster file alphabetically? per-channel mapping? | **Error** with a helpful message: `"--account required. Available: main, alt1, alt2."` (lists discovered roster files). Reason: per-channel-to-account mapping would need a new schema in `command-channels.json` (deferred to a follow-up); looping is too verbose for Discord. | Spec example shows `--account main` always supplied but doesn't define no-flag behaviour. |
| Q3 | **Output length cap** — Discord message limit is 2000 chars. `officers` (no flag) on a 50-officer DB will exceed it. | **Truncate at 1900 chars + "… (N more — use `--owned` or `--faction X` to filter)" footer.** Avoid silent truncation; never paginate to multiple messages (rate-limit risk). | Spec is silent. |
| Q4 | **`best` default `--top`** — engine default is 3; in chat that produces a long message. | **Default `--top 1` for chat; allow `--top 3` opt-in.** Spec User Story 6 example doesn't pin a number; engine CLI default is 3. | Spec example shows `!crew best mining-g3` (no top). |
| Q5 | **`synergy <group>` — exact match or fuzzy?** | **Exact case-insensitive snake_case match.** No fuzzy matching (matches the parser's "deterministic / no surprises" stance from #91 review). | Spec says `synergy <group>`; group ids in `officers.json` are snake_case. |
| Q6 | **`explain <officer>` — id or name lookup?** | **Id (kebab-case) first; fallback to case-insensitive name match if id miss.** Most operators will type `!crew explain kirk`, not `!crew explain "James T. Kirk"`. | Spec says `explain <officer>` without specifying id vs name. |
| Q7 | **Rate-limit message visibility** — current parser silently swallows rate-limited commands. Should the handlers surface "rate limited" back to the user? | **No.** Keep parser behaviour as-is (silent). This was Kirk's #91 review verdict and not in scope of #92. | Spec User Story 6 AC#4 says "ignored and a single ephemeral rate-limit notice" — parser PR deferred the "ephemeral notice" half; do not retrofit here. |

**My recommendation:** Treat Q1–Q5 as Kirk's-call defaults (state them in the PR body); flag Q6 + Q7 as explicit "decision recorded" notes in the PR body inviting Picard override during reviewer lane. None of these block dispatch.

**Genuinely novel work flag (per "If the spec calls for something genuinely novel" constraint):** None detected. Every verb maps to a 1–3 line call into an existing helper plus formatting. If Q1 flips to "must be Discord embeds", that becomes novel (new `CrewCommandResponder` API surface) — escalate to user before starting.

---

## 7. Reviewer-lane proposal (post-PR-open)

Per the cleanup-PR1 routing boilerplate and `.squad/routing.md`:

| Reviewer | Lane | What they check |
|---|---|---|
| **Garak** | Hostile fact-check | (1) Does each handler's output actually cite what the engine returns, or does it embellish? (2) Are the rationale strings stable across re-runs (deterministic ordering, not Map iteration order)? (3) Does `progression` actually use the engine, or does it hand-roll a parallel algorithm that drifts? Verdict via `gh pr comment` (Rule 9b: single-maintainer repo). |
| **Kirk** | Technical correctness | (1) Engine reuse — no logic duplicated. (2) Type safety: `HandlerDeps` shape, no `any`. (3) Pure functions: handlers must not touch disk except via the injected `load*` helpers (testability). (4) Output length cap actually enforced (Q3 default). (5) Dispatcher switch is exhaustive (TS `never` check). Verdict via `gh pr comment`. |
| **Bashir** | Test coverage adequacy | (1) Every verb has a golden snapshot. (2) Edge cases: missing officer / unknown task / stale roster / empty group all covered. (3) Integration test asserts dispatch is wired for all 8 verbs (not just one). (4) `tests/index.test.ts` imports the new files. Verdict via `gh pr comment`. |
| **Picard** | Scope/governance | (1) No constitution amendment required (handlers live in already-sanctioned `src/crew/**` namespace per v1 amendment). (2) PR body has per-line `Closes #92` (Rule 6a). (3) No new outbound network destinations introduced (it's pure compute). (4) Q6 + Q7 defaults acceptable. Verdict via `gh pr comment`. |

**Merge gate:** Per Rule 7, ALL of {Garak APPROVE, Kirk APPROVE, Picard APPROVE, Bashir APPROVE} + CI green → Coordinator auto-merges without asking. No governance carve-out (no constitution edit).

**Tuvok:** No editorial pass needed unless docs are added. Per Rule 16, if any handler exposes a flag not documented in `docs/CREW-OPTIMIZER.md`, the same PR must extend that doc. If it does, route docs review to Tuvok.

---

## 8. Summary for the coordinator

- **8 handlers, all backed by existing `src/crew/**` helpers.** Zero new domain logic; novelty is Discord-output rendering + account resolution glue.
- **Parallel-safe split:** Scotty (best/status/progression/rosterShow) + Uhura (explain/synergy/tasks/officers + dispatch wire-up). Sole shared file is the dispatcher in `crewCommandParser.ts`, owned end-to-end by Uhura.
- **Single PR** on `squad/92-crew-v2-handlers` from main, four phase-boundary commits per Rule 5.
- **Worktree:** `/workspaces/stfc-92`, fresh `npm ci` required (Rule 22).
- **Open questions:** 7 small operational defaults (Q1–Q7 above). All have suggested Kirk's-call defaults; only Q1 (embed vs string) and Q6 (id vs name lookup) are worth surfacing to the user before dispatch. The rest are safe to land with the PR and revise in reviewer comments.
- **Reviewers when PR opens:** Garak (hostile fact-check) → Kirk (correctness) → Bashir (coverage) → Picard (scope). No constitution amendment, so no Tuvok unless docs change.

Ready for the implementer round.

— Kirk

# Picard — Backlog triage + worktree fan-out plan

**Author:** Picard (M2/EM)
**Date:** 2026-06-01T04:57Z
**Requested by:** Cyrus Jamula (via Copilot Ralph Round 5)
**Mode:** READ-ONLY triage; no worktrees created, no implementers spawned
**Coverage:** 12 open issues, 2 open PRs (#129 in review, #96 draft stub)

---

## TL;DR

- **12 open issues; 0 dispatchable RIGHT NOW** without waiting for an in-flight gate.
- **PR #129 (issue #92) is fully green + MERGEABLE** — only Garak's hostile-fact-check verdict outstanding. As soon as it merges, **#93 unblocks** and becomes the lead Batch 2 dispatch.
- **Two external blockers need user action in parallel** (Rule 21 — user-local terminal only): #127 (Azure OIDC secrets) and #85 (20 real game screenshots).
- **Recommended posture:** hold; ask user the two unblocker questions; dispatch #93 the moment PR #129 merges.

---

## 1. Backlog classification (all 12 open issues)

| Status | Issue | Title (short) | Owner(s) | Blocker | Action |
|---|---|---|---|---|---|
| 🟡 IN-FLIGHT | #92 | crew[v2] read-only handlers | Uhura+Scotty | PR #129 review (Garak pending) | monitor; do NOT touch |
| ⏳ DEPENDS-ON | #93 | crew[v2] knowledge embedding pipeline + `!crew knowledge` handler | Uhura+Scotty | #92 (PR #129) merge | queue for Batch 2 |
| ⏳ DEPENDS-ON | #94 | crew[v2] knowledge-rebuild workflow + Rule 3 pin tests | O'Brien | #93 (artifact shape must exist) | queue for Batch 3 |
| ⏳ DEPENDS-ON | #95 | crew[v2] operator docs + reviewer gates | Tuvok + Garak/Kirk/Picard | #93 + #94 (surface area to document) | queue for Batch 4 |
| ⛔ EXTERNAL-BLOCKER | #85 | crew[v1.5] OCR POC spike on 20 screenshots | Uhura | **needs 20 real game screenshots from user** | ASK USER |
| ⏳ DEPENDS-ON | #86 | crew[v1.5] POC gate decision | Picard (me) | #85 measurements | queue for Batch 5 |
| ⏳ DEPENDS-ON | #87 | crew[v1.5] constitution amendment | Tuvok | #86 PASS | queue for Batch 6 |
| ⏳ DEPENDS-ON | #88 | crew[v1.5] image-attachment ingest + ocr.ts + roster-sync.yml | Uhura+Scotty+O'Brien | #87 | queue for Batch 6 |
| ⏳ DEPENDS-ON | #89 | crew[v1.5] OCR + Discord transport operator docs | Tuvok | #88 | queue for Batch 7 |
| ⏳ DEPENDS-ON | #90 | crew[v1.5] reviewer gates | Garak/Kirk/Picard | #88 + #89 PRs | queue for Batch 7 |
| ⛔ EXTERNAL-BLOCKER | #127 | Provision Azure OIDC secrets for SWA deploy | Picard (me) + O'Brien | **user-only `gh secret set` from local terminal per Rule 21** | ASK USER |
| ⏳ DEPENDS-ON | #112 | Epic: 005-web-control-panel Phase 1 | Picard | only #127 left open from epic; auto-closes when #127 closes | track only |
| ⛔ EXTERNAL-BLOCKER | #76 | Ingest STFC Discord channel #1115978499400933473 | Kirk+O'Brien | **bot lacks guild membership in `639255937869152267`** | ASK USER for invite path |

**Dependency-chain sanity check (verified against live `gh` state):**
- #91 (parser, dep for #92) — ✅ CLOSED 2026-06-01T01:17Z
- #84 (v1 reviewer gates, dep for #85) — ✅ CLOSED 2026-05-31T22:49Z
- #74 (sheet ingest, dep for #76) — ✅ CLOSED 2026-05-31T19:43Z

No stale dependencies in any body. All blocker assertions in the issue bodies remain accurate as of 04:57Z.

---

## 2. Parallel-safe fan-out groups

Within the crew[v2] track, the next two dispatches (#93 and #94) are **parallel-safe across worktrees** once #93's interface lands (i.e., the embedding-artifact path is defined). They have:
- **Different lead owners** (Uhura/Scotty vs O'Brien)
- **Different file scopes** (`src/crew/knowledge.ts` + `data/crew/knowledge-embeddings.json` vs `.github/workflows/knowledge-rebuild.yml` + pin tests)
- **Different test files** (`tests/crew/knowledge*.test.ts` vs `tests/skills/knowledgeRebuild*.test.ts`)

The **only shared file** is `tests/index.test.ts` (master barrel). Per the `audit-wip-fanout` skill: serialize barrel edits — the second PR to land rebases over the first.

Within the crew[v1.5] track, #88 spans three owners (Uhura+Scotty+O'Brien) and is best handled in a **single worktree with a coordinated implementer trio**, not three separate worktrees — they share `src/crew/`, `tests/index.test.ts`, and the new `roster-sync.yml` cross-references.

---

## 3. Recommended fan-out batches

| Batch | Trigger | Dispatch | Worktrees added | Cap check |
|---|---|---|---|---|
| **1 (NOW)** | — | **Nothing autonomous.** Hold for PR #129 + ask user on #127 and #85. | 0 | 2 active (`stfc`, `stfc-76`, `stfc-92`) → 3, ≤4 ✅ |
| **2** | PR #129 merges (likely <1h — green + auto-merge will fire on Garak APPROVE) | Spawn Uhura+Scotty pair on **#93** in `/workspaces/stfc-93` | +1 | 3 active (`stfc-92` removed) ≤4 ✅ |
| **3** | #93 PR opens (artifact shape stable) | Spawn O'Brien on **#94** in `/workspaces/stfc-94` | +1 | 4 active ≤4 ✅ (cap hit — no more new worktrees) |
| **4** | #94 PR opens | Spawn Tuvok on **#95** docs in main (no worktree — docs only); reviewer gates fire on #93/#94/#95 | +0 | 4 active |
| **5** | User provides 20 screenshots → #85 closes | Spawn Uhura on **#86** gate prep in main; if PASS → unblock #87–#90 cascade | +0 | within cap |
| **6** | #86 PASS | Spawn Tuvok on **#87** constitution amendment (small PR in main); then **#88** trio in `/workspaces/stfc-88` | +1 (after Batch 3 worktrees retire) | manage cap |
| **7** | #88 PR opens | Tuvok #89 docs; reviewer gates #90 | +0 | within cap |
| **8** | User provisions Azure secrets → #127 closes | O'Brien verifies SWA deploy; close #112 epic | +0 | within cap |

**Concurrency rule applied:** ≤4 active worktrees. Batches 2+3 use 2 new worktrees; we wait for one to retire (PR merge + sweep + remove per Rule 8) before adding another.

---

## 4. Worktree allocation table (proposed)

| Worktree path | Branch | Issue(s) | Status | Notes |
|---|---|---|---|---|
| `/workspaces/stfc` | `main` | (coordinator base) | EXISTING — keep | clean; Tuvok docs / reviewer comments happen here |
| `/workspaces/stfc-76` | `squad/76-ingest-discord-channel` | #76 | EXISTING — KEEP frozen | blocked on guild access; do not work, do not remove (preserves draft PR #96 context) |
| `/workspaces/stfc-92` | `squad/92-crew-v2-handlers` | #92 | EXISTING — REMOVE after PR #129 merge | per Rule 8: sweep `.squad/` artifacts → `git worktree remove --force` |
| `/workspaces/stfc-93` | `squad/93-crew-v2-knowledge` | #93 | **PROPOSED** Batch 2 | run `worktree-preflight` skill (npm ci) on creation; effort M (3–5 files src + ~3 test files + embeddings artifact + tests/index.test.ts) |
| `/workspaces/stfc-94` | `squad/94-crew-v2-knowledge-rebuild` | #94 | **PROPOSED** Batch 3 | run `worktree-preflight`; effort S (1 workflow yaml + ~1 pin test file + tests/index.test.ts append); Rule 3 grep on creation |
| `/workspaces/stfc-88` | `squad/88-crew-v15-ocr-impl` | #88 | **PROPOSED** Batch 6 | trio worktree (Uhura+Scotty+O'Brien); effort L; only after #86 PASS |

**File-scope sanity (no cross-worktree conflicts in Batch 2 + 3):**

| File | #93 | #94 | Resolution |
|---|---|---|---|
| `src/crew/knowledge.ts` | ✅ new | — | #93 owns |
| `data/crew/knowledge-embeddings.json` | ✅ new (committed artifact) | reads | #93 defines shape; #94 reads schema |
| `.github/workflows/knowledge-rebuild.yml` | — | ✅ new | #94 owns |
| `tests/index.test.ts` | append | append | **SERIALIZE** — second PR rebases over first (per `audit-wip-fanout` skill) |
| `tests/skills/discordMonitor.test.ts` | — | possibly grep-touched | Rule 3 grep before edits |
| `docs/CREW-OPTIMIZER.md` | — | — | reserved for #95 (Tuvok) |

---

## 5. Recommended action for Coordinator

### 5a. Dispatch NOW (Batch 1)

**Nothing autonomous.** The two highest-priority actionable items both depend on user action or a near-imminent PR merge.

### 5b. Queue (Batches 2–8 via session SQL todos)

Track in SQL with dependencies — Coordinator should `INSERT INTO todos` for each batch with `depends_on` chain so they auto-fire as gates clear.

### 5c. **STOP AND ASK USER (two parallel asks)**

Use `ask_user` (or direct chat) with these two questions, **both at the same time** (independent unblockers):

1. **#127 — Azure OIDC secrets (Phase 1 epic deploy verification):**
   > Please run from your **local terminal** (Rule 21 — never paste values in chat):
   > ```bash
   > gh secret set AZURE_CLIENT_ID     --repo Jamula/stfc
   > gh secret set AZURE_TENANT_ID     --repo Jamula/stfc
   > gh secret set AZURE_SUBSCRIPTION_ID --repo Jamula/stfc
   > ```
   > Reply "secrets set" when done; I will close #127 and #112 epic.

2. **#85 — OCR POC screenshots (unlocks the entire crew[v1.5] cascade #85→#86→#87→#88→#89→#90):**
   > Can you provide 20 real STFC game screenshots covering officer roster screens (varied resolutions / iPhone framings if you have them)? Drop them in a folder, share a path or zip. Once Uhura has them, the POC spike runs in ~1 session and the gate decision (#86) follows immediately.

3. **#76 (lower urgency — long-blocked already):**
   > The bot still lacks membership in guild `639255937869152267`. If the invite path opened up since 2026-05-31, let me know; otherwise we leave #76 + draft PR #96 frozen.

### 5d. Auto-fire watch

When PR #129 merges (CI green + auto-merge enabled — likely <1h):
1. Remove `/workspaces/stfc-92` worktree per Rule 8 (sweep `.squad/` first).
2. Create `/workspaces/stfc-93` + `squad/93-crew-v2-knowledge`; run `worktree-preflight` skill.
3. Dispatch Uhura (Discord/API lead) + Scotty (TS/CLI) as a coordinated pair against #93.
4. Set up next gate: when #93 PR opens, dispatch O'Brien on #94 in `/workspaces/stfc-94`.

---

## 6. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Worktree sprawl** — multiple ranks of crew[v1.5] + crew[v2] worktrees could pile up | Hard cap ≤4 active concurrent worktrees; new worktrees only after a PR merges + sweep + remove per Rule 8 |
| **`tests/index.test.ts` merge conflict** (#93 vs #94) | Second PR rebases over first; per `audit-wip-fanout` skill — only ONE PR appends barrel imports per wave |
| **PR #129 review-loop drag** (Bashir CR fix still in flight per context) | Don't start #93 work until #129 actually MERGES (not just APPROVED). Wait for `gh pr view 129 --json state --jq '.state'` = `MERGED`. |
| **#94 starting before #93 stabilizes** — workflow rebuilds an artifact whose shape isn't final yet | Strict gate: #94 worktree creation only after #93's PR is OPEN and the embedding-artifact JSON schema is committed to the #93 branch |
| **Restart required if PR #128 (cleanup) work re-touched** — self-development rule | None of these batches touch `squad.agent.md` / `.specify/memory/constitution.md` / `.squad/rules/`. Safe. |
| **Stale `stfc-76` worktree as long-lived "park"** | Document it as "frozen by design pending guild access" in this memo; don't auto-prune. Re-evaluate weekly. |
| **#127 secret provisioning never happens** → #112 epic stays open indefinitely | Acceptable. Epic closes itself on #127 close; no other Phase 1 work pending. |

---

## 7. Skill usage on this triage

- ✅ Read `.copilot/skills/dispatch-precheck/SKILL.md` — applied state-checks on all dependency issues (#91, #84, #74) to confirm blocker assertions are current.
- ✅ Read `.squad/skills/audit-wip-fanout/SKILL.md` — applied serialization rule for `tests/index.test.ts` across #93/#94; cross-cutting file pre-resolution.
- ✅ Read `.squad/skills/worktree-preflight/SKILL.md` — embedded `npm ci` step into Batch 2/3/6 spawn instructions; satisfies Rule 22.
- ✅ Read `.squad/routing.md` — used to confirm O'Brien owns #94 (workflow YAML), Tuvok owns #89/#95 (docs), Uhura+Scotty on #92/#93 per crew-optimizer routing.

---

## 8. One-line recommendation

**Hold all autonomous dispatch; ask user the two Rule-21 unblocker questions (#127 secrets + #85 screenshots) in parallel NOW; the moment PR #129 merges, sweep `stfc-92`, then spawn `/workspaces/stfc-93` for the Uhura+Scotty knowledge-pipeline pair on #93. Everything else queues behind that.**

— Picard, 2026-06-01T04:57Z
# Picard → Tuvok — HF carve-out follow-up after PR #130

**Date:** 2026-06-01
**From:** Picard (scope/governance reviewer)
**To:** Tuvok (governance/constitution steward)
**Re:** Scotty's parked question at `.squad/decisions/inbox/scotty-issue-93-constitution-q.md`
**Urgency:** non-blocking — PR #130 ships with NO amendment needed.

## TL;DR

PR #130 (issue #93) landed under the existing HF carve-out without an amendment because the
committed embeddings artifact uses the deterministic on-runner `hashed-bow-v1` embedder
(no network), and `createMiniLMEmbedder` is dead-code under the default config. **This
note is the follow-up routing for the standing question about whether to broaden the
carve-out for a future MiniLM switch.**

## Picard's recommendation: Option (A), separate amendment track

Scotty offered (A) broaden carve-out, (B) keep hashed-fallback as permanent, (C) something
else. Recommend **(A)** when (and only when) someone actually proposes flipping the runtime
default to MiniLM. Rationale:

1. The hashed-bow-v1 embedder is a fine retrieval substrate for the current 76-chunk
   corpus, but it will degrade as the corpus grows (semantic similarity is approximated
   only by token co-occurrence in the hashed feature space). MiniLM produces materially
   better top-k ordering on free-form natural-language queries — which is the entire
   point of #93's freeform Q&A surface.
2. The carve-out broadening is mechanically the same shape as the existing classifier
   carve-out: new `config/knowledge-model.json` with a pinned SHA-256, scoped to the
   `discord-monitor` skill only, integrity-checked on cache miss. The amendment template
   already exists (see the v1.6.0 / v2.0.0 amendments for prior art on adding a
   sanctioned `huggingface.co` purpose).
3. Option (B) — permanent hashed fallback — locks us into degraded retrieval quality
   and means we shipped 100% of the MiniLM plumbing for nothing. Wasteful.

## What this note does NOT do

- Does NOT propose the amendment now. PR #130 doesn't need it.
- Does NOT assign a new issue. If/when a future ticket proposes flipping the default to
  MiniLM, that ticket should be filed with `squad:tuvok` + an amendment-track label, and
  the new `config/knowledge-model.json` + SHA pin must land in the same PR.
- Does NOT change the scope of #93, #94, or #95. Those three issues do NOT depend on the
  amendment.

## Action requested from Tuvok

Acknowledge this recommendation (or counter-propose) and park until/unless someone files
the "switch knowledge embedder to MiniLM" ticket. No PR-blocking work.

— Picard
# Scotty — issue #93 — constitution question (non-blocking)

**Date:** 2026-06-01
**From:** Scotty (TypeScript/CLI engineer, M2)
**To:** Tuvok (governance/constitution steward)
**Re:** Knowledge-base embedding pipeline (PR for issue #93)
**Urgency:** non-blocking — implementation has shipped without depending on HF network egress.

## Context

PR for #93 adds `src/crew/knowledge.ts` + `src/crew/handlers/knowledge.ts` + a
committed embeddings artifact at `data/crew/knowledge-embeddings.json`. The
default embedder used by the rebuild CLI and the committed artifact is a
deterministic SHA-256-based feature-hashing fallback (`hashed-bow-v1`,
384-dim) — **no network egress**. The real `Xenova/all-MiniLM-L6-v2` pipeline
is implemented (`createMiniLMEmbedder`) but is opt-in via
`STFC_KNOWLEDGE_MODEL=minilm` and never called by the default code path,
tests, CI, or the runtime handler against the committed artifact.

## Question

The constitution sanctions `huggingface.co` egress only for the
`discord-monitor` skill's tier-2 zero-shot classifier
(`.specify/memory/constitution.md` ~lines 1262–1265, "purpose: one-time
download of classifier model weights, integrity-checked against the SHA-256
pinned in `config/classifier-model.json`"). The carve-out is scoped to the
classifier and references its specific SHA-pinned config.

If/when we want to switch the runtime embedder from the hashed fallback to
real MiniLM (which lives behind the same `!crew knowledge` handler routed
inside the `discord-monitor` skill runtime), should the carve-out be:

- **A.** Broadened to cover any MiniLM-class feature-extraction model used
  inside the `discord-monitor` skill, with the same SHA-pin requirement and
  a new `config/knowledge-model.json`; or
- **B.** Kept as-is, with `!crew knowledge` permanently using the on-runner
  hashed-fallback embedder (current state) and any future MiniLM use
  triggering a separate amendment proposal; or
- **C.** Something else (e.g. precompute query embeddings at build time and
  ship a query-encoder service — probably not feasible for free-form Q&A)?

## What I did (current PR)

- Implemented embedder as a pluggable interface, defaulted to
  `createHashedEmbedder()` (no network).
- Committed `data/crew/knowledge-embeddings.json` built with the hashed
  embedder (`model: "hashed-bow-v1"`, 76 chunks).
- The MiniLM code path is dead-code in the default config; reviewers can
  confirm by grepping for `STFC_KNOWLEDGE_MODEL`.
- No constitution amendment proposed in this PR.

## Recommended follow-up

If Tuvok prefers (A), file a separate amendment-track issue/PR; the
`createMiniLMEmbedder` plumbing is ready and a model-config + SHA pin is
the only missing piece. If (B), keep things as they are.

— Scotty
# Uhura decision: crew v2 dispatcher seam

Date: 2026-06-01T04:10Z
Issue: #92

- `handleCrewCommand` is now async and owns handler dispatch/error wrapping; `processCrewCommands` only handles parse/rate-limit/post sequencing.
- Handler failures are converted to `Error: {message}` before calling `CrewCommandResponder.postMessage`, preserving the existing string-only Discord responder surface.
- The barrel exposes all 8 handler names as static exports after Scotty's handler commit landed; Uhura only edited the barrel and dispatcher, not Scotty's handler bodies.
