#!/usr/bin/env bash
# scripts/azure/create-swa.sh
#
# Idempotent bootstrap for the stfc-control-panel Azure Static Web App.
#
# Usage:
#   AZURE_RESOURCE_GROUP=my-rg AZURE_LOCATION=eastus ./scripts/azure/create-swa.sh
#
# Reads env vars (or prompts for missing ones):
#   AZURE_RESOURCE_GROUP  — resource group to create/use (default: stfc-control-panel-rg)
#   AZURE_LOCATION        — Azure region              (default: eastus)
#
# Prerequisites: az CLI installed and logged in (az login).
# See docs/SWA-SETUP.md for the full operator runbook.
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
SWA_NAME="stfc-control-panel"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-stfc-control-panel-rg}"
LOCATION="${AZURE_LOCATION:-eastus}"
SKU="Free"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo "  ✔  $*"; }
warn()  { echo "  ⚠  $*"; }
abort() { echo "  ✘  $*" >&2; exit 1; }
step()  { echo; echo "── $*"; }

# ── 1. Prereqs ────────────────────────────────────────────────────────────────
step "Checking prerequisites"

if ! command -v az &>/dev/null; then
  abort "az CLI not found. Install from https://docs.microsoft.com/cli/azure/install-azure-cli then run 'az login'."
fi
info "az CLI found: $(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo 'version unavailable')"

step "Checking Azure login"
if ! az account show &>/dev/null; then
  abort "Not logged in to Azure. Run 'az login' first."
fi
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
info "Subscription: ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

# ── 2. Resource group (idempotent) ────────────────────────────────────────────
step "Ensuring resource group '${RESOURCE_GROUP}' in '${LOCATION}'"
if az group show --name "${RESOURCE_GROUP}" &>/dev/null; then
  info "Resource group '${RESOURCE_GROUP}' already exists — skipping creation"
else
  az group create --name "${RESOURCE_GROUP}" --location "${LOCATION}" --output none
  info "Resource group '${RESOURCE_GROUP}' created"
fi

# ── 3. Static Web App (idempotent) ────────────────────────────────────────────
step "Checking for existing SWA '${SWA_NAME}'"
if az staticwebapp show --name "${SWA_NAME}" --resource-group "${RESOURCE_GROUP}" &>/dev/null; then
  info "SWA '${SWA_NAME}' already exists — skipping creation (idempotent)"
else
  warn "SWA '${SWA_NAME}' not found — creating (${SKU} tier)"
  az staticwebapp create \
    --name "${SWA_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --sku "${SKU}" \
    --output none
  info "SWA '${SWA_NAME}' created"
fi

# ── 4. App settings (kill switches) ──────────────────────────────────────────
step "Configuring app settings (DISABLE_WRITES=1, DISABLE_CHAT=1)"
az staticwebapp appsettings set \
  --name "${SWA_NAME}" \
  --resource-group "${RESOURCE_GROUP}" \
  --setting-names "DISABLE_WRITES=1" "DISABLE_CHAT=1" \
  --output none
info "App settings applied"

# ── 5. Deployment-token next steps ────────────────────────────────────────────
step "Next steps for the SWA deployment token"
cat <<EOF

  1. Pipe the deployment token directly into GitHub CLI; do not print it:
       set -o pipefail
       az staticwebapp secrets list \
         --name "${SWA_NAME}" \
         --resource-group "${RESOURCE_GROUP}" \
         --query properties.apiKey -o tsv \
         | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo Jamula/stfc

  2. Verify the secret name only:
       gh secret list --repo Jamula/stfc --json name

  3. Invite first operator via Azure Portal:
       Portal → Static Web Apps → stfc-control-panel
       → Role Management → Invite → GitHub → role: stfc_operator

  The official Azure/static-web-apps-deploy action requires this token input.
  Never print or paste the deployment token into a terminal transcript or chat.

EOF

info "Done. Push a commit to main to trigger the first deploy."
