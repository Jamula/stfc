# SWA Deploy Contract — 005-web-control-panel

**Tracking issue:** #113
**Status:** FINAL — Phase 1 Wave 1
**Date:** 2026-05-31
**Auth correction:** #127 — deployment token required; owner provisioning pending.

---

## 1. Deployment method decision

### Chosen: Static Web Apps deployment token

The Phase 0 platform spike (Q5, `research.md`) recommended the **deployment
token** approach, which is also the supported authentication mechanism for
the pinned `Azure/static-web-apps-deploy` action. Its `action.yml` declares
`azure_static_web_apps_api_token` as a required input; Azure login via OIDC
does not satisfy that input.

| Factor | Deployment token (chosen) | OIDC federation |
|---|---|---|
| Long-lived secret in repo? | Yes — `AZURE_STATIC_WEB_APPS_API_TOKEN` stored as a repository secret | No, but the pinned deploy action still requires its deployment-token input |
| Rotation burden | Reset in Azure and update the repository secret if compromised | Not applicable to the pinned action |
| Permissions needed | `contents: read` + `pull-requests: write` for preview comments | `id-token: write` plus an action that can consume Azure credentials |
| Azure setup | Retrieve the SWA token | Service Principal + federated credential + RBAC, but this does not replace the required action input |
| Pinned official action support | Required input | Not supported as a replacement for the token |

The deployment token is stored only as a GitHub repository secret and is
passed directly to the action. The operator runbook pipes it from Azure CLI
to `gh secret set` so it is not printed or passed as a command-line argument.
Rotate it if compromised.

### Managed API runtime

`staticwebapp.config.json` selects `node:22` for the SWA-managed Functions API,
and `api/package.json` requires Node.js 22 or newer. As of 2026-11-07, the
[SWA managed API runtime matrix](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes)
also lists .NET 10 isolated (`dotnet-isolated:10.0`), but not Node.js 24.
Azure Functions lists Node.js 22 support through April 30, 2027 and .NET 10
support through November 14, 2028 in its
[runtime support table](https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages).

The root CLI uses Node 24 via `.nvmrc`. In `.github/workflows/swa-deploy.yml`,
the API validation job uses Node 22 via `api/.nvmrc`, while
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` selects Node 24 for JavaScript actions.
These tool and action runtimes are separate from the managed API runtime
selected above. Moving this API to .NET 10 isolated is technically possible
on the managed SWA API runtime, but requires a separately approved port of the
API and its contracts and tests; do not infer a migration from runtime
availability alone. Reassess the API runtime before the current Node 22
support window ends.

---

## 2. SHA-pinned action

```
Azure/static-web-apps-deploy@1a947af9992250f3bc2e68ad0754c0b0c11566c9  # v1
```

- **Tag:** `v1`
- **Commit SHA:** `1a947af9992250f3bc2e68ad0754c0b0c11566c9`
- **Verified:** `curl https://api.github.com/repos/Azure/static-web-apps-deploy/tags`
  → confirmed 2026-05-31T23:xx UTC
- Pin rationale: supply-chain hygiene per project convention (all `uses:` lines
  must be SHA-pinned; see `discordMonitor.test.ts` / `swaDeploy.test.ts`
  pinning assertions).

To update the pin in future: run
```bash
curl -sS https://api.github.com/repos/Azure/static-web-apps-deploy/tags \
  | jq -r '.[0] | "\(.name) \(.commit.sha)"'
```
and update both this contract and the workflow in the same commit (Rule 3).

---

## 3. Required secrets / repo settings

### Deployment-token mode (primary)

| Name | Scope | Purpose |
|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Repository secret | Deployment token from the `stfc-control-panel` Static Web App; required by the pinned official deploy action |

### Application env vars (SWA app settings — NOT workflow secrets)

| Name | Value at launch | Changed when |
|---|---|---|
| `DISABLE_WRITES` | `"1"` | Phase 3 acceptance passes and write capability ships |
| `DISABLE_CHAT` | `"1"` | Phase 6 acceptance passes and chat ships |

---

## 4. Preview environment policy

- **Every PR** targeting `main` triggers a preview deployment.
- Upload and close jobs skip when the repository deployment token is absent,
  including fork PRs that cannot access repository secrets. Skipped jobs do not
  prove deployment readiness.
- The SWA action creates an isolated preview URL per PR automatically.
- The workflow posts the preview URL as a PR comment (via `pull-requests: write`
  permission + the action's built-in comment step).
- Preview environments are destroyed automatically when the PR is closed/merged
  (handled by the `closed` PR trigger in the workflow).

---

## 5. Production promotion policy

- **Only pushes to `main`** trigger a production deployment.
- No branch other than `main` produces a production-slot deployment.
- The `concurrency` group (`swa-deploy-prod`) ensures parallel push events
  do not race on the production slot.

---

## 6. Writes-default-disabled policy

Until Phase 3 ships and passes acceptance:

- `DISABLE_WRITES=1` is set in the SWA Function app settings (Azure Portal).
- The workflow also injects `DISABLE_WRITES: "1"` in the `env:` block as a
  belt-and-suspenders belt (env var visible to the build step too).
- **No code path in Phase 1 issues a write against GitHub Actions or the STFC
  API.** Phase 1 is read-only dashboard.
- Removing `DISABLE_WRITES` requires a deliberate SWA app-setting change
  (operator action), NOT a code push.

---

## 7. Workflow file location

```
.github/workflows/swa-deploy.yml
```

---

## 8. Rollback runbook (Phase 1 — brief; Phase 8 expands)

**Deploy went bad; traffic is live:**

1. Open Azure Portal → Static Web Apps → `stfc-control-panel`.
2. Go to **Environments** → **Production** → **Swap / Redeploy prior version**.
   SWA retains the last N deployment zips; select the previous one and
   click **Deploy**.
3. If portal is unavailable: re-run the last known-good workflow run
   (`gh run rerun <run-id>`) to re-push the prior artifact.

**Preview environment stuck:**
- Close and reopen the PR, or manually delete the preview slot in the portal
  (Environment → Delete).

**Full teardown:**
- `az staticwebapp delete --name stfc-control-panel --resource-group stfc-control-panel-rg`
- Recreate with `scripts/azure/create-swa.sh`, then provision its new deployment
  token before the next workflow upload. The workflow does not create resources.

---

## 9. Open prerequisites (must complete before first prod deploy)

- [ ] Provision SWA resource in Azure (Cyrus, any Azure subscription — confirm region).
- [ ] Set `AZURE_STATIC_WEB_APPS_API_TOKEN` as a repository secret.
- [ ] Confirm the token belongs to `stfc-control-panel` in `stfc-control-panel-rg`,
      not `swa-jamula-web-prod` (linked to another repository).
- [ ] Set `DISABLE_WRITES=1` in SWA app settings (Azure Portal).
- [ ] Verify production/preview upload and preview close succeed after provisioning.

These are infrastructure prerequisites; the workflow YAML and this contract are
complete and can be merged before provisioning.
Issue #127 retains `status:blocked` until owner provisioning and deployment
verification are complete.
