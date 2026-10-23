# Research: 005-web-control-panel

## Phase 0 Platform Spike

**Owner:** O'Brien
**Tracking issue:** #109
**Status:** COMPLETED — 2026-05-31
**Spike date:** 2026-05-31T22:40:48+00:00

---

### Q1: Azure SWA custom-role mechanism

**Answer:** The `allowedRoles` + invitation model works as v3 assumes.
RD P0.1's finding is confirmed: `staticwebapp.config.json` has NO
per-username allowlist in config — roles are the only mechanism. The
built-in managed GitHub OAuth provider on the **Free plan** supports
custom roles assigned via invitation. The invitation cap is **25 users
per app** (identical on Free and Standard plans). Custom role
`stfc_operator` gating routes via `allowedRoles: ["stfc_operator"]`
is the correct and fully documented pattern.

**Invitation UX from the invited user's side:** The operator generates
an invitation link in the Azure Portal (or via Azure CLI) with the
desired role embedded as a signed token. The invited user opens the
link in a browser, signs in with GitHub OAuth (or another configured
provider), and the SWA runtime grants the custom role automatically —
no operator interaction required at click time. The token is
single-use; role persists until the operator revokes it.

**`X-MS-CLIENT-PRINCIPAL` injection:** SWA injects this header on
every request forwarded to a linked Azure Function. The value is a
Base64-encoded JSON object:

```json
{
  "identityProvider": "github",
  "userId": "abcd12345abcd012345abcdef0123450",
  "userDetails": "cyrusjamula",
  "userRoles": ["anonymous", "authenticated", "stfc_operator"],
  "claims": []
}
```

The `userRoles` array contains ALL roles assigned to the user
(including the built-in `anonymous` and `authenticated`). The Function
`requireAllowedUser` check must decode this header and assert
`userRoles.includes("stfc_operator")` as the primary gate (the SWA
route rule is defence-in-depth, not the primary gate — consistent with
v3 plan).

**Note on custom identity providers:** The docs note that "custom
authentication is only available in the Standard plan." However, the
v3 plan uses the **pre-configured GitHub OAuth provider** (not a
custom OIDC registration). Pre-configured providers + custom roles via
invitation work on **Free tier** — no Standard plan required.

**Citation:**
- Quotas: https://learn.microsoft.com/en-us/azure/static-web-apps/quotas
  (table row: "Authorization (custom roles) → via invitations: 25")
- User info / header: https://learn.microsoft.com/en-us/azure/static-web-apps/user-information
- Auth/authz overview: https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization
- Custom roles: https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-custom#manage-roles

**Recommendation:** Proceed as v3 plans. Use pre-configured GitHub
OAuth (not custom OIDC) — stays on Free tier. Gate routes with
`allowedRoles: ["stfc_operator"]`. Function `requireAllowedUser` is
the primary allowlist guard (checking `x-ms-client-principal`
`userRoles`). Invitation cap of 25 is non-binding for the intended
audience ("cyrusjamula + a few trusted users").

**Blockers:** None.

---

### Q2: GitHub App installability

**Answer:** `cyrusjamula` is a **personal account** (type: `User`).
No org-policy restrictions apply. Personal accounts can register up to
100 GitHub Apps and install them on any repo they own with no
additional approvals. The `Jamula/stfc` repo is owner-controlled —
App installation requires only the repo owner's GitHub session.

**Account verification:**

```
$ gh api user --jq '.login,.type'
cyrusjamula
User
```

**Requested permissions for Phase 1:**

- `actions: write` — trigger workflow dispatches, list runs, read run
  results
- `contents: read` — read committed artifacts (`data/runs/*.json`,
  `data/digests/`)

**Org-policy blocks:** N/A — personal account. No org-level GitHub App
policy exists for individual user repos.

**Installation token TTL and rotation pattern:** Installation access
tokens expire after **1 hour** (documented, confirmed). The standard
rotation pattern for a SWA Azure Function:

1. At Function cold start or when the cached token is within 10 minutes
   of expiry: POST to
   `/app/installations/{installation_id}/access_tokens` using a fresh
   JWT signed with the App's private key.
2. Cache the new token in an Azure Function app-setting-backed in-memory
   cache (or Azure Table Storage) with the expiry timestamp.
3. Refresh proactively at ~50 min (10 min buffer before the 60 min TTL).
4. The private key is stored as a SWA Function app setting
   (`GITHUB_APP_PRIVATE_KEY`) — never in source control.

**Note (2026-05-27):** GitHub began a staged rollout of a new stateless
token format (`ghs_APPID_JWT`) for App installation tokens. If any
code asserts `token.length === 40`, update it — new tokens are longer.
See https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header

**Citation:**
- GitHub App registration: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- Installation access tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- `gh api user` — verified live: `cyrusjamula / User`

**Recommendation:** Register the GitHub App under `cyrusjamula`'s
personal account. Store the private key as a SWA Function app setting.
Implement a proactive refresh at 50-min intervals. No org-policy
consideration required now; if `Jamula/stfc` ever moves to an org,
re-evaluate.

**Blockers:** None.

---

### Q3: GitHub Models availability

**Answer:** GitHub Models API is **available and working** on
`cyrusjamula`'s account. Live test passed with the Codespaces-injected
`GITHUB_TOKEN` (no explicit `models:read` scope declaration required in
Codespaces). For a PAT used outside Codespaces, the required permission
is `models:read`.

**Live test (verified 2026-05-31T22:49Z):**

```bash
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Content-Type: application/json" \
     https://models.inference.ai.azure.com/chat/completions \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"reply with the single word ok"}]}'
```

Response: HTTP 200, `"content":"Ok."`, model `gpt-4o-mini-2024-07-18`,
`service_tier: "default"`, TTFT ~983 ms. No 401/403.

**Free-tier rate limits by model family (Copilot Free / Pro):**

| Tier | Models | Req/min | Req/day | Tokens/request |
|---|---|---|---|---|
| Low | gpt-4o-mini, Phi-3.5, etc. | 15 | 150 | 8000 in / 4000 out |
| High | gpt-4o, etc. | 10 | 50 | 8000 in / 4000 out |
| Embedding | text-embedding-* | 15 | 150 | 64000 |
| o1-mini / o3-mini | reasoning small | 2/min | 12/day | 4000 in/out |

gpt-4o-mini is **Low tier** (150 req/day). For an internal ops panel
with <10 daily active users, this is sufficient for Phase 6. The plan's
Gemini Flash fallback on 429 is prudent given the modest daily cap.

**Citation:**
- Rate limits table: https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models#rate-limits
- About GitHub Models: https://docs.github.com/en/github-models/about-github-models
- Live test: verified above, exit code 0, full JSON response received

**Recommendation:** Use GitHub Models (`gpt-4o-mini` as primary, Low
tier, 150 req/day). Implement 429 → Gemini Flash fallback as v3
specifies. Store `MODELS_API_TOKEN` (PAT with `models:read`) as a
SWA Function app setting — separate from `GITHUB_APP_PRIVATE_KEY` to
keep blast radii distinct. For production scale, opt into paid usage
via GitHub Models billing.

**Blockers:** None.

---

### Q4: Azure Table Storage free tier

**Answer:** Azure Table Storage has **no dedicated always-free tier**
in the traditional sense. It is pay-as-you-go. However:

- An Azure **free account** (first 30 days) includes $200 credit and
  some always-free services — Table Storage is **not** in the
  always-free list.
- For the v3 use case (a durable cache storing one row per
  `refresh-token` cooldown event — single-digit writes/month), the
  monthly cost is **effectively $0**: Azure Table Storage charges
  ~$0.00036/10,000 write transactions and $0.00010/10,000 reads. At
  <100 transactions/month, the bill rounds to $0.00 (below the minimum
  billing threshold).
- The plan's claim "Azure Table Storage free tier — still $0" is
  operationally correct at this scale, though technically there is no
  formal "free tier" label — it is sub-threshold pay-as-you-go.

**Transaction limit:** No enforced monthly transaction cap on Table
Storage accounts — capacity scales to the storage account limit
(500 TB). The only practical limit is budget.

**Storage Account co-location:** Table Storage requires an Azure
Storage Account (General Purpose v2 or legacy Table Storage account).
It does **not** need to be in the same resource group as the SWA.
SWA automatically creates a linked Storage Account for its Functions
runtime — however, Microsoft advises against storing application data
in the SWA-managed Storage Account (it's an internal runtime
dependency; manual interference can break deployments).

**Citation:**
- Azure Table Storage overview: https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-overview
- Azure Storage introduction: https://learn.microsoft.com/en-us/azure/storage/common/storage-introduction
- Pricing: https://azure.microsoft.com/en-us/pricing/details/storage/tables/ (pay-as-you-go, ~$0 at sub-threshold volume)

**Recommendation:** Provision a **separate, dedicated Storage Account**
(`stfccontrolpanel` or similar) in the same region as the SWA. Do NOT
use the SWA-managed Storage Account for application data. At the
expected transaction volume, monthly cost is $0.00 (sub-billing-threshold).
One Storage Account can hold both Table Storage (cooldown cache) and
any future Blob Storage needs (e.g., RAG index interim builds).

**Blockers:** None. Clarify with Cyrus which Azure subscription/region
to use before provisioning — no blocker on Phase 1 planning, but needed
before Phase 1 infra provisioning.

---

### Q5: SWA deployment — OIDC federation vs deployment token

**Answer:** For Phase 1's deploy-contract, use the **deployment token**
approach.

**Comparison:**

| Factor | Deployment Token | OIDC Federation |
|---|---|---|
| Setup complexity | Low — one secret in repo | High — Service Principal, federated credential, RBAC role on SWA resource |
| Workflow permissions needed | `contents: read` + `pull-requests: write` for preview comments | `id-token: write` + `contents: read`, but not a substitute for the pinned action's token |
| Long-lived secret? | Yes — stored as repo secret; rotatable in portal | No — ephemeral JWT; no stored secret |
| Branch protection / cron churn compat. | ✅ No conflicts | ✅ No conflicts |
| SHA-pinned action support | ✅ `Azure/static-web-apps-deploy@<sha>` works | ❌ Requires a different deployment mechanism that explicitly supports Azure credentials |
| Single-maintainer operational burden | Low — reset via portal if compromised; otherwise never touch it | Medium — Azure RBAC setup; identity federation config; more failure surfaces |
| Pinned official action support | ✅ First-class required input | ❌ `azure_static_web_apps_api_token` remains required; `azure/login` does not replace it |

**Branch protection / Rule 4 compatibility:** The deployment token is
stored as a repo secret (`AZURE_STATIC_WEB_APPS_API_TOKEN`). Cron
commits (Rule 4 — the 15-min `redeem.yml` churn on `docs/redeem-history.md`)
do not interact with this secret. No rebase conflicts introduced by either
approach.

**SHA-pinning:** The workflow pins `Azure/static-web-apps-deploy` by commit
SHA for supply-chain hygiene. The pinned action's `action.yml` requires
`azure_static_web_apps_api_token`; Azure OIDC login alone cannot deploy through
this action.

**Rotation pain for deployment token:** Rotation is manual (Azure Portal
→ Manage deployment token → Reset). Only needed if compromised. For a
single-maintainer personal project with no shared runners, this is
negligible.

**Citation:**
- Deployment token management: https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management
- Build configuration (security section): https://learn.microsoft.com/en-us/azure/static-web-apps/github-actions-workflow
- GitHub OIDC with Azure: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-azure

**Recommendation:** **Use deployment token for Phase 1.** Simpler,
first-class SWA support, zero Azure RBAC/identity-federation overhead.
Pin `Azure/static-web-apps-deploy` by SHA. Store the token as
`AZURE_STATIC_WEB_APPS_API_TOKEN` in repo secrets. Revisit OIDC only with a
deployment mechanism verified to accept Azure credentials; additional
maintainers alone do not change the pinned action's required input.

**Blockers:** None.

---

## ✅ No blockers — Phase 1 cleared

All five platform questions resolved with GO status. Summary:

| Question | Finding | GO/NO-GO |
|---|---|---|
| Q1 — SWA custom roles | Invitation model works on Free tier; 25-user cap; header confirmed | ✅ GO |
| Q2 — GitHub App installability | Personal account, no org policy; 1h token TTL confirmed | ✅ GO |
| Q3 — GitHub Models availability | Live test 200 OK; gpt-4o-mini Low tier 150 req/day | ✅ GO |
| Q4 — Azure Table Storage | No formal free tier; sub-threshold = $0; use separate account | ✅ GO |
| Q5 — SWA deploy method | Deployment token preferred; simpler for single maintainer | ✅ GO |

Phase 1 infra provisioning prerequisite: confirm Azure subscription/region
with Cyrus before provisioning the Storage Account (not a blocker on
contract or code work).

---

### Original questions (preserved for reference)

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
