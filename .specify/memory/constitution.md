<!--
SYNC IMPACT REPORT
==================
Version change: TEMPLATE (uninitialized) → 1.0.0
Bump rationale: Initial ratification of the project constitution. No prior
versioned constitution existed; the file held only template placeholders.
MAJOR baseline established per semantic-versioning policy for governance docs.

Modified principles: N/A (initial ratification)
Added sections:
  - Core Principles (5)
    1. User Safety & Trust First
    2. Dual-Platform Parity
    3. Resilient DOM Automation
    4. Type-Safe, Component-First UI
    5. Transparent Local-Only Persistence
  - Security & Compliance Constraints
  - Development Workflow & Quality Gates
  - Governance
Removed sections: None

Templates requiring updates:
  - .specify/templates/plan-template.md       ⚠ pending — Constitution Check
    section is generic; recommend listing the 5 principles above as explicit
    gates on next plan authoring. No structural change required now.
  - .specify/templates/spec-template.md       ⚠ pending — Verify scope/NFR
    sections cover persistence-locality and automation-resilience callouts.
  - .specify/templates/tasks-template.md      ⚠ pending — Add task categories
    for selector-resilience verification and dual-platform parity checks when
    the next feature is planned.
  - .specify/templates/checklist-template.md  ✅ no change needed
  - README.md / INSTALLATION.md / QUICKSTART.md ✅ no change needed
  - .github/copilot-instructions.md           ✅ no change needed (delegates
    to current plan)

Follow-up TODOs:
  - TODO(RATIFICATION_DATE): Confirm 2026-05-08 with project owner; adjust if
    an earlier de-facto adoption date applies.
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

Rationale: The codebase is small and has no automated test suite; the type
system and a consistent component vocabulary are the primary safety nets.

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
  1. `npm run lint` — passes with zero errors.
  2. `npm run build` — succeeds (web app build).
  3. `npm run build:extension` — succeeds when changes touch `extension/`,
     `scripts/`, or shared code in `src/lib/`.
- **Manual verification**: Any change to redemption flow, selector logic,
  or auth detection MUST be smoke-tested against the live STFC store
  (extension and web app) before merge, and the verification noted in the
  PR description.
- **Spec-driven changes**: Non-trivial features MUST go through the
  Spec Kit flow (`speckit.specify` → `speckit.plan` → `speckit.tasks` →
  `speckit.implement`). Trivial fixes (typos, dependency bumps,
  documentation) may bypass the flow.
- **Reviews**: At least one human reviewer MUST approve any PR that
  modifies automation logic, extension permissions, or data persistence.

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
  table justifying the deviation.
- **Runtime guidance**: Day-to-day implementation guidance for AI agents and
  contributors lives in `.github/copilot-instructions.md` and the active
  feature plan; both MUST defer to this constitution where they overlap.

**Version**: 1.0.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
