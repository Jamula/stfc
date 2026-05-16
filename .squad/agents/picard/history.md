# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.1.0 → v1.2.0 Amendment Cycle (2026-05-08 → 2026-05-09)

**Cycle Summary:**
- **v1.1.0 proposal:** Incorporated Phase 1 briefing feedback from Scotty (trigger threshold, checkpoints), Uhura (artifact hygiene), Bashir (test-first gates), Borg Queen (prerequisites).
- **Blocking defect found:** Principle IV/IX contradiction (Principle IV claims "no automated test suite" while Principle IX mandates tests). Fixed by amending Principle IV rationale to acknowledge Principle IX requirement.
- **v1.2.0 assembly:** Parallel lanes coordinated—Uhura built artifact hygiene scanner, Scotty built npm test gate, Bashir built test-first reviewer gates.
- **Verification cycle:** Borg Queen performed 4 passes; v1.2.0 ratified with Path D acceptance (Known Tensions documented).

**Critical Lesson Learned:** Critique framing matters. "Verify my concerns are defused" (too narrow) vs. "Does every concrete claim match the repository?" (broader, catches inherited baseline overclaims). Full-document verification against live repo code is the distinguishing factor between real governance and hollow process.

**Post-Ratification Roadmap:**
- **Blocking (pre-first-speckit-merge):** Artifact hygiene CI gate (Uhura) + smoke-test runbook (WHO/WHEN/HOW).
- **Within 30 days:** Scope-assessment rubric for "scope creep" gate; adoption meter script for 50% annual review.
- **v1.3.0 cycle:** Resolve 3 Known Tensions (Principle III/IX/VII accuracy issues).

**Status:** v1.2.0 ratified and operational. Constitution is now the source of truth for governance in stfc-gift-redeemer.

---

### Plan review gate — 001-discord-monitor (2026-05-13)

**Architecture confirmed:**
- The "only `src/cli.ts` calls `process.exit`" invariant is real and verifiable (`src/cli.ts:1`, `src/cli.ts:108`, `src/cli.ts:111`). Any new skill that needs to be callable from another skill MUST be invoked as a function import — never spawned as a subprocess and never routed back through `src/cli.ts`. This is the load-bearing rule that makes the in-process redeemer seam clean rather than coupled.
- Existing skill contract: every skill in `src/skills/` returns `{ result, exitCode }` (see `RedeemCodesOutput` at `src/skills/redeemCodes.ts:33-38`). New skills MUST follow this shape. Exit code 1 is reserved for *infrastructure-class* failures only; per-source failures (auth fail on one channel, one account, one code) return 0 with the failure surfaced in the result/health payload.
- Concurrency safety on `main` is enforced by a *string-equal* `concurrency.group` across every workflow that does `git push`. The group string is `stfc-gift-redeemer` (`.github/workflows/redeem.yml:31`). Any new workflow that writes to the repo MUST use this exact string — the shared group is the only thing preventing `git push` collisions.
- Typed-error / zod-validated upstream client posture (`src/api/client.ts`) is the codebase's house style for ANY external HTTP. New API clients should mirror it: named error classes per status class, zod-validated responses, GET-only retry, `AbortSignal` timeouts, redaction on every error path that may surface a credential.
- Additive-arg seam pattern: when extending an existing function for a new caller, prefer ONE optional named arg with deterministic order semantics (`loadPromoCodes({ extraCandidates })`) over a new public function or a new module. This kept the redeemer-Discord seam to two function signatures touched, total.

**Constitution principles I challenged but upheld:**
- Principle V's literal enumeration of "secrets" and "durable inputs" was originally written tightly bound to STFC-only surfaces. A new feature that adds a third-party credential or new committed durable inputs REQUIRES a v1.x.0 amendment — it cannot be smuggled in under "Complexity Tracking." This pattern will repeat: any future skill that adds a new outbound destination, a new credential, or new committed state files must follow the same amend-first-then-implement ordering.
- Bundling a constitutional amendment with the first feature PR (Option 2) is tempting but wrong. Amendment PRs need their own reviewer set (Borg Queen for claim verification, Tuvok for process audit) and their own rollback semantics, separate from feature code review.

**Reviewer process patterns confirmed:**
- The "name a different agent on rejection" lockout rule is real (`.specify/memory/constitution.md` Speckit Reviewer Gates section); applies even when not invoked.
- Plan review gate scope is narrow: architecture + dep audit + Constitution Check completeness + (when present) amendment ordering decision. NOT a code review, NOT a spec re-review.
- Hostile verification of every concrete claim against the live repo is delegated to Borg Queen — Picard's gate is architecture and governance ordering, not file-level claim audit.

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*

---

### Plan review gate ROUND 2 — 001-discord-monitor (2026-05-13)

**What changed in round 2:**
- Tuvok applied 13 surgical edits per Borg Queen's BLOCKING findings; verified all P0/P1 corrections landed cleanly across `plan.md`, `research.md`, `contracts/redeemer-integration.contract.md`. Round-2 verdict: APPROVE WITH CONDITIONS (8 conditions, 3 of them new from Tuvok's amendment audit).
- The new amendment-audit P0s (Sync Impact Report missing per-principle summary; `plan-template.md` re-sync omitted; v1.3.0 inheriting unaddressed Known Tensions and TODO(V1.3) items from v1.2.0) reframe the amendment PR's scope — they don't change the LAND-AMENDMENT-FIRST decision, but they mean the amendment PR is *bigger* than just the six § V/security edits.
- Original architecture verdict unchanged: corrections are factual / cosmetic / cross-reference, not structural.

**Patterns about correction-verification I want to remember:**
- **Verify by zero-grep.** Best signal that a numeric/string correction landed cleanly is a `grep -n` for the OLD value across the affected directory returning zero hits. Did this for `\b42\b`, `loadPromoCodes`, `six new`, `same.*cadence`. Cheap, exhaustive, catches stale cross-references the corrector might have missed.
- **The "3 MB" residue case.** The corrected install-size sentence still contains the substring "3 MB" — but as "transitive deps ~3 MB" inside the new "7.2 MB" sentence. A naive grep flags it; reading the surrounding line clears it. Lesson: when the corrected value contains the old value as a substring, sanity-check the hit in context before declaring an UNRESOLVED.
- **Corrections do not extinguish round-1 conditions.** Most r1 conditions (license verification, test-before-extractor, branch-protection callout in quickstart, rerun/cursor edge case) were forward obligations on different agents — Tuvok's correction pass was scoped to plan/research factual fixes. Carry conditions forward by default; only mark RESOLVED when the specific artifact change satisfies them.
- **Adjacent-audit findings can attach to the same gate.** Tuvok's amendment audit ran in parallel to his correction pass and produced three P0s the plan does not yet reflect. These belong to the v1.3.0 amendment PR scope, not the feature plan — but they were surfaced in time to be made round-2 conditions, which keeps the amendment PR honest before it opens.
- **Acknowledged-assumptions sections are powerful.** Borg Queen's five "unstated assumptions" became a named § "Acknowledged assumptions" in `plan.md` with explicit failure modes and an implementer obligation to revisit each. This converts informal hostile-review notes into permanent plan-document obligations — worth replicating on future gates.

---

### Plan review gate ROUND 3 — 001-discord-monitor (2026-05-13)

**What changed in round 3:**
- Tuvok's single-line cascade fix at plan.md:377 (test-strategy table now names TNG/GQ5/GQ7 as expected non-matches) verified clean.
- Bashir's freshly-generated tasks.md absorbs r1/r2 carry-forward conditions into concrete task IDs (T000 governance gate with three Tuvok-audit P0s, T013 extractor test-first with TNG/GQ5/GQ7 expected failures, T037 quickstart branch-protection callout, T038 rerun/cursor edge-case doc, Phase-1 license verification task).
- Five of eight r2 conditions transition from "forward obligation" to "tracked task with acceptance criteria"; three remain amendment-PR-only conditions exactly as r2 framed them.
- Round-3 verdict: APPROVE WITH CONDITIONS — same shape as r2, narrower surface.

## Learnings

**Lightweight round-N re-verification pattern (when prior rounds did the heavy lifting):**

When rounds 1 and 2 have already done the architecture review, hostile fact-check, correction verification, and condition enumeration, round-N collapses to three cheap checks — and trying to re-do the prior rounds' work is wasted effort and risks introducing new opinion drift. The pattern:

1. **Targeted cascade-fix verification.** When the prior round identified a single cascade miss and a single-line fix was applied, verify just that one location with a literal-quote view + a zero-grep for the old wording. Do not re-verify all prior corrections — that was r2's job and re-verifying invites finding new things to "improve" that aren't actually broken.

2. **Re-verify conditions as a status table, not as fresh analysis.** Walk the r2 conditions list in order. For each, ask only: "did a downstream artifact (typically tasks.md) absorb this, or does it remain open?" Three buckets: (a) ADDRESSED BY tasks.md (now a tracked task with acceptance criteria — close at the implementation-time gate); (b) OPEN as amendment-PR condition (unchanged from r2); (c) NEW SUB-CONDITION (rare — only when downstream artifact partially covers an r2 condition and a small gap is now visible). Resist the urge to re-derive conditions from scratch.

3. **Delta-check, not re-review.** For artifacts not edited since r2 (research.md, contracts/, redeem.yml in this case), state "unchanged since r2 verification" and move on. Mtime + targeted grep on the load-bearing strings (concurrency group, cron expressions, function names) is sufficient. A full re-read is wrong-effort for a re-verification gate.

**Anti-patterns to avoid in round-N:**
- Re-running Borg Queen's hostile fact-check yourself. That's her job; if she didn't run again, the plan didn't change enough to require it.
- Inventing new conditions from a fresh read. New conditions in round-N must point to a *new* artifact change or a *new* gap discovered while verifying an r2 condition. Random new opinions are scope creep and erode reviewer credibility round-over-round.
- Deep-reviewing a sibling artifact (here: tasks.md) when another agent owns it. High-level sanity-check only; flag obvious problems for the owner; don't deep-review.

**Tasks-absorption signal:** the strongest evidence an implementation-time condition is well-handled is when it shows up in tasks.md with (a) a stable task ID, (b) explicit acceptance criteria, and (c) a placement in the dependency graph that enforces the right ordering (test-first, governance-first, etc.). When all three hold, the condition can move from "carry forward as risk" to "tracked work item, will close on merge of that task."

**One sub-condition I added in r3 (illustrating the legitimate case for new conditions):** while verifying r2 condition #7 (SIR explicit disposition of 3 Known Tensions + 2 TODO(V1.3) items), I noticed tasks.md T000 covers the three Known Tensions but not the two TODO(V1.3) items (helper-script redaction, SHA-pinning). This is a real downstream gap surfaced *by the verification* — added as a sub-condition on Picard's amendment-PR drafting, not as a new general condition. Legitimate scope.

---

### Constitution v1.3.0 — Active & Unblocking 001-discord-monitor (2026-05-15)

**Status:** v1.3.0 is now the active constitution (PR #6 merged). Principle V enumeration expanded for `DISCORD_BOT_TOKEN`, 6 new durable inputs (Discord monitor state/data files), `data/digests/**` artifact tree. Security & Compliance extended for `discord.com/api/v10`, `huggingface.co` outbound. No principles removed; no obligations narrowed. Amendment classified MINOR per correct precedent.

**Key Learnings for Future Amendments:**

- **Enumeration-expansion pattern for new credentials/durable-inputs/outbound destinations:** The v1.3.0 amendment is the template. Any future feature that adds a new third-party credential, new committed state files, or new external API call site MUST follow this same amendment-first-then-implement sequence. Do not try to bundle the amendment with the feature PR — the amendment needs its own review surface (Borg Queen for claim verification, Tuvok for process audit) and its own decision record.

- **Governance model shifts are material and must be named:** The move from "enumerated closed list of secrets" → "enumerated list + open-ended category (any third-party API credential)" is a deliberate governance-model change in v1.3.0. It was acknowledged explicitly in the Sync Impact Report, not silently absorbed. Name the shift in the amendment document so future readers know what happened.

- **Sync Impact Report is the delivery vehicle for amendment shape & dependencies:** The SIR (Sync Impact Report) must include (a) per-principle REVISED/KEPT/EXTENDED summary, (b) templates-affected enumeration with status, (c) follow-ups section for Known Tensions & TODO items, and (d) explicit acknowledgment of any governance-model shifts. Omitting any of these creates a "partial amendment" that looks complete to code review but is incomplete as a constitutional document.

- **Amendment P0s (from Tuvok's process audit) become hard blockers on the amendment PR itself:** The three P0-level findings from Tuvok's amendment audit (SIR per-principle field, `plan-template.md` re-sync, Known-Tensions disposition) were addressed before the amendment PR opened — they were encoded as acceptance criteria in T000 governance task. This pattern will repeat: if Tuvok surfaces P0s in a future amendment audit, do not open the PR until they are resolved.

---

### BLOCKER Resolution — 001-discord-monitor analyze (2026-05-16)

**Pattern: Constitution-led vs Plan-led BLOCKER resolution.**

When /speckit.analyze surfaces a BLOCKER (artifact inconsistency), there are two resolution paths:
- **Constitution-led (Option A):** Preserve the constitution's wording; amend the plan/contracts/data-model to match.
- **Plan-led (Option B):** Amend the constitution to match the plan's design.

**Decisions on 001-discord-monitor BLOCKERs:**

1. **BLOCKER #1 (suppression.json writer mismatch):** Chose **Option A** — split into operator-written `suppression.json` + skill-written `cooldowns.json`. Reasoning: Preserves Principle V's bright-line separation between policy (operator) and telemetry (skill). The cost is one additional enumeration entry in constitution v1.3.0, which is minimal.

2. **BLOCKER #2 (digest module path mismatch):** Chose **Option A** — moved digest writer from `src/discord/digest.ts` to `src/digest/index.ts`. Reasoning: Matches constitution exactly; the digest is conceptually downstream of Discord (it summarizes redemption activity too), so it belongs in its own module.

**Heuristic for future BLOCKERs:** When the plan's design is logically sound but contradicts the constitution's literal text, prefer the constitution-led fix (Option A) unless the constitution's wording reflects a genuine oversight. This preserves the governance invariant that Principle VI ("Constitution wins") actually means something.
