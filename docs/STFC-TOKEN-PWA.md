# STFC token-update PWA

The control panel's **STFC token update** tab performs a real STFC email-code
login and updates the private account-token store. It is not the synthetic
prototype. It requires the separately hosted services and configuration below;
this repository change does not provision Azure resources, configure identity,
or deploy containers.

## Request and credential flow

1. The authenticated PWA calls the Static Web Apps Functions gateway. The
   gateway checks `requireOwner` before forwarding any request.
2. The token API Container App starts a login session in the browser-relay
   Container App. The relay launches a fresh, headless Chromium context at the
   fixed STFC store URL. The PWA displays only a live screenshot and accepts
   the one-time email code.
3. The relay returns the captured token only to the token API. The API checks
   its JWT shape and validates it against STFC's non-destructive
   `/offers/gifts?available=true` endpoint used by redemption.
4. The API replaces the named account in private Blob `accounts.json` using an
   ETag condition. A stale write returns a conflict instead of overwriting
   another update. The browser receives only an account name and update time.

The OTP is not persisted by the PWA or written to application logs. Tokens are
not returned to the PWA, cached by the service worker, or logged. The browser
relay has no Blob identity. Azure Blob encryption at rest is provided by
Azure Storage; access control and TLS are still required.

## Azure resources and identities

Provision these resources in an owner-controlled Azure subscription:

- The existing authenticated Static Web App and Functions API.
- A private Blob container holding `accounts.json`. Disable anonymous access.
- A token API Container App with a **system-assigned managed identity** and
  `Storage Blob Data Contributor` scoped to the token container.
- A browser-relay Container App using internal ingress only. It must not have a
  storage identity or public ingress.
- An HTTPS-reachable token API Container App. The SWA Function forwards to it
  only after owner authorization and authenticates with a randomly generated
  shared key.

The relay keeps its single login session in process memory. Configure its
maximum replica count as **1**; scaling to multiple instances would route the
start and verification requests to different in-memory session stores. A
restart cancels the active login, which the operator can safely restart.
Keeping a replica warm may incur charges. Container Apps, storage, and network
usage may have costs; no resources are created by this implementation.

Set these Container App settings as secrets (never as public app settings):

| Service | Setting | Purpose |
|---|---|---|
| Token API | `PWA_TOKEN_API_KEY` | At least 32 random characters; shared only with the SWA Function |
| Token API | `PWA_BROWSER_KEY` | At least 32 random characters; shared only with the relay |
| Token API | `PWA_BROWSER_URL` | HTTPS URL of the relay's internal ingress |
| Token API | `STFC_TOKEN_STORAGE_ACCOUNT` | Storage account name |
| Token API | `STFC_TOKEN_STORAGE_CONTAINER` | Private token container |
| Token API | `AZURE_TOKEN_BLOB` | Token Blob name; must match the GitHub Actions variable below |
| Browser relay | `PWA_BROWSER_KEY` | Same secret as the token API |

Set these Static Web App Function application settings:

| Setting | Purpose |
|---|---|
| `STFC_PWA_BACKEND_URL` | HTTPS token API ingress URL |
| `STFC_PWA_BACKEND_KEY` | Same secret as token API `PWA_TOKEN_API_KEY` |
| `STFC_OWNER` | Owner's GitHub username; must also be in `STFC_ALLOWED_USERS` |

The token API ingress must be reachable by the SWA Functions service, but its
key must never be sent to the browser. Restrict network access where the hosting
configuration permits, use HTTPS, and do not expose the browser relay.

## GitHub Actions OIDC for scheduled reads

`redeem.yml` and `discord-monitor.yml` obtain a Microsoft Entra token using the
pinned `azure/login` action and GitHub OIDC. Configure repository **Actions
variables** (not secrets) as follows:

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | Entra application/client ID with Blob read access |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription containing the storage account |
| `AZURE_TOKEN_STORAGE_ACCOUNT` | Storage account name |
| `AZURE_TOKEN_CONTAINER` | Private token container name |
| `AZURE_TOKEN_BLOB` | Blob name, normally `accounts.json` |

Create a federated credential for the read identity with audience
`api://AzureADTokenExchange` and subject
`repo:Jamula/stfc:ref:refs/heads/main`. Grant it `Storage Blob Data Reader`
scoped to the token container. The scheduled workflows download the Blob to a
runner temporary file, restrict its permissions, use `STFC_ACCOUNTS_FILE`, and
remove the file after the account list has been loaded.

For recovery, `redeem.yml` uses the existing `STFC_ACCOUNTS` GitHub secret
only when all six Azure variables are absent or empty. It validates the whole
account list and writes it to the same restricted temporary file, without
changing the secret or dropping accounts. Partial Azure configuration fails
explicitly; a configured Azure login or download failure never falls back.
`discord-monitor.yml` still requires Azure configuration.

This fallback does not refresh expired tokens. Without a current complete
account backup, do not replace `STFC_ACCOUNTS` with a single refreshed account.
The local capture helper requires that backup and independently verified
account identity; enter login credentials and OTP only in the official browser.

### Recovery without a complete account backup

The reviewed recovery workflow references a separate one-time secret named
`STFC_ACCOUNT_REFRESH_61690F065F04521CBA2CAE742A6BEC0DB2606A8E38A2FF74AEA5E1CB58D4E854`.
After independent review, integration, and explicit approval for that name,
`node scripts/refresh-account.mjs --publish` can create it from a private
interactive terminal. Enter credentials and the OTP only in the official browser.
The helper checks `/auth/me` and the non-redeeming gift list and pipes the token
to `gh secret set`; it does not read `.env`, print the token, or alter the
baseline or existing override. `--verify-only` checks a login without saving it.

The name was randomly generated with 256 bits of entropy; independent accidental
collisions are extremely unlikely, not impossible. GitHub does not provide
create-only or compare-and-swap secret updates. The helper checks the name before
and after login but cannot prevent another writer from creating or replacing it
between the final check and write. The name is visible in the repository. Use
this procedure only if the user approves the operational assumption that no other
writer will use this exact name; it is not protection against a malicious writer.
An isolated conditional-write credential store provides stronger protection; the
existing Azure token store must first be available and its use authorized.

Both legacy redemption and the manual **Check recovery authentication** workflow
verify the fresh token's live `/auth/me` account identity and require exactly one
matching `accountId` claim in the existing inventory. The manual check fails if
the required fresh override is missing or any override cannot be matched and
verified. Every override must also pass the exact gift-list endpoint's
authentication, HTTP status, content-type, JSON, and production schema checks.
Scheduled redemption applies each override only after these checks in the same
step that writes its temporary inventory. If a candidate fails, it reports a
warning and rejects that candidate while preserving prior verified overrides and
the baseline tokens for the remaining accounts. Existing JWT claims are used
only to match the trusted secret inventory, not as proof of live authentication.
Tokens whose claims use a different identity field are unsupported and must not
be guessed. All other accounts are preserved.

The merge exists only in the workflow's snapshot: the baseline secret is never
overwritten, so concurrent baseline updates are not lost. The shared workflow
lock serializes recovery checks and redemption, but does not lock secret writers.
Retain an existing override until that credential is
safely incorporated into the canonical store. Deleting it earlier reactivates
the baseline credential. Retain the new override by the same rule; future
refreshes need a newly reviewed name and must not overwrite it. These workflows must be integrated through the
authorized repository process before dispatch; running the auth check does not
authorize live redemption.

The one-time migration workflow uses a separate identity:

- Set `AZURE_MIGRATION_CLIENT_ID` to its client ID.
- Give it a federated credential with the same audience and `main` subject.
- Grant `Storage Blob Data Contributor` scoped to the token container.
- Run **Migrate token store** manually from `main`. It validates the legacy
  `STFC_ACCOUNTS` secret and refuses to overwrite an existing Blob.
- After successful migration and verification, delete the legacy GitHub secret.

Do not grant write access to the scheduled reader identity. The PWA's managed
identity is separate from both GitHub identities.

## Build and verification

From the repository root, build both images with Node version 24:

```bash
docker build --build-arg NODE_VERSION=24 -f pwa-token-api/Dockerfile -t stfc-token-api .
docker build --build-arg NODE_VERSION=24 -f pwa-browser/Dockerfile -t stfc-browser-relay .
```

Deploy these images only through the owner's approved Azure process, then
configure the settings above. Do not test with a real STFC login until the
owner has reviewed the target resources, identity scopes, ingress and cost.
Provider compatibility is not verified by automated tests; successful token
capture and endpoint acceptance can only be confirmed during an explicitly
authorized real login.

For local CLI token capture, continue to use `npm run capture-token`; it writes
to local `.env` and does not update the hosted Blob.
