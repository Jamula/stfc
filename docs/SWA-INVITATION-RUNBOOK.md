# SWA Operator Invitation Runbook

**Feature:** 005-web-control-panel  
**For:** `cyrusjamula` (or any delegated operator)  
**Tracking issue:** #118  
**See also:** `docs/SWA-SETUP.md` (infrastructure setup), `specs/005-web-control-panel/deploy-contract.md`

---

## Overview

The STFC Control Panel uses **SWA Free-tier custom role assignment** via invitation tokens
to grant the `stfc_operator` role. This is a **hard platform cap of 25 users** (Azure
Free-tier limit). This runbook covers the full operator management lifecycle:
generating invitations, distributing them securely, verifying access, managing churn
under the cap, and troubleshooting common failure modes.

**Authorization model (two independent gates — threat-model S-1, E-1):**

1. **SWA route gate** — `staticwebapp.config.json` requires `allowedRoles: ["stfc_operator"]`
   on every route. Users without the role cannot reach any page or API endpoint.
2. **Function-side env-var allowlist** — every Azure Function handler calls
   `requireAllowedUser(req)` from `api/src/_lib/auth.ts` as its first statement,
   re-validating the SWA-injected `X-MS-CLIENT-PRINCIPAL` header against the
   `SQUAD_ALLOWED_USERS` env-var allowlist. This is defence-in-depth against stale
   role assignments and forged principals (threat-model S-2).

**Both gates must be updated together whenever you invite or revoke a user.**

---

## 1. Prerequisites

| Requirement | Details |
|---|---|
| `az` CLI ≥ 2.60 | `az --version`; [install guide](https://docs.microsoft.com/cli/azure/install-azure-cli) |
| Azure account | Must be logged in with Contributor or higher on `stfc-control-panel-rg` |
| `gh` CLI ≥ 2.x | [cli.github.com](https://cli.github.com) — for updating `SQUAD_ALLOWED_USERS` |
| SWA resource exists | Confirm with `az staticwebapp show --name stfc-control-panel --resource-group stfc-control-panel-rg` |

Verify your session before starting:

```bash
az login              # opens browser — skip if already authenticated
az account show       # confirm correct subscription
az staticwebapp show \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --query defaultHostname -o tsv
# → stfc-control-panel.<random>.azurestaticapps.net
```

You also need write access to the repo to update `SQUAD_ALLOWED_USERS` (see §4).

---

## 2. Generate an invitation

### 2a. Via Azure CLI (preferred)

```bash
SWA_NAME=stfc-control-panel
SWA_RG=stfc-control-panel-rg
INVITEE_GITHUB_LOGIN=<github-username>   # exact GitHub login, case-sensitive

# Get the SWA hostname first
SWA_HOST=$(az staticwebapp show \
  --name "$SWA_NAME" \
  --resource-group "$SWA_RG" \
  --query defaultHostname -o tsv)

az staticwebapp users invite \
  --name "$SWA_NAME" \
  --resource-group "$SWA_RG" \
  --authentication-provider GitHub \
  --user-details "$INVITEE_GITHUB_LOGIN" \
  --roles stfc_operator \
  --invitation-expiration-in-hours 168 \
  --domain "https://${SWA_HOST}"
```

This prints an `invitationUrl`. **Do not paste this URL into Slack, Discord, or any chat
channel.** See §3 for secure distribution.

**Key parameters:**

| Parameter | Value | Notes |
|---|---|---|
| `--authentication-provider` | `GitHub` | Only GitHub OAuth is wired in `staticwebapp.config.json` |
| `--user-details` | `<github-login>` | Must exactly match the GitHub username the invitee will sign in with |
| `--roles` | `stfc_operator` | The role defined in `staticwebapp.config.json`; do not use `anonymous` or `authenticated` |
| `--invitation-expiration-in-hours` | `168` (7 days) | Minimum 1h, maximum 168h on Free tier; set shorter for high-sensitivity invites |
| `--domain` | SWA HTTPS URL | Required; used to scope the invitation cookie domain |

### 2b. Via Azure Portal (fallback)

1. Portal → **Static Web Apps** → `stfc-control-panel`
2. Left menu → **Role Management** → **Invite**
3. Fill in:
   - **Authentication provider:** GitHub
   - **Invitee GitHub login:** `<github-username>`
   - **Role:** `stfc_operator`
4. Click **Generate** → copy the invitation URL
5. Set expiry to 7 days or less

> **Note on Free tier:** The Azure Portal UI may show fewer expiry options than the CLI.
> If you need a specific expiry, use the CLI.

---

## 3. Distribute the invitation securely

The invitation URL is a **bearer token** — anyone with it can accept the invitation and
receive the `stfc_operator` role. Treat it like a password reset link.

**Prohibited channels (refuse-and-rotate protocol):**
- ❌ Slack / Discord DM or channel
- ❌ GitHub issue or PR comment (even private)
- ❌ Email with no encryption
- ❌ Shared document with broad read access

If you accidentally paste the URL in a prohibited channel, **revoke it immediately**
(see §6 — you cannot revoke by URL, but you can revoke the user if they accepted, or
rotate the invite by revoking and re-generating before acceptance). Do not wait to see
if anyone opened it.

**Approved channels:**
- ✅ Encrypted email (GPG, S/MIME, or provider E2EE)
- ✅ Signal / WhatsApp DM (E2EE)
- ✅ 1Password or Bitwarden secure share
- ✅ SSH-authenticated file drop (SCP, SFTP)
- ✅ In person / verbal (for same-machine setup)

---

## 4. Post-invite: update the Function-side allowlist

The SWA invitation grants the outer-gate role. The inner gate — `requireAllowedUser()`
in `api/src/_lib/auth.ts` — checks the `SQUAD_ALLOWED_USERS` env-var allowlist. **If
`SQUAD_ALLOWED_USERS` is not updated, the invitee will get a 403 from every API call
even after accepting the invitation.**

```bash
# View current allowlist
az staticwebapp appsettings list \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --query "[?name=='SQUAD_ALLOWED_USERS']" -o tsv

# Update (replace CURRENT_USERS with the full comma-separated list)
az staticwebapp appsettings set \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --setting-names \
    SQUAD_ALLOWED_USERS="cyrusjamula,new-invitee-login"
```

> **Format:** comma-separated GitHub logins, no spaces around commas.
> `requireAllowedUser` trims whitespace but be consistent.

After updating, wait ~30 seconds for the setting to propagate before asking the invitee
to test access (see §5 — role propagation lag).

---

## 5. Invitee acceptance flow

The invitee does the following:

1. Clicks the invitation URL (opens in a browser — see §8 on browser cookie issues)
2. If not already signed in to GitHub: redirected to `github.com/login`, signs in
3. GitHub OAuth consent screen: grants the SWA app basic profile access (read-only)
4. Redirected back to the SWA: role is assigned, session cookie is set
5. Browser lands on the SWA homepage

The invitation is **single-use** — the URL is invalidated after first acceptance. The
role persists until explicitly revoked (see §6).

> If the invitee gets a 403 page (`/403.html`) immediately after accepting, the most
> likely cause is `SQUAD_ALLOWED_USERS` was not updated (§4). Ask them to wait 2
> minutes for propagation and retry by navigating directly to the SWA URL.

---

## 6. Verify access (operator confirmation steps)

After the invitee accepts and reports back:

### 6a. Check role assignment via CLI

```bash
az staticwebapp users list \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --authentication-provider GitHub \
  --query "[?roles[?contains(@,'stfc_operator')]].{login:displayName, roles:roles}" \
  -o table
```

Confirm the invitee's GitHub login appears with `stfc_operator` in the roles column.

### 6b. Verify Function-layer auth

Ask the invitee to navigate to the dashboard and perform any authenticated action
(e.g. a read-only API call). The expected behavior per `api/src/_lib/auth.ts`:

| Scenario | HTTP response | Meaning |
|---|---|---|
| `X-MS-CLIENT-PRINCIPAL` present + user in allowlist | `200` | Fully authorized — both gates passed |
| `X-MS-CLIENT-PRINCIPAL` present + user NOT in allowlist | `403` | Outer gate OK; inner gate blocked — update `SQUAD_ALLOWED_USERS` |
| `X-MS-CLIENT-PRINCIPAL` absent | `401` | Not authenticated at SWA layer — role not assigned or cookie expired |

Check Function logs in Azure Portal → `stfc-control-panel` → **Functions** → select
handler → **Monitor** → **Logs** for detailed error messages. The auth library produces:

- `"No valid authentication principal"` → 401 (header missing or malformed base64)
- `"User \"<login>\" is not in the allowed list"` → 403 (allowlist miss)
- `"User \"<login>\" does not have role \"stfc_operator\""` → 403 (role check fail, requireRole path)

> **Owner-only endpoints (threat-model E-2):** `/api/ops/refresh-token` and any
> handler calling `requireOwner()` will return 403 for all invitees who are not
> `SQUAD_OWNER`. This is expected and correct. Only `cyrusjamula` can access those
> endpoints. Do not diagnose this as an invitation problem.

---

## 7. Manage churn under the 25-user cap

Azure SWA Free tier caps custom role assignments at **25 users**. At current usage
(primarily `cyrusjamula`) this cap is non-binding, but document the procedure now
before you need it under pressure.

### 7a. Audit current users

```bash
az staticwebapp users list \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --authentication-provider GitHub \
  --query "[].{login:displayName, roles:join(',',roles), userId:id}" \
  -o table
```

Review the output. Users who no longer need access should be revoked promptly (threat-model S-1 — stale invitation residual risk).

### 7b. Revoke a user

```bash
# Remove stfc_operator role (sets roles to empty = revoked)
az staticwebapp users update \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --authentication-provider GitHub \
  --user-details <github-login> \
  --roles ""
```

After revoking, also remove the user from `SQUAD_ALLOWED_USERS`:

```bash
az staticwebapp appsettings set \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --setting-names \
    SQUAD_ALLOWED_USERS="cyrusjamula"   # remove the revoked user; keep remaining list
```

> **Verification:** After revocation, if the former user has an active SWA session
> cookie, they may be redirected to the 403 page rather than the login prompt. This is
> correct SWA behavior — the cookie is cleared on the next auth challenge (typically
> within minutes). The Function-side 403 from `requireAllowedUser` is immediate once
> `SQUAD_ALLOWED_USERS` is updated.

### 7c. Re-issue an invitation (slot churn)

If a user's invitation expired before acceptance, or you need to swap out a user:

1. Revoke the old user (§7b) — frees the slot
2. Generate a new invitation (§2a) for the replacement user
3. Update `SQUAD_ALLOWED_USERS` (§4)
4. Distribute via approved channel (§3)

Slots are reclaimed immediately upon role revocation — there is no cool-down period.

### 7d. Emergency: approaching the 25-user cap

If the user count approaches 25:

1. Run the audit (§7a) — identify users who haven't signed in recently
2. Revoke idle users first (check last login via Portal → Role Management)
3. If all 25 slots are legitimately occupied, open a GitHub issue to evaluate
   upgrading to Azure SWA Standard tier (removes the 25-user cap)

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Invitee gets 401 after accepting invitation | SWA role not persisted; cookie not set | Ask invitee to clear cookies for the SWA domain and accept invitation in a fresh private-browsing window |
| Invitee gets 403 immediately after accepting | `SQUAD_ALLOWED_USERS` not updated | Add the login to the allowlist (§4) and wait 30s |
| Invitee gets redirect loop (GitHub → SWA → GitHub) | Role assignment failed silently | Re-generate invitation; verify `--authentication-provider GitHub` and exact GitHub login match |
| Invitation URL reports "already used" | Single-use token was already accepted | Check `az staticwebapp users list` — the user may already be assigned; if not, re-generate |
| Invitation URL reports "expired" | `--invitation-expiration-in-hours` elapsed | Re-generate with a fresh expiry window (§2a) |
| `X-MS-CLIENT-PRINCIPAL` header missing in Function logs | Direct Function URL called without SWA proxy, or browser blocked the cookie | Ensure Functions are accessed via the SWA hostname, not a direct `.azurewebsites.net` URL; check browser cookie policy (see below) |
| Role propagation lag (403 even after `az` shows `stfc_operator`) | Azure propagation delay (~30–120s on Free tier) | Wait up to 2 minutes; the SWA auth edge needs to refresh its role cache |
| `requireAllowedUser` throws 403 but user is in `SQUAD_ALLOWED_USERS` | Trailing whitespace or comma in env-var value | Check exact value: `az staticwebapp appsettings list ... --query "[?name=='SQUAD_ALLOWED_USERS'].value" -o tsv`; ensure no leading/trailing spaces in any login |

### Browser / cookie issues

The SWA session is maintained via a `StaticWebAppsAuthCookie` cookie. Common problems:

- **Safari ITP (Intelligent Tracking Prevention):** May block the OAuth redirect flow for
  `*.azurestaticapps.net` if the domain hasn't been visited before. Fix: navigate
  directly to the SWA URL first, then open the invitation link. Or use Chrome/Firefox.
- **Firefox Enhanced Tracking Protection:** Same issue; ETP Strict mode may block
  third-party cookies from `login.microsoftonline.com` during the OIDC exchange.
  Switch to Standard mode temporarily, or use a private window with protection disabled.
- **`x-ms-client-principal` header absent:** This header is injected by the SWA
  platform proxy only when the request goes through the SWA routing layer. If you see
  it missing in prod logs (not local dev), the most common cause is a direct call to
  the underlying Azure Functions URL (`.azurewebsites.net`) bypassing the SWA proxy.
  Confirm the invitee is hitting the `azurestaticapps.net` hostname.

### Local development note

`X-MS-CLIENT-PRINCIPAL` is not injected in local dev (`func start` alone). Use
`api/local.settings.json` and set `SQUAD_ALLOWED_USERS` there. The auth library
handles the missing header gracefully: `parsePrincipal()` returns `null`, and
`requireAllowedUser()` throws a 401 — correct behavior for un-authenticated local calls.

---

## 9. Threat-model alignment

This runbook addresses the following threat-model findings
(`specs/005-web-control-panel/threat-model.md`):

| Threat ID | Threat | Mitigation in this runbook |
|---|---|---|
| S-1 | Wrong user receives `stfc_operator` role or stale invitation remains active | §2 — targeted CLI invite with explicit login; §6 — confirm via `users list`; §7b — revoke stale assignments |
| S-2 | Forged `X-MS-CLIENT-PRINCIPAL` header bypasses SWA | §6b — explains the 401 path when header is absent; §8 — missing header diagnosis |
| E-1 | Forged principal or SWA role leak grants API access | §4 — two-gate update protocol (SWA invite + env allowlist); §6b — error mapping |
| E-2 | Non-owner gets `refresh-token` capability | §6b — documents expected 403 for owner-only endpoints; cross-ref to `requireOwner` |

Residual risk (S-1): role/env drift during the propagation window (~30–120s). No
additional mitigation recommended — the window is narrow and both gates converge.

---

## 10. Cross-references

| Artifact | What it provides |
|---|---|
| `api/src/_lib/auth.ts` | `parsePrincipal`, `requireAllowedUser`, `requireOwner`, `requireRole` — the Function-side auth helpers |
| `staticwebapp.config.json` | Route-level `allowedRoles: ["stfc_operator"]` definition; 401→GitHub OAuth redirect; 403→`/403.html` rewrite |
| `docs/SWA-SETUP.md` | Infrastructure setup (SWA resource, OIDC credentials, secrets, first-boot invite); initial bootstrap steps |
| `specs/005-web-control-panel/deploy-contract.md` | Full OIDC contract and deployment constraints |
| `specs/005-web-control-panel/threat-model.md` | STRIDE-lite threat catalog (S-1, S-2, E-1, E-2 addressed above) |
| PR #124 / issue #117 | `requireAllowedUser` / `requireOwner` shape review (Kirk) — auth contract that this runbook's §6b verification steps are written against |
