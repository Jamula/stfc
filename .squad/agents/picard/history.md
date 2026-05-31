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


## 2026-05-31T19:35:00Z — Issue #74: community STFC sheet ingested (PR #75)

**Verdict:** SHIPPED — executed in-stream rather than handing off to Uhura/Tuvok. User mandate was "make it so, keep it moving"; the scope was clear enough that a triage→hand-off→re-review cycle would have added latency without adding quality.

**Scope decision:**
Game-strategy data is **not consumed by our CLI at runtime**. The value of mirroring is (a) context for STFC-domain agents reasoning about features (Uhura), (b) stable reference for the project owner. Therefore: a `docs/stfc-knowledge/community-reference-sheet/` directory under `docs/` — *not* a runtime data path under `data/` or a schema-validated artifact. CSVs preserved raw (thousands separators, percent signs intact) so downstream consumers normalize as they prefer.

**Doc structure chosen:**
- Per-tab markdown file (one file per gid) with a standard attribution header, "read-only mirror" notice, link to upstream tab via `#gid=`, last-fetched date, and a fenced ` ```csv ` block with empty columns trimmed.
- Index `README.md` with the tab table, attribution, refresh procedure, and explicit notes on limitations (visual/screenshot content does not survive CSV export).
- A small helper `scripts/fetch-community-sheet.mjs` that re-fetches all tabs and rewrites the markdown files — concretizes the "refresh by re-fetching" promise and makes future updates a one-command operation.
- Cross-links from both `README.md` (project layout) and `docs/stfc-game-knowledge.md` §14 so the mirror is discoverable from existing entry points.

**Attribution pattern (codified in the fetcher's header() function):**
Every per-tab file carries the same five-line block: source URL with `#gid=`, authors (JulesVern / Quasel / BlueMandalorian / STFC Discord), Discord invite, last-fetched date, "do not modify" notice. Because the header is generated by the script, refreshing the mirror cannot accidentally drop attribution.

**Sheet-fetch technique (worth keeping):**
1. `curl` the `/htmlview` URL (not `/edit`) — the htmlview page contains a JavaScript `items.push({name, gid})` array in its source that maps every tab name to its gid. The `/edit` page does *not* expose this.
2. For each gid, fetch CSV via `https://docs.google.com/spreadsheets/d/<SHEET>/gviz/tq?tqx=out:csv&gid=<GID>`. The gviz endpoint always quotes every field, so a minimal RFC 4180 parser suffices.
3. Trim empty columns (whole-column emptiness check) before writing — the upstream sheet uses heavy merged-cell layout, so raw CSVs have ~50% empty columns. Trimming makes the mirror human-scannable while preserving all real data.
4. Preserve cell formatting (don't strip `%` or thousand separators) so downstream consumers can normalize as they prefer.

**Tabs noted in issue but missing upstream:** *Facade Expansion* and *Emerald Chain Expansion* — documented in the index README with instructions for re-adding if/when they reappear.

**Handoff decisions:**
- *No* mid-stream handoff. Scope was bounded (11 tabs, one fetcher, one index), no STFC-domain disambiguation required (we preserve the authors' terminology verbatim), no editorial polish needed beyond the index README (which is plainly factual). Tuvok can do a follow-up editorial pass on the index README *if* a reader finds it confusing — that's a cheap post-merge polish, not a pre-merge blocker.
- *No* sub-issue filed. The mirror is self-contained; the only natural follow-up is "schedule a periodic refresh via CI," which is a Cyrus decision (cost of CI minutes vs. staleness tolerance), not a Picard one.

**Pattern worth codifying:**
Wrote a new skill at `.squad/skills/mirror-google-sheet/SKILL.md` capturing the fetch technique, attribution pattern, and CSV-trim discipline so future "mirror an upstream sheet" requests (we'll get more — STFC has many community sheets) don't re-derive this.


## 2026-05-31T19:37Z — Mid-flight lineage directive folded into PR #75

Cyrus issued "track lineage (where did the info come from)" mid-flight. Folded into the open PR rather than spawning a follow-up — the existing per-tab header had 4 of the 6 required fields implicitly; explicit labeling + 2 new fields (License/attribution requirements; Refresh strategy) was a 30-line edit to the fetcher's `header()` function.

**What was codified:**

1. **Six-field `## Lineage` block** as project-wide standard. Required fields:
   - Source URL (deep-linked: gid for Sheet, message permalink for Discord, anchor for blog)
   - Source name
   - Author(s) / contributors (semicolon-separated)
   - Captured on (YYYY-MM-DD)
   - License / attribution requirements (terms + our handling commitment)
   - Refresh strategy (exact command + how to detect upstream changes)

2. **Generated from constants in the ingest script**, never hand-written. This is the load-bearing discipline — manually-maintained attribution drifts; generated attribution cannot.

3. **New `docs/stfc-knowledge/README.md`** documents the convention as the standard for ANY future ingest source. A new source = a new sibling sub-directory with its own index README + per-artifact files, all carrying the six-field block.

**Forward-compat note (cyrusj's FYI about a Discord channel ingest follow-up):** The structure works as-is. A `docs/stfc-knowledge/discord-officer-tool-<channel>/` directory with per-message files (each carrying the six-field block: Source URL = message permalink, Author = handle, Captured on = snapshot date) slots in without restructuring. Documented in the skill.

**Skill updated** at `.squad/skills/mirror-google-sheet/SKILL.md`: the six-field block is now MUST, not SHOULD. Examples for non-Sheet sources (Discord, blog) added inline.

**Pattern worth remembering:** Mid-flight directives that strengthen an existing pattern (here: "make the implicit lineage explicit and labeled") are cheaper to fold into the open PR than to file as follow-up issues — the implementer is already in context, the diff is small, and the directive applies to artifacts that don't exist yet (any future ingest) regardless of whether the current PR ships first. Use the inbox decision memo to make sure Scribe records the directive's provenance separately from the PR's primary scope.


## 2026-05-31: Issue #74 Completion — Ingest STFC Community Sheet

**Status:** PR #75 opened, 5 CI checks green, ready to merge

Ingested STFC community Google Sheet with 6-field lineage tracking (source, name, authors, captured-on, license, refresh-strategy) per user directive. Generated docs structure, fetch script, cross-links, and skill artifact. Lineage requirement applies retroactively and to all future ingestion (#76 incoming).

**Decision record:** `.squad/decisions/inbox/picard-issue-74-ingest-sheet.md` (merged to decisions.md by Scribe)

**User directive:** 6-field lineage on all external knowledge ingestion (retroactive + forward)
