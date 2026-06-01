# SWA Setup — Operator Runbook

**For:** `cyrusjamula` (or any delegated operator)
**Tracking issue:** #115
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
# Optional: override defaults
export AZURE_RESOURCE_GROUP=stfc-control-panel-rg
export AZURE_LOCATION=eastus

./scripts/azure/create-swa.sh
```

The script:
- Creates the resource group if it doesn't exist
- Creates the SWA (`stfc-control-panel`) on the Free tier if it doesn't exist
- Applies the kill-switch app settings (`DISABLE_WRITES=1`, `DISABLE_CHAT=1`)
- Prints the deployment token (for fallback mode)
- Prints the OIDC federation next-steps

The script is **idempotent** — safe to run multiple times.

---

## 3. Configure OIDC federated credentials (primary auth)

The deploy workflow uses OIDC federation instead of a long-lived deploy
token. This is a one-time manual step.

### 3a. Create a Service Principal

```bash
az ad sp create-for-rbac \
  --name stfc-control-panel-deploy \
  --skip-assignment \
  --output json
```

Note the output:
```json
{
  "appId":       "<CLIENT_ID>",
  "tenant":      "<TENANT_ID>",
  "displayName": "stfc-control-panel-deploy"
}
```

You also need the **object ID** of the application (different from appId):
```bash
az ad app show --id <CLIENT_ID> --query id -o tsv
# → <APP_OBJECT_ID>
```

### 3b. Assign Website Contributor role

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RESOURCE_GROUP=stfc-control-panel-rg

az role assignment create \
  --assignee <CLIENT_ID> \
  --role "Website Contributor" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/staticSites/stfc-control-panel"
```

### 3c. Add federated credentials

Two credentials are needed: one for `main` branch (prod deploys) and one
for pull requests (preview environments).

```bash
APP_OBJECT_ID=<APP_OBJECT_ID>

# Prod (push to main)
az ad app federated-credential create \
  --id "${APP_OBJECT_ID}" \
  --parameters '{
    "name": "stfc-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Jamula/stfc:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# PR previews
az ad app federated-credential create \
  --id "${APP_OBJECT_ID}" \
  --parameters '{
    "name": "stfc-pr",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Jamula/stfc:pull_request",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

---

## 4. Add repo secrets

In `github.com/Jamula/stfc → Settings → Secrets and variables → Actions`,
add three **repository secrets**:

| Secret name | Value |
|---|---|
| `AZURE_TENANT_ID` | `<tenant>` from step 3a |
| `AZURE_CLIENT_ID` | `<appId>` from step 3a |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |

Using `gh` CLI:
```bash
gh secret set AZURE_TENANT_ID     --body "<TENANT_ID>"
gh secret set AZURE_CLIENT_ID     --body "<CLIENT_ID>"
gh secret set AZURE_SUBSCRIPTION_ID --body "$(az account show --query id -o tsv)"
```

### Deployment-token fallback (optional)

If OIDC federation is blocked by an Azure AD Conditional Access policy,
fall back to deployment-token mode:

1. Get the token printed by `create-swa.sh` (or from Portal → SWA → Manage
   deployment token).
2. Add it as a repo secret: `gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN`
3. Update `.github/workflows/swa-deploy.yml`:
   - Remove the `Log in to Azure (OIDC)` steps
   - Set `azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}`
4. Document the downgrade in `.squad/decisions/inbox/`.

---

## 5. Invite the first operator (role assignment)

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

## 6. Verify the deployment

After completing steps 1–5:

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

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy workflow fails with `AADSTS700016` | Wrong `AZURE_CLIENT_ID` | Re-check secret matches appId |
| Deploy workflow fails with `AADSTS70021` | Federated credential subject mismatch | Re-check branch/PR subject in step 3c |
| Deploy workflow fails with `AuthorizationFailed` | RBAC not assigned | Re-run step 3b |
| Login loop (redirect to GitHub, back to site) | Role not assigned | Re-do step 5 (invite) |
| `az staticwebapp appsettings set` 403 | Insufficient role on resource group | Ensure your az session has Contributor+ on the RG |

---

## Related files

- `specs/005-web-control-panel/deploy-contract.md` — full OIDC contract
- `.github/workflows/swa-deploy.yml` — deploy + preview workflow
- `staticwebapp.config.json` — route rules + security headers
- `scripts/azure/create-swa.sh` — idempotent resource creation script
