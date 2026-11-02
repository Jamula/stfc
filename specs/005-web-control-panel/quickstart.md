# Quickstart: 005-web-control-panel

**Status:** Local read-only dashboard implementation; operator provisioning and deployed
acceptance remain separate gates. Telemetry explicitly reports unavailable until
an approved artifact producer exists.

## Phase 1 capability surface

### Wave 3 — Foundation (this PR #124)

1. **Auth library** (`api/src/_lib/auth.ts`)
   - SWA `x-ms-client-principal` header parsing
   - Role-based access control (RBAC) for `stfc_operator` role
   - Enforced on all Azure Function handlers via CI gate (`scripts/ci/check-api-auth.mjs`)
   - See `docs/SWA-SETUP.md` for auth setup steps

2. **Frontend shell** (`web/src/app.ts`)
   - Lit-based control panel UI
   - Connected to SWA auth context
   - Smoke tested in `tests/web/shell.test.ts`

3. **SWA deployment contract** (`shared/contracts/`)
   - Type-safe schemas for chat tool-calls, audit events, run results
   - Auto-generated from `specs/005-web-control-panel/contracts/*.json`
   - Regenerate with `npm run build:contracts`; verify with `npm run check:contracts`

### Wave 4 — Capabilities (separate PRs, already merged on main)

1. **Data-read endpoints** (`api/src/data/index.ts`)
   - Contracted surfaces in `shared/contracts/` (auto-generated from JSON schemas)
   - GET `/api/data/{redeems,digests,telemetry,crew,runs}`; missing principal returns
     401, missing role or allowlist membership returns 403.
   - Redeems and the latest 20 digests read canonical `automation-state` artifacts;
     officer reference data reads `main`. No fallback presents frozen seeds as live state.
   - Runs merge the latest 20 Actions executions per selected workflow with optional
     `main:data/runs/*.json`, retaining business results and no-op cron runs.
   - See `docs/SWA-SETUP.md` section 4 for user invitation steps.

2. **Invitation guidance**
   - User invitation and access grant procedures
   - See `docs/SWA-SETUP.md` section 4 and its authorization configuration section.

## Getting started

- **To invite an operator:** See `docs/SWA-SETUP.md` section 4.
- **To understand the auth layer:** See `api/src/_lib/auth.ts` + `docs/SWA-SETUP.md`
- **For contract schemas:** See `shared/contracts/README.md` + `specs/005-web-control-panel/contracts/`
- **For full Phase 1 design:** See v3 cleanup plan § "Phase 1 — Read-only dashboard + auth foundation + deploy contract"

## Read behavior and limitations

The existing five tabs fetch same-origin JSON, display loading/empty/error states,
and render committed documents as text (not executable HTML). Runs show actor,
trigger, status, correlation ID and any emitted business result. The endpoint
accepts `workflow=redeem|discord-monitor|refresh-token` and integer `limit=1..100`
(default 20). Upstream errors and invalid run artifacts fail visibly; an absent
optional run-artifact directory is valid because no-op cron executions exist
only in Actions.

Run names may carry an explicit `correlation_id=<id>` token. Without one,
scheduled executions use `cron-{run_id}`; other executions use `run-{run_id}`.
The reader never guesses manual correlations from timestamps. Current producers
do not yet emit manual correlation markers, so unrelated artifact/API records
are not falsely combined. No workflow producer or write capability is added here.

The Functions entrypoint is `api/dist/api/src/index.js`; the widened TypeScript
root includes the shared contract types without duplicating them. For local checks:
`npm run build:api`, `npm run typecheck`, `npm run typecheck --prefix web`,
`npm run build:web`, and `node scripts/ci/check-bundle-budget.mjs`.
