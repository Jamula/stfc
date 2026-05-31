<!-- SYNC IMPACT REPORT -->
Version change: 1.6.0 → 2.0.0 (MAJOR)
Bump rationale: MAJOR — three backward-incompatible expansions of the
project's governance posture that ride together as the 005-web-control-
panel epic (issue #105, epic #104) opens Phase 0:

  (1) Principle IV (Type-Safe Headless TypeScript CLI) gains an
      explicit carve-out admitting a NEW runtime surface — an Azure
      Static Web Apps static bundle (Lit + Vite at v2 launch; the
      framework choice is the Phase 1 plan's, not the constitution's)
      and its linked Azure Functions API (Node 24, server runtime).
      v1.x framed the project as headless-CLI-only; v2 explicitly
      admits a browser-plus-server-API surface alongside it. The CLI
      runtime obligations from Principles II–III–V remain binding
      verbatim on `src/`; the SWA + Functions surface has its own
      typecheck and bundle-budget gates and lives outside
      `tsconfig.json`'s existing include set.

  (2) Principle I (User Safety & Trust First) gains a new
      "Untrusted-input surfaces (chat-input addendum)" subsection.
      Chat input (user messages, retrieved knowledge corpus, recent
      digests) is declared UNTRUSTED for the purposes of tool
      dispatch. Any chat-initiated tool call MUST be gated by an
      HMAC-signed confirmation token bound to a canonical payload
      (actor, session, tool, args, reason, request_id,
      idempotency_key); execution MUST reject any mismatch between
      confirmed payload and executed payload. This is a NEW
      obligation on any future code path that lets external chat
      content reach a tool dispatcher. It does NOT apply to the
      existing cron-driven redeem/refresh/discord-monitor pipelines.

  (3) The Security & Compliance Constraints gain a new uniform
      workflow-input obligation: every `workflow_dispatch`-eligible
      workflow that is callable from the SWA control-panel surface
      (today: `redeem.yml`, `discord-monitor.yml`,
      `refresh-token.yml`) MUST accept three inputs —
      `correlation_id`, `triggered_by`, `reason` — defaulting to
      empty strings so existing `schedule:` cron triggers continue
      to work without providing them.

Additionally (additive, non-breaking on their own; folded into this
MAJOR because they ride the same web-control-panel amendment):

  • Principle V (Stateless Operation & Secret Custody) gains a new
    "Web Control Panel (v2) durable outputs" subsection enumerating
    three new committed artifact trees: `data/runs/*.json` (per-run
    state-change-only emission, schema-versioned),
    `data/audit/*.jsonl` (append-only redacted audit log of every
    SWA-initiated write call), and `data/digests/*.md` (the
    existing digest tree, now declared TRACKED rather than ignored
    — the `data/digests/*.md` line in `.gitignore` is scheduled for
    removal in the Phase 3 web-control-panel implementation when
    the chat retrieval / digest reader actually depends on the
    files being committed; this Phase 0 commit does NOT touch
    `.gitignore`).

  • Principle V sanctioned-secrets enumeration grows by five
    entries, all bound to the SWA + Functions runtime ONLY:
      - `GITHUB_APP_PRIVATE_KEY` — installation-token-minting key
        for the SWA-installed GitHub App on `Jamula/stfc`. Single
        installation, scopes `actions:write` + `contents:read`. App
        private key lives only as a SWA Function app setting;
        installation tokens minted per request and cached
        in-Function for at most 50 min (upstream 1 h TTL).
      - `MODELS_API_TOKEN` — GitHub PAT scoped `models:read` only,
        used by the SWA Function for GitHub Models inference. MUST
        be a SEPARATE secret value from `GITHUB_APP_PRIVATE_KEY`.
      - `GEMINI_API_KEY` — optional fallback key for Gemini Flash
        when GitHub Models is unavailable.
      - `SWA_DEPLOYMENT_TOKEN` — SWA deployment token (OR an OIDC
        federated-credential reference if the Phase 1 deploy
        contract spike selects OIDC; the choice is the deploy
        contract's, not the constitution's).
      - `AZURE_TABLE_CONNECTION_STRING` — connection string for the
        Azure Table Storage free-tier durable cache used by the
        refresh-token cooldown (per RD P0.3); SWA Function only.
    All five live ONLY as SWA Function app settings or as GitHub
    Actions secrets scoped to the SWA deploy workflow. None of them
    are sanctioned writers of `STFC_ACCOUNTS`; the two-writer
    custody rule for `STFC_ACCOUNTS` is unchanged.

  • Security & Compliance Constraints "Outbound network scope" is
    extended to permit the SWA Function runtime to call two new
    external LLM hosts:
      - `https://models.inference.ai.azure.com/...` — GitHub Models
        inference endpoint, callable from the Function only.
      - `https://generativelanguage.googleapis.com/...` — Gemini
        Flash fallback, callable from the Function only.
    Both new destinations are sanctioned for the SWA Function
    runtime only. The redemption orchestrator (`src/`), the
    `discord-monitor` runtime (`src/discord/**`), and the v1.5.0
    Discord application-metadata ops scripts (the `discord-ops`
    carve-out under `scripts/`) MUST NOT call either host.

  • Explicit isolation assertions (Principle V, new subsection
    "Separation between STFC/Discord secrets and the SWA Function
    runtime"):
      - "No STFC store JWTs, no `STFC_ACCOUNTS`, no `STFC_EMAIL` /
        `STFC_PASSWORD` / `cj_pwd` / `STFC_REFRESH_PAT`, and no
        `DISCORD_BOT_TOKEN` ever cross into the SWA Function
        runtime. Those secrets live ONLY in GitHub Actions repo
        secrets and are consumed ONLY by the workflows that
        Principles III and V already sanction."
      - "`GITHUB_APP_PRIVATE_KEY` and `MODELS_API_TOKEN` are
        SEPARATE secret values; provisioning them with the same
        value is a Principle V violation."

Assembled: 2026-05-31
Assembled by: Picard (M2 / Engineering Manager) — Phase 0 Wave 1 of
  the 005-web-control-panel epic (issue #105, epic #104).
Requested by: Cyrus Jamula

Per-principle change summary:
  I.    REVISED   — User Safety & Trust First:
                    New "Untrusted-input surfaces (chat-input
                    addendum)" subsection. Chat input (user
                    messages, retrieved corpus, recent digests)
                    declared UNTRUSTED for tool dispatch;
                    HMAC-signed confirmation tokens required on
                    every chat-initiated tool call; execution
                    MUST reject any mismatch between confirmed
                    and executed payload. Existing obligations
                    (token redaction, sanctioned auth surfaces,
                    bookmarklet review, `redact.ts` contract) are
                    unchanged.
  II.   UNCHANGED — Skill-Isolated CLI Architecture
  III.  UNCHANGED — Resilient Upstream-API Automation
  IV.   REVISED   — Type-Safe Headless TypeScript CLI:
                    New "Web Control Panel runtime carve-out"
                    subsection admitting an SWA static bundle and
                    a linked Azure Functions API as a NEW runtime
                    surface alongside the headless CLI. The CLI's
                    `tsconfig.json` typechecked surface is
                    unchanged; the SWA bundle and Functions API
                    live outside `src/` and outside
                    `tsconfig.json`'s include set, and have their
                    own typecheck + bundle-budget gates declared
                    in the Phase 1 plan. Mirrors the v1.5.0
                    Principle V ops-script carve-out in tone:
                    narrow, scoped, isolation-by-directory.
  V.    REVISED   — Stateless Operation & Secret Custody:
                    Three additions:
                      • New "Web Control Panel (v2) durable
                        outputs" subsection enumerating
                        `data/runs/*.json`, `data/audit/*.jsonl`,
                        and `data/digests/*.md` (now tracked).
                      • Sanctioned-secrets enumeration extended
                        by five SWA-Function-only entries:
                        `GITHUB_APP_PRIVATE_KEY`,
                        `MODELS_API_TOKEN`, `GEMINI_API_KEY`,
                        `SWA_DEPLOYMENT_TOKEN`,
                        `AZURE_TABLE_CONNECTION_STRING`.
                      • New "Separation between STFC/Discord
                        secrets and the SWA Function runtime"
                        subsection codifying the hard isolation
                        invariant.
                    The two-writer custody rule for
                    `STFC_ACCOUNTS` and the durable-inputs
                    enumeration for every prior feature are
                    unchanged.
  VI.   UNCHANGED — Specification-First Governance
  VII.  UNCHANGED — Artifact Hygiene
  VIII. UNCHANGED — Wire-First Discovery
  IX.   UNCHANGED — Test-First Discipline

Speckit Reviewer Gates: UNCHANGED.
Security & Compliance Constraints: REVISED — three changes:
  (a) "Outbound network scope" gains the two LLM hosts
      (`models.inference.ai.azure.com`,
      `generativelanguage.googleapis.com`), each scoped to the SWA
      Function runtime only.
  (b) New "Workflow-input obligation for dispatch-eligible
      workflows" bullet: every `workflow_dispatch`-eligible
      workflow callable from the SWA control panel MUST declare
      `correlation_id`, `triggered_by`, `reason` inputs (default
      empty so cron still works); the dispatcher MUST populate
      all three on every web-initiated run; the audit log under
      `data/audit/*.jsonl` MUST persist them.
  (c) "Third-party action pinning" verified-today list will be
      extended to include the SWA deploy workflow when it lands
      in Phase 1 (per the deploy-contract issue O'Brien owns); a
      pinning test will be authored alongside.

Development Workflow: UNCHANGED.
Governance: UNCHANGED.

Templates re-synced:
  - .specify/templates/plan-template.md ✅ (Principle I, IV, and
    V rows updated to reference constitution v2.0.0 and to
    enumerate the new chat-untrusted addendum, the SWA+Functions
    runtime carve-out, the three new durable artifact trees, the
    five new sanctioned secrets, and the two new outbound LLM
    hosts).

Templates needing re-sync (Rule 1 grep verbatim):
  $ grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml|data/runs|data/audit|GITHUB_APP_PRIVATE_KEY|MODELS_API_TOKEN|GEMINI_API_KEY|SWA_DEPLOYMENT_TOKEN|AZURE_TABLE_CONNECTION_STRING|models\.inference\.ai\.azure\.com|generativelanguage\.googleapis\.com|correlation_id' .specify/templates/*.md
  Matches (post-update): .specify/templates/plan-template.md
    Principle I row (chat-untrusted addendum reference)
    Principle IV row (SWA+Functions carve-out reference)
    Principle V row (full enumeration of new secrets + artifacts
      + outbound LLM hosts + workflow-input obligation;
      constitution version reference updated to v2.0.0)
  No matches in spec-template.md, tasks-template.md,
    constitution-template.md, or checklist-template.md → no
    changes required to those templates.

Cross-artifact follow-ups:
  - `.gitignore` line `data/digests/*.md` is scheduled for
    removal in the Phase 3 web-control-panel implementation
    (when the chat retrieval / digest reader actually depends on
    the files being committed). This amendment makes the
    constitutional declaration ("tracked durable artifact")
    canonical; the implementation step removes the gitignore
    line. NOT removed in this Phase 0 Wave 1 commit.
  - The SWA deploy workflow, GitHub App registration, Azure
    Table cooldown cache, HMAC confirmation-token implementation,
    and dispatcher `correlation_id` wiring on the three target
    workflows are all tracked under Phase 1+ of the
    005-web-control-panel epic (#104). This amendment authorizes
    the constitutional surfaces those issues will use; it does
    NOT itself add code or modify any workflow.
  - The three Known Tensions carried from v1.2.0 (Principle III
    auth/me overclaim; Principle VII scan-path overclaim;
    redeem/refresh concurrency lock un-principled) remain
    unresolved and are preserved verbatim. They are deferred to
    a subsequent revision.
  - `package.json`, `README.md`: do not reference constitution
    version; no update required here.

Cross-check: Principles II, III, VI, VII, VIII, IX, the Speckit
  Reviewer Gates, Development Workflow, and Governance sections
  are byte-identical to v1.6.0. Only Principle I (chat-untrusted
  addendum subsection added), Principle IV (SWA+Functions
  carve-out subsection added), Principle V (web-control-panel
  durable outputs subsection added + sanctioned-secrets
  enumeration extended + STFC-vs-SWA separation subsection
  added), the Security & Compliance Constraints ("Outbound
  network scope" extended; new "Workflow-input obligation"
  bullet added; "Third-party action pinning" note added), the
  version header, the version footer, and this SIR header were
  modified.

Prior SIR history: v1.5.0 → v1.6.0 report is retained below and
  is byte-identical to its previous form.
<!-- /SYNC IMPACT REPORT -->


<!-- SYNC IMPACT REPORT -->
Version change: 1.5.0 → 1.6.0 (MINOR)
Bump rationale: MINOR — Principle II gains three new sanctioned skills
(`skill:roster` with five subcommands, `skill:optimize-crew`,
`skill:progression`) and Principle V's durable-inputs enumeration gains
four new entries (`data/crew/officers.json`,
`data/crew/tasks/*.yaml`, `data/crew/roster/*.yaml` (tracked-by-default,
documented opt-out), and the generated `docs/crew/*.md` per-account
reports). The Security & Compliance Constraints "Third-party action
pinning" bullet is extended to enumerate the new
`.github/workflows/optimize-crew.yml` workflow (no cron; concurrency
group `stfc-crew-optimizer`; triggers on `push` to `data/crew/**` and
`workflow_dispatch`). No principle is removed, no existing obligation
narrowed. No new secrets are introduced. No new outbound destinations
are introduced for v1. No new sanctioned writer of `STFC_ACCOUNTS`.
The v1.5.0 ops-script carve-out (Principle V "Operator-Only One-Shot
Ops Scripts") is unchanged.

Assembled: 2026-05-31
Assembled by: speckit.constitution (drafted) + Tuvok (editorial pass)
  under Picard (M2) — bundled with the spec/plan pipeline for issue #77
  (specs/004-crew-optimizer/).
Requested by: Cyrus Jamula

Per-principle change summary:
  I.    UNCHANGED — User Safety & Trust First
  II.   REVISED   — Skill-Isolated CLI Architecture:
                    Sanctioned-skills enumeration grows by three entries:
                    `skill:roster` (with the five subcommands `status`,
                    `add`, `promote`, `rankup`, `validate`),
                    `skill:optimize-crew`, `skill:progression`. All three
                    registered in `src/cli.ts` and follow the
                    `{ result, exitCode }` contract. Each is exposed via
                    a matching `npm run skill:*` script when added to
                    `package.json`. Skill bodies live under
                    `src/crew/**` (new namespace) and `src/skills/`
                    entry points.
  III.  UNCHANGED — Resilient Upstream-API Automation
  IV.   UNCHANGED — Type-Safe Headless TypeScript CLI
  V.    REVISED   — Stateless Operation & Secret Custody:
                    New subsection "Crew Optimizer (v1) durable inputs"
                    added to the durable-inputs enumeration. Adds four
                    entries:
                      • `data/crew/officers.json` — hand-curated officer
                        database (~30–50 entries at v1 launch).
                        Writer: human operator (manual edit, reviewed
                        PR). Purpose: canonical officer reference for
                        the optimizer.
                      • `data/crew/tasks/*.yaml` — task definitions
                        (slot requirements, tag weights, synergy
                        bonus). Writer: human operator. Purpose: scoring
                        target library for the optimizer.
                      • `data/crew/roster/*.yaml` — per-account owned
                        officer roster (tracked-by-default; operators
                        wanting private rosters opt out via a documented
                        `.gitignore` snippet in `docs/CREW-OPTIMIZER.md`).
                        Writers: `skill:roster` maintenance subcommands
                        (`add`, `promote`, `rankup`) AND human operator
                        (hand-edit). Both writers MUST preserve stable
                        key order and auto-bump `last_updated`.
                      • `docs/crew/{account}.md` — generated per-account
                        recommendation report. Writer:
                        `.github/workflows/optimize-crew.yml` only when
                        the input hash (officers + tasks + that account's
                        roster) has changed since the last commit.
                        Regenerated via rebase-before-push (Rule 4).
                    None of these files contain secrets, JWTs, account
                    material, or game-state credentials.
                    Durable-inputs enumeration for other features is
                    unchanged. Two-writer custody rule for
                    `STFC_ACCOUNTS` is unchanged.
  VI.   UNCHANGED — Specification-First Governance
  VII.  UNCHANGED — Artifact Hygiene
  VIII. UNCHANGED — Wire-First Discovery
  IX.   UNCHANGED — Test-First Discipline

Speckit Reviewer Gates: UNCHANGED.
Security & Compliance Constraints: REVISED — the "Third-party action
  pinning" bullet's verified-today list is extended to include
  `optimize-crew.yml` (when the workflow file lands in #82). The
  workflow MUST pin every third-party action to a full commit SHA and
  is covered by Rule 3 pinning tests in
  `tests/skills/optimizeCrew.test.ts`. The workflow uses a new
  concurrency group `stfc-crew-optimizer` (distinct from
  `stfc-gift-redeemer` and `discord-monitor`), triggers on `push` to
  `data/crew/**` and `workflow_dispatch` only (NO cron), and uses
  rebase-before-push (Rule 4) for any commit it makes.
  Outbound network scope: UNCHANGED for v1. The crew optimizer is
  pure compute with no upstream API surface. v1.5 (Discord/OCR
  transport) and v2 (interactive `!crew` commands + embedding
  rebuild) will require SEPARATE amendments at the time those phases
  are unblocked (tracked as issues #81 and #93 respectively).
Development Workflow: UNCHANGED.
Governance: UNCHANGED.

Templates re-synced:
  - .specify/templates/plan-template.md ✅ (Principle V row updated to
    reference constitution v1.6.0 and to enumerate the four new crew-
    optimizer durable inputs alongside the existing list). Rule 1
    grep run; see Templates needing re-sync below.

Templates needing re-sync (Rule 1 grep verbatim):
  $ grep -nE 'STFC_ACCOUNTS|promo-codes\.txt|DISCORD_BOT_TOKEN|data/discord|data/digests|huggingface|discord\.com|data/crew|skill:roster|skill:optimize-crew|optimize-crew\.yml' .specify/templates/*.md
  Match: .specify/templates/plan-template.md:44 (Principle V cell)
  → UPDATED in this PR. The cell now references constitution v1.6.0
    and enumerates `data/crew/officers.json`,
    `data/crew/tasks/*.yaml`, `data/crew/roster/*.yaml`, and
    generated `docs/crew/*.md` alongside the prior durable inputs.
  No matches in spec-template.md, tasks-template.md,
    constitution-template.md, or checklist-template.md → no changes
    required to those templates.

Cross-artifact follow-ups:
  - `package.json`, `README.md`: do not reference constitution version;
    no update required here. New `npm run skill:roster` /
    `skill:optimize-crew` / `skill:progression` script entries land
    in the implementation phase (#80), not in this amendment.
  - `.github/workflows/optimize-crew.yml` and its accompanying pinning
    test under `tests/skills/optimizeCrew.test.ts` are tracked by the
    O'Brien dispatch on issue #82; this amendment does NOT itself add
    or modify the workflow.
  - The three Known Tensions carried from v1.2.0 (Principle III
    auth/me overclaim; Principle VII scan-path overclaim;
    redeem/refresh concurrency lock un-principled) remain unresolved
    and are preserved verbatim. They are deferred to a subsequent
    revision.

Cross-check: Principles I, III, IV, VI, VII, VIII, IX, Speckit
  Reviewer Gates, Development Workflow, and Governance sections are
  byte-identical to v1.5.0. Only Principle II (sanctioned-skills
  enumeration extended), Principle V (crew-optimizer durable-inputs
  subsection added), the Security & Compliance Constraints
  third-party-action-pinning enumeration (one new workflow added),
  the version footer, and this SIR header were modified.

Prior SIR history: v1.4.0 → v1.5.0 report is retained below and
  is byte-identical to its previous form.
<!-- /SYNC IMPACT REPORT -->


<!-- SYNC IMPACT REPORT -->
Version change: 1.4.0 → 1.5.0 (MINOR)
Bump rationale: MINOR — Principle V gains an explicit, narrowly-scoped
carve-out for operator-only one-shot ops scripts under
`scripts/discord-ops/` that manage Discord *application metadata* (bot
avatar, application description, bot username) by issuing `PATCH`/`PUT`/
`POST` requests against `https://discord.com/api/v10/users/@me` and
`https://discord.com/api/v10/applications/@me`. No principle is removed,
no existing obligation narrowed. No new secrets are introduced
(`DISCORD_BOT_TOKEN` is reused). No new outbound destinations are
introduced (`discord.com/api/v10` is already sanctioned for the
`discord-monitor` skill). No new sanctioned writer of `STFC_ACCOUNTS`.
The strict read-only constraint on the monitor runtime
(`src/skills/discordMonitor.ts`, `src/discord/**`, per FR-009 of
specs/003-discord-oauth) is preserved verbatim because the ops scripts
are not loaded by the monitor runtime — they live outside `src/` and
are invoked only by the operator (locally or via `workflow_dispatch`).
FR-012's token-redaction obligation is extended to the new scripts.

Assembled: 2026-05-18
Assembled by: Tuvok (editorial pass) under Cyrus Jamula override of
  Picard's earlier (c) Decline verdict
  (see .squad/decisions/inbox/picard-discord-avatar-automation-scope.md
  and .squad/decisions/inbox/copilot-directive-override-picard-discord-avatar-(a).md)
Requested by: Cyrus Jamula

Per-principle change summary:
  I.    UNCHANGED — User Safety & Trust First
  II.   UNCHANGED — Skill-Isolated CLI Architecture
  III.  UNCHANGED — Resilient Upstream-API Automation
  IV.   UNCHANGED — Type-Safe Headless TypeScript CLI
  V.    REVISED   — Stateless Operation & Secret Custody:
                    New subsection "Operator-Only One-Shot Ops Scripts
                    (Discord application metadata)" added after Token
                    Capture Custody. Authorizes write traffic from
                    `scripts/discord-ops/**` to two specific Discord
                    REST endpoints for application-metadata management
                    only; preserves the read-only constraint on the
                    monitor runtime; reuses `DISCORD_BOT_TOKEN` with the
                    full FR-012 redaction obligation. Durable-inputs
                    enumeration unchanged. Two-writer custody rule for
                    `STFC_ACCOUNTS` unchanged.
  VI.   UNCHANGED — Specification-First Governance
  VII.  UNCHANGED — Artifact Hygiene
  VIII. UNCHANGED — Wire-First Discovery
  IX.   UNCHANGED — Test-First Discipline

Speckit Reviewer Gates: UNCHANGED.
Security & Compliance Constraints: REVISED — the "Outbound network
  scope" bullet now acknowledges the `scripts/discord-ops/` write
  traffic to `https://discord.com/api/v10/users/@me` and
  `https://discord.com/api/v10/applications/@me`. No new destinations
  beyond `discord.com/api/v10`. The third-party-action SHA-pinning rule
  now also applies to any `workflow_dispatch` workflow that carries
  `DISCORD_BOT_TOKEN` for `scripts/discord-ops/` (the rule already
  covered workflows that "carry the `DISCORD_BOT_TOKEN`" so this is a
  clarification, not an expansion).
Development Workflow: UNCHANGED.
Governance: UNCHANGED.

Templates re-synced:
  - .specify/templates/plan-template.md ✅ (Principle V row updated to
    reference constitution v1.5.0 and to record `scripts/discord-ops/`
    as the additional permitted write surface for the
    `DISCORD_BOT_TOKEN` + `discord.com/api/v10` pair).
  (spec-template.md and tasks-template.md contain no durable-inputs
  or outbound-destination claim; no changes required.)

Cross-artifact follow-ups:
  - `package.json`, `README.md`: do not reference constitution version;
    no update required.
  - Workflow `.github/workflows/discord-ops.yml` (when added) and its
    accompanying pinning tests under `tests/` are tracked by the
    Scotty/Bashir dispatches in the same `discord-ops-automation`
    branch; this constitution amendment does NOT itself add or modify
    the workflow.
  - The three Known Tensions carried from v1.2.0 (Principle III auth/me
    overclaim; Principle VII scan-path overclaim; redeem/refresh
    concurrency lock un-principled) remain unresolved and are preserved
    verbatim. They are deferred to a subsequent revision.

Cross-check: Principles I, II, III, IV, VI, VII, VIII, IX, Speckit
  Reviewer Gates, Development Workflow, and Governance sections are
  byte-identical to v1.4.0. Only Principle V (carve-out subsection
  added), the Security & Compliance Constraints "Outbound network
  scope" bullet (one sentence added), the version footer, and this
  SIR header were modified.

Prior SIR history: v1.3.0 → v1.4.0 report is retained in the v1.4.0
  amendment record; not duplicated here.
<!-- /SYNC IMPACT REPORT -->


# STFC Gift Redeemer Constitution

**Version:** 2.0.0
**Ratified:** 2026-05-08
**Last Amended:** 2026-05-31

## Core Principles

### I. User Safety & Trust First (NON-NEGOTIABLE)

This project operates a Scopely / Star Trek Fleet Command player account on the user's
behalf. The store JWT and any login material the user provides are the sole authority
this project carries; protecting them is the first obligation of the codebase.

- The application MUST act only as a logged-in player could act through the official
  store: read `/auth/me`, list `/offers/gifts`, claim `/offers/gifts/claim`, redeem
  `/redeem/claim`. No undocumented endpoints, no privilege escalation, no scraping of
  other players' data. (See `src/api/client.ts` for the full set of paths the
  orchestrator can issue.)
- Authentication MUST happen in a browser the user controls — either their own browser
  via `docs/BOOKMARKLET.md`, or a Playwright-driven Chromium launched locally by
  `npm run capture-token`, or the same script running headless in
  `.github/workflows/refresh-token.yml` against the user's own Scopely credentials
  stored as repo secrets. The orchestrator itself never sees a password.
- Strings that `src/` surfaces externally and that may carry credential-bearing
  content — thrown error messages, uncaught-failure detail, API-response error text —
  MUST pass through `src/lib/redact.ts` (`redactString` / `redactForLog`).
  `src/api/client.ts` wraps every error message it constructs with `redactString`
  before throwing; `src/cli.ts` applies `redactForLog` to uncaught-skill failures and
  fatal errors. Not every `src/` log call explicitly invokes `redact.ts` —
  informational log lines (e.g., account names, expiry strings, usage messages) do not.
  The obligation is scoped to code paths that produce output strings containing or
  derived from credential-bearing fields; new code in `src/` that surfaces such strings
  MUST apply `redactForLog` before output.
- Helper scripts under `scripts/` operate on raw token material by design (capture,
  validate, hand off). The sanctioned output channels are documented in Principle V:
  the single `{"name","token"}` JSON line on stdout in `--ci` mode and the interactive
  `.env`-merge path. A known exception exists in the interactive path: if the existing
  `.env` STFC_ACCOUNTS value is malformed JSON, `scripts/capture-token.mjs` emits an
  error message to stderr that includes the raw existing STFC_ACCOUNTS line, which may
  contain a live token. Operators MUST treat the terminal session as a secret-bearing
  surface in that case; re-run with `--force` to overwrite the malformed value, or
  correct `.env` manually first. Diagnostic dumps (`--debug`) MUST report shape only
  (lengths, presence flags, JWT-shape booleans), never raw values.
- Code that touches credentials MUST be unminified, human-readable, and reviewable
  before it runs. The bookmarklet snippet's expanded source MUST appear in
  `docs/BOOKMARKLET.md` alongside any minified bookmark form so a user can read it
  before pasting.

**Untrusted-input surfaces (chat-input addendum, v2.0.0)**

The Phase 3+ web control panel introduces a new class of input surface
that is fundamentally less trustworthy than the orchestrator's current
inputs (env-var secrets, version-controlled config, captured-token
JWTs). Specifically, the SWA chat endpoint receives three streams that
MUST be treated as UNTRUSTED for the purposes of dispatching any tool
call:

- User chat messages (typed in the browser).
- Retrieved corpus fragments from the indexed knowledge base
  (`data/digests/*.md`, repo docs, prior `data/runs/*.json`).
- Recent digest content surfaced into the chat context.

None of these may directly cause a tool dispatch. Any chat-initiated
tool call (today scoped to the Phase 7 write tools `trigger_redeem`
and `trigger_discord_monitor`; `refresh-token` is deliberately
EXCLUDED from chat-initiated dispatch) MUST flow through a
confirmation gate:

- The Function MUST return a "pending confirmation" response carrying
  an HMAC-signed confirmation token bound to a canonical payload
  containing AT MINIMUM: actor (authenticated SWA principal
  username), session ID, tool name, canonical-serialized arguments,
  the human-supplied reason string, request ID, and idempotency key.
- The HMAC key MUST be a SWA-Function-only secret (not exposed to the
  browser, not logged, not echoed in any response body).
- Execution MUST refuse to dispatch unless the user re-submits the
  confirmation token AND the server-recomputed HMAC over the
  to-be-executed payload matches the signed payload byte-for-byte.
- Confirmation tokens MUST have a bounded TTL and MUST NOT be
  replayable across users, sessions, or tool names.

This addendum is binding on any future code path that lets external
chat content reach a tool dispatcher. It does NOT apply to the
existing cron-driven redeem / refresh-token / discord-monitor
pipelines — those run from version-controlled inputs and committed
secrets only, with no chat surface in the loop.

Rationale: Trust is the product. The previous wording promised the project handled
*nothing* token-related, which was never true and which masked the real obligations on
the secret-handling code that does exist. This rewrite states the actual handling
surface and the actual safeguards (`src/lib/redact.ts`, the GitHub Actions masking in
`refresh-token.yml`, the consent-gated `gh secret set` in `capture-token.mjs`) so
contributors know what they are required to preserve.

### II. Skill-Isolated CLI Architecture

The project is a headless Node CLI organized around isolated TypeScript skills, not a web app/browser-extension pair. The redeem runtime MUST keep user-facing skill behavior behind the `src/cli.ts` dispatcher and the skill modules in `src/skills/`.

- Current skills are `run-all`, `check-auth`, `list-gifts`, `claim-gifts`, `redeem-codes`, plus the v1.6.0-sanctioned crew-optimizer family: `roster` (with the five subcommands `status`, `add`, `promote`, `rankup`, `validate`; dispatched inside `src/skills/roster.ts`), `optimize-crew`, and `progression`. Each MUST be registered in `src/cli.ts` and exposed through the matching `npm run skill:*` script in `package.json` when it is intended for operator use. The crew-optimizer skill bodies live under `src/crew/**` (new namespace) plus the skill entry points under `src/skills/`; pure-compute modules in `src/crew/**` do NOT call the network and do NOT call `process.exit`.
- Skill isolation means each `src/skills/*.ts` module accepts typed options, returns a structured `{ result, exitCode }` object, and does not terminate the process directly. Shared account, logging, redaction, summary, promo-code, outcome, and API behavior belongs in `src/lib/` and `src/api/`, not duplicated inside individual skills.
- Process termination is centralized only for the TypeScript skill runtime: within `src/`, `src/cli.ts` is the only file that calls `process.exit`. Project-wide, helper scripts also call `process.exit` (`scripts/check-artifact-hygiene.mjs` and `scripts/capture-token.mjs`), so the constitution MUST NOT claim `src/cli.ts` is the only file in the repository that exits.
- The `src/cli.ts` exit-code contract is: `0` for successful/expected skill completion, `1` for account-configuration errors, uncaught skill failures, or a skill-reported infrastructure-class failure, and `2` for an unknown or missing skill name. Diagnostic skills may return `0` while reporting per-account errors because they are inspection tools.
- `run-all` is the workflow orchestrator. It MUST continue processing remaining accounts after per-account token/API outcomes and MUST treat known per-account outcomes (`TOKEN_EXPIRED`, `ALREADY_CLAIMED`, `CODE_ALREADY_USED`, `CODE_INVALID_OR_EXPIRED`, `TRANSIENT`, `UNKNOWN_RESULT`, and the other values in `src/lib/outcomes.ts`) as reportable outcomes rather than workflow failures. Infrastructure errors recorded in the run report are what make `run-all` return a non-zero exit code.
- GitHub Job Summary rendering is owned by `run-all` for normal redeem runs. Other diagnostic skills log their structured rows to the CLI and should not be described as rendering the full orchestrator summary unless they actually append to the summary writer.

Rationale: Boring, testable CLI skills keep the scheduled redeemer reliable. Skills that return data instead of exiting are unit-testable, reusable by the dispatcher, and safe to compose in GitHub Actions without one account's expected failure hiding another account's result.

### III. Resilient Upstream-API Automation

The STFC store JSON API at
`https://cdn-nv3-webstore-api.startrek.digitgaming.com/api/v2` is third-party,
unversioned, and may change without notice. All redemption-path code that calls it MUST
treat the wire as untrusted — schemas, status codes, latency, and connectivity.

- All STFC-API traffic from the redemption orchestrator (`src/cli.ts`, `src/skills/*`)
  MUST go through `src/api/client.ts` (the `ApiClient` class) or its module-function
  wrappers in `src/api/endpoints.ts`. No raw `fetch` calls to the STFC API are
  permitted under `src/`. (Helper scripts under `scripts/` are scoped exceptions: see
  Principle V on the capture-token surface, which validates a freshly-captured JWT
  against `/auth/me` directly to keep the helper standalone.)
- Every response MUST be validated by a zod schema declared in `src/api/schemas.ts`.
  Schema failures throw `SchemaMismatchError` rather than producing untyped data.
- The client MUST distinguish at minimum: `TokenExpiredError` (401/403),
  `TransientError` (5xx and network failures), `SchemaMismatchError` (non-JSON or
  shape-invalid bodies), and a generic `ApiError` (4xx). Skill-level outcome
  classification in `src/lib/outcomes.ts` MUST branch on these typed errors, not on
  string matching.
- Safe-method (`GET`) requests MUST retry once on `TransientError` or low-level
  network failure, with jitter. Unsafe methods (`POST`/`PUT`) MUST NOT retry
  automatically — the orchestrator decides per-account whether to continue.
- Every request MUST run under an `AbortSignal` timeout (default 10s) so a hung
  upstream cannot stall the cron job.
- Most per-account API failures — token expiry, transient network errors,
  already-claimed or already-used results, and unclassified HTTP errors — MUST NOT
  fail the workflow: the orchestrator MUST continue to the next account and classify
  these as per-account outcomes in the run summary. Schema-mismatch failures
  (`SchemaMismatchError` on any `run-all` API call) are treated differently: they are
  appended to `report.errors` in `src/skills/runAll.ts` and cause the workflow to exit
  with code `1`. This distinction is intentional — a schema mismatch signals an
  upstream API-shape change requiring developer action, not a recoverable per-account
  outcome. See `src/skills/runAll.ts` (`finalize` function, schema-mismatch catch
  blocks) and `src/lib/outcomes.ts`.
- When the upstream API surface changes (new fields, renamed paths, altered error
  shapes), the fix MUST go through Principle VIII (Wire-First Discovery): captured
  request/response evidence, schema update, fixture under `tests/fixtures/`, test
  first.

Rationale: We have no contract with the upstream API. A typed, schema-validated,
retry-aware client confined to one file is the only way the redemption path stays
debuggable when the wire changes. The v1.1.0 wording described DOM scraping in a
non-existent web app; this rewrite describes what the redeem orchestrator actually
does.

### IV. Type-Safe Headless TypeScript CLI

The core application surface is a headless TypeScript Node CLI. Type safety is enforced by `tsconfig.json` and `npm run typecheck`, not by a UI framework, extension build, or bundler pipeline.

- The typechecked application/test surface is exactly the `tsconfig.json` include set: `src/cli.ts`, `src/api/**/*.ts`, `src/lib/**/*.ts`, `src/skills/**/*.ts`, and `tests/**/*.ts`, subject to the explicit excludes already listed in `tsconfig.json`.
- `npm run typecheck` MUST remain the authoritative static check for the TypeScript surface and currently runs `tsc --noEmit`.
- The TypeScript compiler options that define the current safety baseline include `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `isolatedModules: true`, `forceConsistentCasingInFileNames: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, and `noEmit: true`.
- Runtime execution uses `tsx` for the skill scripts (`npm run skill:run-all`, `npm run skill:check-auth`, `npm run skill:list-gifts`, `npm run skill:claim-gifts`, `npm run skill:redeem-codes`). Tests use Node's built-in test runner through `node --import tsx --test tests/index.test.ts`.
- Plain JavaScript helper scripts under `scripts/*.mjs` are outside the `tsconfig.json` TypeScript surface. Changes there MUST be covered by existing tests or by targeted manual/CI verification appropriate to the script; they MUST NOT be represented as TypeScript-compiled production code.
- This repository currently has no React UI, Shadcn UI, Radix, Tailwind, `src/components/ui/`, `theme.css`, browser-extension directory, `npm run lint`, `npm run build`, or `npm run build:extension` script. Future constitutional text MUST NOT impose those obligations unless the corresponding project surface and scripts are added first.

**Web Control Panel runtime carve-out (Azure Static Web Apps + linked Azure Functions, v2.0.0)**

The v2.0.0 amendment admits a NEW runtime surface alongside the
headless CLI: a webpage control panel deployed as an Azure Static
Web App on the free tier, with a linked Azure Functions API. This
is a narrow, scoped carve-out from the "headless TypeScript Node
CLI" framing above — it does NOT relax the CLI's own obligations,
which remain binding verbatim on `src/`.

- The browser bundle (Lit + Vite at v2 launch; the framework choice
  is the Phase 1 plan's, not the constitution's) lives under a
  dedicated top-level directory (today: `web/` or `swa/` per the
  Phase 1 structure decision) and is OUTSIDE the `tsconfig.json`
  include set documented above. It has its own TypeScript surface,
  its own typecheck gate, and a bundle-budget CI gate declared in
  the Phase 1 plan.
- The Azure Functions API (Node 24 runtime) lives under a
  dedicated top-level directory (today: `api/` or `swa/api/` per
  the Phase 1 structure decision) and is also OUTSIDE
  `tsconfig.json`'s include set above. It has its own typecheck
  gate and its own test surface.
- Neither the SWA bundle nor the Functions API may import from
  `src/`, and neither may be imported by `src/`. The two runtimes
  are isolated by directory boundary and enforced by their
  separate `tsconfig.json` files.
- The SWA bundle MUST NOT carry, request, or forward any
  STFC/Discord secret from Principle V's sanctioned-secrets
  enumeration. The Functions API MUST NOT consume any STFC/Discord
  secret either; see the Principle V "Separation between
  STFC/Discord secrets and the SWA Function runtime" subsection
  below for the full isolation invariant.
- The CLI runtime (`src/`, `tests/`, the `npm run skill:*`
  scripts, the cron workflows under
  `.github/workflows/redeem.yml`,
  `.github/workflows/refresh-token.yml`,
  `.github/workflows/discord-monitor.yml`) remains the canonical
  STFC-facing runtime. The SWA + Functions surface is a control
  and observability layer on top of it; it dispatches the existing
  workflows via `workflow_dispatch` (per the new workflow-input
  obligation in Security & Compliance Constraints) but does NOT
  reimplement any STFC or Discord behavior.
- `npm run typecheck` for `src/` is unchanged. Adding `web/` or
  `api/` directories does NOT extend the existing `tsc --noEmit`
  command's scope; those directories have their own typecheck
  invocations declared in their respective `package.json` or
  build configuration. Future amendments may consolidate the
  typecheck gates once the surfaces stabilize.

Rationale: The build surface should match the code that exists. A strict TypeScript CLI with `tsx` execution and `tsc --noEmit` checking is enough for this project; invented UI/extension rules create false gates and distract from the actual runtime risks.

### V. Stateless Operation & Secret Custody

Redeem runs MUST be stateless and reruns MUST be safe. Secrets MUST live only in the
sanctioned surfaces below; every other surface is treated as a leak.

**Stateless operation**

- The orchestrator MUST NOT persist run state between invocations. Promo codes are
  re-submitted on every run; the upstream API's "already redeemed" response is the
  source of truth and is classified as an expected outcome
  (`src/lib/outcomes.ts`, `src/skills/runAll.ts`).
- The only durable inputs the redemption pipeline (`npm run skill:run-all` and the
  `Redeem gifts` workflow) consumes are the `STFC_ACCOUNTS` secret and the
  version-controlled `promo-codes.txt` file. (See `src/cli.ts` and
  `.github/workflows/redeem.yml`.)
- The token-refresh pipeline (`.github/workflows/refresh-token.yml`) additionally
  consumes the `STFC_EMAIL`, `STFC_PASSWORD` (or legacy `cj_pwd`), and
  `STFC_REFRESH_PAT` secrets, plus the optional `account_name` `workflow_dispatch`
  input.
- The `discord-monitor` skill (`src/skills/discordMonitor.ts` and
  `src/discord/**`), executed by `.github/workflows/discord-monitor.yml` on its
  own 4-hour cron, additionally consumes the following committed durable
  inputs/outputs (none of which contain secrets):
  - `config/discord-allowlist.json` — operator-curated list of Discord
    server/channel IDs the bot is permitted to read. Writer: human operator
    (manual edit, reviewed PR). Purpose: hard allowlist for ingestion scope.
  - `config/classifier-model.json` — pinned classifier model identifier and
    SHA-256 integrity digest. Writer: human operator (manual edit, reviewed
    PR). Purpose: reproducible, integrity-checked one-time model fetch.
  - `data/discord/cursors.json` — monotonic per-channel last-seen message
    cursors. Writer: the `discord-monitor` skill itself, executed inside
    `.github/workflows/discord-monitor.yml`. Purpose: idempotent re-runs
    and bounded backfill.
  - `data/discord/candidates.jsonl` — append-only JSONL log of classifier
    candidate hits with status updates. Writer: same. Purpose: audit trail.
  - `data/discord/tips-seen.jsonl` — append-only JSONL log of tip-class
    messages already surfaced. Writer: same. Purpose: de-duplication.
  - `data/discord/suppression.json` — operator-curated allow/deny rules
    for known code patterns. Writer: human operator (manual edit, reviewed
    PR). Purpose: deny known-bad code patterns and allow exceptions.
  - `data/discord/cooldowns.json` — auto-written cool-down telemetry.
    Writer: feature code at `src/discord/` (the candidate-redemption
    pipeline). Purpose: track failed candidates with `firstFailedAt` and
    `suppressedUntil` fields per FR-009 (default 30-day window).
  None of these files contain secrets, JWTs, account material, or message
  text from monitored channels (only message IDs, timestamps, and
  classifier scores).
- The `discord-monitor` skill additionally produces the committed artifact
  tree `data/digests/YYYY-MM-DD.md`. Writer: the skill itself
  (`src/digest/`), executed inside `.github/workflows/discord-monitor.yml`.
  Purpose: human-readable daily summary; idempotent re-render (re-running
  the same UTC day overwrites that day's digest deterministically).
- The `tuvok-telemetry` feature (`src/telemetry/**`, issue #15,
  specs/002-tuvok-telemetry/) additionally produces the following
  committed durable inputs/outputs (none of which contain secrets,
  prompt content, or assistant responses — token counts and metadata
  only, per FR-009 privacy-by-design):
  - `config/model-tiers.json` — operator-maintained model tier
    classification. Writer: human operator (manual edit, reviewed PR).
    Purpose: map model identifiers to cost/capability tiers for
    reporting.
  - `data/telemetry/sessions.jsonl` — append-only session telemetry
    records. Writer: the `tuvok-telemetry` feature code. Purpose:
    durable per-session token-usage log.
  - `data/telemetry/collection-log.jsonl` — append-only collection
    audit log. Writer: same. Purpose: audit trail of telemetry
    collection runs (timestamps, record counts, errors).
  - `data/telemetry/reports/*.md` — generated summary reports.
    Writer: the `tuvok-telemetry` feature code. Purpose:
    human-readable aggregated usage summaries.
  None of these files contain secrets, JWTs, account material,
  prompt content, or assistant responses (only model identifiers,
  token counts, timestamps, and aggregated metadata).
- The `crew-optimizer` feature (`src/crew/**` and `src/skills/{roster,optimizeCrew,progression}.ts`, specs/004-crew-optimizer/, sanctioned in v1.6.0) additionally consumes and produces the following committed durable inputs/outputs (none of which contain secrets):
  - `data/crew/officers.json` — hand-curated officer database (~30–50
    entries at v1 launch, growing per PR). Writer: human operator
    (manual edit, reviewed PR). Purpose: canonical officer reference
    for the optimizer and progression engines. Closed-vocabulary tag
    enum locked in v1 per `specs/004-crew-optimizer/spec.md` FR-002.
  - `data/crew/tasks/*.yaml` — task definitions (slot requirements,
    weighted tag preferences, synergy bonus, optional faction bonus,
    optional officer-exclusion constraints). Writer: human operator
    (manual edit, reviewed PR). Purpose: scoring target library.
  - `data/crew/roster/*.yaml` — per-account owned officer rosters
    (one file per account). **Tracked by default**; operators
    wanting private rosters opt out via a documented `.gitignore`
    snippet in `docs/CREW-OPTIMIZER.md`. Writers: the `skill:roster`
    maintenance subcommands (`add`, `promote`, `rankup`) AND the
    human operator (hand-edit, reviewed PR). Both writers MUST
    preserve stable key order (`account`, `last_updated`,
    `staleness_overrides`, `officers` sorted by `id`) and auto-bump
    `last_updated` to the current UTC ISO timestamp. Purpose: the
    operator's source-of-truth roster state.
  - `docs/crew/{account}.md` — generated per-account recommendation
    report. Writer: `.github/workflows/optimize-crew.yml` only when
    the input hash (officers + tasks + that account's roster) has
    changed since the last commit. Regenerated via rebase-before-
    push (Rule 4). Purpose: human-readable recommendations surface
    visible from the repo and GitHub mobile.
  None of these files contain secrets, JWTs, account material, game-
  state credentials, or screenshot bytes (no screenshot is ever
  committed; v1.5 OCR keeps image bytes in runner tmpfs only).
- The `web-control-panel` runtime (v2.0.0; SWA + linked Functions
  under `web/` and `api/` per the Phase 1 structure decision)
  additionally produces the following committed durable outputs.
  None contain secrets, JWTs, account material, prompt content, or
  user PII; they contain workflow metadata, redacted run summaries,
  and tool-call audit trails only:
  - `data/runs/*.json` — per-workflow-run summary records emitted
    on a state-change-only basis (the workflow commits the run
    record only when business state actually changed;
    `workflow_dispatch`-initiated manual runs always commit one).
    Schema-versioned (`schema_version` field, starting at `"1"`)
    per the v1 JSON Schema at
    `specs/005-web-control-panel/contracts/run-result.json`.
    Writers: `.github/workflows/redeem.yml`,
    `.github/workflows/discord-monitor.yml`, and
    `.github/workflows/refresh-token.yml` via a shared emitter
    step. Purpose: durable run log that the SWA control panel
    reads (via GitHub raw + ETag) to render status without
    scraping the live STFC store.
  - `data/audit/*.jsonl` — append-only redacted audit log of every
    SWA-initiated write call (tool dispatch, confirmation
    acceptance, refresh-token request). One JSON object per line,
    schema-versioned (`schema_version` field, starting at `"1"`)
    per the v1 JSON Schema at
    `specs/005-web-control-panel/contracts/audit-event.json`.
    Writer: the SWA Function audit emitter, which commits via the
    same App installation token that dispatches the underlying
    workflow. Records MUST pass through the `redact.ts` contract
    (Principle I) before commit. Purpose: immutable forensic
    record of who triggered what, when, and why.
  - `data/digests/*.md` — daily digest tree, already produced by
    the `discord-monitor` skill (see the bullet above) and as of
    v2.0.0 declared TRACKED rather than ignored. The
    `data/digests/*.md` line in `.gitignore` is scheduled for
    removal in the Phase 3 web-control-panel implementation when
    the chat retrieval / digest reader actually depends on the
    files being committed; this v2.0.0 amendment does NOT itself
    modify `.gitignore`.
  No other `data/` subtree is sanctioned for the web-control-panel
  runtime.
- These are the *only* additional durable inputs and outputs the project
  recognizes.
- A rerun after a partial failure MUST be safe: per-account failure does not block
  other accounts, and re-claiming an already-claimed gift or re-submitting an
  already-used promo code MUST classify as an expected `ALREADY_*` / `CODE_ALREADY_USED`
  outcome rather than an error.

**Secret custody — sanctioned surfaces**

A "secret" here means a Scopely password, an STFC store JWT, the GitHub PAT used to
write secrets, or any third-party API credential the orchestrator or its sibling
skills carry. The current enumeration is:

- Scopely / STFC credentials: `STFC_EMAIL`, `STFC_PASSWORD` / `cj_pwd`,
  the per-account JWTs inside `STFC_ACCOUNTS`, and the `STFC_REFRESH_PAT`
  GitHub PAT used to write `STFC_ACCOUNTS`.
- `DISCORD_BOT_TOKEN` — read-only Discord bot auth token consumed by the
  `discord-monitor` skill. Provided exclusively via GitHub Actions
  encrypted secrets (provisioned by the operator with
  `gh secret set DISCORD_BOT_TOKEN`). The feature code MUST NOT write
  `DISCORD_BOT_TOKEN` to disk, MUST NOT echo it to logs or the Job
  Summary, and MUST NOT include it in any committed durable input listed
  above. `DISCORD_BOT_TOKEN` is NOT a sanctioned writer of `STFC_ACCOUNTS`
  and is explicitly excluded from the Token Capture Custody surface
  (see below).
- **Web Control Panel (v2) secrets (SWA Function runtime only):** the
  v2.0.0 amendment introduces five secrets bound to the SWA + linked
  Functions runtime under `web/` and `api/`. None of them are
  sanctioned writers of `STFC_ACCOUNTS`; none of them appear in
  `src/`, in any `npm run skill:*` script, or in the cron workflows
  under `.github/workflows/redeem.yml`, `refresh-token.yml`, or
  `discord-monitor.yml`:
  - `GITHUB_APP_PRIVATE_KEY` — RSA private key for the
    installation-token-minting GitHub App. Single installation on
    `Jamula/stfc`, scopes `actions:write` and `contents:read`.
    Stored ONLY as a SWA Function app setting; never copied into
    GitHub Actions repo secrets or `.env`. Installation tokens are
    minted per request and cached in-Function for at most 50 min
    (upstream 1 h TTL).
  - `MODELS_API_TOKEN` — GitHub PAT with scope `models:read` ONLY,
    used by the SWA Function for GitHub Models inference calls.
    MUST be a SEPARATE secret value from `GITHUB_APP_PRIVATE_KEY`;
    provisioning both with the same value is a Principle V
    violation. Stored only as a SWA Function app setting.
  - `GEMINI_API_KEY` — optional Gemini Flash fallback key, used by
    the SWA Function when GitHub Models is unavailable. Stored
    only as a SWA Function app setting.
  - `SWA_DEPLOYMENT_TOKEN` — Azure Static Web Apps deployment
    token consumed by the SWA deploy workflow under
    `.github/workflows/` (exact filename TBD by the Phase 1
    deploy-contract spike; O'Brien may instead select an OIDC
    federated-credential reference, in which case
    `SWA_DEPLOYMENT_TOKEN` is not provisioned and the deploy
    workflow uses the OIDC path). Stored as a GitHub Actions repo
    secret, consumed only by the SWA deploy workflow.
  - `AZURE_TABLE_CONNECTION_STRING` — connection string for the
    Azure Table Storage free-tier table that backs the
    refresh-token cooldown cache (per the Phase 4 atomic
    check-and-set design). Stored only as a SWA Function app
    setting; consumed only by Function handlers that read/write
    the cooldown table.

Secrets MAY live in:

1. The user's local `.env` file (gitignored).
2. GitHub Actions encrypted secrets (`STFC_ACCOUNTS`, `STFC_EMAIL`, `STFC_PASSWORD` /
   `cj_pwd`, `STFC_REFRESH_PAT`).
3. Process memory of a redeem run, a refresh run, or a local `capture-token` run.
4. Two narrowly-scoped, documented hand-off channels owned by the refresh pipeline:
   the single `{"name":"…","token":"…"}` JSON line on `scripts/capture-token.mjs`
   stdout in `--ci` mode, and the temporary `/tmp/captured.json` file the
   `Refresh token` workflow writes to and `rm -f`s in the same job
   (`.github/workflows/refresh-token.yml`). Both surfaces are masked via
   `::add-mask::` for any captured or pre-existing token before any subsequent
   step runs.

Secrets MUST NOT live anywhere else. In particular: not in repo files, not in spec /
plan / tasks artifacts (Principle VII), not in shell history, not on a process command
line, not in workflow logs except as masked output, not in the GitHub Actions Job
Summary.

**Token Capture Custody (folded in from the v1.2.0 gap)**

`scripts/capture-token.mjs` is the only sanctioned entry point for *creating* a fresh
JWT for a named account. It is one of two sanctioned writers of `STFC_ACCOUNTS`; the
other is the `Refresh token` workflow's "Merge with existing STFC_ACCOUNTS and update
secret" step. Both writers MUST preserve every other account when updating one named
entry.

Obligations on `scripts/capture-token.mjs` (and any future replacement):

- The script MUST be invoked by the account owner — locally as
  `npm run capture-token`, or in CI as the `Refresh token` workflow under
  `--ci`. No third party may run it on the owner's behalf.
- The script MUST validate every captured candidate against `GET /auth/me` before
  treating it as a usable token. Validation failures MUST exit non-zero and MUST NOT
  write the candidate to `.env` or to any GitHub secret.
- In interactive mode the captured JWT MUST be merged into the local `.env` and MAY
  be propagated to the `STFC_ACCOUNTS` GitHub secret only via an explicit `y/N`
  consent prompt, and only via `gh secret set --body-file -` (stdin). The token
  MUST NOT appear on any command line or in shell history. **Known stderr surface:**
  if the existing `.env` STFC_ACCOUNTS value is malformed JSON,
  `scripts/capture-token.mjs` prints an error message to stderr that includes the raw
  existing STFC_ACCOUNTS line, which may contain a live token. Operators MUST treat
  the terminal session as a secret-bearing surface until cleared in that scenario.
  Remediation: re-run with `--force` to overwrite the malformed value, or correct
  `.env` manually before re-running.
- In `--ci` mode the script MUST emit exactly one line of JSON
  (`{"name","token"}`) to stdout for the calling workflow to consume; all other
  output MUST go to stderr; the script MUST NOT write `.env` or run `gh`. The
  consuming workflow MUST `::add-mask::` the captured token before any further
  step executes. The intermediate file `/tmp/captured.json` is currently deleted
  (`rm -f`) at the end of the secret-merge step in
  `.github/workflows/refresh-token.yml` — but only on the success path of that step:
  if the merge or `gh secret set` call fails mid-execution, the file persists on the
  runner. **Known gap (v1.3 follow-up):** an unconditional cleanup step (e.g., a
  separate step with `if: always()`) is needed to guarantee removal on all exit paths.
  Until that fix lands, a failed refresh run may leave `/tmp/captured.json` on the
  Actions runner filesystem.
- Diagnostic dumps (the `--debug` path) MUST record only shape (lengths, presence
  flags, JWT-shape booleans, cookie metadata without `value`), never raw values.
- Any new sanctioned writer of `STFC_ACCOUNTS` MUST be added to the list above by
  constitutional amendment, not by ad-hoc PR.
- `DISCORD_BOT_TOKEN` MUST NOT be merged into `STFC_ACCOUNTS`, MUST NOT be
  handled by `scripts/capture-token.mjs`, and is provisioned only via direct
  `gh secret set DISCORD_BOT_TOKEN` by the operator. The v1.3.0 amendment
  that added `DISCORD_BOT_TOKEN` to the sanctioned-secret enumeration does
  NOT add a new writer of `STFC_ACCOUNTS`; the strict two-writer custody
  rule above is unchanged.

Rationale: The previous wording claimed `STFC_ACCOUNTS` and `.env` were the only
places a token could ever live and that `Refresh token` was the only writer of
`STFC_ACCOUNTS` — both untrue. The actual surface is wider but still bounded, and
codifying the exact bounded set (and the obligations on the writer scripts) gives
contributors a clear test for "is this change safe?": if it adds a new place a token
can live, or a new path that writes `STFC_ACCOUNTS`, it requires an amendment.

**Operator-Only One-Shot Ops Scripts (Discord application metadata)**

Scripts under `scripts/discord-ops/` are operator-invoked utilities for
managing Discord *application metadata* — the bot avatar, the application
description, and the bot username — and MAY issue `PATCH` / `PUT` /
`POST` requests against `https://discord.com/api/v10/users/@me` and
`https://discord.com/api/v10/applications/@me`. This is a narrow carve-out
to the "read-only Discord bot auth token" framing above: it authorizes
write traffic for application-metadata management only, and explicitly
NOT for sending messages, reactions, or any other write operation against
monitored servers or channels. The strict read-only constraint on the
runtime Discord client (FR-009 of specs/003-discord-oauth) is preserved
verbatim because these scripts are NOT the client — they are out-of-band
operator utilities.

Obligations on every script placed under `scripts/discord-ops/`:

- The scripts MUST NOT be loaded, imported, or executed by the
  `discord-monitor` runtime (`src/skills/discordMonitor.ts`,
  `src/discord/**`, or any code reachable from a cron-driven entry
  point under `.github/workflows/discord-monitor.yml` or
  `.github/workflows/redeem.yml`). Static separation is enforced by
  location: ops scripts live outside `src/` so the type-check, the test
  suite, and any future static audit can distinguish them from the
  monitor runtime by path alone.
- The scripts MUST redact `DISCORD_BOT_TOKEN` from every thrown error,
  every log line, every `process.exit` message, and every GitHub Actions
  Job Summary write — the same FR-012 obligation that already governs
  `src/discord/**`. Use the existing `redactString` helper at
  `src/lib/redact.ts` or an equivalent wrapper that produces the same
  guarantees.
- The scripts MAY be invoked locally with `DISCORD_BOT_TOKEN` in the
  operator's process env, OR via a `workflow_dispatch` workflow that
  maps the repo's `DISCORD_BOT_TOKEN` GitHub Actions secret onto the
  script's env (preferred — keeps the token off operator laptops).
- Any accompanying `workflow_dispatch` workflow MUST declare an
  explicit `permissions:` block per the Security & Compliance
  Constraints below, MUST pin every third-party action to a full
  commit SHA (the action-pinning rule already covers workflows that
  "carry the `DISCORD_BOT_TOKEN`"), and MUST be covered by a pinning
  test under `tests/` per the workflow-YAML rule in
  `.github/copilot-instructions.md` (Rule 3).

This carve-out introduces no new outbound destinations and no new
secrets: the existing enumeration of `https://discord.com/api/v10/...`
in the Security & Compliance Constraints below and `DISCORD_BOT_TOKEN`
in the sanctioned-secrets list above is reused. `DISCORD_BOT_TOKEN`
remains NOT a sanctioned writer of `STFC_ACCOUNTS`; the two-writer
custody rule for `STFC_ACCOUNTS` is unchanged. Any future ops script
that would call a Discord REST endpoint other than `/users/@me` or
`/applications/@me`, or would introduce a new outbound destination or
a new secret, requires a constitutional amendment — this carve-out
authorizes only the two endpoints named here.

**Separation between STFC/Discord secrets and the SWA Function runtime (v2.0.0)**

A hard invariant the v2.0.0 architecture relies on: the secrets that
drive the STFC and Discord runtimes never cross into the SWA + linked
Functions runtime, and vice versa. Specifically:

- No STFC store JWT, no `STFC_ACCOUNTS`, no `STFC_EMAIL`, no
  `STFC_PASSWORD` / `cj_pwd`, no `STFC_REFRESH_PAT`, and no
  `DISCORD_BOT_TOKEN` MAY be provisioned as a SWA Function app
  setting.
- No SWA Function handler MAY read those secrets from any source
  (env var, GitHub API, GitHub Actions cache, blob storage).
- No SWA / Function HTTP response MAY return those secrets in any
  form, masked or otherwise.
- The SWA control panel triggers redeem / discord-monitor /
  refresh-token work EXCLUSIVELY by dispatching the existing GitHub
  Actions workflows via `workflow_dispatch`, using the installation
  token minted from `GITHUB_APP_PRIVATE_KEY`. The workflows
  themselves continue to consume the STFC/Discord secrets from
  GitHub Actions repo secrets, on the runner, never exposed to the
  SWA Function.
- Conversely, the five SWA-Function-only secrets enumerated above
  (`GITHUB_APP_PRIVATE_KEY`, `MODELS_API_TOKEN`, `GEMINI_API_KEY`,
  `SWA_DEPLOYMENT_TOKEN`, `AZURE_TABLE_CONNECTION_STRING`) MUST
  NOT appear in `src/`, in any `npm run skill:*` script, or in any
  of the cron workflows under `.github/workflows/redeem.yml`,
  `refresh-token.yml`, or `discord-monitor.yml`.
- `GITHUB_APP_PRIVATE_KEY` and `MODELS_API_TOKEN` MUST be
  provisioned with DIFFERENT secret values; sharing a value
  between them is a Principle V violation.

Rationale: The web control panel and the STFC orchestrator share a
repo but have disjoint blast radii. Codifying the secret-set
disjointness as a constitutional invariant means any future PR
that tries to bridge the two runtimes is a visible governance
change rather than incremental drift.

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
- Files under `specs/`, `plans/`, `tasks/`, `.specify/memory/`,
  `.specify/templates/`, `docs/`, and `.github/` that are changed in a PR are
  scanned for JWT-shaped strings and bearer-token patterns by
  `scripts/check-artifact-hygiene.mjs`, invoked by
  `.github/workflows/squad-artifact-hygiene.yml`. The workflow fails the CI job on
  a match; whether that failure blocks merge depends on GitHub branch-protection
  settings outside this repository. Code comments and `tests/fixtures/` are not
  within the scanner's current scope. A `[skip-token-scan]` override placed in the
  PR description bypasses the scan for confirmed false positives; abuse is a
  Principle VII violation.

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
updates. This principle complements Principle III (Resilient Upstream-API
Automation) for the API layer.

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

## Speckit Reviewer Gates

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

## Security & Compliance Constraints

- **Canonical credential store.** `STFC_ACCOUNTS` is the canonical credential store
  for redeem runs. It is a JSON array of `{name, token}` objects loaded by
  `src/lib/accounts.ts`. The schema (`zod`) rejects malformed values with an
  infrastructure-class `AccountsConfigError`.
- **Sanctioned secret writers.** The only sanctioned writers of `STFC_ACCOUNTS` are
  `scripts/capture-token.mjs` (local, consent-gated `gh secret set` over stdin) and
  the `Refresh token` workflow's secret-update step (CI, using
  `STFC_REFRESH_PAT`). New writers require a constitutional amendment (Principle V).
- **Workflow permissions.** Every workflow under `.github/workflows/` MUST declare an
  explicit `permissions:` block. The default for jobs that do not need write access
  is `contents: read`; the `Refresh token` workflow uses a separate fine-grained PAT
  (`STFC_REFRESH_PAT`) for secret writes rather than elevating the workflow's
  `GITHUB_TOKEN`.
- **Outbound network scope.** The redemption orchestrator (`src/`) MUST only call
  the STFC store API base. The token-capture and token-refresh helpers
  (`scripts/capture-token.mjs`, `.github/workflows/refresh-token.yml`) additionally
  reach the Scopely-hosted login surface served from
  `https://home.startrekfleetcommand.com/store` (Playwright-driven) and may shell out
  to the `gh` CLI to update the `STFC_ACCOUNTS` secret over the GitHub API. The
  `discord-monitor` skill (`src/discord/**`, executed by
  `.github/workflows/discord-monitor.yml`) additionally calls
  `https://discord.com/api/v10/...` (REST only, read-only bot scopes; purpose:
  ingest messages from allowlisted channels per `config/discord-allowlist.json`)
  and, on Actions classifier-cache miss only, `https://huggingface.co/...`
  (purpose: one-time download of classifier model weights, integrity-checked
  against the SHA-256 pinned in `config/classifier-model.json`). Both
  `discord.com/api` and `huggingface.co` are sanctioned for the
  `discord-monitor` skill only. **Binding constraint:** NO message content from
  any monitored Discord channel — and NO STFC game data — ever leaves the
  runner. All message classification is performed on-runner by the locally
  cached model; the only outbound traffic from the classifier path is the
  one-time model-weights fetch above. Any other outbound destination requires
  a constitutional amendment. **Operator-only one-shot ops scripts under
  `scripts/discord-ops/` (see Principle V, "Operator-Only One-Shot Ops
  Scripts") additionally issue `PATCH`/`PUT`/`POST` against
  `https://discord.com/api/v10/users/@me` and
  `https://discord.com/api/v10/applications/@me` for application-metadata
  management (bot avatar, application description, bot username). These
  scripts are NOT part of the monitor runtime, MUST live outside `src/`,
  and MUST redact `DISCORD_BOT_TOKEN` from every error path per FR-012.
  This is the only authorized write traffic to Discord; the read-only
  constraint on the monitor runtime is preserved.** The SWA Function
  runtime (v2.0.0; lives under `api/` per the Phase 1 structure
  decision, NOT in `src/`) additionally calls two LLM inference hosts:
  `https://models.inference.ai.azure.com/...` (GitHub Models, primary)
  and `https://generativelanguage.googleapis.com/...` (Gemini Flash,
  fallback). Both are sanctioned for the SWA Function runtime ONLY;
  the redemption orchestrator (`src/`), the `discord-monitor` runtime
  (`src/discord/**`), and any `scripts/discord-ops/` ops script MUST
  NOT call either host. The SWA Function MAY additionally call the
  GitHub REST API (`https://api.github.com/...`) for installation-
  token minting and `workflow_dispatch` dispatch using the
  installation token derived from `GITHUB_APP_PRIVATE_KEY`, and MAY
  read repo-raw content from `https://raw.githubusercontent.com/...`
  for the run-status feed (per RD P0.1 ETag design). Any other
  outbound destination from the SWA Function MUST be added by
  constitutional amendment.
- **Workflow-input obligation for dispatch-eligible workflows
  (v2.0.0).** Every `workflow_dispatch`-eligible workflow that is
  callable from the SWA control-panel surface (today:
  `.github/workflows/redeem.yml`,
  `.github/workflows/discord-monitor.yml`, and
  `.github/workflows/refresh-token.yml`) MUST declare three
  `workflow_dispatch.inputs`: `correlation_id` (string, default
  `""`), `triggered_by` (string, default `""`), and `reason`
  (string, default `""`). Defaults are empty so that `schedule:`
  cron triggers continue to work without providing them. The
  dispatcher in the SWA Function MUST populate all three on every
  web-initiated run; the audit log under `data/audit/*.jsonl` MUST
  persist them; workflows MAY surface them in the Job Summary;
  cron runs naturally show empty strings. This obligation does NOT
  apply to workflows that are not dispatch-eligible from the SWA
  surface (e.g., the `squad-*.yml` family, `optimize-crew.yml`,
  `test.yml`, `squad-test-gate.yml`, `squad-artifact-hygiene.yml`).
  Wiring the three target workflows is tracked under Phase 1+ of
  the 005-web-control-panel epic (#104); this constitutional
  obligation lands in v2.0.0, the per-workflow YAML changes land
  with the dispatcher PRs.
- **Secret hygiene in artifacts.** Specs, plans, tasks, PR descriptions, and other
  committed artifacts MUST NOT contain real JWTs, real account names, real player IDs,
  or unsanitized API responses. Principle VII covers this obligation; automated
  enforcement by `scripts/check-artifact-hygiene.mjs` (invoked by
  `.github/workflows/squad-artifact-hygiene.yml`) scans files under `specs/`,
  `plans/`, `tasks/`, `.specify/memory/`, `.specify/templates/`, `docs/`, and
  `.github/` that are changed in a PR. Code comments and `tests/fixtures/` are outside
  the current automated scan scope and rely on manual code review. The CI scan honours
  a `[skip-token-scan]` PR-description escape hatch for confirmed false positives —
  abuse is a Principle VII violation reviewable by Bashir/Picard.
- **Third-party action pinning.** Workflows that handle the JWT, write the
  `STFC_ACCOUNTS` secret, or carry the `DISCORD_BOT_TOKEN` MUST pin every
  third-party action to a full commit SHA with the version in a trailing
  comment. This is verified today for `redeem.yml`, `refresh-token.yml`,
  `test.yml`, `squad-test-gate.yml`, `discord-monitor.yml` (added in v1.3.0),
  `optimize-crew.yml` (added in v1.6.0 — no cron, triggers on `push`
  to `data/crew/**` and `workflow_dispatch`, concurrency group
  `stfc-crew-optimizer`, covered by Rule 3 pinning tests in
  `tests/skills/optimizeCrew.test.ts`),
  and the SHA-pinned uses in `squad-artifact-hygiene.yml`. Auxiliary
  squad-process workflows
  (`sync-squad-labels.yml`, `squad-heartbeat.yml`, `squad-triage.yml`,
  `squad-issue-assign.yml`, the `actions/github-script@v7` step in
  `squad-artifact-hygiene.yml`) currently use moving major-version tags; tightening
  those to SHAs is tracked as a follow-up and is NOT yet a uniform repo invariant.
- **Licensing.** The project remains MIT-licensed (see `LICENSE`). New runtime
  dependencies MUST be license-compatible (MIT/BSD/Apache-2.0/ISC).
- **Disclosure.** The README MUST clearly state that the tool is unofficial, may
  violate the STFC / Scopely Terms of Service, and is run at the operator's own risk
  (see `README.md` "Disclaimer" section).

Rationale: The v1.1.0 text governed a Manifest V3 browser extension that does not
exist in this repo (no `extension/`, no `manifest.json`, no popup, no content
scripts). This rewrite governs the surfaces that *do* exist — secret stores,
sanctioned secret writers, workflow permissions, outbound network scope — and
explicitly carves out the GitHub-API and Scopely-login traffic the helper scripts
legitimately need so the constitution does not lie about its own outbound posture.
The SHA-pinning rule is scoped to "workflows that touch the token surface" so it
matches the verifiable repo state today, with the rest tracked as follow-up.

## Development Workflow

- **Branching and specs**: Non-trivial changes MUST follow Principle VI's Spec Kit workflow. Use `speckit.git.feature` when a Spec Kit feature branch is required; do not treat direct commits to `main` as a substitute for required review or required checks.
- **Required local checks before merge**:
  1. `npm run typecheck` — verifies the TypeScript surface with `tsc --noEmit`.
  2. `npm test` — runs the Node test suite through `tests/index.test.ts`.
  3. For changes that affect live CLI behavior, run the relevant skill smoke test and record the result in the PR: choose from `npm run skill:check-auth`, `npm run skill:list-gifts`, `npm run skill:claim-gifts`, `npm run skill:redeem-codes`, or `npm run skill:run-all` based on the code path changed. If credentials or live-store access are unavailable, record that limitation instead of fabricating verification.
- **CI gates present in the repo**: `.github/workflows/test.yml` runs `npm run typecheck` and `npm test` on push and pull request. `.github/workflows/squad-test-gate.yml` runs `npm test` on pull request and names the job `npm test (required)` for branch-protection configuration. `.github/workflows/squad-artifact-hygiene.yml` runs the artifact hygiene scanner on matching PR artifact paths, with its documented `[skip-token-scan]` bypass. The repository defines these workflows; whether they block merge depends on GitHub branch-protection settings outside the repository and must not be overstated without verifying those settings.
- **Scheduled runtime verification**: `.github/workflows/redeem.yml` is the production scheduled/manual redeem workflow. It installs dependencies with `npm ci` and runs `npm run skill:run-all` using `STFC_ACCOUNTS`. Changes to orchestration, account loading, outcomes, summary rendering, or redeem behavior MUST consider this workflow as the deployment target.
- **Manual verification**: Changes to auth detection, API request/response handling, outcome classification, promo-code redemption, or gift claiming MUST be smoke-tested through the narrowest relevant `npm run skill:*` command or through the `Redeem gifts` `workflow_dispatch` path, then documented in the PR. This replaces the obsolete web-app/extension smoke-test requirement.
- **Reviews**: At least one human reviewer MUST approve any PR that modifies redeem automation, credential handling, GitHub Actions runtime behavior, package scripts, TypeScript configuration, or persistence/summary behavior. Reviewers MUST evaluate agent-authored code against functional requirements, constitutional principles, and test coverage rather than rejecting it solely because an agent produced it.

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

---

### Known Tension: Principle III auth/me failure taxonomy overclaim

- **Principle affected:** III. Resilient Upstream-API Automation
- **Tension:** The replacement sentence introduced a new overclaim: it says transient network errors and unclassified HTTP errors "MUST NOT fail the workflow" (`.squad/.scratch/constitution-v1.2.0-edited.md:198-201`). That is false for non-schema `auth/me` failures: `checkAuth()` pushes every non-`TokenExpiredError`, non-`SchemaMismatchError` failure into `report.errors` (`src/skills/runAll.ts:151-163`), and `finalize()` turns any such error into `exitCode = 1` (`src/skills/runAll.ts:276`). — Borg Queen, Pass 3 Finding 2
- **Accepted in:** v1.2.0 (per cyrusj's Path D ratification decision, 2026-05-08)
- **Resolution scheduled:** v1.3.0
- **Tracking:** `.squad/decisions/inbox/v1.3.0-backlog.md`

### Known Tension: Principle VII / Security .github/ scan path overclaim

- **Principle affected:** VII. Artifact Hygiene / Security & Compliance Constraints
- **Tension:** The edited draft says changed files under `.github/` are scanned in PRs (`.squad/.scratch/constitution-v1.2.0-edited.md:399-403, 524-527`). That overstates the workflow trigger. The workflow only triggers on `.github/**/*.md`, not arbitrary `.github/` files (`.github/workflows/squad-artifact-hygiene.yml:12-21`). So the hard-gate claim is fixed, but the scoped-path claim is still not fully true. — Borg Queen, Pass 3 Finding 3
- **Accepted in:** v1.2.0 (per cyrusj's Path D ratification decision, 2026-05-08)
- **Resolution scheduled:** v1.3.0
- **Tracking:** `.squad/decisions/inbox/v1.3.0-backlog.md`

### Known Tension: Redeem/refresh concurrency lock un-principled

- **Principle affected:** None (governance gap — no existing principle covers this invariant)
- **Tension:** The repo has a real safety invariant: `redeem.yml` and `refresh-token.yml` share the same `concurrency.group` (`stfc-gift-redeemer`) so secret reads/writes do not race (`.github/workflows/redeem.yml:20-23`; `.github/workflows/refresh-token.yml:36-39`). The assembled constitution mentions the workflows, but no principle/section states that this lock is required. — Borg Queen, Pass 2 Section D item 3
- **Accepted in:** v1.2.0 (per cyrusj's Path D ratification decision, 2026-05-08)
- **Resolution scheduled:** v1.3.0
- **Tracking:** `.squad/decisions/inbox/v1.3.0-backlog.md`

**Version**: 2.0.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-31
