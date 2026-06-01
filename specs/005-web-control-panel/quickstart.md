# Quickstart: 005-web-control-panel

**Status:** Phase 1 shipped — auth foundation + read-only dashboard + SWA bootstrap complete.

## Phase 1 capability surface

Phase 1 (Wave 3 PR #124) ships:

1. **Auth library** (`api/src/_lib/auth.ts`)
   - SWA `x-ms-client-principal` header parsing
   - Role-based access control (RBAC) for `stfc_operator` role
   - Enforced on all Azure Function handlers via CI gate (`scripts/ci/check-api-auth.mjs`)
   - See `docs/SWA-SETUP.md` for auth setup steps

2. **Frontend shell** (`web/src/shell.ts`)
   - Lit-based control panel UI
   - Connected to SWA auth context
   - Smoke tested in `tests/web/shell.test.ts`

3. **Data-read endpoints** (Wave 4 #121)
   - Contracted surfaces in `shared/contracts/` (auto-generated from JSON schemas)
   - `/api/data/*` read-only access (403 for unauthorized, 200 for operator role)
   - See `docs/SWA-INVITATION-RUNBOOK.md` for user invitation steps

4. **SWA deployment contract** (`shared/contracts/`)
   - Type-safe schemas for chat tool-calls, audit events, run results
   - Auto-generated from `specs/005-web-control-panel/contracts/*.json`
   - Regenerate with `npm run build:contracts`; verify with `npm run check:contracts`

## Getting started

- **To invite an operator:** See `docs/SWA-INVITATION-RUNBOOK.md` § "User Invitation"
- **To understand the auth layer:** See `api/src/_lib/auth.ts` + `docs/SWA-SETUP.md`
- **For contract schemas:** See `shared/contracts/README.md` + `specs/005-web-control-panel/contracts/`
- **For full Phase 1 design:** See v3 cleanup plan § "Phase 1 — Read-only dashboard + auth foundation + deploy contract"
