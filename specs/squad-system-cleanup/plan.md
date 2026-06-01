> Committed copy of v4.2 plan (migrated from session state per plan Item 8). Authoritative source.

# Squad System Cleanup — Implementation Plan v4.1

> **Status:** DRAFT v4.1 · supersedes v3 + v4 · incorporates Garak (11) + Kirk (3) + Picard (7) reviews of v3 + rubberduck-v4 (P0×3, P1×7, P2×3) · awaiting fresh Picard + Kirk + Garak review of v4.1 → user approval
>
> **Requested by:** Cyrus Jamula
> **Date:** 2026-06-01
> **Session:** `f1073669-1239-486e-a66b-7c51b041eb2d`
>
> **v4 → v4.1 changelog (rubber-duck fixes):**
> - **P0#1 fixed:** Rule-count math now has ONE canonical statement: slots 1–22 exist; 12 and 20 RESERVED; substantive = 20 (see Item 2). Goal #2 and execution table updated to match.
> - **P0#2 fixed:** Rule 23 adoption DEFERRED to its own dedicated PR (was: bundled with cleanup). Cleanup PR ships Rule 22 only. Rule 23 needs migrating live placeholder, CI grep gate, and plan-template update — too much scope for cleanup.
> - **P0#3 fixed:** PRD triggers now: (a) literal `here's the PRD/spec` substring match, (b) `read the PRD at <path>` regex, (c) long-paste heuristic. All 3 smoke-tested.
> - **P1#1 fixed:** Template count is consistently **5 NEW** (init-mode, prd-intake, human-members, copilot-agent, reviewer-lockout) + **3 EXTEND** (casting-reference, plugin-marketplace, issue-lifecycle).
> - **P1#2 fixed:** Scribe defines tagging convention in dry-run output (not v4.1). Single artifact location: `.squad/log/{ts}-decisions-classification-sample.md`.
> - **P1#3 fixed:** Item 3 net archival today expected to be **0 entries** (all <7d). Hygiene tagging is the only work.
> - **P1#4 fixed:** Only Uhura is mandatory (at 15KB threshold). Picard/Garak get schema migration (add Standing-verdicts section if absent) only. O'Brien/Tuvok deferred to next ≥15KB trigger.
> - **P1#5 fixed:** `INPUT ARTIFACTS` standardization moves to squad.agent.md (where the spawn template lives). Routing.md gets cross-reference only + reviewer-lane PR-body boilerplate.
> - **P1#6 fixed:** Charter-skeleton + skill INDEX moved to PR2 (state cleanup). PR1 = coordinator/rules/routing only.
> - **P1#7 fixed:** Cleanup PR also creates `.squad/skills/worktree-preflight/SKILL.md` as Rule 22's companion (was: Rule 22 only).
> - **P2 fixed:** Q1 reversal explicitly flagged in approval prompt; plan-migration wording cleaned; stretch goal marked non-binding.

---

## What changed from v3 → v4 (executive summary)

v3 was **NOT approval-ready.** The squad reviews surfaced math errors, premise errors, and integration gaps that would have made v3 ship a plan it couldn't execute. v4 corrects:

1. **Item 1 math:** v3 claimed 30KB/35% savings from `squad.agent.md`; Garak verified table-sum is ~12.6KB (15%). v4 lowers the goal to "≥15% measurable shrink" and adds a second pass to find more sections (not a hand-wave to "another 17KB").
2. **Item 2 rule renumbering:** v3 said "no external refs to rule numbers." Garak found refs in `routing.md`, O'Brien/Garak charters, multiple skills, specs, and tests. v4 either (a) keeps numbers stable and only consolidates body text, or (b) ships a grep-and-update step as a mandatory sub-task. Picked (a) — see Item 2.
3. **Item 2 Rule 21 grouping:** Both Kirk (F2) and Picard (Finding 1) flagged that Rule 21 (credential refuse-and-rotate) is environment-agnostic and MUST NOT fold into "Codespaces gotchas." v4 keeps Rule 21 standalone.
4. **Item 2 Rule 6+12 consolidation:** Kirk (F1) — Rule 12 fires at PR-create time, Rule 6 at merge time. If consolidating, rename to "PR shipping hygiene" (trigger-neutral) and lead with both obligations explicitly.
5. **Item 3 decisions.md goal:** v3 promised 43→15KB. Garak sampled 10 entries: 0/10 immediately movable by age, ~2/10 eventually archive-class. v4 downgrades from a size-shrink goal to a **semantic-tagging hygiene task** with no specific KB target. The hot path stays ~current size; future archival becomes principled.
6. **Item 4 schema:** Picard (Finding 3) — governance agents (Picard, Garak) need a `### Standing verdicts / prior approvals` section so a respawned reviewer doesn't contradict prior approvals. v4 adds this section to the schema for Picard and Garak histories specifically.
7. **Item 4 Scribe behavior premise:** Garak (Failed #5) — v3 said Scribe "already preserves full text in history-archive.md"; it doesn't, it summarizes. v4 makes verbatim-append-then-summarize an explicit NEW behavior for Scribe, not an existing one.
8. **Item 1 missing templates:** Garak (Failed #7) — v3 said it would "extend existing" templates for 10 sections, but 7 of those target files don't exist (`ceremony-reference.md`, `ralph-reference.md`, `prd-intake.md`, `human-members.md`, `copilot-agent.md`, `reviewer-lockout.md`, `init-mode.md`). v4 reclassifies these as **NEW file creation** with explicit content scaffolding, not "extension."
9. **Item 3 Scribe gate:** Picard (Finding 2) — Item 3 cannot execute without a Scribe dry-run on `decisions.md` first. v4 makes this a hard pre-condition.
> - **v4 included adopting Rule 22 + DEFERRED Rule 23** as part of the cleanup PR — Rule 23 directly addresses an issue surfaced by THIS PLAN (v3 lived in stale session state), but requires migrating the live `specs/005-web-control-panel/plan.md` placeholder + CI grep gate + plan-template update which is its own PR.
11. **Kirk F3 — vague triggers:** PRD and plugin-marketplace error-catch triggers need to be sharpened with concrete signal strings. v4 specifies them inline in Item 1.
12. **Canonical rule-count statement:** see Item 2.

---

## Problem statement (verified numbers)

The Squad system has accumulated sprawl across 6 surfaces. Sizes verified by `wc` against the live repo as of 2026-06-01:

| Surface | Verified size | Pain |
|---|---|---|
| `.github/agents/squad.agent.md` | **84,943 B / 60 H2 or H3 sections** | Ships on every coordinator turn. Init Mode, Casting, Plugin Marketplace, PRD Mode, Human Members, Copilot Agent, Migration are conditionally relevant but ship unconditionally. |
| `.github/copilot-instructions.md` | **28,416 B / 21 rules** | Ships on every coordinator turn. Rules 6/12 both touch PR shipping; Rules 13/20 are both Codespaces quirks; Rule 21 is universal security. |
| `.squad/decisions.md` | **~90,482 B / 19 H1 top-level entries / 101 H2/H3 subsections** post-merge (v3 inbox just shipped) | Read by every spawned agent. Hot path grew with today's reviews — but all entries are <7 days old. |
| `.squad/agents/{name}/history.md` | After today's Scribe compaction: Uhura 15,199 B (at threshold), Picard 12,767 B, Garak 2,264 B, O'Brien 9,040 B, Tuvok 4,877 B | Scribe summarization triggers at ≥15 KB; only Uhura currently at threshold. |
| `.squad/agents/{name}/charter.md` | O'Brien 6,479 B / 119 lines (2–3× peer); Garak 5.3 KB exception; rest 2–4 KB | O'Brien is the outlier from 4-domain consolidation. Garak is the second outlier (hostile-fact-check methodology). |
| `.copilot/skills/` (11) + `.squad/skills/` (22) = **33 skills** | No confidence audit; unknown how many are one-shots vs validated patterns. |

**Why now:** (a) the just-shipped `chronicle-rollup` decision named "trim squad.agent.md dead weight" as a TO-BE-ADOPTED item; (b) v3 attempted this and produced a partially-broken plan that surfaced exactly which premises are wrong; (c) Picard's just-shipped improve-cycle proposal (Rule 22) lands in the same PR; Rule 23 deferred to PR3 (separate scope).

---

## Goals & non-goals

### Goals

1. **Modularize `squad.agent.md`** — measurable shrink of ≥15% (~12 KB), with concrete trigger detection for every moved section. Stretch target: ≥20% with a second-pass section scan.
2. **Consolidate `copilot-instructions.md`** with safe consolidations only (no renumbering). Slots 1–22 after merge; substantive rules = 20 across 22 slots (12 + 20 become RESERVED stubs); only Rule 22 added in cleanup (Rule 23 deferred to PR3).
3. **Semantic-tag `decisions.md` entries** so future archival is principled. No immediate size-shrink goal — that wasn't honest math in v3.
4. **Force-summarize histories ≥15 KB** with a structured schema that preserves operational recall (Active blockers / Permanent facts / Unblock commands / External IDs / Open follow-ups / **Standing verdicts (governance roles only)** / Archived gloss).
5. **Standardize charter shape** with a target skeleton; trim O'Brien and Garak charters by *duplicated prose only*, preserving every ownership claim and collaboration nuance.
6. **Skill inventory** — write `.copilot/skills/INDEX.md` and `.squad/skills/INDEX.md` with confidence levels. No archival per user decision; inventory only.
7. **Routing + inter-agent comms documentation** — add a "Common ambiguity resolutions" section to `routing.md`, document the drop-box pattern in routing terms, standardize the `INPUT ARTIFACTS` spawn-block convention.
8. **Adopt Picard's Rules 22 + 23** from the improve cycle, applying them to this PR's worktree work (Rule 22) and migrating the v3 + v4 plans into the repo per Rule 23.

### Non-goals

- Renaming agents or rebalancing the roster.
- Changing the constitution (`.specify/memory/constitution.md`) — separate amendment process (Rule 1).
- Touching active feature work (Wave 4 fanout `#118`, `#121`, web-control-panel epic) — cleanup targets only `.squad/`, `.github/`, `.copilot/`, and `specs/*/plan.md` migrations.
- Changing dispatch tools or platform behavior.
- **Renumbering rules** — Garak found rule numbers are externally referenced; renumber is out of scope to avoid scope explosion.

---

## Approach — 8 Work Items

### Item 1 — Modularize `squad.agent.md` (target ≥15% shrink, stretch ≥20%)

**Bootstrap sections that stay inline** (load-order critical, cannot defer):
- "Check `.squad/team.md` exists?" decision tree (top of file)
- Init Mode Phase 1 step-1 (identify user) and casting trigger detection
- Casting migration check stub in Team Mode
- Source of Truth Hierarchy
- Constraints section

**Move to on-demand templates** — these require CREATING the target file (Garak Failed #7):

| Section | Approx KB | Target file | NEW or EXTEND | Trigger string (Kirk F3) |
|---|---|---|---|---|
| Init Mode Phase 1 detailed steps | 3.0 | `.squad/templates/init-mode.md` | **NEW** | Bootstrap detects: `.squad/team.md` missing OR `## Members` empty |
| Init Mode Phase 2 detailed steps | 1.5 | `.squad/templates/init-mode.md` | **NEW** (same file) | Phase 1 returned `ask_user` accept |
| Casting Universe + Overflow + State Files | 2.0 | `.squad/templates/casting-reference.md` | EXTEND | Trigger 1: Init Mode Phase 1 step 3. Trigger 2: user message matches `add\s+(a|an|someone)?` AND mentions a role. Trigger 3: registry shows universe exhausted on next allocation. |
| Casting Migration — Already-Squadified Repos | 0.5 | `.squad/templates/casting-reference.md` | EXTEND | `.squad/team.md` exists AND `.squad/casting/` missing |
| Plugin Marketplace full text | 0.5 | `.squad/templates/plugin-marketplace.md` | EXTEND | Trigger 1: adding new team member AND `.squad/plugins/marketplaces.json` exists with ≥1 entry. Trigger 2 (Kirk F3): any `plugin marketplace` operation fails with `ENOTFOUND`/`ETIMEDOUT`/`403` — load for graceful degradation guidance. |
| PRD Mode full text | 1.0 | `.squad/templates/prd-intake.md` | **NEW** | **3 triggers, all smoke-tested (P0#3 fix):** (a) literal substring: user message contains `here's the PRD` or `here's the spec` (case-insensitive); (b) regex: `/read\s+the\s+(prd\|spec)\s+at\s+(\S+)/i`; (c) long-paste heuristic: user pastes ≥40 lines containing 3+ of `requirement`, `acceptance criteria`, `user story`, `must`, `should`. |
| Human Team Members full text | 0.7 | `.squad/templates/human-members.md` | **NEW** | User says `add ([A-Z][a-z]+)\s+as\s+(a\s+)?human` or `add a human` or names a real person in a roster-management context |
| Copilot Coding Agent Member full text | 0.7 | `.squad/templates/copilot-agent.md` | **NEW** | User mentions `@copilot` in a roster-management context |
| GitHub Issues Mode (Prerequisites + Connect + Issue→PR detail) | 1.2 | `.squad/templates/issue-lifecycle.md` | EXTEND | User message matches `(pull\|work on\|connect to)\s+issues?(\s+from)?\s+[a-z0-9-]+/[a-z0-9-]+` |
| Reviewer Rejection Lockout Semantics (1–7) | 1.5 | `.squad/templates/reviewer-lockout.md` | **NEW** | First reviewer says `CHANGES_REQUESTED` or `REJECTED` in a session |

**Sub-table totals:** 12.6 KB measured, ~15% of 84.9 KB. This matches Garak's verified math.

5. **Second-pass section scan** (P2#3 — STRETCH ONLY; no acceptance gate depends on hitting 20%):
- Audit `Per-Agent Model Selection` (~7.5 KB verified) — could the role-to-model table move to `.squad/templates/model-selection.md`, loaded only on first spawn?
- Audit `Client Compatibility` (~3.7 KB verified) — VS Code adaptation block could move to `.squad/templates/vscode-adaptations.md` loaded only when `runSubagent` is detected.
- Audit `MCP Integration` (~2.1 KB verified) — detection lines stay inline; the routing/degradation table could move to `.squad/templates/mcp-config.md` (which exists).

If 3 of these land safely, additional ~5–7 KB shrink → ~20%+ total. **Non-binding stretch; PR ships if only Item 1 base table moves.**

**Pre-flight check:** `ls .squad/templates/` confirms inventory. v4.1 verifies **5 NEW target files** don't exist (`init-mode.md`, `prd-intake.md`, `human-members.md`, `copilot-agent.md`, `reviewer-lockout.md` — Garak verified all 5 absent) and **3 EXTEND targets** exist (`casting-reference.md`, `plugin-marketplace.md`, `issue-lifecycle.md` — Garak verified all 3 present).

**Trigger smoke-test:** for each trigger string above, manually run a coordinator turn with a matching user message and assert the right file gets read (via `read_bash` log of view-tool calls). Each smoke-test is one orchestration log entry.

### Item 2 — Consolidate `copilot-instructions.md` (NO renumbering)

**Canonical count statement (P0#1 fix — replaces all prior conflicting numbers):**

> No renumbering. After consolidation: **slots 1–22 exist** (Rule 22 added new from improve cycle; Rule 23 deferred per P0#2). Rules **12 and 20** become RESERVED 1-line pointers to the merged rule. **Substantive rules = 20** (originals 1–21 minus 2 merged + 1 new Rule 22). Of the original 1–21, **19 substantive remain**.

**Approach:** numbers stay stable; consolidations happen *within* a rule by adding subsections. Where rules merge, the merged rule keeps the LOWER number, and the higher number's slot becomes "RESERVED — see Rule N for content."

| Rules | Action | Outcome |
|---|---|---|
| **6** (ship-it ritual) + **12** (per-line Closes keywords) | Merge into Rule 6 renamed "**PR shipping hygiene**" with subsections: (6a) PR-body authoring — close keywords one-per-line; (6b) merge-time ritual — rebase → push → merge → cleanup. Per Kirk F1, lead sentence must say the rule covers BOTH PR-create AND merge-time obligations. Rule 12 slot becomes "RESERVED — see Rule 6." | -1 |
| **13** (CodeQL 403 token scope) + **20** (Codespaces idle-timeout) | Merge into Rule 13 renamed "**Codespaces operational gotchas**" with subsections: (13a) token-scope diagnosis; (13b) idle-timeout management. Rule 20 slot becomes "RESERVED — see Rule 13." | -1 |
| **21** (credential refuse-and-rotate) | **STANDALONE — DO NOT GROUP.** Per Kirk F2 + Picard Finding 1: environment-agnostic security boundary. Renames to "**Credential hygiene — refuse-and-rotate**" for clarity. | 0 |
| **9a** + **9b** (gh command hygiene) | Already paired as Rule 9 in current file. Keep as-is. | 0 |
| **11** (Researching: prefix) | **RETAIN.** Garak verified 5 invocations in 30 days. | 0 |
| **15** (per-phase test scope) + **16** (per-capability doc updates) | **KEEP SEPARATE.** Rubber-duck P1#5: Rule 16 routes missing docs to Tuvok — collapsing buries that routing. | 0 |
| **22** (NEW from Picard improve) — `npm ci` in fresh worktrees | **ADD as new Rule 22.** | +1 |
| ~~**23** (`specs/*/plan.md` self-contained)~~ | **DEFERRED to its own PR (P0#2).** Reason: requires migrating live `specs/005-web-control-panel/plan.md` placeholder, adding CI grep gate, and updating `.specify/templates/plan-template.md` — which v4.1 validation gate 6 explicitly forbids. Including Rule 23 here would either fail CI or require relaxing the constitution-edit guard. Both bad. Rule 23 ships in PR3 (followup). | 0 |

See canonical count statement above this table.

**Rule-number reference grep gate** (Garak Failed #6 — mandatory):
```bash
grep -rnE '\bRule\s+(6|9|11|12|13|15|16|20|21)\b' .squad/ .github/ .copilot/ specs/ tests/ 2>/dev/null
```
Run before consolidation. Any reference to a number that becomes RESERVED (12, 20) must be updated to point to the merged rule (6, 13). This step is in-scope.

### Item 3 — Semantic-tag `decisions.md` (NO size-shrink goal; principled future hygiene)

**Goal change from v3:** v3 promised 43→15KB. Garak proved this impossible (all entries <7d; semantic sampling showed only 2/10 eventually archive-eligible). v4 drops the KB target. The work is: **add a semantic tag to every entry so future archival has a basis**, plus archive only the actually-eligible entries today (likely 2–4 of 12 top-level entries; net shrink minimal).

**Semantic class taxonomy** (Picard Finding 2 + Garak counterexample — add 7th class):

| Class | Retention | Examples |
|---|---|---|
| `constitutional` | hot, forever | Constitution amendments, charter creations, agent retirements |
| `standing-rule` | hot, forever | "Always/never X" directives, cost-discipline, doc-update rule |
| `active-blocker` | hot until resolved | Discord guild access, Azure OIDC provisioning, plan.md placeholder |
| `unresolved-followup` | hot until closed | Tracked chronicle next-action checklist items |
| `canonical-pattern` | hot, forever | Auth-first handler, ship-runner, ETag caching, structural workflow pin |
| `current-epic` | hot until epic closes | P1 web-control-panel decisions, crew v1.5/v2 |
| `operational-learning` (NEW — Garak counterexample) | hot until similar pattern recurs ≥3× or 90 days no recurrence | Worktree `.git` path nuance, CI environment drift, `vite: not found` |
| `archive-eligible` | hot for 7d, then archive | One-off PR review verdicts (PR merged + issue closed), resolved triage notes, stale superseded "what we thought we'd do" |

**Mechanism (per Picard Finding 2 — Scribe dry-run mandatory; rubber-duck P1#2 — Scribe defines convention):**

1. **Scribe dry-run pre-condition** (NEW gate): Scribe receives the proposed taxonomy and runs classification against the live `decisions.md`. Scribe's dry-run output **MUST define the durable tagging convention** (Scribe owns the mechanics — HTML comments under heading is v4.1's *proposal*, Scribe may counter-propose front-matter, sidecar file, or other approach). Scribe writes the single review artifact to `.squad/log/{ts}-decisions-classification-sample.md` (only location — v4.1 P1#2 fix). Output includes: chosen tagging convention, sample classification of 10–15 entries, future-merge behavior for new entries entering inbox.
2. User reviews the sample + convention before bulk apply.
3. The "current-epic" + "archive-eligible" classes require live `gh issue` / `gh pr` lookup at archive-decision time. Scribe handles this lookup in Task 1 of its standard tasks.
4. Today's net archival (P1#3 fix): **expected 0 entries** because all current decisions.md entries are <7 days old (Garak sampled the first 10 H1 entries — all dated 2026-05-31). The work today is *tagging only* — archival happens automatically once entries age past 7d AND their `gh` lookup confirms eligibility. No size promise.

### Item 4 — Force-summarize histories ≥15 KB with verbatim-archive backing

**v3 premise correction (Garak Failed #5):** Scribe currently SUMMARIZES into history.md and does NOT preserve full text in history-archive.md. v4 explicitly adds verbatim-preservation as NEW Scribe behavior:

> **New Scribe behavior:** when summarizing `history.md`, first APPEND the full pre-summarized text verbatim into `history-archive.md` (separator: `---\n# Pre-{date} verbatim snapshot\n`), then write the structured summary into `history.md`.

This is a Scribe charter amendment + spawn-prompt template update.

**Summary schema** (Picard Finding 3 — add governance-role section):

```markdown
## Pre-{date} summary (auto-generated)

### Active blockers
- {blocker-name}: {status}, {external IDs}, {unblock path}

### Permanent facts
- {fact still true and required for the agent's role}

### Unblock commands / paths
- {exact CLI / file path / API endpoint that was hard-won}

### External IDs and references
- {Discord guild IDs, Azure resource names, GH issue/PR numbers}

### Open follow-ups
- {what's still being chased; cross-link the issue/PR}

### Standing verdicts / prior approvals  ← NEW, GOVERNANCE ROLES ONLY (Picard, Garak, Kirk)
- {artifact}: {verdict summary + key dissenting points}, {date}, {PR/issue link}

### Archived verbatim → see history-archive.md
{1-2 line gloss per archived chunk for grep-discoverability}
```

**Targets (P1#4 — only Uhura mandatory after today's aggressive compaction):**
- **MANDATORY:** `uhura/history.md` (15.1 KB — at hard threshold; will re-trigger Scribe gate on next spawn)
- **SCHEMA MIGRATION ONLY** (no full re-summarize): `picard/history.md` (12.8 KB) + `garak/history.md` (2.3 KB) — add `### Standing verdicts / prior approvals` section if absent. These are governance/reviewer roles where the new section matters most.
- **DEFERRED** until next ≥15 KB trigger or reviewer explicitly requests: `obrien/history.md` (9.0 KB), `tuvok/history.md` (4.9 KB). Both well under threshold after today's compaction; re-summarizing now is churn.

### Item 5 — Standardize charter shape (rationale-preserving)

Define `.squad/templates/charter-skeleton.md`:
- Identity (name, role, reports-to, expertise, style) — short
- What I Own — bullets, no length cap
- What I Don't Own (delegates/refuses) — bullets, no length cap
- Boundaries — short prose
- Model preference (with rationale + fallback)
- Collaboration footer — standard ~3 lines (Picard Finding 5: O'Brien's Collaboration section is NOT redundant — preserve it)
- Voice — 1 paragraph

**O'Brien trim rule (Picard Finding 5):** preserve all 4 consolidated ownership domains, ML cache split with Uhura, workflow-pin test split with Bashir, workflow-step split with Scotty. Cut only duplicated prose. Target: 119 → ~70 lines (not 60).

**Garak charter (second outlier — 5.3 KB):** apply skeleton; cut hostile-fact-check methodology overlap with the agent's history if any (likely none — methodology IS the charter for Garak).

**Verification:** for each trimmed charter, diff against original; confirm every "What I Own" claim, every collaboration nuance, every cross-agent reference is preserved.

### Item 6 — Skill inventory (no archival — user opt-out)

For each skill in `.copilot/skills/` (11) and `.squad/skills/` (22):
- Determine confidence level (low/medium/high) per the lifecycle in squad.agent.md
- Write `.copilot/skills/INDEX.md` and `.squad/skills/INDEX.md` with columns: name, confidence, last-validated (commit SHA or session ID), owner, summary, file:line of last use
- Flag "high"-confidence skills in `.squad/skills/` as **promotion candidates** to `.copilot/skills/` (no actual move; user decides in a future cycle)
- **No `inventory-archive/` moves.** Per user v2 decision. Inventory only.

### Item 7 — Routing + inter-agent comms (expanded from v3's 4-bullet sketch; v4.1 — P1#5 fix)

User explicitly called out "optimize routing and inter-agent comms" as a top-3 ask. v3 was too thin here. v4.1 lands changes in **TWO files** (P1#5 fix: `INPUT ARTIFACTS` belongs in squad.agent.md where the spawn template lives, not routing.md):

**`.github/agents/squad.agent.md` additions (spawn-template area):**
1. **`INPUT ARTIFACTS` block standardization** — update the spawn template comment to specify: file paths only (no prose), one per line, prefixed with verb (`READ:` / `MODIFY:` / `CREATE:`). Agents may always additionally read their own history + decisions.md without explicit listing.

**`.squad/routing.md` additions:**
1. **"Common ambiguity resolutions" section** — table of disputed routing cases the team has actually hit:
   - workflow YAML + pin test → O'Brien (per Rule 3)
   - STFC API + workflow → split per ownership (Uhura owns STFC API, O'Brien owns workflow)
   - docs + capability → Tuvok for editorial, owner for content (per Rule 16)
   - secret rotation → coordinator handles refuse, owner runs `gh secret set` from local terminal (per Rule 21)
   - speckit phase boundary → implementer auto-commits, NOT user (per Rule 5)
2. **Drop-box pattern documentation** — explain in routing.md how decisions flow: agent writes inbox file, Scribe merges, agents read consolidated decisions.md on next spawn. Currently this is only documented in squad.agent.md (which agents don't read).
3. **Cross-reference** to `INPUT ARTIFACTS` convention in squad.agent.md (#1 above).
4. **Reviewer-lane declaration template** (Picard Finding 4) — concrete PR-body boilerplate for multi-item PRs:
   ```markdown
   ## Reviewer lanes
   - **Kirk** (technical correctness): Items {N1, N2}
   - **Picard** (scope/governance): Items {N3, N4}
   - **Garak** (hostile fact-check): consolidation fidelity, all items
   
   Each reviewer signs off only their lane. Do NOT approve outside lane.
   ```

**Drop-box mechanism itself unchanged.** This is pure documentation + spawn-template wording.

### Item 8 (NEW) — Adopt Picard's Rule 22 + worktree-preflight skill (Rule 23 deferred)

Picard's improve cycle just dropped `picard-squad-improve-2026-06-01.md` proposing:
- **Rule 22:** `npm ci` in fresh worktrees (avoid stale node_modules symlink causing "vite: not found", "json-schema-to-typescript missing" — observed in O'Brien PR #125 close-out)
- **Companion skill** (P1#7 fix — v4 omitted this): `.squad/skills/worktree-preflight/SKILL.md` — captures the `npm ci` + `link node_modules` + verify-build-tools pattern as a reusable preflight checklist
- **Rule 23** (DEFERRED per P0#2): `specs/*/plan.md` must be self-contained. Migrating the live `specs/005-web-control-panel/plan.md` placeholder + adding CI grep gate + updating `.specify/templates/plan-template.md` is its own scope. Cleanup PR's "no .specify edits" gate (validation 6) would forbid Rule 23 work anyway.

**Cleanup PR also:**
- Adds Rule 22 to `copilot-instructions.md` (per Item 2's accounting)
- Creates `.squad/skills/worktree-preflight/SKILL.md` with the preflight checklist
- Cross-references `.squad/skills/audit-wip-fanout/SKILL.md` (existing) which describes when worktrees get spawned
- **Commits this approved v4.1 plan to `specs/squad-system-cleanup/plan.md`** (P2#2 wording fix — was confusing "migrate v3 to v4" phrasing). Source of truth: the repo-committed file, not the session-state copy.

**Rule 23 followup:** open a NEW issue `squad:tuvok` titled "Adopt Rule 23 — migrate `specs/005-web-control-panel/plan.md` placeholder + CI grep gate + update plan-template" after cleanup PR merges. Tuvok-led because it's editorial + cross-template.

---

## Validation gates

Before merging the cleanup PR:

1. **Mechanical:** Full test suite still passes (`npm test` and `npm run typecheck`). Cleanup is doc-only; any test failure means non-cleanup work broke.

2. **Modularization trigger checklist** (concrete strings, per Kirk F3):
   - [ ] `.squad/team.md` missing OR `## Members` empty → coordinator loads `init-mode.md` Phase 1 immediately
   - [ ] `.squad/casting/` missing AND team.md exists → coordinator loads `casting-reference.md` migration section
   - [ ] User says `add a designer` (or matches `add\s+(a|an)?\s+\w+\s+(role|agent|member)` ) → coordinator loads `casting-reference.md` allocation section
   - [ ] Universe exhausted on next allocation → coordinator loads `casting-reference.md` overflow section
   - [ ] User message contains PRD signal (Item 1 trigger 3) → coordinator loads `prd-intake.md`
   - [ ] User says `add Brady as human` → coordinator loads `human-members.md`
   - [ ] User says `add @copilot` → coordinator loads `copilot-agent.md`
   - [ ] User says `pull issues from owner/repo` → coordinator loads `issue-lifecycle.md`
   - [ ] Reviewer comment contains `CHANGES_REQUESTED` or `REJECTED` → coordinator loads `reviewer-lockout.md`
   - [ ] Plugin marketplace operation fails with `ENOTFOUND|ETIMEDOUT|403` → coordinator loads `plugin-marketplace.md` degradation section

   Each trigger verified by a smoke-test scripted into `.squad/skills/trigger-smoke-tests/SKILL.md` (run manually pre-merge).

3. **Rule-number grep gate:** the rule-number grep listed in Item 2 must return only the consolidated/correct references after edits. CI gate via a new `.github/workflows/rule-reference-check.yml`.

4. **Scribe dry-run on decisions.md** (Picard Finding 2, mandatory for Item 3): Scribe runs classification against the live `decisions.md`, produces `.squad/log/{ts}-decisions-classification-sample.md` for user review BEFORE bulk apply. User signs off on the sample before classification + archive runs.

5. **History summarization schema check** (Picard Finding 3): for each summarized history, verify `### Standing verdicts / prior approvals` section is present for **Picard + Garak** (governance + hostile-fact-check roles). Kirk excluded per P1#4 — Kirk's prior approvals are captured in commit history and PR comments, not history.md. Verify `history-archive.md` contains verbatim pre-summary text (Garak Failed #5 correction).

6. **Constitution check (Rule 1):** no `.specify/memory/constitution.md` or `.specify/templates/plan-template.md` changes in this PR.

7. **Reviewer-lane declaration** (Picard Finding 4): PR description includes explicit lane assignments (Kirk: Items 1, 2, 5; Picard: Items 2, 3, 5, 7, 8; Garak: consolidation fidelity all items). Each reviewer signs off only their lane to prevent rubber-stamping on a broad diff.

8. **Restart boundary:** in-flight worktrees (`#118`, `#121`) complete on OLD `squad.agent.md`. After this PR merges, user starts a NEW session for new work to pick up leaner coordinator. PR body repeats this guidance.

---

## Decisions still open (Q1, Q2)

Default values shown — change in approval prompt if you disagree.

### Q1 — Delivery shape

| Option | Description | Default? |
|---|---|---|
| A — Single `chore(squad)` PR | Atomic, one review pass | (v2 user choice) |
| **B — Two PRs (rubber-duck preference)** | PR 1: docs trim (squad.agent.md modularization + copilot-instructions Rule 22 + routing) — requires session restart. PR 2: state cleanup (decisions/histories/skills/charters/skill INDEX/charter skeleton) — no restart. (PR 3 followup: Rule 23 adoption.) | **DEFAULT in v4.1 — FLIPPED FROM YOUR v2 PREFERENCE.** P2#1 fix: explicitly flag this reversal at approval. Rationale: Garak's 11 findings on v3 proved a single broad diff invites rubber-stamping. Override to single PR if you prefer atomic restart. |

### Q2 — Reviewer panel

| Option | Description | Default? |
|---|---|---|
| A — Picard + Kirk + Garak only (gating) | (v2 user choice) | |
| **B — Picard + Kirk + Garak (gating) + Scribe (advisory, Item 3 dry-run) + Tuvok (advisory, editorial template re-sync)** | Picard Finding 2: Scribe dry-run is mandatory for Item 3 (this happens regardless of panel composition). Rubber-duck P1#8: Tuvok advises on editorial template re-sync. | **DEFAULT in v4 — partial.** Picard Finding 6 accepts the 3-reviewer gating panel. Add Scribe advisory (Item 3 dry-run is non-negotiable per Picard Finding 2). Skip Tuvok advisory per Picard Finding 6 (charter-skeleton is simple, Kirk's eye suffices). |

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Lossy consolidation** drops a nuance (Rule 6/12 axis mismatch was v3's example) | Kirk's review gates each consolidation; PR description quotes BOTH original rules verbatim before the merged version for diff review. |
| **On-demand pattern failure** — coordinator forgets to load a moved section | Trigger smoke-tests in validation gate 2 + a grep guard in CI (gate 3) that fails the build if a moved section is removed without a corresponding template-load reference in `squad.agent.md`. |
| **Rule renumbering breaks external refs** | v4 does NOT renumber. RESERVED slots preserve numbers; merged rules keep the lower number. Grep gate (validation 3) confirms no orphaned references. |
| **History summarization loses recall** | Verbatim preservation in `history-archive.md` (Item 4 new Scribe behavior); structured schema (Item 4) enforces operational sections. |
| **Decision archival mis-classifies** | Scribe dry-run + user sample review (validation 4) before bulk apply. |
| **Skills audit retires a useful pattern** | No retirement per user opt-out. INDEX.md only. |
| **Coordinator restart needed** | Documented in PR body; in-flight worktrees finish on old context. |
| **PR too broad for review** (rubber-duck P1#9) | Mitigated by Q1 default B (2 PRs) + Picard Finding 4 reviewer-lane declarations. |
| **Plan.md itself becomes stale session-state** (the v3 trap) | Item 8 migrates v4 to `specs/squad-system-cleanup/plan.md` as a committed file (satisfies new Rule 23). |

---

## Out-of-band: live work in flight

- O'Brien #118 (invitation runbook) — PR #125 already open, ready for merge
- Scotty #121 (data-read endpoints) — in progress
- Picard's chronicle-rollup adoption checklist (separate from this plan)

Cleanup targets only `.squad/`, `.github/`, `.copilot/`, and `specs/squad-system-cleanup/`. No file overlap with Wave 4 worktrees.

---

## Todos (SQL-tracked after approval — see section "Reflect to SQL")

| ID | Title | Depends on |
|---|---|---|
| `v4-rubber-duck-review` | Rubber-duck reviews v4 (this plan) | — |
| `v4-incorporate-rd` | Incorporate rubber-duck findings into v4 | v4-rubber-duck-review |
| `v4-squad-review` | Picard + Kirk + Garak parallel review of v4 | v4-incorporate-rd |
| `v4-incorporate-squad` | Incorporate squad findings into v4 | v4-squad-review |
| `v4-user-approval` | exit_plan_mode for final user sign-off | v4-incorporate-squad |
| **EXECUTION TODOS — only after v4-user-approval** | | |
| `migrate-plan-to-repo` | Migrate v4 plan from session state to `specs/squad-system-cleanup/plan.md` (Rule 23 compliance) | v4-user-approval |
| `pre-flight-template-inventory` | `ls .squad/templates/` + confirm 5 NEW target files don't exist; reserve names | v4-user-approval |
| `create-templates` | Create 5 NEW template files: init-mode.md, prd-intake.md, human-members.md, copilot-agent.md, reviewer-lockout.md | pre-flight-template-inventory |
| `extend-templates` | Extend 3 EXISTING templates: casting-reference.md, plugin-marketplace.md, issue-lifecycle.md | pre-flight-template-inventory |
| `modularize-squad-agent` | Move 10 sections to templates + add trigger detection lines | create-templates, extend-templates |
| `second-pass-scan-squad-agent` | Audit Per-Agent Model Selection, Client Compatibility, MCP Integration for ≥20% stretch | modularize-squad-agent |
| `grep-rule-refs` | Grep for all `Rule N` references; build update map | v4-user-approval |
| `consolidate-rules` | Apply 2 merges (6+12, 13+20) + add Rule 22 (NOT 23) + update grep-listed refs to 12/20 | grep-rule-refs |
| `scribe-decision-classify-dryrun` | Scribe dry-run classification on decisions.md → sample for user review | v4-user-approval |
| `decision-classify-apply` | Bulk-tag decisions + archive eligible (likely 2-4 entries) | scribe-decision-classify-dryrun (USER GATE) |
| `update-scribe-history-behavior` | Amend Scribe charter + spawn template: verbatim-then-summarize for history.md | v4-user-approval |
| `summarize-histories-new-schema` | Re-summarize Uhura (mandatory, at 15KB threshold); schema migration only for Picard + Garak (add Standing-verdicts section if absent); defer O'Brien + Tuvok per P1#4 (under threshold after compaction) | update-scribe-history-behavior |
| `create-charter-skeleton` | Write `.squad/templates/charter-skeleton.md` | v4-user-approval |
| `trim-obrien-charter` | Trim O'Brien charter to ~70 lines preserving all 4 domains + collaboration splits | create-charter-skeleton |
| `audit-other-charters` | Audit + selectively trim other charters against skeleton | create-charter-skeleton |
| `skill-inventory` | Write `.copilot/skills/INDEX.md` + `.squad/skills/INDEX.md` (no retirement moves per user decision) | v4-user-approval |
| `routing-comms-update` | Add 4 routing.md additions (Item 7) | v4-user-approval |
| `trigger-smoke-tests` | Manually verify 10 trigger strings load the right template | modularize-squad-agent |
| `rule-ref-grep-ci` | Add `.github/workflows/rule-reference-check.yml` | consolidate-rules |
| `open-pr1-docs` (if Q1=B) | Open PR 1: docs trim (squad-agent + copilot-instructions + routing + Rule 22 + worktree-preflight skill) | (all docs-trim todos) |
| `open-pr2-state` (if Q1=B) | Open PR 2: state cleanup (decisions/histories/charters/skill INDEX) | open-pr1-docs |
| `open-pr-single` (if Q1=A) | Open single chore(squad) PR | (everything) |

---

## Execution sequence (after final approval, assuming Q1=B / 2 PRs)

### PR 1 — Docs trim (requires post-merge session restart)

1. Branch: `chore/squad-cleanup-docs` in fresh worktree (use Rule 22 — `npm ci` first)
2. **Parallel batch:** create 5 NEW templates (init-mode, prd-intake, human-members, copilot-agent, reviewer-lockout), extend 3 templates (casting-reference, plugin-marketplace, issue-lifecycle), modularize squad.agent.md (move 10 sections + add trigger detection + `INPUT ARTIFACTS` standardization), second-pass stretch scan
3. **Sequential:** rule-ref grep → consolidate copilot-instructions.md (rules 6+12, 13+20, add Rule 22 only — Rule 23 deferred to PR3)
4. **Parallel batch:** routing.md additions (reviewer-lane boilerplate, drop-box doc, ambiguity table, cross-ref to INPUT ARTIFACTS), create `.squad/skills/worktree-preflight/SKILL.md`
5. **Sequential:** trigger smoke-tests (all 10 incl. 3 PRD trigger paths)
6. PR title: `chore(squad): docs cleanup — modularize coordinator prompt, consolidate rules`
7. PR body: reviewer-lane declarations using new boilerplate (Kirk: Items 1+2; Picard: Items 2+8; Garak: consolidation fidelity)
8. Review per panel
9. Merge per Rule 7 auto-merge gate
10. Communicate restart: pin a comment on PR after merge naming this as the restart trigger

### PR 2 — State cleanup (no restart needed)

1. Branch: `chore/squad-cleanup-state` in fresh worktree (after PR 1 merges)
2. **Sequential:** Scribe dry-run on decisions.md → user signs off on convention + sample
3. **Sequential:** apply classification + archive eligible (expected: 0 entries today; tags only)
4. **Sequential:** update Scribe charter + spawn template for verbatim+summarize
5. **Sequential:** re-summarize Uhura (mandatory); schema migration only for Picard + Garak; defer O'Brien + Tuvok
6. **Sequential:** create `.squad/templates/charter-skeleton.md`; trim O'Brien charter (~119 → ~70 lines preserving 4 domains + collaboration splits)
7. **Sequential:** audit + selectively trim other charters against skeleton
8. **Sequential:** write `.copilot/skills/INDEX.md` + `.squad/skills/INDEX.md` with confidence levels
9. PR title: `chore(squad): state cleanup — semantic decision tags, history schema, charter trim, skill INDEX`
10. PR body: reviewer-lane declarations (Picard Items 3+5+7; Kirk Item 4 schema; Garak consolidation fidelity)
11. Review per panel + Scribe advisory on Item 3 sample
12. Merge per Rule 7

### PR 3 — Rule 23 adoption (followup, separate work)

Open new issue `squad:tuvok` for: migrate `specs/005-web-control-panel/plan.md` placeholder content into the file itself, add CI grep gate forbidding `~/.copilot/session-state/` references in `specs/*/plan.md`, update `.specify/templates/plan-template.md`, add Rule 23 to copilot-instructions.md. Not part of cleanup scope.

### Execution sequence (if Q1=A / single PR)

Same as above but combined; ALL items in `chore/squad-system-cleanup`. Reviewer-lane declarations more critical to avoid rubber-stamp.

---

## Notes / considerations

- **Pre-commit hook will run on every commit.** All work must keep `npm test` green. Plan changes do not run tests; charter/template/rule edits should not break tests either (they're not in test paths).
- **`.gitattributes`** already has merge=union for `.squad/decisions.md`, `.squad/agents/*/history.md`, `.squad/log/**`, `.squad/orchestration-log/**` — safe for cross-branch merge during the PR cycle.
- **Rebase strategy:** per Rule 4, rebase onto origin/main before every push. Local main may diverge every 15 min from `redeem.yml` chore commits.
- **Restart self-rule:** the Squad self-development rule already says any change to squad.agent.md needs a session restart. PR 1's body will repeat this explicitly.
