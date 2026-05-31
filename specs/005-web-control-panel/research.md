# Research: 005-web-control-panel

## Phase 0 Platform Spike

**Owner:** O'Brien
**Tracking issue:** #109
**Status:** Placeholder — to be populated by O'Brien's spike output.

### Questions to resolve

1. **Azure SWA custom-role mechanism.** Does the
   `staticwebapp.config.json` `allowedRoles` model — combined with
   per-user role assignment via SWA invitation — work as the v3 plan
   architecture assumes? Confirm or refute RD P0.1's finding that
   `allowedPrincipals` does NOT support per-username allowlists in
   config.
2. **GitHub App installation on `Jamula/stfc`.** Can `cyrusjamula`
   install a new GitHub App with `actions: read/write` + `contents:
   read` scopes on the `Jamula/stfc` repository without org-policy
   blocking, and is the installation private-key flow documented for
   SWA Function app-setting storage?
3. **GitHub Models availability.** Is the GitHub Models API
   (`https://models.inference.ai.azure.com`) available on this
   account, in the SWA-hosted region, with the `models:read`
   scope? If not, what fallback (Gemini Flash) provisioning is
   required?

### Acceptance for this spike

A short report (≤2 pages) committed back to this file with a clear
GO/NO-GO recommendation per question, plus any new risks or
constraints surfaced. Any NO-GO finding gates Phase 1+ until resolved
or the v3 plan is amended.

### v3 plan reference

See `~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`
§ "Phase 0 — Governance + spec + threat model + schema" for the
spike's role in the bundled Phase 0 PR pattern (mirrors the 004
`c6432d9` precedent).
