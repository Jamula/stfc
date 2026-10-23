# SWA Setup — Operator Runbook

**For:** `cyrusjamula` (or any delegated operator)
**Tracking issue:** #115
**Deployment-auth blocker:** #127 (owner provisioning still required)
**Contract:** `specs/005-web-control-panel/deploy-contract.md`

---

## Overview

The STFC Control Panel is hosted as an **Azure Static Web App (SWA)** on the
Free tier. The GitHub Actions workflow (`.github/workflows/swa-deploy.yml`)
deploys it automatically on every push to `main` and creates preview
environments for pull requests.

This runbook covers the **one-time setup** steps that cannot be automated
by GitHub Actions — they require Azure portal access or an authenticated
`az` CLI session.

---

## 1. Prerequisites

| Tool | Version | Install link |
|------|---------|--------------|
| `az` CLI | ≥ 2.60 | https://docs.microsoft.com/cli/azure/install-azure-cli |
| Azure account | Free tier sufficient | https://azure.microsoft.com/free/ |
| `gh` CLI | ≥ 2.x | https://cli.github.com (for adding repo secrets) |

Verify:
```bash
az --version          # must be ≥ 2.60
az login              # opens browser for interactive login
az account show       # confirms you're in the right subscription
```

---

## 2. Create the Azure SWA resource

Run the idempotent bootstrap script from the repo root:

```bash
# Select the subscription that should contain the STFC Control Panel.
az account set --subscription "<SUBSCRIPTION_ID>"

# Optional: override defaults
export AZURE_RESOURCE_GROUP=stfc-control-panel-rg
export AZURE_LOCATION=eastus

./scripts/azure/create-swa.sh
```

The script:
- Creates the resource group if it doesn't exist
- Creates the SWA (`stfc-control-panel`) on the Free tier if it doesn't exist
- Applies the kill-switch app settings (`DISABLE_WRITES=1`, `DISABLE_CHAT=1`)
- Prints the deployment-token setup command

The script is **idempotent** — safe to run multiple times.

Before assigning permissions, confirm that `stfc-control-panel` is the intended
resource in the selected subscription. Do not reuse a Static Web App connected
to a different repository. In particular, **do not use `swa-jamula-web-prod`**:
its GitHub link belongs to another repository.

---

## 3. Configure the deployment token

The pinned official `Azure/static-web-apps-deploy` action requires
`azure_static_web_apps_api_token`. An Azure login using GitHub OIDC does not
replace this action input, so this repository uses the SWA deployment token.

For #127, first verify the existing target without retrieving credentials:

```bash
az account set --subscription "<SUBSCRIPTION_ID>"
az staticwebapp show \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --query '{name:name,resourceGroup:resourceGroup,repositoryUrl:repositoryUrl,defaultHostname:defaultHostname}' \
  -o json
```

Confirm the name and resource group match, and any repository link is
`https://github.com/Jamula/stfc`. If the resource is absent or linked elsewhere,
stop and ask the owner to provision or correct the intended resource; do not
substitute another SWA. The bootstrap in step 2 creates resources and changes
app settings; it is not a read-only verification command.

Pipe the token from Azure CLI directly to GitHub CLI so it is not printed or
passed as a command-line argument. Run this only from the owner's local Bash
terminal (Git Bash on Windows), with tracing/debug logging disabled:

```bash
set -o pipefail
az staticwebapp secrets list \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --query properties.apiKey -o tsv \
  | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo Jamula/stfc
```

The workflow needs only this **repository secret**:

| Secret name | Value |
|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token from the `stfc-control-panel` Static Web App |

Verify names only with `gh secret list --repo Jamula/stfc --json name`; never
print or share secret values. Azure app registrations, federated credentials,
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` are not needed
for this workflow.

**#127 remains blocked** until the owner provisions the intended SWA token and
the upload and preview-close jobs succeed. A skipped deployment is not proof
that provisioning is complete.

---

## 4. Invite the first operator (role assignment)

The SWA uses GitHub OAuth with a custom `stfc_operator` role.
Roles are assigned via invitation links (Azure Portal only — CLI support
is limited for the Free tier).

> ⚠️ Wave 4 issue #118 will detail the full operator management workflow.
> The steps below are for the initial bootstrap.

1. Azure Portal → Static Web Apps → `stfc-control-panel`
2. **Role Management** → **Invite**
3. Authentication provider: `GitHub`
4. GitHub login: `cyrusjamula`
5. Role: `stfc_operator`
6. Click **Generate** → copy the invitation URL
7. Open the invitation URL in a browser and sign in with GitHub

The invitation is single-use. The role persists until revoked.

**Invitation cap:** 25 users per app on Free tier (non-binding for this
use case).

---

## 5. Verify the deployment

After completing steps 1–4:

1. Push any commit to `main` (or open a draft PR):
   ```bash
   git commit --allow-empty -m "chore: trigger first SWA deploy"
   git push origin main
   ```
2. Watch the `Deploy SWA` workflow run in GitHub Actions.
3. When green, visit the SWA URL:
   ```bash
   az staticwebapp show \
     --name stfc-control-panel \
     --resource-group stfc-control-panel-rg \
     --query defaultHostname -o tsv
   ```
   → `https://stfc-control-panel.<random>.azurestaticapps.net`
4. The browser should redirect to GitHub OAuth login (the
   `staticwebapp.config.json` deny-by-default rule).
5. After signing in, you should see the placeholder landing page
   (real UI lands in Wave 3, issue #119).
6. Close the preview PR and confirm `teardown` succeeds. Fork PRs do not receive
   repository secrets, so deployment and teardown intentionally skip for them.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy job is skipped | `AZURE_STATIC_WEB_APPS_API_TOKEN` is missing | Set the deployment token using step 3 |
| Deploy action reports an invalid token | Token belongs to a different SWA or was rotated | Re-check the target SWA, then set its current token using step 3 |
| Login loop (redirect to GitHub, back to site) | Role not assigned | Re-do step 4 (invite) |
| `az staticwebapp appsettings set` 403 | Insufficient role on resource group | Ensure your az session has Contributor+ on the RG |

---

## Related files

- `specs/005-web-control-panel/deploy-contract.md` — deployment contract
- `.github/workflows/swa-deploy.yml` — deploy + preview workflow
- `staticwebapp.config.json` — route rules + security headers
- `scripts/azure/create-swa.sh` — idempotent resource creation script

---

## Authorization configuration

The control panel uses a **two-layer authorization model** (threat-model S-1, E-1):

1. **SWA route gate** — `staticwebapp.config.json` requires `allowedRoles: ["stfc_operator"]`.
   This is the outer gate; users without the role cannot reach any route.
2. **Function-side env-var allowlist** — every Azure Function handler calls
   `requireAllowedUser(req)` from `api/src/_lib/auth.ts` as its first statement.
   This re-validates the SWA-injected `X-MS-CLIENT-PRINCIPAL` header against an
   explicit username allowlist, providing defence-in-depth against forged principals.

### Required Function app settings

Set these in Azure Portal → Static Web Apps → `stfc-control-panel` → **Configuration**,
or via `az staticwebapp appsettings set`:

| Setting | Type | Description |
|---|---|---|
| `SQUAD_ALLOWED_USERS` | Comma-separated GitHub usernames | Users allowed to access the API (e.g. `cyrusjamula,teammate`). Must include every operator invited via SWA role management. |
| `SQUAD_OWNER` | Single GitHub username | The owner with elevated privileges (refresh-token, owner-only UI). Must be `cyrusjamula`. |

```bash
az staticwebapp appsettings set \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --setting-names \
    SQUAD_ALLOWED_USERS="cyrusjamula" \
    SQUAD_OWNER="cyrusjamula"
```

For local development, add these to `api/local.settings.json` (git-ignored):
```json
{
  "IsEncrypted": false,
  "Values": {
    "SQUAD_ALLOWED_USERS": "cyrusjamula",
    "SQUAD_OWNER": "cyrusjamula"
  }
}
```

### CI gate

`scripts/ci/check-api-auth.mjs` (wired into `npm test`) fails the build if any
Azure Functions HTTP handler file does not import and call `requireAllowedUser` or
`requireOwner`. This prevents accidentally shipping unauthenticated endpoints.

To opt a handler out (e.g. a public health-check endpoint), add:
```typescript
// @auth-anonymous-justification: <reason>
```

### Error mapping

Handlers catch auth errors using `errorResponse(err)` from `api/src/_lib/respond.ts`:

| Error | HTTP status |
|---|---|
| `UnauthorizedError` (missing/malformed principal) | 401 |
| `ForbiddenError` (not in allowlist / not owner) | 403 |
| Any other error | 500 (no details leaked) |
