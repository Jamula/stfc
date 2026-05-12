# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Spec Kit & SDD (2026-05-08)

**What it is:** Spec-Driven Development inverts code-first thinking—specifications become the executable source of truth via a spec → plan → tasks → implement loop. Spec Kit is the GitHub open-source toolkit that operationalizes SDD. The constitution is the meta-spec that governs all downstream artifacts; violation requires amendment with explicit team consensus.

**The workflow:** /speckit.specify (requirements) → /speckit.clarify (ambiguity resolution) → /speckit.plan (tech + architecture) → /speckit.tasks (task breakdown) → /speckit.implement (code generation) → /speckit.checklist (acceptance) → /speckit.analyze (consistency). Git hooks auto-commit at each phase. Teams adopt selectively; once adopted, adherence is enforced.

**Current constitution alignment:** The constitution already gates Spec Kit adoption via the "Spec-driven changes" rule: non-trivial features MUST use Spec Kit; trivial fixes (typos, docs, bumps) are exempt. The constitution is versioned (semantic); amendments trigger a Sync Impact Report that lists affected templates and documents needing updates.

**Key project files:**
- `.specify/memory/constitution.md` — Current v1.0.0 (ratified 2026-05-08); already embeds Spec Kit adoption.
- `.specify/templates/{spec,plan,tasks,checklist}-template.md` — Provide structure for each phase artifact.
- `.specify/integrations/speckit.manifest.json` — Tracks Spec Kit installation (v0.8.8.dev0).
- `.specify/extensions.yml` — Pre-configures git hooks to auto-commit at each phase.
- `.specify/workflows/speckit/workflow.yml` — Defines full SDD cycle with review gates.

**Implications for stfc-gift-redeemer:**
- Spec Kit clearly helps: new redemption features, significant refactors, integrations. Forces clarity on acceptance criteria before code.
- Spec Kit overkill for: typos, docs, routine bumps (already exempt). Hotfixes to unblock runs can skip Spec Kit but must flow back into spec later.
- Gray zone: single-file bug fix, new CLI option. Constitution's "non-trivial" phrasing is vague; team should define examples.

**Next steps:** Propose constitutional amendment (MINOR bump, Option B recommended) to add Principle VI: "Specification-First Governance." This makes Spec Kit adoption explicit, not implicit. Full proposal is in `.squad/decisions/inbox/picard-speckit-briefing.md`.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Key cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed to prevent zero-coverage features from shipping.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without (1) decision gates, (2) overhead accounting, (3) annual review lock-in. Also: agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.

**Picard's role:** Coordinate constitutional amendment that incorporates Uhura's secret hygiene rule (essential), Bashir's test-first gates (essential), Scotty's trigger threshold and checkpoints, and Borg Queen's five prerequisites. Phase 2 drafting; Phase 3 merge into constitution.

**Status:** Phase 1 (Briefing) complete. Awaiting Phase 2 convergence.

---

### 2026-05-08T21:47Z — Phase 3 COMPLETE: Enforcement Infrastructure Operational

**Phase Status:** COMPLETE

**Deliverables:**
1. **Picard — Constitution v1.1 FINAL:** Fixed IV/IX contradiction, tightened VI exemptions, promoted enforcement infrastructure to ratified policy. Ready for ratification.
2. **Uhura — Artifact Hygiene Scanner:** JWT/token detector + CI gate. 6 patterns covered. Tested. Operational.
3. **Scotty — npm test Gate:** Pre-commit hook + CI workflow. All 87 tests pass. Hook verified to abort on test failure.
4. **Bashir — Test-First Proof Workflow:** PR template + CONTRIBUTING guide + reviewer runbook with SHA verification.

**Ratification Status:** PENDING — awaiting user (cyrusj) approval to merge v1.1 draft to `.specify/memory/constitution.md`.

**Manual Step Outstanding:** After first PR merge, configure GitHub branch protection rule for `npm test (required)` job.

**Outstanding Polish (v1.2 candidate):** Wire Uhura's hygiene scanner into Scotty's pre-commit hook; add `test:hygiene` npm script.

---

---

### Team Critique & Convergence — Phase 2 Complete (2026-05-08T21:33:38Z)

**Session:** speckit-v1.1-critique — All five agents submitted critiques of v1.1 proposal.

**Verdicts Summary:**
- **Scotty:** APPROVE_WITH_EDITS (verify `.specify/features/` structure pre-ratification)
- **Uhura:** READY_WITH_CONDITION (CI token-scanner MUST be implemented before ratification, not deferred)
- **Bashir:** APPROVE_WITH_EDITS (two enforcement gaps: pre-commit hook for test rule; verification doc for bug-fix test-first)
- **Borg Queen:** PHASE_2_COMPLETE (Principle IV/IX contradiction MUST be fixed before ratification)

**Convergent Findings — Two Classes of Follow-Up:**

1. **Drafting Fixes** (must complete before ratification):
   - Fix Principle IV (v1.0.0 text) — resolve "no test suite" contradiction with Principle IX
   - Assign artifact hygiene reviewer (recommend: Uhura)
   - Clarify `package.json` scripts exemption in Principle VI (optional edit)
   - Tighten test-first verification (add documentation requirement)

2. **Enforcement Infrastructure** (pre-ratification blockers):
   - Implement CI token-scanner for Artifact Hygiene (Uhura: blocking prerequisite, not TODO)
   - Implement pre-commit hook for `npm test` gate OR document pre-ratification commitment (Bashir)
   - Verify `.specify/features/` directory structure (Scotty)

**Critical Issues Identified by Team:**
- **Borg Queen caught Principle IV/IX contradiction** — v1.0.0 "has no automated test suite" vs. v1.1 "npm test MUST pass." This creates ambiguity for implementation.
- **Uhura flagged CI enforcement gap** — Principle VII (Artifact Hygiene) is strong but unenforceable without CI token-scanner. Deferring to post-ratification is unacceptable.
- **Bashir flagged pre-commit hook gap** — NON-NEGOTIABLE language in Principle IX requires mechanical enforcement, not honor-system.
- **Smoke-test operational runbook undefined** — WHO performs smoke-test, HOW to document, WHEN, WHERE. Needs follow-up.

**Adoption Threshold Decision:** Keep 50% as stated (Borg Queen recommendation accepted).

---

### Constitution v1.1 Drafting — Phase 2 Complete (2026-05-08T21:14:47-07:00)

**What was produced:** Full v1.1.0 constitution proposal (`.squad/.scratch/constitution-v1.1-proposal.md`) and decision memo (`.squad/decisions/inbox/picard-speckit-v1.1-proposal.md`).

**Key synthesis decisions:**

1. **Trigger threshold (Pragmatic/Option B) is explicit and operational.** Listed as bullet criteria in Principle VI — not a hand-wave. "Multi-file, cross-skill, >4h, API-contract, or build/config changes" → speckit required. "One-liners, typos, bumps, single-file bug fixes, doc edits" → direct PR.

2. **Test command is `npm test`** (confirmed from `package.json`: `node --import tsx --test tests/index.test.ts`). Encoded as a hard rule in Principle IX — no skip clauses, no CI-deferred exceptions.

3. **Borg Queen's concerns answered structurally, not dismissed.** Brownfield reality acknowledged in Known Tensions §1; smoke-test collision resolved as "agents implement, humans verify" in §2; abandonment risk addressed with 3-consecutive-skip retro rule in §3; annual review in §4.

4. **Reviewer gates name specific veto powers.** Bashir blocks: untestable specs, missing test tasks, uncovered acceptance criteria. Picard blocks: scope creep, principle violations, speckit bypass without justification.

5. **All v1.0.0 principles preserved unchanged.** No modifications, no removals, no weakening. New principles are additive (MINOR bump).

**What I learned about constitutional drafting:**
- Synthesizing 5 team briefings requires respecting each viewpoint while making hard calls about what goes in the constitution vs. what stays as operational guidance. Bashir's full 20-item checklist is too granular for the constitution — named it as a follow-up artifact instead.
- The Borg Queen's pre-mortem was the most structurally important input. Without answering those concerns directly in the document, the proposal would be aspirational rather than credible.
- Uhura's Artifact Hygiene principle extends Principle I into the development process itself — a gap the v1.0.0 constitution didn't cover. This is the highest-urgency addition.

---

### Constitution v1.1 Finalize — Phase 3 Complete (2026-05-08T21:37:54-07:00)

**What was produced:** Finalized v1.1.0 constitution draft (`.squad/.scratch/constitution-v1.1-proposal.md`) and finalize memo (`.squad/decisions/inbox/picard-v1.1-finalized.md`).

**Changes from Phase 2 draft to final:**

1. **Principle IV/IX contradiction fixed** (Borg Queen hard-fix). Rewrote Principle IV's rationale to acknowledge the test suite exists as of v1.1.0 and frame the type system and test suite as complementary safety nets. The v1.0.0-era "no automated test suite" claim is retired.

2. **Principle VI version-bump exemption tightened** (Scotty critique). Narrowed the exemption to `dependencies`/`devDependencies` field changes only. Added explicit NOTE that `package.json` scripts, build config, and CI workflows are NOT exempt — they meet the trigger threshold.

3. **Enforcement infrastructure promoted from TODO to policy** (Path A — Full Ship). CI token-scanner (Uhura) and npm test CI gate (Scotty/Bashir) are now stated as enforced outcomes. Constitution references `.github/workflows/` without hardcoding specific filenames. Deferred TODOs removed from Impact Report for these items.

4. **Sync Impact Report updated** with finalize pass timestamp, summary of edits, and enforcement infrastructure block.

**Draft status:** READY for infra-gated ratification. Ratification step (overwriting `.specify/memory/constitution.md`) is blocked pending Uhura/Scotty/Bashir completing the CI gates.


### Verifying baselines, not just diffs (2026-05-08, post-v1.1.0 ratification)

**The error.** v1.1.0 was a MINOR amendment that added Principles VI–IX. The Phase 2 critique pass framed Borg Queen's role as "verify your Phase 1 concerns are defused" — i.e., interrogate the new principles. We did. We caught the IV/IX contradiction, tightened Principle VI's exemption, promoted enforcement infra. What we did NOT do is read the v1.0.0 baseline against the actual project. The baseline described a web app + browser extension stack (Shadcn/Radix/Tailwind, Spark KV, `chrome.storage.local`, Manifest V3, `src/App.tsx`, `extension/manifest.json`, `npm run lint`, `npm run build`, `npm run build:extension`) — none of which exists in this repository. We trusted the boilerplate. `speckit.constitution` caught it AFTER ratification.

**The lesson.** When critiquing an amendment, the diff is necessary but not sufficient. The full document goes live, including the lines you didn't touch. Every preserved line is a fresh assertion. For any future amendment critique pass, the protocol is:

1. Read the diff and verify the additions (current practice — keep doing this).
2. **Then** read the un-diffed body and ask, for every concrete reference (file path, npm script, command, technology name): "does this exist in the project I'm shipping?" If no — flag it, even if it's not in the diff.
3. Don't assume the previous version was project-fit just because it was previously ratified. v1.0.0 was almost certainly generated from a generic template and never audited against reality.

**Operational rule for myself.** When someone asks me to review a constitution amendment, my first tool call should be a project-fit grep of the LIVE document (not the diff) for: file paths under `src/`, file paths under `.github/workflows/`, every `npm run` invocation, every dependency name, every "MUST be `X`" architectural claim. Cross-check each against the working tree. Only after that pass do I look at the diff.

**Cost of getting this wrong.** A constitution that lies about its own project loses moral authority instantly. Contributors will (correctly) ignore rules that reference files they can't find. The whole point of governance — that the document is binding — collapses. v1.1.1 is cheap; rebuilding trust in a constitution after contributors stop trusting it is not.

**Cost of the fix.** ~1 hour to retarget five principles + two sections, with no new obligations imposed. PATCH semantics. The lesson is more valuable than the patch.

---

## v1.2.0 Amendment Cycle — Lockout & Ratification (2026-05-08 → 2026-05-09)

### Session: speckit-v1.2.0-ratification-with-known-tensions

**Status:** COMPLETE. v1.2.0 ratified with Known Tensions (Path D acceptance).

**Summary:** Picard's v1.1.1 draft (project-fit retarget) was rejected by Borg Queen with 9 findings. Per reviewer-rejection lockout protocol, Picard was locked out from further revisions. Uhura and Scotty revised in parallel lanes (path-B); Bashir assembled. Borg Queen issued second rejection (9 findings across parallel-lane draft). All revision authors locked out. Coordinator escalated: cast Tuvok (new Process Auditor / Editorial Specialist) to break deadlock. Tuvok applied 5 surgical edits and documented 3 Known Tensions. cyrusj accepted Path D. v1.2.0 ratified with Known Tensions; v1.3.0 backlog created.

**Key lesson:** The "verify concerns are defused" framing from v1.1.0's critique was too narrow. It checked ADDITIONS but missed a false baseline (the v1.0.0 boilerplate claimed web-app/extension stack that doesn't exist). Future amendments must verify the entire document against the live project, not just the diff. Lesson encoded in this history for next amendment cycle.

**Lockout duration:** Cycle-scoped. Picard (and all revision authors: Uhura, Scotty, Bashir, Tuvok) are locked out from v1.2.0 amendments. Lockout resets for v1.3.0 cycle per coordinator decision.

**Next cycle (v1.3.0):** 3 Known Tensions to resolve. Backlog tracked in `.squad/decisions/inbox/v1.3.0-constitution-backlog.md`.

---

### Current-State System Specification — Reverse-Engineering Synthesis (2026-05-08T23:59:26-07:00)

**What was produced:** Authoritative system specification at `.specify/specs/000-current-state/spec.md`, reverse-engineered from commit `20a5d96`. 6 user stories (P1–P6), 61 functional requirements (FR-001 through FR-061), 10 success criteria (SC-001 through SC-010), 13 NEEDS CLARIFICATION markers.

**Architectural patterns surfaced during synthesis:**

1. **Outcome-driven exit codes.** The most distinctive architectural pattern in this codebase is the strict separation between "expected outcomes" (all 13 defined outcomes, including failures like TOKEN_EXPIRED and CODE_ALREADY_USED) and "infrastructure errors" (schema mismatches, config errors). Only infrastructure errors cause non-zero exit codes. This inversion — where most "failures" are actually expected — is the key insight for reimplementers. It means the system is designed to run quietly for months even as tokens expire and codes become stale, only alarming on genuine upstream contract breakage.

2. **Stateless idempotency via upstream delegation.** The system deliberately maintains zero local state between runs. No "already redeemed" database, no run-state file, no checkpoint. Idempotency is entirely delegated to the upstream API's "already done" responses. This is a conscious architectural choice (Constitution Principle V), not a gap. Reimplementers must resist the temptation to add local state tracking — it would break the stateless-rerun safety guarantee.

3. **Centralized exit vs. distributed result.** Sub-commands return structured `{ result, exitCode }` objects; only the CLI entry point calls process exit. This pattern is essential for testability and composition. Reimplementers should not let sub-commands terminate the process directly.

4. **Redaction as a cross-cutting concern.** Redaction is applied at multiple layers (API client wraps errors, CLI wraps uncaught exceptions, summary writer scrubs output). This is not a single-point filter — it's defense-in-depth. A reimplementation must apply redaction at every output boundary, not just one.

5. **Schema permissiveness for API resilience.** The API client uses permissive schema validation (accepting unknown fields) while still enforcing required field shapes. This is a deliberate trade-off: strict enough to catch contract breakage, loose enough to survive upstream additions. Both field naming inconsistency (snake_case vs camelCase) and type flexibility (boolean vs 0/1) are accommodated.

**Implications for future specs:** The 000-current-state spec is now the baseline. Any future feature spec should reference it and specify only the delta. The 13 NEEDS CLARIFICATION markers are the immediate backlog for user resolution — several (rate limiting, non-ENOENT file errors, concurrency semantics) could become FR additions once clarified.

---

### 2026-05-12T04:12:27Z — News Beat Recon (Picard)

**What:** Captured the STFC news surface to `.squad/knowledge/stfc/news.md`. Pulled the WP REST feed (`/wp-json/wp/v2/posts`), enumerated the last 10 posts, and read four high-signal posts in full (Update 90.1 patch notes, Battle Pass/Leslie compensation, Quark's Halloween riddle, Login Security Improvements).

**Learnings — implications for our redemption schedule:**

1. **News cadence (~2–3 posts/week, 9 in last 24 days) does NOT drive promo-code cadence.** Most posts are patch notes / feature highlights / event schedules — not code drops. Codes appear in clusters tied to seasonal events (Halloween riddle was 5 daily hints assembled into one shared code; Anniversary windows in Nov/Dec produce more). Our 4-hour cron is comfortably faster than the news beat. **No need to tighten the schedule based on news rhythm alone.**

2. **The redemption surface is confirmed and stable.** "Promo Code Redemption page on the official Star Trek Fleet Command Website" is the canonical channel. Codes are share-friendly, case-insensitive, no per-user limit on the campaigns I read. This validates our charter: a headless redeemer is a sensible automation.

3. **MAJOR strategic flag — auth surface is on a deprecation timer.** The Feb 26, 2026 post announced Scopely is phasing out passwords in favor of passwordless email-verification-code login. If our redeemer relies on `username + password` auth, that flow is on borrowed time. This is the single most important finding of this recon. I'm dropping a decision-inbox note so the team triages auth posture before we ship more features on a shaky foundation.

4. **Missing input upstream.** Scopely does not publish a list of valid codes — codes circulate via community channels (Discord, Reddit). Our pipeline needs an *input* source. The news beat is NOT that source. Worth raising with Brady whether we're scoped to "ingest a curated list and redeem" vs "discover codes ourselves."

5. **Compensation is a different channel.** The May 1 compensation bundle is delivered to in-game inbox, not the web store. Our redeemer correctly does not need to touch this. Worth making the scope boundary explicit in the spec.

6. **Active game systems context (for the squad):** Starfleet Academy (Update 90) is the current arc — Remote Campus, Academy Space, Duo Wave Defense, Simulation Codes (note: in-game currency, not promo codes — naming collision worth flagging to avoid confusion in code/docs). G5 Scrapping, Sigma Refinery, Battle Pass refresh, Emerald Chain expansion all live.


---

### Merge: origin/copilot/joint-puffin + origin/main → main (2026-05-12)

**Branches merged:** `origin/copilot/joint-puffin` (local) + `origin/main` (117974f: PR #2 "Enable worktrees, wire GitHub Issues, add STFC knowledge base and issue-creation skill") into `main`.

**Conflict patterns observed:**

- **Both-added knowledge docs (`game-flow.md`, `news.md`):** One side (ours, from a Picard research session) was the research-first superset with full detail. The other (theirs, from Uhura via PR #2) was a structured summary with different organization. Resolution: **take the superset (ours) as the base, append the Index section from theirs.** Both sides had unique value only in the Index — everything else was covered in the richer version.

- **Both-added skill (`issue-creation/SKILL.md`):** Two different conventions for the same skill. Ours had a 3-case routing table (self-assign, handoff, triage-only). Theirs required `squad:{author}` on every issue including triage cases. Resolution: **kept ours' routing logic** (the 3-case model is more coherent — omitting agent label signals "needs triage") but incorporated theirs' `valid agent values` list, concrete named examples (Bug/Enhancement/Architecture patterns), and additional anti-patterns. The conventions are now consolidated in one place.

- **Both-modified routing table (`routing.md`):** Conflict only in the "How to Create Issues" section — same divergence as SKILL.md. Resolution: **same merge strategy as SKILL.md** — ours' 3-case routing table + theirs' named examples + expanded anti-patterns list.

- **Rebase introduced second routing.md conflict:** After `git pull --rebase`, the rebased local checkpoint commit re-introduced the same routing.md conflict. Resolved identically; rebased cleanly.

**Key pattern to remember:** When merging "both added" knowledge docs, always check which side has more research depth. The richer side is the base; the other side contributes structure/organization/Index. Never just pick one side — extract unique value from each.

**Routing convention decision:** The 3-case triage model (self-assign / handoff / triage-only-squad) is authoritative. The "always require squad:{author}" convention from PR #2 was merged in as examples but not adopted as the primary table.
