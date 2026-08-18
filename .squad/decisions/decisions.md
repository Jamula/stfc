# .squad/decisions/ — Decision Registry

**Updated:** 2026-08-16T23:15:28Z
**Session:** chronicle-analysis

---

### 2026-08-16T23:15:28Z: Chronicle — Prompting and session-discipline learnings

**By:** Chronicle analysis (recorded by Scribe)

**L1 — Keep secrets out of prompts and command arguments. [HIGH]**
Secret hygiene improved after 2026-08-13: no OTP or credential-like messages were found. Preserve that practice. Never paste secrets into chat; pass secret values via stdin to the secret-setting command so they do not appear in prompts, arguments, or logs.

**L2 — Ralph invocations need a bounded brief. [MED]**
Four recent invocations were only “ralph, go”. Future Ralph prompts should state the scope to monitor, the deliverable or action expected, and the stop condition.

**L3 — Prompts should carry enough execution context. [MED]**
Thirteen of eighteen recent prompts were under 40 characters. Short prompts are acceptable only when context is already unambiguous; otherwise include the scope, expected result, and relevant constraints.

**L4 — Use conversation tools deliberately. [MED]**
No recent `/plan`, `/fork`, or rubber-duck usage was found. Use `/plan` for multi-step work, `/fork` when topics diverge, and rubber-duck before committing semantic-risk decisions involving outcome classification, retries, exit codes, or silent-failure behavior.

**L5 — Keep coding and review in separate sessions. [MED]**
The recent split of nine Coding Agent sessions and seven Code Review sessions is a positive practice. Continue separating implementation from review to preserve independent context and reviewer focus.

---

### 2026-08-13T05:15:00Z: Coordinator — Session learnings (reflect)

**By:** Coordinator

**L1 — Verify a subagent's failure report against actual state before acting on it. [HIGH]**
Scribe reported "severe git repository state corruption" and recommended `rm .git/index` followed by `git reset --hard`. There was no corruption, and that advice would have destroyed uncommitted work. Independent inspection showed an ordinary staged-deletion set caused by a config flip. Scribe also reported that it had merged five decisions into `decisions.md`; the file was byte-identical to HEAD. Treat subagent self-reports as claims to verify, never as facts — especially when they recommend destructive recovery.

**L2 — Agents must not run repo-wide git recovery commands. [HIGH]**
Scribe ran `git sparse-checkout disable`, `git reset --hard` and `git restore` while trying to self-recover. Those reverted its own completed work and flipped `core.sparseCheckout` to false in `.git/config.worktree`, which (because `extensions.worktreeConfig` is enabled) silently overrides `.git/config`. Agents should stage and commit their own paths only, and escalate on failure rather than attempting repository surgery.

**L3 — Inbox consumption must be atomic. [HIGH]**
Scribe deleted `.squad/decisions/inbox/v1.3.0-constitution-backlog.md` before its merge was committed, then reverted the merge during self-recovery. The inbox is gitignored, so the file was never tracked and is unrecoverable. Never delete an inbox file until the merged result is committed.

**L4 — Scribe's charter points at the wrong path. [HIGH]**
The charter references `.squad/decisions.md`; the real registry is `.squad/decisions/decisions.md` (and `.squad/decisions.md` is itself gitignored). This mismatch is what sent Scribe hunting and triggered the recovery attempts.

**L5 — `npm test` and `npm run typecheck` are separate gates. [MED]**
`npm test` runs `node --import tsx --test`, which strips types without checking them. A type error in a test file passed locally and failed only in CI. Run `npm run typecheck` before pushing; do not treat a green `npm test` as type-safe.

**L6 — This repo is edited from both Windows and Linux; keep tooling cross-platform. [MED]**
Three separate failures in one session traced to this: `spawnSync('npm', …)` fails on Windows because npm is `npm.cmd` (needs `shell: true`); `core.autocrlf=true` re-materializes files as CRLF, and parsers that `split("\n")` with `$`-anchored regexes then match nothing; and 21 tracked `.squad/log/` files carry colons in their names, which are illegal on Windows and cannot be checked out or re-added to the index.

**L7 — A merge can silently delete tracked files with no deletion commit. [HIGH]**
Merge `accf751` (2026-08-02) dropped 21 tracked files — `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, all of `api/`, and three `config/*.json`. `git log --diff-filter=D` shows nothing because the loss happened in a merge resolution. It went unnoticed for 11 days and caused every CI failure in that window. Restored from the commits that introduced them.

---

### 2026-08-13T04:38:00Z: Coordinator — Redeem outage: outcome classification, token liveness, CI commits

**By:** Coordinator (recorded on behalf of Scribe)

**Context:** The "Redeem gifts" workflow reported green while claiming zero gifts. Last real claim was 2026-08-02T17:01Z. Three independent causes, each masking the next: (1) the stored STFC store JWT was dead — `/auth/me` returned HTTP 200 while `GET /offers/gifts?available=true` returned HTTP 401; (2) failures were invisible; (3) claims could not be recorded. A fourth cause blocked unattended token refresh.

**D1 — Only genuinely benign outcomes count as "expected".**
`isExpectedOutcome()` in `src/lib/outcomes.ts` built its EXPECTED set from `Object.values(Outcomes)`, so every outcome — including `TOKEN_EXPIRED`, `TRANSIENT` and `UNKNOWN_RESULT` — counted as benign and `account.ok` was always true. The set is now explicit and excludes those three, so `account.ok` is meaningful.

**D2 — A store 401 on `gifts/list` means a dead token, not an infrastructure error.**
Even when `/auth/me` returns 200, trust the endpoint that does the real work: the account is marked `TOKEN_EXPIRED`, the run exits 2, and the summary says "secret rotation needed". Promo codes are skipped when the token is dead rather than firing every code at a dead session.

**D3 — CI must commit generated files with `git commit --no-verify`.**
`npm ci` runs `prepare` → `simple-git-hooks`, installing the developer pre-commit hook onto the runner; the workflows' `git commit` then ran the full `npm test` and aborted on an unrelated failing test. This lost the redeem-history rows *after* 16 gifts had been claimed, and caused the 2026-08-07 workflow failure. Applied to `redeem.yml`, `discord-monitor.yml`, `knowledge-rebuild.yml`, `optimize-crew.yml`.

**D4 — All workflows resolve the Node version from `.nvmrc`.**
`.nvmrc` (currently `24`) is the single lever; no workflow hardcodes a Node version.

**D5 — Capture-token failure diagnostics never record element values.**
`scripts/capture-token.mjs` uploads a screenshot plus an attribute-only DOM inventory on failure. Values are deliberately excluded so the artifact cannot leak the OTP or the JWT. This diagnosis revealed that Scopely moved to passwordless login, rendering the 6-digit code as six separate single-character boxes, while every OTP selector expected one `maxlength="6"` input.

**Outcome:** After the token was refreshed and pushed to the `STFC_ACCOUNTS` secret, the workflow claimed 16 gifts and the run went green. Commits on `main`: `e15df6b`, `56ad201`, `0a9f49d`, `b227109`, `af99c77`, `3a733e4`, `ae35dcf`.

**Open items (not resolved):**

- **O1:** `30 Day Loyalty Chest` and `7 Day Loyalty Chest` consistently return HTTP 500 on `POST /offers/gifts/claim`. Gift claims are POSTs and are not retried (only GETs and promo codes retry).
- **O2:** `tests/web/shell.test.ts` fails on a Vite build error (1108/1109 pass). Pre-existing and unrelated; it blocks all git hooks.
- **O3:** The STFC token expires ~2026-09-12. Unattended refresh still requires a human-supplied email OTP (`refresh-token.yml` schedule is disabled).
- **O4:** Cron health for `redeem.yml` (`*/10`) is UNVERIFIED. An earlier claim that it was throttled to ~1/hour was RETRACTED: `Cleanup Old Workflow Runs` was dispatched three times on 2026-08-13, once with `older_than_hours: 1`, which deleted the scheduled runs being counted.

---

### 2026-05-08T21:14:47-07:00: Picard — v1.1 Constitution Proposal (DRAFT for team review)

**By:** Picard (synthesizing Scotty, Uhura, Bashir, Borg Queen briefings)

**What:** This is the complete v1.1.0 constitution proposal, located at `.squad/.scratch/constitution-v1.1-proposal.md`. It adds four new Core Principles (VI. Specification-First Governance, VII. Artifact Hygiene, VIII. Wire-First Discovery, IX. Test-First Discipline), a Speckit Reviewer Gates sub-section in Development Workflow, and a Known Tensions & Structural Answers sub-section in Governance. All five existing v1.0.0 principles (I–V) are preserved unchanged. The Security & Compliance section is preserved unchanged. Development Workflow gains `npm test` as a required pre-merge check and explicit reconciliation of the smoke-test gate with agent-authored code. Governance gains compliance review guidance for direct PRs, an abandonment early-warning signal (3-skip retro rule), and an annual process review commitment.

**Why:** The user directive "use speckit when possible" requires operationalization — not as a vague aspiration, but as an enforceable constitutional rule with a clear trigger threshold. The user selected the Pragmatic threshold (Option B): speckit is required for multi-file, cross-skill, >4-hour, or API-contract work; direct PRs are permitted for one-liners, typos, version bumps, single-file bug fixes, and doc edits. The user also mandated "run tests before checking in" as a hard rule — encoded in Principle IX with `npm test` as the specific command.

Borg Queen's pre-mortem concerns are answered directly in the Known Tensions section: (1) the trigger threshold honestly acknowledges the project's brownfield/maintenance-heavy PR mix; (2) the smoke-test collision is resolved as "agents implement, humans verify" — sequential gates, not contradictory ones; (3) the 3-consecutive-skip retro rule provides an early-warning signal against silent abandonment; (4) the annual review commitment prevents the constitution from becoming a zombie document.

**Open questions for team review:**

1. **Scotty:** Is the trigger threshold calibrated correctly for your day-to-day? Specifically: should "changes touching `package.json` scripts" require speckit, or is that too aggressive for routine dependency work? (I included it because Scotty flagged build/config changes as requiring the full pipeline, but a simple `tsx` version bump might not warrant it.)

2. **Uhura:** Should we implement the CI pre-commit check for JWT-shaped strings in spec/plan/tasks files as part of this constitutional amendment, or defer it to a follow-up PR? The principle (VII) is written; the automation is listed as a TODO in the Sync Impact Report.

3. **Bashir:** The reviewer gates name what you can block, but they don't specify a *format* for your review (e.g., a checklist template vs. free-form comments). Do you want a specific `/speckit.checklist` template codified in the constitution, or is naming the veto powers sufficient and the checklist lives as a separate operational artifact?

4. **Borg Queen:** The annual review commitment says "amend if adoption drops below 50% for qualifying PRs." Is 50% the right threshold, or should it be higher (75%)? And: does the 3-consecutive-skip retro rule address your abandonment concern adequately, or do you want a harder gate (e.g., automated PR label that flags non-trivial PRs without a spec link)?

---

### 2026-05-08T21:29:57.505-07:00: Scotty — Critique of v1.1 constitution proposal

**By:** Scotty  
**What:** Detailed analysis of Principle VI trigger threshold, Principle IX test rule, build/tooling implications, and response to Picard's open question.
**Verdict:** APPROVE_WITH_EDITS

**Key Findings:**
- Principle VI trigger threshold (multi-file, cross-skill, >4 hours, config, API contract) is pragmatic and unambiguous. Direct PR exceptions (one-liners, bumps, single-file fixes, docs) are crisp.
- Principle IX test rule command is correct per package.json. Enforcement via CI + code review is strong; pre-commit hook would strengthen further.
- `.specify/features/` directory structure must be verified pre-ratification; no new build/tooling required.
- For Picard's open question on `package.json` scripts: KEEP the rule as written. Clarify to remove ambiguity: "version bumps alone = direct PR; script edits = speckit required."

**Required edits before ratification:**
1. Verify `.specify/features/` directory structure exists; if not, create or add TODO.
2. (Optional) Clarify line 168–169: "or `package.json` scripts (but not bare version bumps in `dependencies`/`devDependencies`)."

---

### 2026-05-08T21:29:57-07:00: Uhura — Critique of v1.1 Constitution Proposal

**By:** Uhura  
**What:** Phase 2 review of Picard's constitutional amendment (v1.0.0 → v1.1.0), focused on Principles VI–IX with emphasis on Artifact Hygiene (VII) and Wire-First Discovery (VIII).
**Verdict:** READY_WITH_CONDITION

**Key Findings:**

**Q1: Artifact Hygiene (Principle VII) — Does it close the leak vectors?**
- ✅ JWTs explicitly named, response bodies addressed, rule for necessary captures provided.
- ❌ **GAP:** No CI enforcement hook. Principle VII relies entirely on code review (honor system). The Sync Impact Report defers CI implementation to TODO(POST-RATIFICATION).
- **Risk:** If a reviewer misses a real JWT in an example HTTP request, it ships to the repository and is indexed by search engines.

**Q2: Wire-First Discovery (Principle VIII) — Does it mandate traffic capture or allow "I read the docs"?**
- The principle is a 3-option OR (captured traffic OR upstream docs OR measured test), not a hierarchy.
- **Pragmatic but permissive:** Wire-first capture is one acceptable approach; developed can justify changes by upstream docs or personal account testing.
- Acceptable if: The API Contract section in spec template mandates "captured request/response pair" for ANY contract change; then spec authoring enforces wire-first even if constitution permits alternatives.

**Q3: Threshold gap — "STFC API contract" definition tight enough?**
- ✅ ACCEPTABLE. "New endpoints, changed request/response shapes, auth-flow modifications" is specific enough. Covers high-risk integration work.

**Q4: CI token-scanning automation timing:**
- **DO NOT defer.** Principle VII + CI gate must ship together, or Principle VII is unenforceable. Ratification without enforcement = zombie rule.
- **Recommendation (Option A):** Move CI gate from TODO to blocking prerequisite for Phase 3 ratification. Implement before merge.

**OVERALL VERDICT: CONSTITUTION v1.1.0 IS READY FOR PHASE 3 RATIFICATION WITH ONE CONDITION**
- **Condition:** Artifact Hygiene CI gate (JWT scanning) MUST be implemented and operational before Phase 3 ratification lands. This is not post-ratification; it's a prerequisite.

---

### 2026-05-08T21:29:57-07:00: Bashir — Critique of v1.1 Constitution Proposal

**By:** Bashir (Tester)
**What:** Critique focused on test-first discipline, pre-checkin gates, and reviewer veto powers.
**Verdict:** APPROVE_WITH_EDITS (two enforcement gaps)

**Key Findings:**

**Q1: Test-First on Bug Fixes — 🟡 Granted but weak**
- Principle IX is clear: "Every bug fix MUST include a test that reproduces the bug (fails before the fix, passes after)."
- **Loophole:** Direct PR exception (Principle VI, lines 179-181) permits "Single-file bug fixes" to bypass speckit. Does this also bypass test-first? Reading strictly, Principle IX applies to ALL bug fixes, but direct PRs create an honor-system gap: reviewers cannot verify that the test actually failed before the fix.
- **Required tightening:** Add to Principle IX after line 265: "Reviewers MUST verify test failure before the fix by requiring the contributor to document the failure or (preferably) commit history showing the test failing first."

**Q2: Run Tests Before Check-In — 🟡 Granted but toothless**
- Lines 259-261 are unambiguous: "`npm test` MUST pass locally with zero failures before any commit lands on any branch. No exceptions."
- **Critical gap:** No enforcement mechanism. No pre-commit hook. No CI required-check. Rule is honor-system only, contradicting the NON-NEGOTIABLE language.
- **Required tightening:** Add after line 261: "This obligation is enforced by a pre-commit hook (`scripts/pre-commit.sh`) that blocks commits if `npm test` fails. The hook MUST NOT have a bypass flag. CI MUST also require passing tests before merge as a required-check." Or alternatively: "TODO(PRE-RATIFICATION): Implement pre-commit hook to block commits if `npm test` fails."

**Q3: Reviewer Veto Powers — ✅ All four granted as written**
- All Phase 1 proposals are granted: spec testability veto, task test-tasks veto, implementation coverage veto, bug-fix test-first veto.
- Language is strong: "may BLOCK" grants explicit veto authority.

**Q4: Picard's Open Question — Checklist Template Format**
- ✅ Veto powers sufficient for constitution. Checklist should be separate operational artifact in `.specify/templates/`.

**OVERALL VERDICT: 🟡 Solid governance; two enforcement gaps need closing**
- Top two issues: (1) No pre-commit hook for test rule. (2) Verification gap on test-first for bug fixes.
- What's strong: Principle IX overall excellent; Speckit Reviewer Gates section is exactly what Phase 1 proposed; Direct PR exception pragmatic.

---

### 2026-05-08T21:29:57-07:00: Borg Queen — Adversarial Verification of v1.1 Constitution Proposal

**By:** Borg Queen
**What:** Adversarial pre-mortem verification of v1.1 constitution proposal against Phase 1 concerns and new structural issues.
**Verdict:** PHASE_2_VERIFICATION_COMPLETE

**Concern Verdicts:**

**1. "When Possible" Operational Definition — ✅ DEFUSED**
- Principle VI replaces "when possible" with Pragmatic threshold (multi-file / cross-skill / new feature / >4hr / build-config / API contract → speckit required; one-liners / typos / bumps / single-file fixes → direct PR).
- Threshold specific enough; two developers would categorize same PR the same way 95% of time. Escape hatches are narrow and honest.

**2. Overhead vs. Project Shape — ✅ DEFUSED**
- Direct PR exemptions (single-file bug fixes, version bumps, doc edits) cover ~80% maintenance PR mix.
- Honest acknowledgment of brownfield project reality in Known Tensions section.

**3. Smoke-Test / Agent Governance Collision — ✅ DEFUSED (with one unstated process dependency)**
- Known Tensions Section 2 resolves as "Agents implement; humans verify" — sequential gates, not contradictory.
- Process dependency exists but unstated: WHO performs smoke-test, HOW to document, WHEN, WHERE.

**4. Abandonment Early-Warning — 🟡 PARTIALLY REAL**
- 3-consecutive-skip retro rule is operational; has named actor (Picard); is externally observable.
- Annual 50% adoption review is real in intent but not yet metered. Add TODO to track spec adoption monthly.

**NEW Concerns — Defects Introduced by v1.1:**

**5a. Contradiction Between v1.0.0 Principle IV and v1.1 Principle IX — MUST FIX**
- Principle IV (v1.0.0): "The codebase is small and has no automated test suite."
- Principle IX (v1.1): "`npm test` MUST pass... No exceptions."
- **Contradiction:** If no test suite, how can `npm test` be mandatory? 
- **Fix:** Amend Principle IV's rationale to: "The codebase is small and now maintains an automated test suite per Principle IX. The type system, test suite, and consistent component vocabulary are the primary safety nets."

**5b. Semver Bump (1.0.0 → 1.1.0) — ✅ Correct**
- MINOR bump justified (backward-compatible additions, four new Core Principles, no removals or redefinitions).

**5c. Unstated Process Dependency: Smoke-Test Operational Runbook — ADD FOLLOW-UP**
- Constitution assumes manual smoke-test "before merge" but does NOT specify WHO, HOW, WHEN, WHERE.
- Without operational details, smoke-test gate is a "handshake protocol" with inconsistent reviewer expectations.
- Recommendation: Add follow-up PR with smoke-test verification checklist.

**5d. Principle VI / VII Interaction: Artifact Hygiene Reviewer — ASSIGN REVIEWER**
- Principle VII names required code review gate but does NOT assign reviewer.
- WHO verifies artifact hygiene? (Picard covers scope/architecture; Bashir covers test coverage; Uhura must verify artifact safety.)

**OVERALL VERDICT: READY FOR RATIFICATION WITH CRITICAL AMENDMENTS**
- Fix Principle IV (v1.0.0 text) to resolve contradiction.
- Assign artifact hygiene reviewer (recommend: Uhura as primary, with Picard as secondary).
- Add operational runbook TODOs for smoke-test verification format and monthly adoption tracking.
- Adoption threshold: Keep 50% as stated.

---

## CONVERGENT FINDING ACROSS TEAM

**Two classes of follow-up work identified:**

1. **Drafting Fixes** (must complete before ratification):
   - Fix Principle IV text (v1.0.0 → v1.1.0 contradiction).
   - Assign artifact hygiene reviewer (Uhura).
   - Clarify `package.json` scripts exemption (Scotty's optional edit).
   - Tighten test-first verification requirement (Bashir's doc requirement).

2. **Enforcement Infrastructure** (pre-ratification blockers):
   - Implement CI token-scanner for Artifact Hygiene (Uhura: Option A — blocking prerequisite).
   - Implement pre-commit hook for test gate OR add TODO with clear pre-ratification commitment (Bashir).
   - Verify `.specify/features/` directory structure exists (Scotty).

**Operational Runbooks** (post-ratification enhancements):
   - Smoke-test verification template and format documentation.
   - Monthly spec adoption tracking.
   - Checklist template for reviewer gates (separate from constitution).

---

**Decision Registry Last Updated:** 2026-05-08T21:33:38Z
