### 2026-05-18T02:04:00Z: STFC-News-Bot Discord identifiers (operator-supplied)
**By:** Cyrus Jamula (via Copilot)
**What:** A new Discord application named **STFC-News-Bot** has been created for the `003-discord-oauth` work (issue #51). Operator-supplied public identifiers:

- **Application ID (client_id):** `1505752454388514916`
- **Public Key:** `505b2f8384e61947003357a956a16986e1d9c48b451def18aed2297568e0fcbf`

**Why:** Needed to (a) construct the OAuth2 install URL the operator pastes to a guild admin (`docs/DISCORD-BOT-SETUP.md:68`, `specs/003-discord-oauth/quickstart.md:40`, currently `<APPLICATION_ID>` placeholders), and (b) future-proof for interaction-webhook signature verification (Public Key — not used in current REST-only design per plan.md §Summary point 2).

**Scope notes:**
- Both values above are **public** by Discord's design (App ID appears in OAuth URLs; Public Key is the verifier half of an asymmetric pair) — safe to commit to docs.
- The **Bot Token** (`DISCORD_BOT_TOKEN`) is the only secret and MUST NEVER be committed (constitution Principle V, FR-012). It is set via `gh secret set DISCORD_BOT_TOKEN` only.
- If the operator ever pastes a bot token into chat, the Coordinator MUST refuse to write it to any file and remind them to rotate it via the Developer Portal.
