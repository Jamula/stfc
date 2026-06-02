# stfc-discord-bridge — Cloudflare Worker

A stateless Cloudflare Worker (~100 LoC) that bridges Discord slash-command interactions to GitHub Actions via `repository_dispatch`. It contains **no business logic** — it only verifies the Ed25519 signature, defers the response, and fires the dispatch. All command handling runs in GitHub Actions.

## How it works

```
Discord user types /crew
        │
        ▼
Discord API  ──POST──►  Cloudflare Worker (this)
                                │
                    1. Verify Ed25519 signature
                    2. Respond {type:5} in <3s   ──►  Discord: "Bot is thinking..."
                    3. ctx.waitUntil(GH dispatch)
                                │
                                ▼
                    GitHub Actions (repository_dispatch: discord-command)
                                │
                    Handler workflow does the work
                                │
                                ▼
                    PATCH /webhooks/{app_id}/{token}/messages/@original
                                │
                                ▼
                    Discord: final reply appears
```

## Secrets

Three bindings are required. Set the secrets with wrangler — **never** commit values to source:

```bash
# Ed25519 hex public key from Discord Developer Portal > your app > General Information
wrangler secret put DISCORD_PUBLIC_KEY

# GitHub PAT with fine-grained permissions: contents:write
# (metadata:read is automatically enforced by GitHub for fine-grained PATs)
# (or classic PAT with `repo` scope)
wrangler secret put GH_DISPATCH_TOKEN
```

The non-secret `GH_REPO` variable (`Jamula/stfc`) is already set in `wrangler.toml`.

## Deploy

```bash
cd worker
npm install

# First deploy — wrangler provisions the Worker and sets the route
wrangler deploy

# Set secrets (prompted for value; nothing echoed to terminal)
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put GH_DISPATCH_TOKEN
```

After deploy, copy the Worker URL (`https://stfc-discord-bridge.<your-subdomain>.workers.dev`) and paste it into:

**Discord Developer Portal → your app → General Information → Interactions Endpoint URL**

Discord will immediately send a PING (type 1) to verify the endpoint. The Worker responds with PONG (type 1) and Discord marks the URL valid.

## Local development

```bash
cd worker
wrangler dev     # starts local dev server with hot reload
```

For local dev, create a `.dev.vars` file (gitignored) with your secrets:

```
DISCORD_PUBLIC_KEY=<your-hex-public-key>
GH_DISPATCH_TOKEN=<your-github-pat>
GH_REPO=Jamula/stfc
```

## Deployment

This Worker is automatically deployed to Cloudflare via GitHub Actions when `worker/**` files change on the `main` branch.

**Automatic deployment:**
- Trigger: `git push` to `main` with changes to `worker/` (or the workflow itself)
- Checks: `npm test` and `npm run typecheck` run first — code that fails tests does not deploy
- Action: `wrangler deploy` is invoked from `.github/workflows/deploy-cloudflare-worker.yml`

**Manual redeploy:**
- GitHub → Actions tab → **Deploy Cloudflare Worker** → **Run workflow**

**Required secrets (set once per repo, persists):**
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with **Workers Scripts:Edit** permission (create at https://dash.cloudflare.com/profile/api-tokens)
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account ID (find at https://dash.cloudflare.com — bottom-left sidebar)

Set both from your local terminal using `gh`:
```bash
gh secret set CLOUDFLARE_API_TOKEN --repo Jamula/stfc
gh secret set CLOUDFLARE_ACCOUNT_ID --repo Jamula/stfc
```

**After deploy:**
- Open the workflow run in GitHub Actions
- Scroll to **Deploy Cloudflare Worker** job → final step
- Copy the deployed URL from the job summary
- Paste it into [Discord Developer Portal](https://discord.com/developers/applications) → Your Application → **General Information** → **Interactions Endpoint URL**
- Discord will verify the endpoint immediately (PING/PONG handshake)

## Tests

```bash
cd worker
npm test          # runs all 8 tests via vitest
npm run typecheck # tsc --noEmit
```

Tests cover:
- PING → PONG (type 1)
- Missing signature/timestamp headers → 401
- Stale timestamp (>5 min skew) → 401
- Corrupted Ed25519 signature → 401
- APPLICATION_COMMAND (type 2) → deferred type 5 + correct GH dispatch payload
- Unknown interaction type → 400

## Environment

| Binding | Type | Value |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Secret | Ed25519 hex public key from Developer Portal |
| `GH_DISPATCH_TOKEN` | Secret | GitHub PAT (contents:write; metadata:read auto-enforced) |
| `GH_REPO` | Var | `Jamula/stfc` |

## Related issues

- **#143** — Epic: Discord slash command infrastructure
- **#146** — This Worker (code only)
- **#147** — GH Actions handler workflow that processes the dispatch (Scotty)
- **#148** — Deploy workflow (O'Brien)
- **#149** — Operator runbook (Uhura)
