# Uhura — History

## Core Context

- **Role:** Technical Writer
- **Joined:** 2026-11-01

## Learnings

<!-- Append new learnings below -->

## Repository orientation

Jamula/stfc automates STFC gift and promo-code redemption, with Discord monitoring, crew recommendations, a Cloudflare Worker for slash commands, and an Azure web/API control panel (README.md, discord/RUNBOOK.md, docs/CREW-OPTIMIZER.md). Verify the actual implementation before promising capabilities: the control-panel tabs are placeholders in this checkout (web/src/app.ts, web/src/components/stfc-redeems-tab.ts).

Operator guidance must distinguish configured secrets and permissions from publicly shareable instructions. The refresh-token workflow is manual-only; some older documentation describes an automatic schedule (.github/workflows/refresh-token.yml, docs/SETUP.md).
