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

## 2026-05-18T02:52:00Z — Picard governance sign-off: PR #71 three-reviewer gate cleared

**Verdict:** APPROVE ✅ (governance sign-off). All three gates clear (Kirk + Garak + Picard APPROVE). Per Rule 7, Coordinator auto-merges. Consolidated follow-up issue #72 filed (`v1.5.1 polish: discord-ops pinning + script hardening follow-ups`).

**Key learnings:**

### Override → ship pattern (first success)
When Cyrus issues an override directive (e.g., `.squad/decisions/inbox/copilot-directive-override-picard-discord-avatar-(a).md`), the governance sign-off workflow is:
1. Scope validation — override scope reflected in implementation, zero scope creep
2. Amendment integrity — SIR header + version footer + plan-template sync + cross-ref verification
3. Reviewer findings consolidation — Kirk + Garak findings independently tracked, explicit owner assignment (Bashir/Uhura per reviewer-lockout protocol)
4. Three-gate clear — all reviewers APPROVE, CI green → Rule 7 auto-merge
5. Scribe commits .squad/ — Picard posts decisions/inbox/picard-pr-71-signoff.md but does NOT commit (Rule 2)

This pattern ran successfully once (PR #71). If it repeats, encode as `.copilot/skills/override-signoff/` with hard boundaries between steps.

### Constitution amendment review — fact-check closes Decline
Picard's (c) Decline (2026-05-18T02:23Z) was grounded in "read-only DISCORD_BOT_TOKEN" (constitution.md:285/564). Cyrus overrode with narrower scope (/users/@me + /applications/@me only). **Garak's cross-provider hostile review (GPT-5.5) validated that the narrowing closes all four loopholes** (endpoint surface, src/ boundary, non-grant clause, workflow obligation). When a fact-check confirms the loopholes are factually closed, the evidence base for Decline is gone. Ship it.

### Pinning-test scope check — new governance heuristic
Garak identified: constitution amendments with new MUST clauses should each map to literal-value assertions in tests/. The discord-ops amendment introduced 4 MUSTs; constitution-pin test covers 3/4 directly but endpoint narrowing itself is not literally pinned. **For future constitution reviews:** enumerate MUST clauses, grep for each in tests/, flag any gap as [MEDIUM] (post-merge polish, appropriate reviewer).

---

