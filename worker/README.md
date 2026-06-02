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

# GitHub PAT with fine-grained permissions: contents:read + actions:write
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
| `GH_DISPATCH_TOKEN` | Secret | GitHub PAT (contents:read + actions:write) |
| `GH_REPO` | Var | `Jamula/stfc` |

## Related issues

- **#143** — Epic: Discord slash command infrastructure
- **#146** — This Worker (code only)
- **#147** — GH Actions handler workflow that processes the dispatch (Scotty)
- **#148** — Deploy workflow (O'Brien)
- **#149** — Operator runbook (Uhura)
