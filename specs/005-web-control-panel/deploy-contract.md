# SWA Deploy Contract — 005-web-control-panel

**Owner:** O'Brien (DevOps / Platform Engineer)
**Tracking issue:** #113
**Status:** FINAL — Phase 1 Wave 1
**Date:** 2026-05-31

---

## 1. Deployment method decision

### Chosen: OIDC federation (no long-lived secret in repo)

The Phase 0 platform spike (Q5, `research.md`) recommended the **deployment
token** approach on grounds of lower setup complexity for a single-maintainer
project.  After Phase 1 formalization, **OIDC federation is the adopted
approach** for the following reasons:

| Factor | Deployment token | OIDC federation (chosen) |
|---|---|---|
| Long-lived secret in repo? | Yes — `AZURE_STATIC_WEB_APPS_API_TOKEN` stored indefinitely | **No** — ephemeral JWT issued per workflow run; no stored secret |
| Rotation burden | Manual reset in Azure Portal if compromised | N/A — credential is short-lived by design |
| Supply-chain blast radius | Token compromise = silent deploy access | OIDC compromise bounded to the federated identity's RBAC scope |
| Permissions needed | `contents: read` only | `id-token: write` + `contents: read` + `pull-requests: write` |
| Azure setup | One portal copy-paste | Service Principal + federated credential + `Website Contributor` RBAC |
| SWA native support | First-class (auto-generated at site creation) | Supported; requires extra ARM config but well-documented |
| Recommended by | Phase 0 spike (simplicity argument) | **Phase 1 contract (security argument — no secrets stored)** |

**Rationale for overriding the spike recommendation:** The spike ranked
simplicity highest because at spike time the Azure tenant/subscription were
not yet provisioned.  Now that Phase 1 requires actual provisioning, the
incremental cost of OIDC setup is paid once.  The long-term benefit — no
long-lived deployment secret to rotate or leak — outweighs the one-time
setup overhead.  A single-maintainer project is not lower-risk than a
team project when it comes to secret exposure; it is arguably higher-risk
because there is no second reviewer on PR secret changes.

**Fallback:** If the Azure tenant blocks federated credentials (e.g.
Conditional Access policy prohibits workload-identity federation), fall back
to deployment-token mode: swap the OIDC `az login` steps for
`azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}`
in the action call.  Document the downgrade in `.squad/decisions/inbox/`.

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

The workflow also uses the following SHA-pinned action for OIDC authentication:

```
azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906  # v3.1.0
```

- **Tag:** `v3.1.0`
- **Commit SHA:** `a641126d1b8aa4d1fa005f4f92df94a3a4c4c906`
- **Verified:** the `v3.1.0` tag resolves to this commit.
- Update this contract, the workflow, and `tests/skills/swaDeploy.test.ts`
  together whenever this pin changes.

To update the pin in future: run
```bash
curl -sS https://api.github.com/repos/Azure/static-web-apps-deploy/tags \
  | jq -r '.[0] | "\(.name) \(.commit.sha)"'
```
and update both this contract and the workflow in the same commit (Rule 3).

---

## 3. Required secrets / repo settings

### OIDC mode (primary)

| Name | Scope | Purpose |
|---|---|---|
| `AZURE_TENANT_ID` | Repository secret | Azure AD tenant that hosts the SWA Service Principal |
| `AZURE_CLIENT_ID` | Repository secret | Client ID of the SWA Service Principal (federated credential registered for this repo + ref) |
| `AZURE_SUBSCRIPTION_ID` | Repository secret | Subscription containing the SWA resource |

**Service Principal configuration (one-time, done in Azure Portal or CLI):**
1. Create a Service Principal: `az ad sp create-for-rbac --name stfc-control-panel-deploy --skip-assignment`
2. Assign `Website Contributor` role on the SWA resource.
3. Add a federated credential (subject: `repo:Jamula/stfc:ref:refs/heads/main` for prod,
   `repo:Jamula/stfc:pull_request` for previews).
4. Store `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID` as repo secrets.

### Deployment-token fallback

| Name | Scope | Purpose |
|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Repository secret | Deployment token from Azure Portal → Static Web App → Manage deployment token |

### Application env vars (SWA app settings — NOT workflow secrets)

| Name | Value at launch | Changed when |
|---|---|---|
| `DISABLE_WRITES` | `"1"` | Phase 3 acceptance passes and write capability ships |
| `DISABLE_CHAT` | `"1"` | Phase 6 acceptance passes and chat ships |

---

## 4. Preview environment policy

- **Every PR** targeting `main` triggers a preview deployment.
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
- `az staticwebapp delete --name stfc-control-panel --resource-group stfc-rg`
- Recreate from the workflow on next merge to `main`.

---

## 9. Open prerequisites (must complete before first prod deploy)

- [ ] Provision SWA resource in Azure (Cyrus, any Azure subscription — confirm region).
- [ ] Create Service Principal + federated credentials (O'Brien, post-provisioning).
- [ ] Add `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID` as repo secrets.
- [ ] Confirm SWA app name for the `app_name` workflow input.
- [ ] Set `DISABLE_WRITES=1` in SWA app settings (Azure Portal).

These are infrastructure prerequisites; the workflow YAML and this contract are
complete and can be merged before provisioning.
