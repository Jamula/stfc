# SWA Setup — Operator Runbook

**For:** Repository maintainers and delegated operators
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

First verify the intended target without retrieving credentials:

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

The deployment workflow skips deployment and preview teardown when the
repository secret is unavailable. Check the latest workflow summary before
assuming that a deployment or teardown completed.

---

## 4. Invite the first operator (role assignment)

The SWA uses GitHub OAuth with a custom `stfc_operator` role.
Roles are assigned via invitation links (Azure Portal only — CLI support
is limited for the Free tier).

The steps below invite an initial operator. Manage later role changes from
the app's **Role Management** page in Azure Portal.

1. Azure Portal → Static Web Apps → `stfc-control-panel`
2. **Role Management** → **Invite**
3. Authentication provider: `GitHub`
4. GitHub login: the operator's GitHub username
5. Role: `stfc_operator`
6. Click **Generate** → copy the invitation URL
7. Open the invitation URL in a browser and sign in with GitHub

The invitation is single-use. The role persists until revoked.

**Invitation cap:** 25 users per app on Free tier (non-binding for this
use case).

---

## 5. Verify the deployment

After completing steps 1–4:

1. After an approved change reaches `main`, watch the `Deploy SWA` workflow
   run in GitHub Actions. A pull request targeting `main` also creates a
   preview deployment when the required secret is available.
2. When deployment succeeds, visit the SWA URL:
   ```bash
   az staticwebapp show \
     --name stfc-control-panel \
     --resource-group stfc-control-panel-rg \
     --query defaultHostname -o tsv
   ```
   → `https://stfc-control-panel.<random>.azurestaticapps.net`
3. The browser should redirect to GitHub OAuth login (the
   `staticwebapp.config.json` deny-by-default rule).
4. After signing in, verify the control panel loads and its expected routes
   behave correctly.
5. Close a preview PR and confirm `teardown` succeeds. Fork PRs do not receive
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

Configure both settings before enabling API access. The handlers read these
names and fail closed when values are missing.

| Setting | Type | Description |
|---|---|---|
| `STFC_ALLOWED_USERS` | Comma-separated GitHub usernames | Users allowed to access the API (e.g. `cyrusjamula,teammate`). Must include every operator invited via SWA role management. |
| `STFC_OWNER` | Single GitHub username | The owner allowed to use the token-update PWA and other owner-only UI. Set this to the authorized repository owner; for `Jamula/stfc`, that is `cyrusjamula`. |

### GitHub OAuth provider settings

The GitHub identity provider in `staticwebapp.config.json` also requires the
`GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` settings. Register or
select the GitHub OAuth application for this SWA and configure its credentials
in the Static Web App before expecting sign-in to work. Keep the client secret
in the Azure configuration UI; never put it in repository files or logs.

```bash
az staticwebapp appsettings set \
  --name stfc-control-panel \
  --resource-group stfc-control-panel-rg \
  --setting-names \
    STFC_ALLOWED_USERS="cyrusjamula" \
    STFC_OWNER="cyrusjamula"
```

For local development, add these to `api/local.settings.json` (git-ignored):
```json
{
  "IsEncrypted": false,
  "Values": {
    "STFC_ALLOWED_USERS": "cyrusjamula",
    "STFC_OWNER": "cyrusjamula"
  }
}
```

### Read-only dashboard sources

The dashboard tabs call GET `/api/data/{redeems,digests,telemetry,crew,runs}`.
The Function rechecks both the allowlist and `stfc_operator` role before reading
GitHub. Configure a read-only `GITHUB_TOKEN` Function app setting with access to
repository contents and Actions when authenticated API access is required.
It is a server-side setting, never a browser credential or URL parameter.
Provision credentials only through the owner's approved local/portal process;
do not paste values into chat.

Redeem history and digests come from `automation-state`, not frozen `main`
seeds. Crew reads the committed officer reference, not private account game
state. Telemetry reports unavailable until an approved producer is defined.
Runs show up to the requested limit, merging the latest 20 Actions executions
per workflow with any valid committed run-result artifacts. Existing unmarked
Actions runs remain uncorrelated and are never joined by run ID, event type,
or timestamp. An artifact is merged only when its correlation ID explicitly
matches the ID carried by an Actions run name.
The **Discord** tab displays committed monitoring digests and recent
`discord-monitor` workflow results. Its **Run redemption now** action requires
the owner-only Function endpoint and a fresh browser confirmation before it
dispatches `redeem.yml` on `main`. Configure a dedicated server-side
`PWA_GITHUB_DISPATCH_TOKEN` with the minimum repository-scoped Actions write
permission needed for `workflow_dispatch`; do not reuse the read-only dashboard
token or expose this credential to the browser. The endpoint rejects requests
without the PWA's same-origin custom action header (cross-origin browser
requests cannot set it without a successful CORS preflight, and the API does
not enable CORS). It does not invoke Discord's
slash-command API. `/game-state` uploads remain available only through Discord.

The local Vite server and preview server proxy `/api/*` to Azure Functions at
`http://127.0.0.1:7071`. Start the API with `func start` from `api/` and run the
frontend with `npm run dev --prefix web` (or `npm run build --prefix web` and
`npm run preview --prefix web`). The local proxy does not emulate SWA sign-in;
owner-only token updates and redemption dispatch must be tested in the
authenticated SWA deployment. When the Functions API is absent, API requests
now fail as unavailable instead of receiving Vite's HTML fallback as JSON.

### STFC token-update PWA

The **STFC token update** tab uses the owner-only `/api/token-session/{action}`
Functions gateway to call the token API Container App. Configure
`STFC_PWA_BACKEND_URL` and `STFC_PWA_BACKEND_KEY` as Static Web App Function
settings only after following the separate
[STFC token PWA runbook](STFC-TOKEN-PWA.md). The API key must never be exposed
to the browser. The browser relay must remain on internal Container Apps
ingress and must not receive a Blob identity.

### Discord and live redemption

The PWA's Discord status and digest view uses the existing authenticated
dashboard API. To enable the redemption button, set
`PWA_GITHUB_DISPATCH_TOKEN` as a secret in the Static Web App Function
configuration. Restrict its GitHub token permissions to the `Jamula/stfc`
repository and the Actions write permission required to dispatch the `redeem`
workflow. Do not copy the token into `api/local.settings.json`, a browser
setting, or a Vite environment variable. The owner must confirm each run in
the browser; opening the Discord tab never starts redemption.

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
