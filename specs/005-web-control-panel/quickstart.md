# Quickstart: 005-web-control-panel

**Status:** Placeholder — populated in Phase 1 once the SWA is
bootstrapped, the deployment contract lands, and the first read-only
endpoints are live.

Phase 1 will populate this with:

- How to invite a user to the `stfc_operator` SWA role.
- How to set the Function-side env-var allowlist (defense in depth).
- How to bring up a preview SWA environment.
- How to verify the auth gate end-to-end (sign in as allowed user;
  sign in as denied user; confirm 403 from `/api/data/*`).
- How to flip the kill switches (`DISABLE_WRITES`, `DISABLE_CHAT`,
  `DISABLE_CHAT_WRITE_TOOLS`) and confirm 503.

Until Phase 1 lands, refer to:

- `spec.md` (this directory) for the user stories and acceptance
  scenarios.
- v3 plan
  (`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`)
  § "Phase 1 — Read-only dashboard + auth foundation + deploy
  contract" for the issue breakdown.
- O'Brien's platform-spike output in `research.md` once it lands
  (issue #109).
