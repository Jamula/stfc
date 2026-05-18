# Picard — Lead / Code Review

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Recent Learnings (2026-05-18)

**Last major dispatch:** Audit resolution wave — O'Brien hired, @copilot activated, 4 routing rules added, 6 issues resolved. See `.squad/decisions.md` for full memos.

Key learnings from this round:
- Name role for function, not authority (O'Brien = working-class fixer)
- Consolidate convergent recommendations under one charter
- @copilot needs written tier profile in team.md (not vibe)
- Registry hygiene is real (backfill with `legacy_named: true` for utility roles)
- Hard-gate codification: verdict greppability > ceremony (use `**APPROVE** ✅` header)

**Earlier learnings (2026-05-16 through 2026-05-18):**
- See `history-archive.md` for condensed summary of 21 prior learnings on governance template sync, superseded-PR detection, triage-bot patterns, self-test taxonomy, audit compression heuristics.

2026-05-18T00:57Z: New teammate O'Brien (Miles) joined as DevOps/Platform Engineer; @copilot activated for autonomous issue pickup; new routing rules added (Garak hard-gate on src/ PRs, Discord precedence, Bashir/Kirk reviewer mitigation). See decisions.md and routing.md.
