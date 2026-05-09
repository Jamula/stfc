<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0 (MINOR)

Bump rationale: MINOR — backward-compatible additions. Four new Core
Principles (VI–IX) and expanded Development Workflow & Governance sections
impose new obligations but do not remove or redefine any existing principle.

Preserved principles (unchanged):
  I.   User Safety & Trust First (NON-NEGOTIABLE)
  II.  Dual-Platform Parity
  III. Resilient DOM Automation
  IV.  Type-Safe, Component-First UI
  V.   Transparent Local-Only Persistence

Added principles:
  VI.  Specification-First Governance
  VII. Artifact Hygiene
  VIII. Wire-First Discovery
  IX.  Test-First Discipline

Modified sections:
  - Development Workflow & Quality Gates
    * Added `npm test` to required local checks before merge.
    * Added CI enforcement note (items 1 and artifact hygiene are CI-gated).
    * Added Speckit Reviewer Gates sub-section (Bashir/Picard veto powers).
    * Reconciled manual smoke-test requirement with speckit.implement workflow.
  - Governance
    * Added "Known Tensions & Structural Answers" sub-section addressing
      brownfield reality, smoke-test collision, and abandonment risk.
    * Added abandonment early-warning signal (3-consecutive-skip retro rule).
    * Added annual process review commitment.

Removed sections: None

Finalize pass: 2026-05-08T21:37:54-07:00 (Picard — Phase 3 convergence)
Finalize changes:
  - Fixed Principle IV rationale — resolved IV/IX contradiction caught by
    Borg Queen (v1.0.0 "no automated test suite" vs. IX's npm test mandate).
  - Tightened Principle VI version-bump exemption — Scotty's critique:
    clarified that only dependency-field changes are exempt; package.json
    script/config changes are NOT exempt from the trigger threshold.
  - Promoted enforcement infrastructure from deferred TODOs to ratified
    policy — Uhura (CI token-scanner), Scotty/Bashir (npm test CI gate)
    implementing this batch under Path A (Full Ship). Outcomes stated as
    enforced facts; .github/workflows/ referenced without hardcoded paths.
  - Added enforcement outcome bullets to Principles VII and IX, and an
    enforcement note to the Development Workflow required-checks list.

Ratification pass: 2026-05-08T21:29:58-07:00 (speckit.constitution)
Templates updated during this ratification:
  - .specify/templates/plan-template.md       UPDATED — Constitution Check
    section now lists all 9 principles plus an "Artifact Hygiene Check"
    CI-gate row, with PASS/FAIL/N/A status guidance.
  - .specify/templates/spec-template.md       UPDATED — Added "API Contract"
    section (mandatory for changes touching external integrations) per
    Principle VIII, with Principle VII redaction reminders inline.
  - .specify/templates/tasks-template.md      UPDATED — Removed
    "tests are OPTIONAL" language; tests are now REQUIRED whenever
    acceptance criteria exist; reordering rule (tests before
    implementation) made explicit per Principle IX.
  - .specify/templates/checklist-template.md  PENDING — Bashir's
    test-quality checklist items (CHK001–CHK020) to be encoded in a
    follow-up post-ratification PR (see TODO below).
  - .github/copilot-instructions.md           PENDING — Add explicit
    Principle VI/VII awareness for AI agents (no real tokens/account
    data in generated artifacts; speckit-required trigger threshold).
  - README.md / docs/                         NO CHANGE NEEDED at
    ratification time.

Enforcement infrastructure (ratified concurrent with this constitution):
  - CI token-scanner: blocks spec/plan/tasks files containing JWT-shaped
    strings from merging, enforced by the workflows in .github/workflows/.
  - npm test CI gate: commits that fail `npm test` are blocked from merging,
    enforced by the workflows in .github/workflows/.
  - Bug-fix test-first proof: bug-fix PRs must include a documented
    failing-test-then-passing-test artifact (test file + scenario), enforced
    at the Bashir reviewer gate.

Follow-up TODOs:
  - TODO(POST-RATIFICATION): Create reusable /speckit.checklist template
    encoding Bashir's test-quality checklist (CHK001–CHK020).
  - TODO(POST-RATIFICATION): Update .github/copilot-instructions.md with
    Principle VI/VII awareness for AI-generated artifacts.
-->

# STFC Gift Redeemer Constitution

## Core Principles

### I. User Safety & Trust First (NON-NEGOTIABLE)

The user's account credentials, session cookies, and game data MUST remain
under the user's exclusive control at all times.

- The application MUST NOT collect, store, transmit, proxy, or log
  credentials, cookies, session tokens, or any personally identifying game
  account data.
- All authentication MUST occur in the user's own browser session against
  `startrekfleetcommand.com` directly; the app only observes login state via
  DOM/cookie presence checks.
- Automation scripts MUST be human-readable, unminified in source form, and
  reviewable by the user before execution. No obfuscated payloads.
- The app MUST only perform actions a logged-in user could perform manually
  through the official store UI; no exploitation of undocumented APIs and no
  privilege escalation.

Rationale: This is a third-party automation tool acting on a user's live
account. Trust is the product. Any compromise here invalidates the project.

### II. Dual-Platform Parity

Every user-facing capability MUST ship in both the web app and the browser
extension, OR be explicitly documented as platform-exclusive with a stated
technical reason (e.g., persistent auth requires extension privileges).

- Shared business logic (gift detection, redemption flow, history shape,
  types) lives in `src/lib/` and MUST be consumed by both `src/App.tsx` and
  `extension/`. Logic MUST NOT be duplicated across platforms.
- Storage access (Spark KV in the web app, `chrome.storage.local` in the
  extension) MUST be encapsulated so calling code does not branch on platform.
- Any platform-exclusive feature MUST be listed in the README comparison
  table with the reason it cannot be ported.

Rationale: Divergent feature sets create maintenance debt and surprise users
who switch platforms. A single source of truth for behavior keeps both
deliverables coherent.

### III. Resilient DOM Automation

The STFC store is a third-party site we do not control. All DOM-driven code
MUST treat the page as untrusted, mutable, and partially loaded.

- Selectors MUST use multi-pattern fallbacks (text match, role, attribute)
  rather than relying on a single brittle CSS path or auto-generated class.
- Every DOM lookup MUST handle the missing-element case without throwing;
  failures surface as structured, user-visible status, not console errors.
- Automation runs MUST emit progress feedback (current step, total, errors)
  consumable by the UI; silent loops are forbidden.
- Confirmation/accept dialogs MUST be matched by intent (text patterns
  covering common variants), not by a single hard-coded selector.
- When the store layout changes and breaks redemption, the failure MUST be
  detectable from logs/UI within a single user run — never silent success.

Rationale: We have no contract with the upstream site. Defensive automation
is the only way to keep the tool useful across game updates.

### IV. Type-Safe, Component-First UI

All UI code MUST be TypeScript React function components built on the
existing Shadcn UI + Radix + Tailwind stack.

- New UI MUST reuse components in `src/components/ui/` before introducing
  raw HTML elements or new dependencies. Adding a UI primitive requires a
  justification in the PR description.
- `tsc -b --noCheck` is the build path; types MUST still compile under
  strict checking locally before merge. Unsafe `any` is permitted only at
  boundaries with untyped vendor APIs (Spark, Chrome extension APIs) and
  MUST be narrowed to a typed shape before flowing into application code.
- Styling MUST go through Tailwind utility classes or `theme.css` tokens.
  Inline styles are reserved for dynamic values that cannot be expressed
  as classes.
- `npm run lint` MUST pass with zero errors before merge.

Rationale: The type system and a consistent component vocabulary are the
primary safety nets for UI-layer correctness and component discipline. Note:
The v1.0.0 text stated "no automated test suite" because none existed at
that time. As of v1.1.0, Principle IX mandates an automated test suite that
must pass on every commit. Principle IV's obligations are unchanged; the
type system and the test suite are complementary safety nets, not competing
claims.

### V. Transparent Local-Only Persistence

User-generated data (gift history, preferences) MUST live on the user's
device and be fully under their control.

- The web app MUST persist via Spark KV; the extension MUST persist via
  `chrome.storage.local`. No remote backend, no cloud sync, no third-party
  analytics or telemetry.
- The user MUST be able to view all stored history and clear it from the UI.
- New stored fields MUST be additive and tolerant of missing keys from
  older installs; data migrations MUST not require user intervention.

Rationale: A no-backend posture removes an entire class of privacy,
compliance, and operational risk and is a core user-trust commitment.

### VI. Specification-First Governance

The team follows spec-driven development: non-trivial work is validated
against the project constitution through the Spec Kit workflow before code
is written. This principle operationalizes the directive "use speckit when
possible" with an explicit, enforceable trigger threshold.

**Speckit is REQUIRED for work that meets ANY of these criteria:**

- Multi-file changes spanning different modules or concerns.
- Cross-skill work (changes touching more than one `skill:*` entry point).
- New features or new user-facing capabilities.
- Work estimated to take more than 4 hours of implementation effort.
- Changes touching build configuration, CI workflows, or `package.json`
  scripts.
- Changes to the STFC API contract (new endpoints, changed request/response
  shapes, auth-flow modifications).

The required workflow is: `/speckit.specify` → `/speckit.clarify` (if
ambiguity exists) → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`
→ `/speckit.analyze` (recommended) → `/speckit.checklist` (recommended).

**Direct PR is permitted (speckit NOT required) for:**

- One-line fixes and typos.
- Dependency version bumps and routine package updates — changes to the
  `dependencies` or `devDependencies` fields in `package.json` only.
  NOTE: Changes to `package.json` `scripts`, build configuration, or CI
  workflows are NOT exempt; they meet the trigger threshold above.
- Single-file bug fixes that do not touch API contracts or cross-module
  boundaries.
- Documentation-only edits.

**When in doubt, use speckit.** The cost of an unnecessary spec is low; the
cost of an unreviewed architectural decision is high.

- Constitution violations MUST be caught during `/speckit.plan`, not
  deferred to code review. The plan's Constitution Check section MUST list
  every principle touched and confirm non-violation.
- When a spec or plan conflicts with the constitution, the constitution
  wins. Amendment requires an explicit PR and team consensus.
- Completed specs, plans, and implementation artifacts MUST be retained in
  `.specify/features/` as version-controlled reference. They are
  organizational memory, not disposable scaffolding.
- Speckit is tooling, not governance. If any speckit output violates the
  constitution, governance wins. The team may revise the output or restart
  the workflow.

Rationale: "Use speckit when possible" is team policy. This principle gives
that directive teeth by defining exactly when "possible" means "required"
and when a lighter-weight path is acceptable. The trigger threshold
(Pragmatic / Option B) was selected by the project owner to balance
discipline against the overhead of a brownfield, maintenance-heavy project.

### VII. Artifact Hygiene

Development artifacts — specs, plans, tasks, code comments, PR descriptions
— MUST NOT contain real authentication tokens, account data, or unsanitized
live API responses.

- Do NOT paste captured JWTs, session cookies, or API keys into spec, plan,
  or tasks files, even as examples. Use `<REDACTED>` placeholders.
- Do NOT include real gift IDs, account names, player IDs, or inventory
  data in requirements or acceptance criteria.
- Do NOT commit raw HTTP response bodies from live accounts. Extract
  sanitized contract examples with placeholder values instead.
- When capturing traffic for research, store raw captures in untracked
  locations (`.env`, local machine only). Extract sanitized shapes for the
  spec's API Contract section, then delete the raw capture. Never commit it.
- Code review MUST verify no tokens or account data leaked into spec, plan,
  or tasks files before merge.
- Spec, plan, and tasks files containing JWT-shaped strings or bearer-token
  patterns are blocked from merging, as enforced by the CI workflows in
  `.github/workflows/`. This is a hard gate, not an honor-system check.

Rationale: Specs, plans, and tasks are committed to the repository and
indexed by search engines, AI systems, and audit tools. Real tokens in
artifacts create security debt that Principle I's application-level
safeguards do not cover. This principle extends User Safety & Trust First
to the development process itself.

### VIII. Wire-First Discovery

For changes to external API integrations, implementation MUST be driven by
observed wire-level behavior, not assumptions about upstream behavior.

- Any parser, error-handler, or retry-logic change MUST be justified by:
  - A captured HTTP request/response pair showing the behavior, OR
  - Upstream documentation (changelog, API docs), OR
  - A measured test against a real account.
- Parsers MUST fail fast and emit structured errors when upstream violates
  assumptions (e.g., unexpected JSON schema).
- When the STFC store changes and breaks our code, treat it as a legitimate
  discovery moment and a spec amendment — not a quick-fix that skips
  documentation.
- API contract sections in specs MUST document request shapes, response
  shapes (success and error), HTTP status codes, and known edge cases
  (rate limits, token expiry mid-request, 5xx responses).

Rationale: The STFC store is third-party and unversioned. We cannot assume
stability. Defensive, evidence-based coding — grounded in what the wire
actually shows — is the only way to keep the tool useful across game
updates. This principle complements Principle III (Resilient DOM Automation)
for the API layer.

### IX. Test-First Discipline (NON-NEGOTIABLE)

Tests are not optional. Every bug fix includes a failing test first; every
commit passes the test suite.

- **Run tests before check-in:** `npm test` MUST pass locally with zero
  failures before any commit lands on any branch. No exceptions. No "I'll
  fix it in CI" deferrals. No skip clauses.
- **CI enforcement:** Commits that fail `npm test` are blocked from merging,
  as enforced by the CI workflows in `.github/workflows/`. The local
  obligation above remains — CI is the backstop, not the first line.
- **Bug-fix test-first rule:** Every bug fix MUST include a test that
  reproduces the bug (fails before the fix, passes after). The test MUST
  remain in the codebase. The PR description MUST cite the test by file
  and describe the scenario it covers.
- **Acceptance criteria coverage:** Every spec acceptance criterion
  (Given/When/Then) MUST map to at least one test case before the feature
  is considered complete. Acceptance criteria without tests block merge.
- **Fixtures and test data:** Test fixtures MUST be version-controlled
  (in `tests/`), reflect realistic STFC API response shapes, and never
  contain real account data (see Principle VII).

Rationale: The project has no extensive manual QA process; automated tests
are the primary regression safety net. The user directive "run tests before
checking in" is encoded here as a hard rule. Combined with Bashir's
test-first methodology, this ensures coverage grows with every bug fix and
feature, not just when someone remembers to write tests.

## Security & Compliance Constraints

- **Extension permissions**: `extension/manifest.json` MUST request the
  minimum permissions required for the current feature set. New permissions
  require a PR-described justification and a README update for end users.
- **Manifest V3**: The extension MUST remain Manifest V3 compatible; no
  background pages, no remotely hosted code, no `eval` / `new Function`.
- **CSP**: Popup and content scripts MUST be CSP-safe — no inline scripts,
  no inline event handlers, no string-evaluated code.
- **Third-party requests**: The application MUST only make network requests
  to `startrekfleetcommand.com` (and its required subdomains) on the user's
  behalf. Any other outbound request requires explicit constitutional
  amendment.
- **Licensing**: The project remains MIT-licensed (see `LICENSE`). New
  dependencies MUST be license-compatible (MIT/BSD/Apache-2.0/ISC).
- **Disclosure**: The README and extension store description MUST clearly
  state that the tool is unofficial and not affiliated with Scopely or
  Star Trek Fleet Command.

## Development Workflow & Quality Gates

- **Branching**: Feature work MUST occur on feature branches created via the
  `speckit.git.feature` workflow; direct commits to `main` are reserved for
  documentation and constitution updates.
- **Required local checks before merge**:
  1. `npm test` — passes with zero failures (Principle IX).
  2. `npm run lint` — passes with zero errors.
  3. `npm run build` — succeeds (web app build).
  4. `npm run build:extension` — succeeds when changes touch `extension/`,
     `scripts/`, or shared code in `src/lib/`.

  Items 1 (npm test) and Artifact Hygiene (Principle VII — JWT pattern
  scan) are enforced by the CI workflows in `.github/workflows/`; merge is
  blocked automatically on failure. The remaining items are locally verified
  and checked at code review.
- **Manual verification**: Any change to redemption flow, selector logic,
  or auth detection MUST be smoke-tested against the live STFC store
  (extension and web app) before merge, and the verification noted in the
  PR description. This requirement applies regardless of whether the code
  was authored by a human or generated by `/speckit.implement`. See
  "Known Tensions" in Governance for the reconciliation of this gate with
  agent-authored code.
- **Spec-driven changes**: Non-trivial changes MUST use the Spec Kit
  workflow per Principle VI. The trigger threshold in Principle VI is the
  authoritative definition of "non-trivial." Trivial changes (as defined in
  Principle VI's "Direct PR permitted" list) may bypass the flow.
- **Reviews**: At least one human reviewer MUST approve any PR that
  modifies automation logic, extension permissions, or data persistence.
  Reviewers MUST NOT reject code solely because it was generated by a
  speckit agent; they MUST evaluate it against functional requirements,
  constitutional principles, and test coverage.

### Speckit Reviewer Gates

Named reviewers hold specific veto powers within the Spec Kit workflow.
These gates exist to catch quality and coverage gaps that speckit tooling
cannot enforce on its own.

**Bashir (Tester) may BLOCK:**

1. **Spec review** (before `/speckit.tasks`): Acceptance criteria that are
   untestable, vague, or missing Given/When/Then structure. Edge cases
   enumerated in the spec but with no plan to cover them.
2. **Tasks review** (before `/speckit.implement`): Task lists that omit
   test tasks for user stories with acceptance criteria. Task ordering that
   places implementation before the corresponding test task (violates
   test-first).
3. **Implementation review** (before merge): Features where acceptance
   criteria in the spec do not have corresponding passing tests. Bug fixes
   without a reproducing test (Principle IX).

**Picard (Lead) may BLOCK:**

1. **Spec review**: Scope creep beyond the stated feature boundary.
   Specifications that conflict with constitutional principles without an
   explicit amendment proposal.
2. **Plan review** (before `/speckit.tasks`): Architectural choices that
   violate existing principles or introduce unapproved dependencies.
   Plans missing the Constitution Check section.
3. **Implementation review**: PRs that bypass the speckit workflow for
   work that meets the "speckit required" trigger threshold (Principle VI)
   without documented justification.

## Governance

This constitution supersedes ad-hoc conventions, prior README guidance, and
informal practice. When this document conflicts with another file in the
repository, this document wins and the conflicting file MUST be updated.

- **Amendments**: Proposed via PR that modifies
  `.specify/memory/constitution.md`, includes an updated Sync Impact Report,
  and identifies every dependent template or document that must change in
  lockstep.
- **Versioning policy** (semantic versioning of governance):
  - **MAJOR** — Removal or backward-incompatible redefinition of a principle
    or governance rule.
  - **MINOR** — Addition of a new principle/section or material expansion
    that imposes new obligations.
  - **PATCH** — Wording, clarification, typo, or non-semantic refinement.
- **Compliance review**: PR reviewers MUST check the Constitution Check
  section of the relevant `plan.md` (when present) and reject PRs that
  violate a principle without an entry in the plan's Complexity Tracking
  table justifying the deviation. For direct PRs (no plan.md), reviewers
  MUST spot-check constitutional compliance and flag violations in review
  comments. Compliance cannot be waived regardless of PR path.
- **Runtime guidance**: Day-to-day implementation guidance for AI agents and
  contributors lives in `.github/copilot-instructions.md` and the active
  feature plan; both MUST defer to this constitution where they overlap.

### Known Tensions & Structural Answers

This section acknowledges structural tensions between spec-driven
development and the project's operational reality. These are not defects —
they are trade-offs the team has consciously accepted and must manage.

**1. Brownfield / Maintenance Reality**

This project is a stable, feature-complete orchestrator (~400 LOC core
logic) running on a 4-hour cron schedule. The majority of PRs are
maintenance: dependency bumps, selector resilience fixes, promo-code
parsing tweaks, test additions. Spec Kit's full pipeline (4–7 hours of
overhead) is justified only for genuinely non-trivial work.

The Pragmatic trigger threshold (Principle VI) addresses this directly:
it requires speckit for multi-file, cross-module, or >4-hour work, while
explicitly permitting direct PRs for the single-file maintenance work that
constitutes most of the project's velocity. This is not an escape hatch —
it is an honest acknowledgment that a brownfield project's PR mix is
~80–90% maintenance, and the process must match that reality or it will be
abandoned.

**2. Smoke-Test / Agent-Implementation Collision**

The constitution requires manual smoke-testing of redemption flow, selector
logic, and auth detection changes against the live STFC store. An
autonomous agent (speckit.implement) cannot perform this verification.

Resolution: **Agents implement; humans verify.** The speckit workflow ends
at code review. For any PR touching automation logic, the human smoke-test
gate remains mandatory before merge, regardless of code authorship. The
agent's job is to produce correct, type-safe, test-passing code; the
human's job is to confirm it works against the live store. Both gates are
non-negotiable and sequential — not in conflict.

**3. Abandonment Risk (Early-Warning Signal)**

If speckit adoption erodes silently, the constitution becomes a document
the team maintains but does not follow.

**Early-warning rule:** If 3 consecutive non-trivial PRs (as defined by
Principle VI's trigger threshold) ship without a corresponding spec in
`.specify/features/`, the team MUST run a retrospective before the next
non-trivial PR proceeds. The retro asks:
  - Were these PRs genuinely non-trivial, or does the trigger threshold
    need recalibration?
  - Was speckit skipped for speed, and if so, what was the cost?
  - Does the team still believe in spec-driven development, or should the
    constitution be amended to reflect actual practice?

The constitution MUST match reality. If speckit is not being used, the
honest response is to amend the constitution — not to maintain a rule
no one follows.

**4. Annual Process Review**

Every 12 months from ratification, the team SHALL review:
  - Percentage of non-trivial PRs that used speckit.
  - Average time from spec to merge for spec-driven PRs.
  - Whether the trigger threshold is correctly calibrated.
  - Whether speckit adoption exceeds 50% for qualifying PRs.

If adoption for qualifying work drops below 50% over a trailing 6-month
window, governance MUST be amended. The process document must match
reality, or it must be updated — never left as a zombie.

**Version**: 1.1.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
