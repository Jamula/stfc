# Picard — Lead / Code Review

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

> **Note:** Prior learnings (2026-05-08 through 2026-05-30) summarized in `history-archive.md`.

> Older learnings archived to history-archive.md. See archive for context.

## 2026-05-31T22:13:00Z — Plan v2: 005-web-control-panel (scope/governance review)

**Verdict:** APPROVE WITH CHANGES. Plan is materially hardened over v1 (good rubber-duck integration), but scope is too aggressive, routing violates a standing decision, the constitution amendment is under-scoped for the surface area being added, and the timing collides with in-flight 004 v2 work that has overlapping infrastructure.

**Top findings (8):**

1. **Cut Phase 7 (chat write tools) entirely; defer Phase 5 (refresh-token via web) and Phase 6 (RAG/chat) to a v2 control panel.** Phase 7's risk-to-reward is poor (a chat-dispatched workflow vs a button click is the same UX win at a much larger attack surface). Phase 5 duplicates working operator flow (`scripts/capture-token.mjs`). Phase 6's RAG pipeline DIRECTLY overlaps 004-crew-optimizer v2 issue #93 ("Knowledge-base embedding pipeline") — two embedders in flight is duplicated infra. Ship Phases 0–4 + a Phase-8-lite (audit + kill-switches scoped to what's shipped) as v1.

2. **Routing violation: workflow edits assigned to Uhura, but Rule (routing.md, 2026-05-18) says O'Brien owns ALL `.github/workflows/*.yml`.** Re-route Phase 3/4/5 workflow extensions (redeem.yml, discord-monitor.yml, refresh-token.yml) and SWA deployment workflow + `staticwebapp.config.json` to O'Brien. CSRF/idempotency middleware is not integration-specific — re-route to Scotty.

3. **Uhura is overloaded (~13 issues); O'Brien is under-loaded (~4 issues).** Re-balance per #2 above. Target: ~7 Uhura, ~9 O'Brien, ~12 Scotty.

4. **Constitution amendment is materially under-scoped.** Phase 0 lists outbound destinations, durable artifacts, and re-sync — but MISSES: (a) GitHub App as a new sanctioned secret + new sanctioned dispatcher of workflows (Principle V, two-writer custody analog); (b) Azure SWA + Functions as a new RUNTIME surface, which is a Principle IV ("Type-Safe Headless TypeScript CLI") carve-out — analogous to the v1.5 ops-script carve-out and needs the same explicit subsection; (c) `correlation_id` as a new workflow-input + run-name + result-artifact obligation (Principle VII or new sub-principle); (d) chat as a new UNTRUSTED-INPUT surface that can influence dispatch — that's a Principle I addendum; (e) explicit "no STFC/Discord secrets ever cross into SWA" assertion. This is a **MAJOR (2.0.0)** amendment, not MINOR. Tuvok should draft.

5. **Speckit-chain shape: bundle the v2.0.0 amendment WITH the speckit pipeline in one PR**, per the 004-crew-optimizer precedent (commit `c6432d9`: "P0–P5 spec pipeline + v1 constitution amendment"). Plan currently treats them as two separate issues in Phase 0 — that risks an amendment shipping that references speckit artifacts not yet in the tree. Also: Phase 0 underspecifies the speckit artifacts. Enumerate `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, per the established `004-crew-optimizer/` shape.

6. **43 issues is borderline-overwhelming.** Realistic target is ~25 by batching: Phase 1's frontend shell + /api/data + digests-unignore can be 2 issues, not 6. Phase 3's workflow-extend + result-artifact can be 1. Phase 8's audit + cost + runbook + docs can be 2.

7. **Per-phase reviewer-gate matrix is missing.** Plan only states Phase 0 acceptance (Picard + Garak). Per Rules 9 and 12, EVERY phase touching `src/` needs Kirk + Garak + Picard (+ Bashir if coverage). Add a reviewer-gate column to the per-phase test+doc summary table. Phases 6 and 7 (chat) MUST have Garak adversarial review on prompt-injection corpus as a hard gate — currently mentioned but not gated.

8. **Standing rules: trim from 5 to 2.** Rules 2 (test scope per phase) and 3 (docs on capability change) duplicate constitutional Principles IX and VII respectively — don't duplicate, just reference. Rule 5 (fleet mode + worktrees) is config in `.squad/config.json`, not a rule. Keep Rule 1 (gh-issues-driven) and Rule 4 (rubber-duck on multi-phase plans) — both genuinely new, both belong in `.github/copilot-instructions.md` as Rules 14–15, NOT the constitution. Also: "rubber-duck agent" isn't a roster member. Either name the existing agent (Garak does hostile fact-check; this is adjacent) or onboard the new role explicitly via team.md.

**Priority finding (8):** 004-crew-optimizer v1 is still mid-ship (PR #101 open). I owe POC gate decision on #86 that gates ~8 v1.5 issues. v2 has 4 queued issues including #93 (knowledge embeddings) which COLLIDES with this plan's Phase 6. Recommendation: **sequence Phase 0 (governance) in parallel with finishing 004; defer Phases 1+ until 004 v1 ships and the POC gate clears.** This keeps the speckit pipeline moving without doubling squad load.

**What needs to change before APPROVE upgrades to clean APPROVE:**
- Cut Phase 7; defer Phases 5 and 6 to a stated future v2.
- Re-route workflow YAML edits and SWA config to O'Brien.
- Tuvok drafts the v2.0.0 (MAJOR) amendment covering the five missing items in finding 4.
- Bundle amendment + speckit pipeline in one PR (Phase 0).
- Add reviewer-gate matrix per phase; Garak adversarial corpus is a hard gate on chat phases.
- Trim standing rules to 2 (Rules 14–15 in copilot-instructions.md, not constitution).
- Batch issues to ~25 total.
- Sequence: Phase 0 in parallel with 004 wrap; Phases 1+ start after 004 v1 + POC gate.

**Not in my lane (defer to Kirk / Garak):** architecture choice (Lit+Vite vs React), CSRF/idempotency/correlation-id design, SWA-vs-alternative hosting, RAG embedder selection, claims-vs-repo fact-check. Coordinator should route to Kirk and Garak for those.

## 2026-05-31T19:50:00Z — Issue #77: crew-optimizer speckit pipeline + v1 constitution amendment (PR #97)

**Verdict:** SHIPPED to reviewer gate. PR #97 opened with `Closes #77`. Constitution bumped v1.5.0 → v1.6.0 (MINOR).

**Phases completed (Rule 5 phase-boundary commits):**

- Phase 0 — `spec.md` (T001) — 6 user stories, 26 FRs, pre-resolved Q1/Q2/Q3/Q4/Q5 baked in inline.
- Phase 1 — clarify — encoded inline; no separate commit needed.
- Phase 2 — `plan.md` + `research.md` + `data-model.md` + `quickstart.md` + 4 contract docs (T002–T007).
- Phase 3 — v1 amendment + Tuvok editorial + Rule 1 plan-template re-sync (T008–T010).
- Phase 4 — `speckit.analyze` cross-artifact sweep, fixed issue cross-refs against live board (T011).
- Phase 5 — `tasks.md` (T012–T013).

**Final SIR "Templates needing re-sync" line (Rule 1 grep, verbatim):**

```
$ grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml' .specify/templates/*.md
.specify/templates/plan-template.md:44   (UPDATED in this PR — Principle V cell now references v1.6.0)
```

## Learnings (2026-05-31)

### Constitution-amendment pinning-test collision (new failure mode)

`tests/constitution/discord-ops-carveout.test.ts` reads the constitution via `indexOf("scripts/discord-ops/")` and asserts a ±1500-char window contains the carve-out body text. My v1.6.0 SIR mentioned `scripts/discord-ops/` literally in a "carve-out unchanged" closing sentence — that became the first hit, and the ±1500 window stopped short of the actual carve-out body. Pre-commit hook tripped.

**Fix:** rephrase the SIR to reference the carve-out by its subsection title ("Operator-Only One-Shot Ops Scripts") rather than the literal path. Test passes; semantics preserved.

**Pattern (to memorialise in `speckit-pipeline-driver` SKILL):** before writing a new SIR, scan `tests/constitution/*.test.ts` for any `indexOf(literal)`-style assertion and avoid those literals in the SIR.

### Issue cross-reference audit is mandatory in Phase 4

I drafted spec/plan with issue numbers derived from the source plan's draft `#1..#19` numbering. The live board's actual numbers are `#77..#95`. The off-by-N matters: "issue #79" in my draft meant the OCR POC, but #79 on the board is the engine implementation. Phase 4 caught this via:

```bash
gh issue list --state all --search 'crew-plan-id in:body' --json number,title --limit 30
```

**Lesson:** the `speckit.analyze` phase MUST include a live-board lookup, not just internal cross-ref check. Encoded in `.squad/skills/speckit-pipeline-driver/SKILL.md`.

### Pre-resolved clarify answers encode inline; no separate commit needed

Phase 1 (`speckit.clarify`) is a no-op file-wise when the Coordinator's dispatch has already locked the answers (Q3 roster privacy pre-decided; Q1/Q2/Q4/Q5 recommended in the source plan). Bake the answers into spec.md FRs with `(Clarified Qn.)` annotations. Saves a commit and avoids a stub `clarify.md` artifact.

### Constitution version footer lives in two places

`.specify/memory/constitution.md` carries `**Version:** X.Y.Z` near the top of the principles section AND `**Version**: X.Y.Z | **Ratified**: ... | **Last Amended**: ...` as the final line. Both MUST be bumped or the SIR is inconsistent with the body.

### Don't bundle v1.5 / v2 amendments with v1

Each phase's amendment is independent. Filing them as separate PRs (issues #87 v1.5, #93/#94 v2) means each ships with its own Rule 1 re-sync grep, its own Tuvok editorial pass, and its own reviewer-gate cycle. Bundling them would force a multi-version SIR that's harder to review and harder to revert if a later phase is dropped.

### Skill extracted

New skill at `.squad/skills/speckit-pipeline-driver/SKILL.md` codifying the phase-boundary commit pattern + the Phase 4 live-board lookup + the SIR-vs-pinning-test collision avoidance + the dual version footer.

- Phase 0 shipped (PR #111, 988c302..aeef1b5)

## 2026-06-01T01:22:44Z — P1 fanout triage (005-web-control-panel Phase 1)

**Context:** Ralph cycle requested a WIP audit + wave-3-close-out + wave-4-fanout plan for the stfc-p1 worktree.

### P1 epic structure (005-web-control-panel Phase 1)

- **Epic branch:** `squad/005-phase1-dashboard`; worktree at `/workspaces/stfc-p1`
- **Wave cadence:** Wave 1 (O'Brien infra) → Wave 2 (O'Brien scaffold) → Wave 3 (auth + frontend + contracts + github-raw) → Wave 4 (invitation runbook + data endpoints)
- **Phase 0 shipped to main** via PR #111 (constitution v2.0.0, spec, contracts, threat model, rules 14–18)
- **All Phase 1 work accumulates on epic branch first** then merges to main in one PR when Wave 3+4 are done

### Key ownership patterns for this epic

- **O'Brien** owns all `.github/workflows/*.yml`, `staticwebapp.config.json`, `scripts/azure/`, SWA-related docs
- **Uhura** owns `api/src/_lib/auth.ts`, auth CI gate, auth docs sections
- **Scotty** owns `web/src/`, `api/_lib/github-raw.ts`, `shared/`, bundle budget gate, data endpoints
- **`tests/index.test.ts`** is the master test barrel — only ONE issue should touch it per wave to avoid merge conflicts. Typically the last issue in the wave to commit.
- **`docs/SWA-SETUP.md`** is cross-cutting between Uhura (#117 auth) and O'Brien (#118 invitation). Always serialize: auth section first, invitation section second.

### Plan.md placeholder risk

`specs/005-web-control-panel/plan.md` is a placeholder pointing to session-state. The binding v3 plan lives in session state `d40435a0-d735-463b-887e-e5f586f7369b/plan.md`. If session state is lost, the plan is gone. Flag Tuvok or O'Brien to migrate it into the repo as a doc issue.

### Skill extracted

New skill at `.squad/skills/audit-wip-fanout/SKILL.md` codifying the "audit uncommitted WIP → map to issues → wave-close-out + fanout plan" pattern.

## 2026-06-01T02:22:04Z — Squad improve cycle delivery: Rules 22, 23, worktree-preflight skill

Ran full improve cycle analyzing friction patterns from 2026-05-31 → 2026-06-01. Proposed 2 new rules (Rule 22: worktree npm ci preflight; Rule 23: plan.md durability in repo, not session-state) and 1 new skill (worktree-preflight ritual codification). No amendments to Rules 1–21 — existing rule set is sound. Delivered as DRAFT proposal in decisions/inbox/ awaiting user approval before Tuvok implementation. Also flagged 6 findings on cleanup-plan v3 (Rule 21 misclassification, Scribe dry-run gate, history schema, reviewer lanes, charter trim, panel composition).

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE

- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01T04:57Z — Backlog-wide triage + worktree fan-out plan (Ralph Round 5)

**Context:** Cyrus requested squad-wide triage with worktree fan-out planning after PR #128 cleanup + PR #124 Phase 1 close-out. 12 open issues across crew[v2], crew[v1.5], Phase 1 epic, and Discord ingest.

**Verdict:** Hold autonomous dispatch. 0 of 12 issues are immediately dispatchable. PR #129 (issue #92) is green and imminent; the moment it merges, #93 unblocks as the lead Batch 2 dispatch (Uhura+Scotty in `/workspaces/stfc-93`).

**Triage memo:** `.squad/decisions/inbox/picard-backlog-triage-2026-06-01.md`

### Learnings

- **Backlog-triage cadence: live-verify every dependency assertion via `gh issue view` before classifying.** Issue bodies cite dependencies by issue number; those dependencies may have closed since the body was written. On this pass: #91, #84, #74 were all CLOSED, confirming the in-body blocker chains. Never trust a static body — always cross-check with `gh issue view N --json state,closedAt`. (Applied `dispatch-precheck` skill at triage scale, not just at dispatch.)
- **≤4 concurrent worktrees is operational sanity.** Beyond 4, `git worktree list` becomes cognitively expensive, `.squad/` sweep per Rule 8 risks artifacts dropping, and CI parallelism on the runner pool degrades. Codify in `audit-wip-fanout` skill: never propose more new worktrees than (4 − currently-active). On this pass: 3 active (main + stfc-76 frozen + stfc-92 in PR) → can propose ≤1 new worktree in Batch 2 (stfc-93), and Batch 3 requires waiting for stfc-92 to retire (PR #129 merge) before adding stfc-94.
- **Fan-out batches are gated by dependencies, not by parallelism opportunity.** I'd rather propose 1 worktree NOW (after a gate clears) than 3 worktrees that all need to wait. Batches 2/3/4 sequenced by PR-open events, not by clock.
- **`tests/index.test.ts` is the single most common cross-worktree conflict source.** When two parallel implementer pairs touch separate `src/` modules but both must register tests, the master barrel becomes the merge point. Codified serialization rule: second PR in the wave rebases over first. (Already encoded in `audit-wip-fanout`; reaffirmed.)
- **Rule 21 ASK-USER asks are batchable.** When the backlog has 2+ external blockers that need different user actions (#127 Azure secrets + #85 screenshots), surface BOTH in a single user round-trip — don't serialize, don't make the user wait through one before learning about the other. Independent unblockers fire in parallel.
- **Frozen worktrees are a legitimate state.** `/workspaces/stfc-76` has been blocked since 2026-05-31 on guild access. Removing it loses the draft PR #96 context for free re-attachment when access opens. Document as "frozen by design" in triage memos so future Picard / Ralph rounds don't auto-prune.
- **Pre-flight: cite the skill in the spawn prompt, don't just rely on the agent to remember it.** Batch 2/3/6 spawn instructions explicitly name `worktree-preflight` so the implementer runs `npm ci` immediately after `git worktree add`. Reduces Rule 22 violations to zero.

## 2026-06-01T05:16Z — PR #130 scope/governance review (issue #93 crew v2 knowledge)

**Verdict:** APPROVE. All 7 gates passed (scope match, no creep, governance, #94 readiness, Rules 12/15/16).

**Comment:** https://github.com/Jamula/stfc/pull/130#issuecomment-4589760515

### Key findings / learnings

- **HF carve-out scope and the "default vs opt-in" embedder pattern.** Scotty shipped a pluggable
  `Embedder` interface with `createHashedEmbedder()` (deterministic on-runner SHA-256 feature
  hashing, no network) as the default AND `createMiniLMEmbedder` (real `Xenova/all-MiniLM-L6-v2`)
  as opt-in via `STFC_KNOWLEDGE_MODEL=minilm`. Because the committed artifact's `model` field is
  `hashed-bow-v1` and the runtime never sets the env var, the MiniLM path is dead-code under
  default config — so the existing HF carve-out (classifier-only, line 1262–1265) is not
  extended by this PR. **Pattern to remember:** when an implementer plumbs a network-egress
  fallback behind an env-var gate AND keeps the default offline, the carve-out does NOT need
  amendment until the default flips. Codify in `speckit-pipeline-driver` SKILL — saves a
  Tuvok round-trip on every "should we amend the constitution?" question.
- **Rule 16 deferral precedent stacking.** PR #129 (#92 handlers) deferred docs to #95; PR #130
  (#93 knowledge) cited that precedent and deferred again. Cumulative deferral risk: by the time
  #95 lands, Tuvok will need to document THREE concurrent surface additions (parser, 8 handlers,
  knowledge handler) in one PR. Flag for Tuvok's #95 dispatch: pre-stage the docs outline before
  asking for the writing time, since the surface is now known and stable.
- **Stacked-dependency confirmation: cite the file paths, not just the issue numbers.** Used
  `gh pr view 130 --json files` and `grep -n` to confirm `package.json` line 20 has the
  `crew:knowledge:rebuild` script and the artifact JSON header has `{model, chunkerVersion,
  sourcesHash, generatedAt}` — exactly what #94's acceptance criteria need to wrap in a
  workflow. Cite the concrete artifacts so O'Brien doesn't have to re-discover them.
- **Constitution question routing via inbox, not via the PR.** Scotty filed the HF carve-out
  question at `.squad/decisions/inbox/scotty-issue-93-constitution-q.md` instead of asking in
  the PR description. This is the right shape: PRs ship with disposable context, but the
  decision-inbox is durable and addressed to a specific role (Tuvok). I added a Picard
  follow-up note (`picard-pr130-hf-carveout-followup.md`) routing the recommendation to
  Tuvok with prior art for option (A). Don't bundle governance follow-ups into PR comments
  — they get lost when the PR merges.
- **The "optimize fail" red is a real noise source.** Every v2 PR will show this red until
  #131 is fixed by O'Brien. When future reviewers see it, they MUST verify it's the same
  pre-existing workflow bug, not a new regression — check `gh pr checks 130 | grep '^optimize'`
  and confirm the job URL is the optimize-crew workflow throwing on a non-Scotty-related path.

### Skill extraction candidate

The pattern "default-offline + opt-in-network embedder = no carve-out amendment needed"
is reusable beyond knowledge retrieval (think: future on-device LLMs, OCR upgrades,
fingerprinting). Worth a one-line entry in `speckit-pipeline-driver` SKILL under
"governance shortcuts."

## 2026-06-01 — Multi-PR scope/governance review + backlog triage: PRs #129–#132; 12 open issues

**PR #129 (crew[v2] read-only handlers):** No constitution amendment required (handlers in sanctioned src/crew/** namespace); PR body uses per-line `Closes #92` format (Rule 12); no new outbound destinations. ✅ APPROVE.

**PR #130 (crew[v2] knowledge embedding + handler):** No amendment needed (hashed embedder, no network); MiniLM carveout deferred to future ticket (routed to Tuvok). ✅ APPROVE.

**PR #132 (knowledge-rebuild workflow + Rule 3 pinning tests):** No governance impact; O'Brien's workflow pin tests per Rule 3 verified. ✅ APPROVE.

**Backlog triage (04:57Z):** 12 open issues classified; 0 immediately dispatchable; PR #129 MERGED unblocks #93; user-action gates on #127 (Azure secrets, Rule 21), #85 (20 screenshots), #76 (guild access); Batch 2–8 fan-out plan queued with ≤4 concurrent worktree cap. Recommendation: hold autonomous; ask user on #127/#85/#76; dispatch #93 when ready.

**Smooth cycle:** All PRs merged 05:43–05:46Z. Decisions inbox merged. Ready for Batch 2.

