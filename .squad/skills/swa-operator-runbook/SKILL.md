# SKILL: SWA Operator Runbook Structure

**Slug:** `swa-operator-runbook`  
**Owner:** O'Brien (DevOps / Platform Engineer)  
**First used:** PR #125 (issue #118, 005-web-control-panel Wave 4)  
**Reusable for:** any Azure Static Web Apps feature that has a custom-role or operator-facing access management surface.

---

## Pattern

When a SWA feature uses **custom role assignment** (invitation-based or otherwise), the
operator runbook should follow this 10-section structure. The structure was validated
against the 005-web-control-panel threat model and the two-gate auth model; it generalises
to any SWA + Azure Functions deployment using GitHub OAuth.

### Canonical section order

1. **Overview** — auth model summary (outer SWA gate + inner Function gate); state the
   "both gates must be updated together" obligation upfront.
2. **Prerequisites** — az CLI version, Azure account/role required, gh CLI, confirm
   resource exists.
3. **Generate** — CLI command (preferred) + Portal fallback; document every parameter;
   call out the `--domain` requirement.
4. **Distribute securely** — refuse-and-rotate protocol; enumerate prohibited and approved
   channels explicitly.
5. **Post-action: update inner gate** — the env-var allowlist (or equivalent Function-side
   gate); make the two-gate obligation concrete with a code block.
6. **Invitee / invitee-side flow** — what the end user sees and clicks; common friction
   points (first-time cookie, consent screen).
7. **Verify access** — operator confirmation steps; cross-ref to auth library error codes
   (401/403 taxonomy); document what "success" looks like in logs.
8. **Manage churn under cap** — audit command, revoke command, re-issue steps; emergency
   cap procedure (what to do when approaching the platform limit).
9. **Troubleshooting** — table format: Symptom / Likely cause / Fix. Must cover at minimum:
   - Missing `x-ms-client-principal` header
   - Role propagation lag
   - Expired invitation
   - Browser cookie / ITP / ETP issues
10. **Cross-references** — table of related files with one-line description each.

### File placement decision

- If `docs/SWA-SETUP.md` (or equivalent) is under ~250 lines → extend inline.
- If over ~250 lines → create `docs/SWA-<FEATURE>-RUNBOOK.md`; update setup doc §N with
  a cross-reference and a minimal "quick steps" snippet.

### Key az CLI commands (reusable templates)

```bash
# Generate invitation
az staticwebapp users invite \
  --name <swa-name> \
  --resource-group <rg> \
  --authentication-provider GitHub \
  --user-details <github-login> \
  --roles <custom-role> \
  --invitation-expiration-in-hours 168 \
  --domain "https://${SWA_HOST}"

# List current users + roles
az staticwebapp users list \
  --name <swa-name> \
  --resource-group <rg> \
  --authentication-provider GitHub \
  --query "[].{login:displayName, roles:join(',',roles)}" -o table

# Revoke user (set roles to empty)
az staticwebapp users update \
  --name <swa-name> \
  --resource-group <rg> \
  --authentication-provider GitHub \
  --user-details <github-login> \
  --roles ""
```

### Threat-model checklist (include in §9)

Map your doc's troubleshooting / §9 to the relevant STRIDE-lite entries:
- **Spoofing (S-x):** stale invitation / wrong user receives role
- **Elevation (E-x):** forged principal bypasses inner gate; non-owner gets owner capability
- State the residual risk honestly (propagation lag, misconfigured exposure)

---

## Anti-patterns (don't do these)

- ❌ Documenting only the Portal path — the CLI is learnable and scriptable; prefer it.
- ❌ Saying "update SQUAD_ALLOWED_USERS" without showing the exact `az appsettings set`
  command — operators under pressure skip to the code block.
- ❌ Documenting the outer gate without mentioning the inner gate — this is the most
  common operator mistake (invites succeed but every API call 403s).
- ❌ Omitting the bearer-token warning on the invitation URL — it must be treated like
  a password reset link.
- ❌ A single monolithic troubleshooting section without the Symptom/Cause/Fix table
  format — scannability matters in ops contexts.
