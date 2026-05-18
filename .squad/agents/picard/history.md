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

2026-05-18T01:40Z: Uhura proposed 3-path Discord+news architecture in decisions.md (admin approval vs relay server vs website scrape). Awaits team ratification on path choice.

2026-05-18T02:23Z: Declined Discord avatar automation (verdict (c)) — chose Portal upload over a one-shot `PATCH /users/@me` script. Rationale: constitution.md:285 + :564 describe `DISCORD_BOT_TOKEN` as the "read-only Discord bot auth token" and sanction `discord.com/api/v10` only for "read-only bot scopes"; option (b) "script lives outside src/discord/, so FR-009 doesn't apply" loses to the secret-level read-only assertion (Garak fact-check would have caught it). Cost-benefit: option (a) carries a constitution amendment + plan-template sync + Scotty script + Tuvok editorial + Garak adversarial review for what is plausibly a one-time-ever operation. Pattern noticed: when a constitution clause asserts a property at *both* the module level *and* the secret level (here "read-only" appears on the skill AND on the token), a non-module-located script does NOT route around the property — the secret-level assertion is the binding one. Worth memorialising as a governance heuristic. Skill-creation question: a `.copilot/skills/one-shot-write-against-readonly-api/SKILL.md` is NOT warranted yet — this is the first instance, and creating a skill for it would normalize a pattern I'm actively declining. Revisit only if a second case arises with genuine recurring frequency. Closing condition: Cyrus uploads via Developer Portal, OR he overrules and I dispatch option (a).
## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---

