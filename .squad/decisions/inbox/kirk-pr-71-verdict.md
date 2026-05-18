# Kirk verdict — PR #71 (discord-ops-automation)

- **By:** Kirk (Lead / Architect)
- **When:** 2026-05-18T02:46Z
- **PR:** https://github.com/Jamula/stfc/pull/71
- **Verdict comment:** https://github.com/Jamula/stfc/pull/71#issuecomment-4473820298
- **Status:** **APPROVE** ✅ (architecture review — script + workflow)

## Summary

Reviewed `scripts/discord-ops/set-discord-app-metadata.mjs` (Scotty, 226ce7b)
and `.github/workflows/discord-ops.yml` (O'Brien, 6ea61c8) plus pinning tests
(Bashir). 557/557 tests green, all CI checks green. Architecture is sound on
both sides; shell-injection hardening matches the GitHub Security Hardening
guidance verbatim; fetch-injection seam is clean and the sentinel-token leak
test pins FR-012 correctly.

Findings are LOW/NIT only — none gate merge:

1. **Idempotency design choice undocumented** — script always PATCHes; worth a one-line comment near `plannedCalls.push` so the next reader doesn't try to "optimise" with a GET-then-diff.
2. **Token-missing exit code inconsistency** — `DISCORD_BOT_TOKEN not set` returns exit 1; by the script's own comment-stated taxonomy (operator error → 2) it should be 2.
3. **curl `--proto` hardening** — `curl -sSfL --max-filesize 10485760` could add `--proto '=https' --proto-redir '=https'` to lock the scheme and reject `file://`/`gopher://` redirects. Belt-and-suspenders; runner network is already isolated.
4. **Partial-success path untested** — if `/users/@me` PATCH succeeds and `/applications/@me` PATCH fails, the script exits 1 with the first success line and the second error line. Defensible (PATCH is idempotent, operator re-runs) but no test.

Per Rule 7, this verdict + Garak's verdict + Picard's governance sign-off
+ green CI gate the merge.

## Revision routing (reviewer-rejection lockout — if any LOW becomes a follow-up)

- Idempotency comment + token-missing exit-code consistency → **Bashir** (NOT Scotty).
- curl `--proto` hardening → **Uhura** (NOT O'Brien).
- Partial-success test → **Bashir** (her domain anyway).

## Pattern worth promoting to a skill

Endorse O'Brien's proposed `.copilot/skills/operator-workflows/` skill. Four
invariants for any future `scripts/<vendor>-ops/` wrapper:

1. `workflow_dispatch:` only (no `schedule`/`push`/`pull_request`).
2. Minimal top-level `permissions:` (`contents: read`) + step-scoped secret env.
3. Unique concurrency group per third-party-API write target.
4. All operator inputs routed through quoted env vars (`"$VAR"`) and built into argv via bash arrays (`ARGS+=(--flag "$VAR")`).

This is the first workflow shape of its kind in the repo (operator-only,
manual-only, third-party-mutating) and the pattern is reusable.

## Architectural notes for the history record

- The fetch-injection seam in `discordPatch({ fetchImpl })` mirrors `src/api/client.ts` and `src/discord/client.ts` — keeping that pattern uniform across the project means test stubs are interchangeable. Worth keeping the convention.
- Inlining `redactString` rather than importing from `src/lib/redact.ts` is the right FR-009 trade: ~10 LOC duplication for a clean "scripts/ never imports src/" boundary. The sentinel-token test catches any future drift.
- Shell-injection hardening via env-routed inputs is now battle-tested in this repo. Future workflow PRs touching `inputs.*` in `run:` blocks should be reviewed against this PR as the reference pattern.
