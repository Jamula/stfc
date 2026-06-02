# Picard board triage — Round 2 (Ralph-triggered)

**Date:** 2026-06-02T04:50Z
**Role:** Picard (M2/EM)
**Trigger:** Ralph work-monitor loop on behalf of Cyrus
**Scope:** Read-only triage of 4 open issues (#85, #86, #127, #138)

## Decisions

### #138 — routing smoke-tests → `go:yes` (ready for @copilot)

- Added `go:yes` label.
- Issue body fully specifies the 10 trigger phrases + two implementation options (A: test harness, B: runbook). No outstanding architectural questions.
- Routing signals now complete: `squad:copilot` (durable) + `go:yes` (readiness).
- Retried `gh issue edit 138 --add-assignee Copilot` — failed as expected (`replaceActorsForAssignable`, Codespaces token can't add Bot actor). Documented in comment.
- Cyrus may need to manually assign from his local terminal if @copilot doesn't auto-discover the issue.

### #85 — OCR POC spike → HELD (NOT `go:yes`)

- Spike normally gets immediate `go:yes` (investigative, no production-code risk).
- **Exception applied:** hard input dependency on 20 operator-provided STFC roster screenshots that Uhura cannot synthesize or substitute. Per `specs/004-crew-optimizer/spec.md`, the POC's whole point is measurement on real gameplay artifacts.
- Posted acceptance bar restatement + unblock path (drop screenshots in `data/crew/poc-screenshots/`, re-trigger Ralph).
- Owner (Uhura) is correct — no reassignment.

### #86 — POC gate decision → HELD (gated on #85)

- This is my own gate decision; cannot post PASS/FAIL without measurements.
- Dependency chain (#85 → #86 → #87/#88 → #89/#90) is correctly modeled.
- Posted one-line "awaiting #85 spike results" comment per Rule 9b convention. Did NOT touch #87–#90 — gating is durable in their issue bodies; label gymnastics would be noise.

### #127 — Azure OIDC secrets → HELD (operator-only per Rule 21)

- Workflow already gated (`secrets.AZURE_CLIENT_ID != ''`, commit `84ffe6f`) → missing secrets produce `skipped`, not `failure`. PR #124 already merged.
- All prep work done on Picard/O'Brien side: runbook documented, `scripts/azure/create-swa.sh` shipped, deploy contract in `specs/005-web-control-panel/deploy-contract.md`, invite runbook in `docs/SWA-INVITATION-RUNBOOK.md`.
- Remaining work is **operator-only**: Cyrus must run `gh secret set` from his local terminal with hidden-input prompt (Rule 21 — values never enter the chat surface).
- No `status:awaiting-user-action` label exists in this repo. Made the status explicit in the comment instead of inventing taxonomy.

## Outcomes

**Now `go:yes` / dispatchable:**
- #138 (ready for @copilot pickup; Cyrus may need to manually assign)

**Held / gated:**
- #85 — awaiting 20 STFC screenshots from Cyrus
- #86 — awaiting #85 outcome (Picard's own gate)
- #87, #88, #89, #90 — chain-gated on #86 (untouched, correctly modeled)
- #127 — awaiting Cyrus to provision Azure OIDC secrets

**Escalations for Cyrus:**
1. **#85 / v1.5 OCR stream is operator-blocked.** Drop 20 STFC roster screenshots in `data/crew/poc-screenshots/` (gitignored) and re-trigger Ralph on #85 to unblock the entire v1.5 chain.
2. **#127 / SWA deploy is operator-blocked.** Run the three `gh secret set` commands from your local terminal (NEVER in chat). Without this, the SWA deploy job will keep skipping and the web control panel can't ship.
3. **#138 / @copilot assignment** may need manual assignment from your local terminal if Copilot doesn't self-discover via the `squad:copilot` label within a session or two.

## Heuristics added to history.md (Learnings section)

- Spike-vs-implementation `go:yes` policy + the input-dependency exception.
- Dependency-chain triage: document blocker on root, one-line "awaiting" on immediate next gate, leave downstream untouched.
- Operator-gated issues without a status label → prose comment, don't invent taxonomy until the pattern recurs 3+ times.
- Codespaces assignee-API limitation is durable; don't waste cycles troubleshooting.

— Picard

---

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


---

# Garak verdict — PR #150 hostile fact-check

**Date:** 2026-06-02T03:52Z
**PR:** #150 — `feat(discord): add commands.json + validator (#144)`
**Verdict:** **CHANGES_REQUESTED** ⚠️

Kirk's approve does not hold because the validator contract is weaker than the PR/docs claim and weaker than Discord's registration constraints.

## Blocking findings

1. **Uppercase command names pass local validation but violate Discord's lowercase-variant rule.**
   - Evidence: `scripts/validate-discord-commands.mjs:22-24` says lowercase but uses `^[-_\p{L}\p{N}]{1,32}$`.
   - Discord docs: command names matching the regex must still use lowercase where a lowercase variant exists.
   - Probe: `/AdminOnly` fixture returned validator status 0.
   - Register-time failure shape: Discord form errors use HTTP 400, code `50035`, message `Invalid Form Body`, nested `errors` object.

2. **`options` is not recursively validated.**
   - Evidence: `scripts/validate-discord-commands.mjs:52-54` checks only `type: "array"`.
   - Discord docs constrain option type, name, description, ordering, uniqueness, choices, lengths, and autocomplete/choices compatibility.
   - Probe: invalid option object with `type:999`, uppercase name, and empty description returned validator status 0.

3. **Duplicate command names pass local validation.**
   - Evidence: root schema has no uniqueness rule (`scripts/validate-discord-commands.mjs:58-62`).
   - Discord docs require command names to be unique per application/type/scope.
   - Probe: duplicate `CHAT_INPUT` names returned validator status 0.

## Confirmed

- `discord/commands.json:8-12` uses `default_member_permissions: "8"`; Discord permissions docs define ADMINISTRATOR as `(1 << 3)` / decimal 8, serialized as a string bitfield.
- PR body has `Closes #144` on its own line and a `## Tests` section.
- AJV is configured with `unicodeRegExp: true` at `scripts/validate-discord-commands.mjs:80`.

## Suggested revision agent

Scotty (not Uhura, per reviewer-lockout). Minimum fix: reject uppercase ASCII names for this repo's command surface, reject duplicate `(type,name)` pairs, and either fully validate `options` or reject `options` until #145/#147 need them.


---

# Garak re-verify — PR #150

**Date:** 2026-06-02T04:02Z
**PR:** #150
**Head verified:** 8fd9818
**Verdict:** APPROVE ✅

## Findings re-verified

1. **Uppercase rejection resolved.** `NAME_PATTERN` now uses `\p{Ll}` and `AdminOnly` exits 1 with a pattern error. Existing `/redeem-status` and `/trigger-redeem` still validate.
2. **Duplicate `(type,name)` detection resolved.** Same `type=1,name="foo"` exits 1 with `duplicate command for (type=1, name="foo")`; same name across types 1 and 2 exits 0.
3. **Options handling resolved for this PR scope.** Any own `options` property, including `options: []`, exits 1 with `options not yet supported by this validator — track in a follow-up issue`.

## Regression checks

- `npm test` passed from `/workspaces/stfc-144`.
- `node scripts/validate-discord-commands.mjs` passed on current `discord/commands.json`.
- `gh pr checks 150 --watch` ended green.
- Original seven tests remain in `tests/discord/commandsJson.test.ts`; Scotty added the three failure tests instead of weakening the suite.
- `git diff main...HEAD -- discord/commands.json` still shows only the intended new command file with `redeem-status` and `trigger-redeem`.

## Non-blocking note

The PR body still contains stale prose from round 1 (`\p{L}` and seven-test inventory). It remains mechanically compliant (`Closes #144`, `## Tests`) and does not change the code verdict, but it is archival drift.


---

# Garak verdict — PR #151 Cloudflare Worker Discord bridge

**Date:** 2026-06-02T03:54Z
**PR:** #151 — `feat(worker): add Cloudflare Worker Discord bridge (#146)`
**Role:** Garak — hostile fact-check, Kirk-as-author co-review
**Verdict:** **CHANGES_REQUESTED** ⚠️

## Blocking finding

Malformed signature/header input escapes as an exception instead of a uniform 401:

- `worker/src/index.ts:62-66` calls `hexToBytes(signature)`, encodes `timestamp + body`, and calls `ed.verifyAsync(...)` with no `try/catch`.
- `worker/src/index.ts:117-123` only rejects odd-length hex; non-hex pairs become `NaN`, which `Uint8Array` coerces to `0`.
- Installed `@noble/ed25519` validates signature/public-key byte lengths inside verification (`worker/node_modules/@noble/ed25519/index.js:461-464`) and can throw.
- Local probe from `/workspaces/stfc-146/worker` showed attacker-controlled malformed signatures throw: `1 THREW RangeError hex string must have even length`, `2 THREW Error Uint8Array expected`, `126 THREW Error Uint8Array expected`.
- Current tests cover only a parseable corrupted 64-byte signature (`worker/src/index.test.ts:106-112`), not odd-length, non-hex, short signature, or malformed public-key configuration.

## Confirmed checks

- Noble v2 API order is correct: `verifyAsync(signature, message, publicKey)` (`worker/node_modules/@noble/ed25519/index.d.ts:119-120`; upstream README usage example same order).
- Verification message is exactly UTF-8 bytes of `timestamp + body` (`worker/src/index.ts:61-65`).
- Replay window uses both directions via `Math.abs(now - ts) > 300` (`worker/src/index.ts:53-58`); no nonce tracking, so a captured valid payload can trigger duplicate dispatches inside five minutes.
- PING does not bypass signature verification; type branching starts after verification (`worker/src/index.ts:47-78`).
- Worker accepts `ctx` and uses `ctx.waitUntil` for command dispatch (`worker/src/index.ts:42,83-86`).
- GH dispatch URL is `https://api.github.com/repos/${env.GH_REPO}/dispatches` and User-Agent is set (`worker/src/index.ts:93-101`); GH_REPO is env-configured, not separately validated.
- `nodejs_compat` is not enabled; `wrangler.toml` documents native Web Crypto use (`worker/wrangler.toml:3-6`).
- PR body has `Closes #146` on its own line and a `## Tests` section; docs touched `worker/README.md` and root `README.md`; diff grep showed placeholders/test values only, no live secrets.

## Suggested revision owner

Scotty — general Worker hardening. Add strict hex length/content validation, wrap conversion + `verifyAsync` in `try/catch`, return uniform 401 for malformed and invalid signatures, and add edge-case tests plus dispatch-failure logging coverage.


---

# Garak PR #151 re-verification verdict

**Date:** 2026-06-02T04:04Z
**PR:** #151 — Cloudflare Worker Discord interactions bridge
**Head verified:** c616289
**Verdict:** APPROVE ✅

## Evidence

- `worker/src/index.ts:66-68` rejects malformed signature hex before `hexToBytes` or `ed.verifyAsync` run.
- `worker/src/index.ts:74-85` wraps both signature/public-key conversion and `verifyAsync`; any throw maps to `Invalid signature` / 401.
- `worker/src/index.test.ts` covers parseable wrong signature, odd-length hex, non-hex correctly-lengthed signature, short signature, long signature, malformed public key, and GH dispatch 5xx behavior.
- `cd worker && npm test`: 14/14 passing.
- `gh pr checks 151`: CodeQL and npm/test checks passing.
- `git diff main...HEAD --stat`: worker project plus README only; no root `package.json` dependency change.

## Non-blocking observations

- PR body's `## Tests` section still says 8 tests and omits the six added revision tests.
- A cold missing `DISCORD_PUBLIC_KEY` binding returns safe 500 without leaking the value, but does not emit the `DISCORD_PUBLIC_KEY misconfigured` log line because the lazy-cache sentinel initially equals `undefined`.

Original blocking finding is fixed. Ship it.


---

# Kirk — PR #150 code review verdict

**Date:** 2026-06-02
**PR:** #150 `feat(discord): add commands.json + validator (#144)`
**Author:** cyrusjamula (Uhura)
**Branch:** `squad/144-commands-json`
**Verdict:** **APPROVE** ✅ — pending Garak co-review (Kirk-as-author-and-reviewer carve-out)

## What I checked

- `discord/commands.json` shape matches Discord CHAT_INPUT spec (name 1–32 chars, description 1–100, `type: 1`, `default_member_permissions: "8"` = bit 3 = ADMINISTRATOR).
- `scripts/validate-discord-commands.mjs`: ajv v8 (`^8.20.0` already in devDependencies — no new deps), `unicodeRegExp: true` correctly enables `\p{L}\p{N}` Unicode classes, `additionalProperties: true` keeps the schema forward-compatible with future Discord fields, exit codes 0/1 match repo convention, error messages are operator-friendly.
- `tests/discord/commandsJson.test.ts`: 8 tests — JSON validity + parse, command-shape loop (name/description/type), both `/redeem-status` and `/trigger-redeem` presence assertions, validator happy-path + 3 failure modes (oversize name, empty description, malformed JSON). Broken-fixture temp files (`discord/_test-broken-*.json`) cleaned in `finally` blocks. Wired into `tests/index.test.ts`.
- Docs: `docs/DISCORD-BOT-SETUP.md` §Slash commands explains source-of-truth role, permission bitmask, validator usage, and downstream consumers (#145/#147). Satisfies Rule 16.
- PR body: `Closes #144` on its own line (Rule 6a ✓), `## Tests` section enumerates added tests (Rule 15 ✓).
- Scope: no worker code (that's #146), no workflow YAML (that's #145), `git diff origin/main..HEAD -- .squad/` is empty (Rule 2 ✓).
- Rule 22: coordinator pre-spawn `npm ci` confirmed; CI is green (6/6 checks).

## Non-blocking observation

Discord's name constraint for Latin script is **lowercase only**, but the regex
`^[-_\p{L}\p{N}]+$` would accept e.g. `Redeem-Status` and pass validation while
Discord's registration API would reject it. Both current commands are lowercase,
so this is latent. Worth either tightening to `^[-_\p{Ll}\p{N}]+$` for
lowercase-Latin, or adding a comment noting Discord enforces lowercase
server-side. **Not a merge blocker** — appropriate to handle as a follow-up
in #146 (where registration will surface the failure if it ever triggers).

## Co-review requirement

I authored the arch decomposition for #143 (parent epic) that scoped #144.
Per `.squad/routing.md` Kirk-as-author-and-reviewer rule, I cannot be the
sole reviewer gate. **Garak's hostile fact-check is required before merge.**

## Routing

- → Garak: hostile fact-check (does the validator actually catch what Uhura
  claims? Are the permission bitmask docs accurate? Is the `unicodeRegExp`
  claim correct?). Verdict to `.squad/decisions/inbox/`.
- → Coordinator: hold merge until Garak's APPROVE lands; then Rule 7
  auto-merge applies.


---

# Kirk verdict — PR #151 (Cloudflare Worker Discord bridge)

**Date:** 2026-06-02T03:55Z
**PR:** https://github.com/Jamula/stfc/pull/151
**Author:** cyrusjamula (Uhura)
**Branch:** `squad/146-cf-worker`
**Comment:** https://github.com/Jamula/stfc/pull/151#issuecomment-4598568022

## Verdict: APPROVE ✅ — pending Garak co-review

Per `.squad/routing.md`, the Kirk-as-author-and-reviewer carve-out applies: I authored the arch in decision `kirk-discord-slash-arch` that this PR implements. **Garak (hostile fact-check) must co-review before merge.** Do NOT auto-merge on my approval alone.

## Security review (priority items, all PASS)

1. **Signature check ordering** ✅ — `ed.verifyAsync` returns 401 *before* `ctx.waitUntil` is reached. PING test asserts `waitUntil` NOT called; bad-sig tests intentionally don't mock `fetch` (would explode if dispatch fired on bad sig — passive assertion).
2. **Message construction** ✅ — `timestamp + body` raw concat, no separator, matches Discord spec.
3. **`ctx.waitUntil` pattern** ✅ — type:5 returned synchronously; dispatch fires in background. No `await` on outbound fetch in the request path.
4. **Replay window** ✅ — `Math.abs(now - ts) > 300` covers both stale AND future skew.
5. **GH token hygiene** ✅ — Only sent as `Authorization: Bearer` to hardcoded `https://api.github.com/repos/${env.GH_REPO}/dispatches`. Never logged/echoed. `GH_REPO` is operator-set (not user input) so URL template is safe.
6. **Method gate** ✅ (405), **PING handling** ✅ (sync `{type:1}`), **Unknown type** ✅ (400).
7. **No secrets in diff** ✅ — `git diff` grep shows only variable names, placeholders, and test fixture `"test-gh-token"`.
8. **wrangler.toml** ✅ — `compatibility_date = "2026-06-02"`, only non-sensitive `GH_REPO` in `[vars]`, secrets in comments as `wrangler secret put`.
9. **Library choice** ✅ — `@noble/ed25519@^2.1.0` in deps, no tweetnacl leftover, no `nodejs_compat` flag.

## Build & test status

- `worker/` → `npm test` → **8/8 passing** (144ms)
- Root → `npm test` → **1019/1019 passing** (no regression)
- TS strict mode ✅, `Env` interface ✅, no `any` in security paths ✅

## PR hygiene (Rules 6a + 15 + 16)

- ✅ `Closes #146` per-line
- ✅ `## Tests` section enumerates 8 tests
- ✅ Why / What / Not-in-this-PR sections
- ✅ Mentions deployment #148 and runbook #149
- ✅ Root `README.md` updated with one-line worker mention (Rule 16)

## Non-blocking wishlist (do NOT block this PR)

Filed in PR comment as wishlist. Summary:

1. **401 messages distinguish failure modes** — could be opaque "Unauthorized" to hide which gate tripped. Discord's own example does the same; defensible.
2. **`hexToBytes` throws on odd-length input** → uncaught → 500 instead of 401. Wrap in try/catch.
3. **`dispatchToGitHub` has no try/catch** — GH API failure silently swallowed by `waitUntil`. Discord user stuck at "thinking...". Recovery is arguably #147's job (GH Actions handler can send error follow-up), but at minimum `console.error` would help `wrangler tail` diagnostics.
4. **Test gaps:** (a) "fetch NOT called when sig invalid" explicit assertion, (b) future-skew (+301s) symmetric to stale test. Currently structural absence-of-mock in negative tests covers (a) implicitly.

None affect security posture. None block.

## Next steps

- Awaiting Garak co-review (hostile fact-check on the security claims above)
- After Garak APPROVE + CI green → auto-merge per Rule 7
- Post-merge: cleanup worktree `/workspaces/stfc-146`, sweep `.squad/` artifacts (Rule 8)
- Follow-ups #147 (Scotty — GH Actions handler), #148 (O'Brien — deploy workflow), #149 (operator runbook)

— Kirk


---

# Kirk verdict — PR #152

**Date:** 2026-06-02T04:13Z
**PR:** #152 — `ci: add discord-register-commands.yml workflow (#145)`
**Author:** Uhura (cyrusjamula)
**Branch:** `squad/145-register-workflow`
**Verdict:** **APPROVE** ✅

## One-line justification

Workflow is `workflow_dispatch`-only with `contents: read`, SHA-pinned to the repo's canonical action versions, has validation as a separate step before the curl side-effect, dry-run short-circuits cleanly, token is handled hygienically (single curl invocation, no echo, no `set -x`, no `-v`), and 14 pin tests cover all the security-adjacent surface.

## Token-leak concern

**None.** `DISCORD_BOT_TOKEN` flows through `env:` → single `curl -H "Authorization: Bot $TOKEN"` invocation. No `echo`, no `set -x`, no `curl -v`. Discord doesn't echo request headers in responses, so the `GITHUB_STEP_SUMMARY` publication of `response.json` is safe. Pin tests explicitly assert absence of token-echo and `set -x`.

## CI status at review time

All 6 required checks green: Analyze (CodeQL), Rule N citations, secret-leak scan, npm test (required), test x2.

## Files reviewed (4)

- `.github/workflows/discord-register-commands.yml` (+128)
- `tests/skills/discordRegisterCommands.test.ts` (+266) — 14 pin tests
- `docs/DISCORD-BOT-SETUP.md` (+44) — operator runbook
- `tests/index.test.ts` (+1) — wiring

## Next action

Auto-merge per Rule 7 — Coordinator may ship without re-asking.

## Reviewer

Kirk (code review) — posted via `gh pr comment 152` per Rule 9b.


---

# Kirk — PR #153 re-verify verdict

**Date:** 2026-06-02T04:25Z
**PR:** #153 (Closes #148)
**Author:** Scotty
**Commit re-verified:** `69bf4b31a7a6001519ba8960552f499744f58c35`
**Verdict:** **APPROVE** ✅

## Prior finding (CHANGES_REQUESTED ~04:20Z)

Wrangler-action SHA `1029e9...` was falsely labeled v4.0.0 in 3 places (workflow YAML, pin test, PR body). Actual v4.0.0 SHA is `ebbaa1584979971c8614a24965b4405ff95890e0`.

## Re-verification (all green)

| Site | Status |
|---|---|
| `.github/workflows/deploy-cloudflare-worker.yml:34` | ✅ `ebbaa158...` |
| `tests/skills/deployCloudflareWorker.test.ts:83-84` | ✅ `ebbaa158...` |
| PR #153 body | ✅ `ebbaa158...` |
| `gh api` tag→SHA cross-check | ✅ returns `ebbaa158...` |
| CI (`npm test` required) | ✅ pass on 69bf4b3 |
| Local `npm test` | ✅ 1041/1041 pass |
| Commit scope | ✅ 2 files (workflow + test); PR body is API-side |
| PR body structure | ✅ `Closes #148` per-line, `## Tests`, `## Required secrets` intact |

## CodeQL note

`Analyze (javascript-typescript)` still queued at verdict time — per Rule 13a, this is timing race on a freshly pushed SHA, non-blocking for review verdict. Auto-merge gate (Rule 7) will wait for green.

## Action

Ship it. No further changes requested.


---

# Kirk — PR #153 review (deploy-cloudflare-worker.yml)

**Date:** 2026-06-02T04:16Z
**Verdict:** CHANGES_REQUESTED ⚠️
**PR:** https://github.com/Jamula/stfc/pull/153
**Comment:** https://github.com/Jamula/stfc/pull/153#issuecomment-4598677426
**Author:** O'Brien (commit via cyrusjamula)
**Revision routed to:** Scotty (mechanical SHA repin)

## Blocker

Workflow pins `cloudflare/wrangler-action@1029e90033977ccf46c2a9b3ddc55e42ad5da467 # v4.0.0`.

`1029e90` is **not** v4.0.0. Verified upstream:
- `1029e90` = 2026-03-12 commit on `main`, "Update default Wrangler version to v4 (4.72.0)", **untagged**
- Real v4.0.0 tag = `ebbaa1584979971c8614a24965b4405ff95890e0`, 2026-05-12, "Automatic compilation"

PR body's claim "pinned to SHA 1029e90 == v4.0.0" is also false. SHA-pin provenance broken.

**Fix (3 places):**
1. Workflow line 34 → `cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0  # v4.0.0`
2. Pin test line 83 → assert new SHA
3. PR body bullet → update SHA reference

## What passed (no changes needed)

- Triggers: push/main + path filter + workflow_dispatch, NO pull_request
- Permissions: contents: read only (single key)
- Concurrency: `deploy-cloudflare-worker`, `cancel-in-progress: false`
- Step order: checkout → setup-node → npm ci → npm test → npm run typecheck → wrangler deploy → summary; no `continue-on-error` / `if: always()`
- wrangler-action inputs: `command: deploy`, `workingDirectory: worker`, both secrets via `${{ secrets.* }}` interpolation
- Token hygiene (Rule 21): no echo, no `set -x`, summary writes deployed URL only — token never in any run: block
- Pin tests: 9 assertions, comprehensive (paths, dispatch, perms minimality, concurrency, 3 action SHAs, step ordering, wrangler `with:`, secrets refs + no-echo, summary)
- worker/README.md: full Deployment section with `gh secret set` instructions + Discord-Portal handoff
- PR body: `Closes #148` per-line (Rule 6a), `## Tests` (Rule 15), required-secrets section
- Scope: 4 files, no `.squad/` staged, no worker code
- Baseline: `npm test` → 1041/1041 pass on `2655ad6`

## Self-trigger note

`worker/README.md` is under `worker/**`, so the merge commit WILL trigger this workflow's first run on `main`. Pre-secret-setup, the wrangler step fails red — expected, not a regression.

## Wishlist (defer)

- Pin test could explicitly assert `triggers.pull_request === undefined` as forward guard.


---

# Kirk — PR #154 review verdict

**Date:** 2026-06-02T04:18:00Z
**PR:** https://github.com/Jamula/stfc/pull/154 (`ci(discord): add command-handler workflow + routing script (#147)`)
**Author:** Scotty (commit by cyrusjamula)
**Commit reviewed:** `04d24f0`
**Verdict:** **APPROVE** ✅
**Posted:** https://github.com/Jamula/stfc/pull/154#issuecomment-4598682023

## Summary
Workflow + routing script match `kirk-discord-slash-arch` contract exactly. Script is security-clean: `execFile` (no shell injection), payload-derived strings never reach `gh` args, `ref`/`repo` sourced from GHA env (not payload), Discord PATCH errors don't leak Authorization header, token never logged. CI all-green; 12/12 tests pass locally. Docs updated per Rule 16. Rule 3 pin tests are comprehensive.

## Verified
- ✅ Trigger `repository_dispatch` types `[discord-command]` only (no push/schedule/workflow_dispatch)
- ✅ Permissions: `contents:read + actions:write` only
- ✅ Concurrency: `stfc-discord-handler` + `cancel-in-progress:false`
- ✅ SHA-pinned actions (checkout 34e1148, setup-node 49933ea)
- ✅ jq pre-check empirically rejects empty `command` (verified with `echo '{...}' | jq -e ...`)
- ✅ `execFile` only — no `exec` with string interpolation
- ✅ Immediate PATCH after dispatch — 15-min token window respected
- ✅ Discord 4xx/5xx → exit 1 with no header/token leakage
- ✅ `Closes #147` per-line; `## Tests` section present; docs updated

## Non-blocking nits (filed in PR, not blockers)
1. Add `allowed_mentions: { parse: [] }` to all PATCH bodies — prevents `@everyone` echo via unknown command (defense-in-depth past the dispatch trust boundary).
2. Add `.slice(0, 1900)` to `formatRedeemStatus` output — hardens against 2000-char PATCH ceiling if a future history line bloats.

## Next steps
- Reviewer-approved + CI-green → Rule 7 auto-merge applies. Coordinator may squash-merge without re-prompting.
- Remaining epic #143 work: #148 (deploy worker), #149 (operator runbook).


---

# Kirk re-verify verdict — PR #155 (operator runbook, epic #143 final piece)

**Date:** 2026-06-02T04:38Z
**Reviewer:** Kirk (Lead / Architect / Code Reviewer)
**PR:** https://github.com/Jamula/stfc/pull/155
**Fix commit:** `17702fc946d006e5d3b0039aa82908a666dd0302`
**Verdict:** **APPROVE ✅**
**Comment:** https://github.com/Jamula/stfc/pull/155#issuecomment-4598761402

## Findings re-verified

| # | Finding (prior CHANGES_REQUESTED) | Fix verified | Evidence |
|---|---|---|---|
| Blocker 1 | Wrong PAT scope (`Actions: write` → should be `Contents: write` for `repository_dispatch`) in `discord/RUNBOOK.md` (step A3 + troubleshooting row) and `worker/README.md` | ✅ | `discord/RUNBOOK.md:78` and `:255` show `Contents: Read and write`. `worker/README.md:131` shows `contents:write`. No residual `Actions: write` anywhere in either file. |
| Blocker 2 | Runbook jumped to `wrangler secret put` with no install/auth prereq | ✅ | New prereq block at lines 151–167: `npx wrangler --version` / `npx wrangler login` / `npx wrangler whoami`, with global-install alternative documented. Primary path is `npx wrangler` (no global install required). |
| Nit 3 | Step D verify list mentioned `GH_REPO` (a var, not a secret — won't appear in `wrangler secret list`) | ✅ | `GH_REPO` no longer appears in `discord/RUNBOOK.md`. Verify list correctly contains only `DISCORD_PUBLIC_KEY` and `GH_DISPATCH_TOKEN`. |
| Nit 4 | Typo "enforates" | ✅ | Zero matches in `discord/RUNBOOK.md`. Corrected to "enforces" in troubleshooting row 254. |
| Nit 5 | Malformed `[Rule 13a](...)` link in troubleshooting row 7 | ✅ | Link is `[Rule 13a](../.github/copilot-instructions.md#13-codespaces-operational-gotchas)`. Target exists (`.github/copilot-instructions.md` line 386 `## 13. Codespaces operational gotchas`; subsection `### 13a.` at line 388). |

## CI + PR hygiene

- `npm test` (worktree): 1067/1067 pass.
- `gh pr checks 155`: all required checks green (npm test 37s, CodeQL Analyze 1m18s, test 41s, test 43s).
- PR body has `Closes #149` on its own line (Rule 6a).
- PR body has `## Tests` heading with docs-only note (Rule 15).

## Epic #143 completion

This PR is the **final piece** of epic #143 (Discord slash command infrastructure, Option B / Cloudflare Workers bridge). Child issues shipped:

- #144 — `discord/commands.json` (single source of truth)
- #145 — `.github/workflows/discord-register-commands.yml`
- #146 / #151 — Cloudflare Worker (signature verifier + GH dispatch bridge)
- #147 — `.github/workflows/discord-command-handler.yml`
- #148 — `.github/workflows/deploy-cloudflare-worker.yml`
- #149 / #155 — `discord/RUNBOOK.md` (operator runbook)

End-to-end Discord slash command pipeline is operational pending Cyrus's live-secret setup (`gh secret set` from local terminal per Rule 21, then save the Interactions Endpoint URL in the Discord Developer Portal).

## Recommendation

Merge per Rule 7 (reviewer-approved + CI-green auto-merge). After merge:
- Close epic #143 with summary linking the 6 child PRs.
- Update `docs/squad.md` or `README.md` if the runbook needs surfacing (Tuvok to decide per Rule 16).


---

# Kirk — PR #155 review verdict

**Date:** 2026-06-02T04:31Z
**PR:** #155 — docs(discord): operator runbook for slash command setup
**Author:** Uhura
**Reviewer:** Kirk (technical accuracy)
**Verdict:** **CHANGES_REQUESTED ⚠️** → routed to **Scotty**

## Summary

Runbook is structurally complete and most of the technical content is correct
(architecture flow, secret-setting commands, workflow click-paths for Step C/F,
Discord Developer Portal click-paths, deploy job summary emission, credential
hygiene per Rule 21). Two blocking technical errors must be corrected before merge.

## Blocking issues

### B1. Wrong fine-grained PAT permission (Step A3 + Troubleshooting row 3)

- **Claimed:** `Actions: Read and write` + `Contents: Read only`
- **Correct:** `Contents: Read and write` (Metadata: Read-only auto-enforced)
- **Source:** https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-a-repository-dispatch-event
  — *"requires permission set: 'Contents' repository permissions (write)"*
- **Operator impact if not fixed:** Worker will hit `403 Resource not accessible by
  personal access token` on every `/trigger-redeem`, with no clear diagnostic.
- **Also fix in same PR:** `worker/README.md` lines 15 and 129 have the same wrong
  scope (`contents:read + actions:write`).

### B2. Missing prerequisite: wrangler CLI install + auth

- **Gap:** Step D uses `wrangler secret put …` but Section 2 never tells the
  operator to install or authenticate wrangler.
- **Operator impact if not fixed:** `wrangler: command not found` at first
  step that needs it, no clear remediation in the runbook.
- **Fix:** Add to Prerequisites:
  - `npm i -g wrangler` (or `npx wrangler`)
  - `wrangler login` (OAuth browser flow)
  - Verify with `wrangler whoami`

## Non-blocking

- Step D verify lists `GH_REPO` under `wrangler secret list` output, but `GH_REPO`
  is a **var** in `wrangler.toml`, not a secret — clarify or drop.
- Typo: "enforates" → "enforces" (Troubleshooting row 1).
- Malformed link in Troubleshooting row 7: `[Rule 13a](../../.github/.#/copilot-instructions.md#…)` — the `/.#/` segment is broken.

## Verified-correct claims (no changes needed)

- App ID `1505752454388514916`
- Architecture flow diagram (Discord → Worker → GH dispatch → handler workflow → PATCH)
- `gh secret set` / `gh secret list` syntax and `--repo Jamula/stfc` flag
- `default_member_permissions: "8"` = ADMINISTRATOR
- Deploy workflow emits `Deployed URL` in job summary (verified in
  `.github/workflows/deploy-cloudflare-worker.yml`)
- Discord PING/PONG handshake on Interactions Endpoint URL save
- Type-5 deferred response pattern matching "Bot is thinking…"
- Rotation cadence (90-day PAT, annual CF token)

## Routing

**Scotty** to apply B1 + B2 + the GH_REPO clarification (small turnaround, ~30 min).
Re-request Kirk review on push. No need for Garak co-review on the re-spin — these
are mechanical corrections against an authoritative source.

Once corrected, this ships epic #143 (Discord slash commands) end-to-end.

— Kirk


---

# Scotty decision note — PR #147 handler script boundary

Date: 2026-06-02
Owner: Scotty
Issue: #147

## Decision

Keep command routing and Discord follow-up behavior in `scripts/discord-handler.mjs`, and invoke `gh workflow run redeem.yml` from the same script for the `trigger-redeem` path.

## Why

- The workflow stays thin (checkout/setup/install/payload wiring) while command behavior remains testable in one unit-tested module.
- The script can emit an immediate run-id response required by Discord interaction token TTL constraints.
- Injected adapters (`runGh`, `readFileImpl`, `fetchImpl`) make command paths deterministic in unit tests.

## Trade-off

`actions: write` permission remains required for the workflow, and the script now owns the gh invocation contract. This is acceptable because the command routing contract is already script-centric and covered by tests.


---

# Scotty revision note — PR #150 reviewer-lockout fix

**Date:** 2026-06-02
**PR:** #150
**Issue:** #144
**Role:** Scotty (lockout reviser)

Implemented Garak's three blockers in one revision commit on `squad/144-commands-json`:

1. Tightened command `name` validation to lowercase-only Unicode letters via `^[-_\\p{Ll}\\p{N}]{1,32}$` and documented the Discord naming rule URL in the validator.
2. Added duplicate `(type,name)` detection after AJV validation (type defaults to `1`) and fail-fast error messaging with the duplicate pair.
3. Chose **Option A** for options handling: validator now rejects any command containing `options` with a clear "not yet supported" follow-up message.

Added tests in `tests/discord/commandsJson.test.ts` for uppercase-name rejection, duplicate `(type,name)` rejection, and options rejection. Verified:
- `node scripts/validate-discord-commands.mjs` passes for current `discord/commands.json`
- `npm test` passes
- `npm run typecheck` passes

Reviewer-lockout respected: Uhura made no revision contributions.


---

# Scotty revision complete — PR #151 (reviewer-lockout)

**Date:** 2026-06-02T03:59Z
**PR:** #151 — Cloudflare Worker Discord bridge
**Owner:** Scotty (sole reviser per reviewer-lockout)

## Decision

Implemented Garak's blocking hardening revision in `worker/src/index.ts` and expanded coverage in `worker/src/index.test.ts`.

### Code changes

- Added strict hex-shape validation helper (`isStrictHex`) for:
  - signature header: exact 64 bytes / 128 hex chars
  - Discord public key: exact 32 bytes / 64 hex chars
- Added lazy public-key configuration validation path with operator log (`DISCORD_PUBLIC_KEY misconfigured`) and explicit misconfiguration response (`500`).
- Wrapped `hexToBytes` + `ed.verifyAsync` in `try/catch`; all throws collapse to invalid signature (uniform 401).
- Added `ctx.waitUntil` dispatch observability:
  - warn on non-OK GitHub dispatch status (`gh dispatch failed: <status>`)
  - warn on thrown dispatch errors by name (`gh dispatch threw: <ErrorName>`)

### Tests added/updated

- odd-length signature hex → 401
- non-hex signature (length 128) → 401
- short signature → 401
- long signature → 401
- malformed `DISCORD_PUBLIC_KEY` → 500 misconfiguration path
- deferred Discord response remains type 5 when GitHub dispatch returns 5xx; warning logged
- existing parseable-but-invalid signature 401 test preserved

### Validation

- `cd worker && npm test` ✅ (14 tests)
- `cd worker && npm run typecheck` ✅
- repo root `npm test` ✅ (1019/1019)

### Coordination

- Commit pushed to `squad/146-cf-worker`: `c616289`
- Re-review requested on PR #151 via comment (Garak requested)


---

# Uhura PR #152 — discord-register-commands.yml arch note

**Date:** 2026-06-02T04:05Z
**PR:** #152 (issue #145)
**Author:** Uhura

## Non-obvious choice: guild vs global default

The workflow defaults `guild_id` to empty string, meaning **global** registration is the default when the operator doesn't fill in the input. This was an intentional choice: global registration is the "ship it" mode (all servers), while guild-scoped is the dev/test mode (single server, instant propagation).

Operators should use `guild_id` during initial testing to verify commands appear correctly before promoting to global. The `dry_run` input provides an additional safety valve.

**Alternative considered:** default to a sentinel `guild_id` (e.g. the main server ID) for safety. Rejected — the workflow description in the inputs already explains the propagation difference, and defaulting to global better matches the end-state operator intent.

## Non-obvious choice: App ID as env var (not secret)

`DISCORD_APP_ID: '1505752454388514916'` is set as a workflow-level env var, not a secret. Discord application IDs are public — they're embedded in OAuth URLs, invite links, and slash command registration URLs that users share. Storing it as a secret would add management overhead with no security benefit.

## Non-obvious choice: single combined step for curl + summary

The validate and register steps are separate jobs (validate exits 1 → workflow aborts before curl). The curl + response + summary reporting are combined in one bash step to keep `$HTTP_STATUS` and `$RESPONSE` in the same shell scope without needing step outputs. This is simpler than splitting across steps with `echo "http_status=$HTTP_STATUS" >> "$GITHUB_OUTPUT"`.
