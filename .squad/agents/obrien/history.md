# O'Brien — DevOps / Platform Engineer

**Owner:** cyrusjamula  
**Project:** stfc-gift-redeemer — headless TypeScript CLI, GitHub Actions orchestration  
**Stack:** TypeScript, Node.js, GitHub Actions, CodeQL, Dependabot, Hugging Face, Cloudflare Workers  

## 2026-06-02 — Discord Worker pipeline live (2 PRs shipped)

### PR #156: deploy-cloudflare-worker hotfix (1-line path fix)
- **Problem:** Worker deploy workflow run 26799486930 failed at setup-node — referenced `worker/.nvmrc` but only root `/.nvmrc` exists
- **Fix:** Changed `node-version-file: worker/.nvmrc` → `.nvmrc`
- **Rule 3 pinning:** Added test in `deployCloudflareWorker.test.ts` to assert path value (prevents regression)
- **Lesson:** Pre-validate `*-version-file` paths exist in repo structure before merging deploy workflows; don't wait for first live run failure

### PR #157: deploy job summary capture
- **Problem:** Deploy job summary step was shelling out to `npx wrangler deployments list` without `CLOUDFLARE_API_TOKEN` in env
- **Option B fix:** Added `id: deploy` to wrangler-action step, referenced `${{ steps.deploy.outputs.deployment-url }}` in summary YAML
- **Verified:** `deployment-url` is a real named output in wrangler-action v4.0.0 (SHA `ebbaa158`)

**Outcome:** Both PRs merged. Worker now live at https://stfc-discord-bridge.cyrus-7cd.workers.dev.

Full platform learnings archived in `history-archive.md`.
