# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### 2026-05-08: Speckit Testing Implications

1. **Speckit templates treat tests as optional** — The tasks-template.md explicitly says "Tests are OPTIONAL — only include them if explicitly requested." This is a gap: we need a constitution principle that tests are mandatory for acceptance-criteria-driven specs.

2. **Acceptance criteria are immediately testable** — The spec template requires `Acceptance Scenarios` in Given/When/Then format for every user story. This is *excellent* for traceability: each criterion maps to a test case. We can enforce this in the spec review gate.

3. **Independence of user stories enables slice-by-slice testing** — Speckit enforces that each story is independently deployable and testable. This is a natural fit for our existing test-per-story practice (contract tests, integration tests). No regressions if one story ships at a time.

4. **Constitution already enforces CI gates but light on testing specifics** — The existing constitution (v1.0.0) requires `npm run lint` and smoke testing for automation logic, but doesn't name `npm run test` as a blocker. We should strengthen this and add test-first discipline for bug fixes.

5. **Fixtures and test-data strategy not templated** — Plan and task templates don't mention fixtures, mocks, or test-data versioning. For STFC (API responses, realistic game state), this is a gap. We need a "Fixtures & Test Data" section in plan.md.

6. **Reviewer gate opportunity** — As Tester, I can veto a spec before `/speckit.tasks` if criteria aren't testable, veto tasks before `/speckit.implement` if test tasks are missing, and veto PRs if coverage isn't mapped. This is a natural checkpoint.

7. **Test-quality checklist can be automated** — `/speckit.checklist` is flexible; we can create a re-usable checklist that validates: all acceptance criteria covered, edge cases tested, fixtures versioned, no skipped tests. This becomes a living gate.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Bashir's key contribution:** Flagged BIGGEST RISK — tests are optional in speckit templates. Proposed mandatory test-first discipline: Spec Review gate (acceptance criteria testable), Tasks Review gate (test tasks required), Implementation Review gate (all criteria have passing tests), Bug Fix gate (new test that failed before fix).

**Cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates. Agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.
- **Picard coordinating amendment:** Will incorporate Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.

**Status:** Phase 1 (Briefing) complete. Phase 2 pending: Picard drafts constitutional amendment v1.1 with Sync Impact Report. Bashir owns test-quality checklist template.

---

### 2026-05-08T21:33:38Z: Phase 2 Critique Convergence — v1.1 Constitution Proposal Complete

**Verdict:** APPROVE_WITH_EDITS (two enforcement gaps identified across team)

**Full critique at** `.squad/orchestration-log/2026-05-08T21-33-38Z-bashir.md`

**Team Convergence on Enforcement Infrastructure:**
- **Scotty:** Confirmed build/tooling requirements met; no new infrastructure debt.
- **Uhura:** Flagged CI enforcement gap (token-scanner is blocking prerequisite for Principle VII).
- **Borg Queen:** Caught Principle IV/IX contradiction; new test suite must be acknowledged in v1.0.0 text.

**Two Enforcement Gaps Identified:**

1. **Pre-commit hook missing (Principle IX)** — "run tests before check-in" is stated but has no mechanical enforcement. NON-NEGOTIABLE language requires automation, not honor-system. Recommend: implement `scripts/pre-commit.sh` to block commits if `npm test` fails, OR add TODO with clear pre-ratification commitment.

2. **Verification gap on test-first (Principle IX)** — Reviewers cannot verify that test actually failed before fix in direct PR context. Recommend: add documentation requirement to PR description (test failure output with timestamp, or commit history evidence).

**Reviewer Gates Section:** ✅ All four veto powers granted as Phase 1 proposed. Language is strong ("may BLOCK"). This is excellent.

**What's Strong:**
- Principle IX overall is excellent (NON-NEGOTIABLE language, clear test-first rule, acceptance-criteria coverage mandate).
- Direct PR exception is pragmatic and honest about project's maintenance-heavy reality.
- Speckit Reviewer Gates section grants all Phase 1 proposed veto powers.

**Ratification Path:** Fix enforcement gaps (pre-commit hook OR TODO) before merge. Verify Principle IV/IX contradiction is resolved.

---

### 2026-05-08T21:29:57-07:00: Phase 2 — Critique of v1.1 Constitution Proposal

**Four-question critique delivered to `.squad/decisions/inbox/bashir-speckit-v1.1-critique.md`**

#### Key findings:

1. **Q1 — Test-first on bug fixes: 🟡** Principle IX is crystal-clear on test-first requirement ("fails before the fix, passes after"), but has verification gap: reviewers cannot inspect commit history from PR alone to confirm test actually failed before fix. Recommend adding documentation requirement to PR description.

2. **Q2 — Run tests before check-in: 🟡** Rule is unambiguous and command matches package.json exactly, but **CRITICAL: no enforcement mechanism.** Constitution says "MUST pass locally" but names no pre-commit hook, no CI gate, no automation. It's a rule without teeth — pure developer honor. This contradicts the NON-NEGOTIABLE language in Principle IX. Recommend pre-commit hook implementation or explicit TODO before ratification.

3. **Q3 — Reviewer veto powers: ✅** All four veto powers granted exactly as I proposed in Phase 1: (a) spec testability, (b) task-level test requirements, (c) implementation coverage mapping, (d) bug-fix test-first. Speckit Reviewer Gates section is strong and explicit.

4. **Q4 — Checklist template format: Answered** The veto powers are sufficient for the constitution. Checklist should be a separate operational artifact (`.specify/templates/checklist-template.md`), not codified in governance. Constitution names the gates; tooling (checklist) evolves separately.

#### Overall verdict: 🟡 Solid structure; two enforcement gaps need closing

- **Q2 is the blocker:** The "MUST pass locally" rule for `npm test` has no enforcement gate. Without a pre-commit hook or CI required-check, this rule is aspirational, not binding.
- **Q1 has a gap:** Test-first for bug fixes is clear, but verification relies on reviewer honor and undocumented test failure.

#### Strengths observed:
- Principle IX overall is excellent (NON-NEGOTIABLE, clear test-first, acceptance-criteria coverage mandate)
- All four reviewer veto powers granted explicitly
- Direct PR pragmatism is honest about maintenance-heavy reality (~80–90% of PRs are single-file maintenance)

#### Recommendation for Picard:
Ratification should be conditioned on (a) commitment to pre-commit hook for `npm test` blocking, (b) one-sentence addition to Principle IX about verifying test failure via PR description documentation.

---

### 2026-05-08T21:29:58-07:00: Phase 3 (Path A) — Test-first proof workflow built

**What:** Closed the Principle IX honor-system gap identified in Phase 2 critique. Three files created:

1. **`.github/pull_request_template.md`** — New PR template with five required sections:
   - *Type of change* (checkboxes; at least one must be ticked)
   - *Test-first evidence* (conditional; required when "Bug fix" is ticked — asks for failing-test commit SHA, test name + path, failure stdout, and passing stdout after fix)
   - *Spec linkage* (required for non-trivial changes per Principle VI threshold, or explicit exempt justification)
   - *Tests run* (checkbox confirming `npm test` passed locally)
   - *Constitution check* (checkbox + space for documented tensions)
   - *Manual smoke-test* (required for automation-logic changes)

2. **`CONTRIBUTING.md`** — Repo root contributor guide with three sections:
   - *Test-first discipline for bug fixes* — full concrete example (failing commit → fix commit → PR description), explicit statement that PRs without evidence get `request-changes` from Bashir
   - *Speckit usage* — decision tree keyed to Principle VI's Pragmatic threshold (when required vs. when direct PR is allowed)
   - *Review gates* — all four Tester veto powers named explicitly: (a) spec testability, (b) task-level test requirements, (c) implementation coverage mapping, (d) bug-fix test-first

3. **`.specify/memory/reviewer-runbook.md`** — Step-by-step reviewer checklist (9 steps) covering: type-of-change read, bug-fix SHA verification procedure, spec linkage check, artifact-hygiene scan (Uhura's domain), tests-run checkbox, constitution check, CI gate, smoke-test gate, and a decision table. Closes the gap by giving reviewers a concrete procedure — not just a principle.

**Why:** The Phase 2 critique identified that "the PR description MUST cite the test" is unenforceable without a template that forces the author to supply specific evidence. Reviewer honor alone cannot verify test-first. The SHA verification step in the runbook makes the check mechanical: `git checkout <sha> && npm test` either shows the test failing or it doesn't.

**Coordination note:** Left `.squad/decisions/inbox/bashir-test-first-proof-built.md` for Scotty (pre-commit hook) and Uhura (artifact scanner) per their domains.

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

---

### 2026-05-08T21:29:58-07:00: Cross-Lane Assembly — v1.2.0 Constitution

**Role:** Assembler/arbiter. Uhura owned Principles I, III, V, Security & Compliance.
Scotty owned Principles II, IV, Development Workflow. Bashir assembled without reading
Picard's locked-out v1.1.1 draft.

**What I learned about cross-cutting assembly:**

1. **Lane discipline pays off at the seams.** Uhura and Scotty produced independent
   patches that were almost completely non-overlapping in substance. The only true seam
   conflict was structural (Speckit Reviewer Gates section level), not content. When
   authors work from the same verified repo rather than from each other's drafts, the
   resulting patches fit together cleanly.

2. **Structural conflicts are different from content conflicts.** The Reviewer Gates
   promotion (sub-section → standalone section) required an assembly call, not a
   content edit. The assembler's job at the seams is to pick a consistent structure
   and document it — not to resolve competing claims about reality. In this assembly,
   both seam issues (section level, section title) had one answer that was clearly
   correct given the task format.

3. **Open questions from lane authors should have a forcing function.** Uhura listed
   three open questions. Without the assembly step, those questions could sit open
   indefinitely. As assembler I was in the right position to make a call on each one
   — I had the full document in front of me, could assess V's actual length, and could
   compare both lanes' evidence against the Borg Queen findings. The fold/split
   decision in particular required seeing the assembled Principle V before calling it.

4. **The cross-check table earns its weight.** Both Uhura and Scotty produced thorough
   per-lane cross-checks. The assembly memo's cross-check table synthesizes those into
   a single auditable artifact — useful for Borg Queen's next verification pass. Don't
   skip it even when both lane authors have already done the work; the synthesis step
   catches claims that are correct in isolation but inconsistent when combined.

5. **Verbatim preservation requires active decision-making.** The v1.1.0 Principle VIII
   rationale tail references "Principle III (Resilient DOM Automation)" — the old name.
   That cross-reference is stale in v1.2.0. Assembly mandate says preserve verbatim,
   but the stale cross-reference is a real (if minor) problem. The right call was to
   flag it for Borg Queen rather than silently patch it (which would be re-authoring)
   or silently leave it (which would be shipping a stale cross-reference). When verbatim
   preservation and accuracy conflict at the seam, surface it — don't swallow it.

6. **The adjudicator role is lighter than the author role, and that's the point.**
   All three adjudications (fold/split, SHA-pinning scope, redaction asymmetry) were
   calls about scope and structure, not about what the repo actually does. Uhura and
   Scotty had already done the evidence work. The assembler's value-add is the forcing
   function and the rationale — making a documented call that unblocks shipping rather
   than leaving the question open for another round.

**Ratification path:** Assembled draft at `.squad/.scratch/constitution-v1.2.0-assembled.md`
is ready for Borg Queen verification. After Borg Queen's pass, user authorizes
ratification, at which point the draft replaces `.specify/memory/constitution.md` and
the three PENDING template updates (plan-template, spec-template, tasks-template,
copilot-instructions) are executed in a follow-up PR.

---

## v1.2.0 Amendment Cycle — Assembly & Deadlock Resolution (2026-05-08 → 2026-05-09)

### Session: speckit-v1.2.0-ratification-with-known-tensions

**Status:** COMPLETE. v1.2.0 ratified with Known Tensions (Path D acceptance).

**Bashir's role:** Assembler (parallel-lane patches); adjudicated 3 open questions; locked out per reviewer-rejection protocol; witnessed deadlock resolution and Tuvok escalation.

**Context:** Picard's v1.1.1 draft was rejected; parallel-lane revision authorized (Uhura + Scotty). Bashir assembled both lanes. Borg Queen rejected assembly (9 findings). Bashir locked out as part of 3-author lockout. Coordinator escalated: cast Tuvok (new Process Auditor) to break deadlock.

**Adjudications made:**
1. **Redaction asymmetry (Uhura open question 1):** Deferred to v1.3 (code change needed). Asymmetry is honest to repo state; widening scope would block ratification on implementation work.
2. **SHA-pinning scope (Uhura open question 2):** Accepted narrow scope (token-handling workflows only). Matches repo exactly; wider claim would require code changes.
3. **Token Capture Custody location (Uhura open question 3):** Kept folded into Principle V (not standalone Principle X). Coherence maintained; no re-numbering.

**All three adjudications ratified by Borg Queen's verification passes; no objections raised.**

**Lockout duration:** Cycle-scoped. Resets for v1.3.0 cycle.

**Witness to deadlock resolution:** Observed that when 3-author lockout exhausts revision capacity, Path D (Known Tensions ratification) + new-agent escalation (Tuvok) is a valid exit. The deadlock-breaking process:
1. Recognize 3-author revision exhausted → decision point required
2. Coordinator evaluates: Path D (Known Tensions) vs. Path E (new author escalation)
3. If escalation chosen: cast eligible new author (not in prior revision cycles)
4. New author applies surgical edits + transcribes findings as Known Tensions
5. Known Tensions queued for v1.3.0 resolution; constitution ratified

**Lesson for next cycle:** The assembly role required lateral thinking — not "who is correct?" but "what is the correct structure for this document?" That mindset is different from authoring. Recommend: in future cycles, consider deputizing an assembler earlier (not just after parallel lanes) to catch inconsistencies mid-draft rather than at the seam.

**Next phase:** Tuvok applied edits and Known Tensions transcription; Borg Queen Pass 3 verified; cyrusj accepted Path D; speckit.constitution applied v1.2.0 to live constitution.

---

### 2026-05-08T23:43:31.290-07:00: Test Suite Recon Complete — Spec-Encoding Analysis

**Role:** Reverse-engineer test suite and produce language-agnostic acceptance criteria catalog.

**Deliverable:** `.squad/.scratch/spec-recon-bashir.md` — 160+ acceptance criteria extracted from 8 test files.

**Key Findings:**

1. **Test framework is intentionally minimal.** Node.js native `node:test` + `node:assert/strict`. No Jest, Vitest, or external framework. This is a deliberate choice: the project values simplicity and avoids test-framework version lock-in. When the project is reimplemented, the equivalent in Python/Go/Rust/etc. can use that language's native test runner (unittest, testing/t, etc.).

2. **Test suite is **exhaustively modular**.** Every module has exactly one `.test.ts` file in a parallel directory under `tests/`. No composite tests, no integration-level scaffolding. This is excellent for our recon goal: each test file is self-contained, with minimal test-file-to-test-file coupling.

3. **Fixtures are **intentionally minimal and hand-coded**.** JSON fixtures are small, specific, and *not* captured from real API responses. They are *designed* fixtures (clean-spec, contaminated-spec, claim-success, etc.) — structured to exercise specific code paths without embedding real account data. This supports the Artifact Hygiene Principle VII beautifully: fixtures are safe to commit.

4. **Error handling is **security-first**.** Redaction tests are extensive and comprehensive. Every secret pattern (JWT, Bearer, GitHub token, AWS key, API key, STFC account data) is explicitly tested. The redaction module is the *third-most-tested* module (21 test cases), demonstrating that secret-leakage prevention is not an afterthought — it's a first-class concern.

5. **Orchestration tests use **fake clients, not mocks**.** The runAll tests provide hand-coded FakeClient implementations instead of mocking the ApiClient class. This is more maintainable than Jest mock spy tracking: the fake client is immediately readable, its behavior is explicit, and the test logic is decoupled from test-framework magic.

6. **Observable gaps in test coverage are **honest and acknowledged**.** The runAll.test.ts file explicitly documents a skipped test case (promo file read errors) with a comment explaining why (platform-specific, flaky, requires fs mocking). This is mature: tests don't paper over gaps with [skip]; they document them. Any reimplementation should address this gap explicitly.

7. **Retry logic is **testable but under-specified**.** The ApiClient retries GET once on 5xx but NOT POST. The tests verify this happens, but there is no test for exponential backoff, retry delay, or jitter. The recon document flags this as a gap: "retry delay / exponential backoff not tested" — any reimplementation must decide whether to add backoff or keep it simple (current spec is: no backoff, single retry).

8. **History file semantics are **stateful and insertion-ordered**.** The runAll tests demonstrate that history file rows are inserted in "newest-first" order (new rows appear BEFORE old rows, below the table header). This is a subtle ordering requirement that must be preserved in reimplements. Good catch from the tests: easy to get wrong if you append to the end instead of inserting after header.

9. **Acceptance criteria are **precisely testable as written**.** Every MUST statement in the recon document can be traced back to at least one `assert()` call in the test suite. The reverse is also true: no test case was left hanging or unexplained. This is the gold standard for executable specs.

10. **Multi-account orchestration is **designed but under-tested at scale**.** Tests cover 1 account and 2 accounts (one success, one TokenExpired). No tests for 10+ accounts, edge cases in mixed-success scenarios, or performance characteristics. The recon document flags this as a gap for reimplementers.

**Test Count Summary:**
- **Total test cases:** 92 (across 8 test files)
- **jwt.test.ts:** 18 (2.1 Account Parsing: 15 tests; Expiry: 3 tests)
- **accounts.test.ts:** 15 (parsing + validation)
- **outcomes.test.ts:** 22 (classification logic)
- **promoCodes.test.ts:** 8 (parsing + file I/O)
- **redact.test.ts:** 21 (redaction rules across 3 functions)
- **summary.test.ts:** 8 (Markdown helpers + writer)
- **client.test.ts:** 12 (HTTP methods, errors, retries, security)
- **runAll.test.ts:** 8 (orchestration scenarios + history)

**Recon Document Stats:**
- **2.1 acceptance criteria** (language-agnostic MUST/SHOULD statements)
- **6 major modules covered** (accounts, jwt, promoCodes, redaction, outcomes, API client, orchestrator)
- **4 edge-case categories** identified
- **9 spec gaps** documented (areas not tested but observable in code review)
- **Artifact hygiene contract** fully specified (6 patterns + watched prefixes + remediation rules)

**Rationale for Gaps Section:**
I deliberately included "Behaviors NOT Currently Tested (Spec Gaps)" because a language-agnostic spec should be honest about what's observable vs. aspirational. The gaps are not criticisms; they are anchors for reimplementers: "If you implement this module, these 9 scenarios are currently untested in the reference implementation — decide whether to test them or accept the risk."

**Constitutional Alignment:**
This recon document enforces Principle IX (Test-first) by making tests the *source of truth* for behavior, not a secondary artifact. The 92 test cases are the spec; the MUST statements are the executable requirements. Any reimplementation that doesn't pass an equivalent test suite is, by definition, incomplete.

**Next Phase (if assigned):**
- Create a `test-equivalence-matrix.md` mapping test files to language-specific test framework analogs (Go's `testing.T`, Python's `unittest`, etc.)
- Build a recon-based test generator (read the MUST statements, emit test stubs for a new language)

---

### 2026-05-12: Database Recon — Entity-Shape Patterns for Future Fixtures

Pulled the STFC entity database for fixture-shape mapping. Captured to
`.squad/knowledge/stfc/database.md`. Headline learnings (the ones that
should drive every future STFC-data fixture in this repo):

**1. The "official" database page is a thin portal — real data lives at
stfc.space (community PWA, JS-rendered) backed by `data.stfc.space`
translation JSONs.** Anonymous CLI access works for `/translations/en/<type>.json`
but NOT for `/<type>/summary.json` (the stat-bearing files appear to need
the SPA's bootstrap context). For fixture purposes the i18n files give us
strings + IDs + a clean uniform schema; that's enough to drive 80% of
realistic fixture work without scraping the SPA.

**2. Universal i18n shape:** every translation row is
`{id: int|null, key: string, text: string}`. `id` is the stable numeric
entity key when non-null; `null` = pure UI string. Lock this shape with a
JSON schema and reuse it across ships/officers/factions/etc. Multiple `key`
values can share an `id` (officer 124 has both `officer_name` and
`faction_character_name`).

**3. IDs are integers, never slugs, and span three size classes:**
small dense (0–1000) for legacy entities, 5-digit grouped (35xxx, 88xxx,
90xxx) for content drops/factions, and 9–10-digit (1000162982) for
procedurally-generated systems and missions. **Never use `range(1, N)` to
populate fixture IDs** — production IDs are non-contiguous and a contiguous
loop will hide off-by-one bugs that production data exposes immediately.

**4. Names are NOT unique keys.** Confirmed duplicates: faction `Borg`
(id=13 AND id=84003), `Maverick` (88001 / 88005), `Flashpoint` (80002 / 80003);
ships `U.S.S. ENTERPRISE` (10 / 29 — original-cast vs Kelvin), `D'DERIDEX`
(47 / 35013), `VOR'CHA` (35005 / 50), `NEGH'VAR` (54 / 60007). Synergy
groups have `Galaxy Quest` (id 42, Title) AND `GALAXY QUEST` (id 54,
SHOUT) as DIFFERENT groups. **Any test that keys on display name will
silently merge distinct entities.**

**5. Production ships data with typo'd keys.** Real keys observed in live
data:
  - `officer_tootltip_description_short` (extra "t") — 87 rows
  - `factian_name_upper_plural` (should be "faction_*")
  - `reserach_project_description` (should be "research_*") — 3 rows
Loaders should accept BOTH the typo'd and canonical forms, OR fail loudly
with the bad-key name in the error message. Silently dropping these rows
loses real entities.

**6. Inconsistent API entity-slug pluralisation.** Singular: `building`,
`hostile`, `research`, `resource`. Plural: `ships`, `officers`, `missions`,
`systems`, `consumables`, `factions`. Special: `forbidden_tech`, `chaos_tech`,
`loyalty`, `starbase`. **Any URL builder MUST be tested against the actual
slug for each entity type, not derived by pluralising.**

**7. Multi-faction is real and encoded as icon concatenation.** JS bundle
ships `${G.Federation}${G.Klingon}` and `${G.Romulan}${G.Federation}${G.Klingon}`
templates; assets include `federation_klingon.png` and
`federation_klingon_romulan.png`. A single ship/officer can belong to up
to 3 factions. Fixtures with only single-faction entities will hide
multi-faction bugs. **At least one multi-faction entry in every test
fixture set.**

**8. Rich-text and Unicode in display strings.** Real production strings
include:
  - Unity rich-text: `Frontier Raider <color=#FFEF40>HAZ</color>`
  - Format placeholders: `<color=#{0}>Harry Mudd</color>`
  - Greek: `Imperial Starfleet Ω-Annihilator`
  - Stars: `★ FEDERATION SCOUT`, `Aggregation Extractor ★`
  - Arrow variant discriminators: `Actian Chrysalis ⇀ / ⇁ / ⇂` (three
    DIFFERENT hostiles)
  - Synergy-group arrows: `⇦ RETALIATION SQUAD`, `⇧ RETALIATION SQUAD`,
    `⇥ RETALIATION SQUAD` (three DIFFERENT groups)
**Any normalize-to-ASCII or strip-non-printable step will collapse
distinct entities. If we ever sanitize display strings, the test suite
must include the arrow trio and assert post-normalize they remain
distinguishable.**

**9. Sentinel placeholder text.** `MISSING DESCRIPTION`, `[PH] …`,
`DO NOT USE`, `????` (literal four question marks — synergy group id 15),
single periods `"."` (resources 9056-9060 + thousands of procedural
systems/missions). Display-rendering tests need at least one of each.

**10. Codename ≠ display name.** `resource_duranium` key has display text
`"PARSTEEL"`. Any code that joins on internal codenames must keep both
the codename and the player-facing display name, not assume they match.

**11. British spelling in production data.** Systems file uses `flavour`
(not `flavor`) as a key. Don't normalize to US spelling — mirror exactly.

**12. Whitespace quirks in real names.** `Academy Training Drone  ⇔` has
a DOUBLE space before the arrow. Trim-on-load is dangerous; collapse-internal-whitespace is even more dangerous (would break the arrow-discriminated
synergy groups too).

**Edge cases I will defend against in any future STFC fixture set** (full
table in `database.md`, summary here):
apostrophes (`B'REL`), periods-in-name (`U.S.S. ENTERPRISE`), hyphens
(`Xindi-Reptilian`), ampersand (`BLOOD & HONOR`), Greek (`Ω`), star (`★`),
Unity rich-text (`<color=…>…</color>`), arrow-variant discriminators
(`⇀ / ⇁ / ⇂`), period-only `text`, empty `text`, `MISSING DESCRIPTION`
sentinel, multi-faction entity, duplicate display names with distinct IDs,
non-contiguous integer IDs, mixed-case casing in same entity type, typo'd
keys in production, codename ≠ display name, slug-inconsistent API URLs.

**Charter alignment:** This is exactly the kind of "what shapes will fixtures
need to mirror" reconnaissance that lets us write integration tests with
realistic inputs (per my charter — "Prefer integration tests with realistic
inputs over mocks-of-mocks"). Logged a team-relevant decision proposal in
`.squad/decisions/inbox/bashir-database-recon.md` calling out the most
defensible fixture-design rules to bake into our test culture before anyone
actually writes the first STFC-data-shaped test.

**Open question I flagged for the team:** the gift-redeemer codebase may
not actually need any of this — its API surface is `redeem-code` flow,
which probably never touches ship/officer/faction names. If so, this
recon is forward-looking only. I have NOT proposed adding fixtures to
the repo yet; that decision belongs to whoever actually owns the next
feature spec.

---
