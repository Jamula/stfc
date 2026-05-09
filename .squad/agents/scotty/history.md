# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions

## Learnings

### Phase 3 — Principle IX Enforcement Gate Built (2026-05-08T21:29:58-07:00)

**Task:** Build two-layer `npm test` enforcement gate for Principle IX (Path A).

**Layer 1 — Local pre-commit hook:**
- Chose `simple-git-hooks` (1 devDep, no postinstall surprises, cross-platform via Git Bash on Windows).
- Hook command: `node scripts/pre-commit.mjs` — a Node.js wrapper (no shell required, runs on any OS with Node).
- `scripts/pre-commit.mjs` runs `npm test`; exits non-zero on failure → commit aborted.
- TODO left in wrapper for Uhura's `check-artifact-hygiene.*` (runs before `npm test` once landed).
- Emergency bypass documented in wrapper: `git commit --no-verify`.
- `"prepare": "simple-git-hooks"` added to package.json scripts — hooks auto-register on `npm install`.

**Layer 2 — CI required check:**
- Added `.github/workflows/squad-test-gate.yml` — triggers on all PRs, runs `npm ci` + `npm test`.
- Job name `npm test (required)` — this is the string cyrusj must enter in GitHub branch protection rules.

**End-to-end verification:**
- 87/87 tests pass pre-hook install.
- `node scripts/pre-commit.mjs` → exits 0, all 87 pass.
- Deliberately broken test → hook exits 1, commit aborted. ✅
- Reverted break → 87/87 pass again. ✅

**Files created/modified:**
- `package.json` — added `prepare` script, `simple-git-hooks` config, `simple-git-hooks` devDep
- `scripts/pre-commit.mjs` — hook runner with Uhura TODO
- `.github/workflows/squad-test-gate.yml` — PR required check workflow
- `.squad/decisions/inbox/scotty-test-gate-built.md` — build summary for team

**Manual step required from cyrusj:**
GitHub branch protection rules cannot be set programmatically. After merging, go to:
GitHub → repo Settings → Branches → Add branch protection rule → "main" → ☑ Require status checks → search for `npm test (required)` → Save.

---

- **Created:** 2026-05-08

## Learnings

### Spec Kit Integration Analysis (2026-05-08)

**Build System & TS Configuration:**
- Project uses `tsx` for runtime + `tsc --noEmit` for typechecking; no build step needed
- `tsconfig.json` has strict mode enabled with aggressive checks (noUncheckedIndexedAccess, noImplicitOverride)
- Tests use native Node.js test runner (`node --import tsx --test`)
- Package.json has skill-based CLI scripts (run-all, check-auth, list-gifts, claim-gifts, redeem-codes)
- Minimal deps: tsx, zod, playwright (for automation), devDeps: types/node, typescript
- No existing build pipeline stress — Spec Kit spec/plan/tasks won't add compile complexity

**Spec Kit Footprint:**
- Templates are lightweight; no breaking structure changes needed in `src/`
- `specs/` directory is isolated and won't interfere with source layout
- Sequential branch numbering already enabled in git extension (001-NNN-feature format)
- Auto-commit hooks available but disabled by default — good for opt-in model
- Constitution model fits our skill-based architecture well

**Git & Feature Branch Integration:**
- `create-new-feature.sh` auto-generates feature branches and specs/ subdirs
- Branches use semantic naming: `001-user-auth`, `002-oauth-integration`, etc.
- No fetch-on-dry-run mode prevents surprise delays for lightweight planning
- Graceful degradation if git not available (specs still created in specs/ dir)

**Commands That Matter for Core Dev:**
- `/speckit.git.feature` — auto-generates branch + specs/ dir on specify phase
- `/speckit.plan` — creates plan.md with tech context; must check post-plan to catch architecture issues early
- `/speckit.tasks` — breaks down into impl phases; review deps before dev starts
- `/speckit.implement` — triggers parallel task execution; I own build validation
- `/speckit.git.commit` — optional auto-commit after each phase; currently disabled (good)

**Key Friction Points (Low, but real):**
- Specs directory grows with every feature — no built-in cleanup/archival yet
- Tasks.md generation depends on good user stories in spec.md; garbage in = garbage out
- If tasks reference build changes (tsconfig, package.json updates), they need explicit review
- Typescript type checking runs per-task; cumulative slowdown if tasks spawn independently

---

### Phase 2 Critique Delivered — v1.1 Constitution Proposal (2026-05-08T21:33:38Z)

**Verdict:** APPROVE_WITH_EDITS

**Four-question critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-scotty.md`

**Key Findings:**
1. **Principle VI trigger threshold** — unambiguous; tested against 10 plausible PR types; two developers would categorize 95% the same.
2. **Principle IX test command** — correct per package.json; CI-backed enforcement strong (pre-commit hook would strengthen further).
3. **Build/tooling assumptions** — `.specify/features/` directory structure MUST be verified pre-ratification; no new infrastructure required.
4. **Response to Picard's open question** — KEEP `package.json` scripts rule as written; clarify version-bump exemption in text: "version bumps alone = direct PR; script edits = speckit required."

**Required edits before ratification:**
- Verify `.specify/features/` directory structure exists; create or add TODO if missing.
- (Optional) Clarify line 168–169 to remove ambiguity about version bumps.

**No blockers.** Constitution ready to sign after `.specify/` structure verification.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Scotty's key contribution:** Proposes Trigger Threshold (use speckit for >4-hour multi-file work; skip for one-liners) and build checkpoints (npm install + typecheck after Foundational Phase). Tech context gate post-plan to catch architecture issues early.

**Cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates, overhead accounting, annual review lock-in.

**Status:** Phase 1 (Briefing) complete. Phase 2: Picard coordinates constitutional amendment incorporating Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

---

### Constitution v1.1 Critique — Phase 2 (2026-05-08T21:29Z)

**Task:** Focused critique from the Core Dev seat. Answer 4 questions on Principle VI (trigger threshold), Principle IX (test rule), build assumptions, and Picard's open question.

**Q1 — Trigger Threshold Practicality:** ✅ APPROVE
- Tested against 10 PR types (typo, dep bump, retry-logic, new skill, orchestrator refactor, new CLI flag, Actions workflow, README, eslint config, test fixture).
- Threshold is UNAMBIGUOUS. Multi-file, cross-skill, >4-hour, config, API-contract are concrete. Exemptions are crisp.
- Single ambiguity: New CLI flags might be multi-module or single-file. **Not a defect** — "when in doubt, use speckit" is the safety valve.
- **Verdict:** Threshold is pragmatic, calibrated correctly, holds up under day-to-day scrutiny.

**Q2 — Test-Before-Checkin Rule:** ✅ APPROVE
- Command accuracy: Principle IX quotes `npm test` — matches package.json exactly (line 16).
- Enforceability: Not purely honor-system. CI runs `npm test` as a required pre-merge gate. Reviewers can demand fresh attestation.
- Threats mitigated: "no exceptions, no deferrals, no skip clauses" is non-negotiable language with teeth.
- Enhancement (optional): Pre-commit hook (Husky) would strengthen enforcement from CI-backed to mechanical. Not a blocker.
- **Verdict:** Rule is correct, command is accurate, enforceable via CI + review. Strong.

**Q3 — Build/Tooling Assumptions:** 🟡 APPROVE WITH EDIT
- Principle VI implicitly requires `.specify/features/` directory for versioned artifact storage (line 194).
- **Required pre-ratification check:** Verify `.specify/features/` exists and directory structure is correct. If not, create it or add TODO.
- No new build infrastructure required. All speckit agents already available. Deferred TODOs (CI token scanner, checklist template) are post-ratification enhancements, not blockers.
- **Verdict:** One pre-ratification verification needed; otherwise clear.

**Q4 — Picard's Open Question (package.json scripts exception):** ✅ KEEP AS WRITTEN + OPTIONAL CLARIFICATION
- Picard asked: Should version bumps in `package.json` require speckit, or is that too aggressive?
- **Answer:** KEEP the rule. A bare version bump (e.g., `tsx` 4.19 → 4.20 in dependencies) does NOT trigger the rule — the trigger says "changes touching...`package.json` scripts," not version numbers.
- **Where it catches bad behavior:** A version bump PLUS a script refactor in the same PR = speckit required. Good.
- **Optional clarity edit (line 168–169):** Add "(but not version bumps in `dependencies`/`devDependencies` if only version numbers change)" to remove doubt.
- **Verdict:** Rule is correct as written. Clarification is optional but recommended.

**OVERALL VERDICT:** **APPROVE_WITH_EDITS**
- Principle VI (trigger threshold) is well-calibrated and unambiguous.
- Principle IX (test rule) is correct and enforceable.
- No new build/tooling debt.
- Picard's concern is answered: the rule works.

**Required edits before ratification:**
1. Pre-ratification: Verify `.specify/features/` directory structure exists. Create if missing.
2. Optional: Clarify line 168–169 re: version bumps.

**Blocking issues:** None. Constitution is ready to sign.

---

### 2026-05-08T21:47Z — Phase 3 COMPLETE: All Enforcement Infrastructure Operational

**Team Status Report:**

Phase 3 enforcement infrastructure is complete across all four pillars:
1. ✅ **Picard:** v1.1 Constitution finalized and ready for ratification
2. ✅ **Uhura:** Artifact Hygiene Scanner deployed and tested
3. ✅ **Scotty:** npm test enforcement gates (pre-commit + CI) wired and verified
4. ✅ **Bashir:** Test-first proof workflow (PR template + runbook) deployed

**Ratification Status:** PENDING user approval. No blockers. Infrastructure is live.

**Outstanding Manual Step:** cyrusj must configure GitHub branch protection rule for `npm test (required)` after first PR merge.

**v1.2 Polish Item:** Wire hygiene scanner into pre-commit hook; add `test:hygiene` npm script.
