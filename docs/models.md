# Squad model selection — catalog & recommendations

> Last refreshed: 2026-05-17 by Tuvok (request from Cyrus).
> Catalog source: Copilot CLI `task` tool model enum, 2026-05-17.
> Configuration source: `.squad/config.json` (per-agent overrides).
> Governance source: `.github/agents/squad.agent.md` § Per-Agent Model Selection (selection algorithm).

## Why this doc exists

The coordinator picks a model per spawn from a four-layer hierarchy. This page is the human-readable reference: what's available, what each model specializes in, and which squad member should use which model. Keep it current when the CLI catalog rotates.

---

## 1. Selection algorithm (4 layers — first match wins)

Per `.github/agents/squad.agent.md` § Per-Agent Model Selection:

| Layer | Source | Scope | How to set |
|-------|--------|-------|------------|
| **0** | `.squad/config.json` (`agentModelOverrides.{agent}` or `defaultModel`) | Persists across sessions | Write to config; survives restarts |
| **1** | Session directive | Current session only | User says "use opus this session" |
| **2** | Charter preference | Agent-specific | `## Model` section in agent's charter |
| **3** | Task-aware auto-select | Per-spawn | Coordinator applies cost-first principle |
| **4** | Default | Fallback | `claude-haiku-4.5` — cost wins when in doubt |

**Cost-first principle (Layer 3):** Non-code work → Haiku. Code generation → Sonnet. Heavy multi-file refactors → Codex specialist. Architecture / governance review → Premium. Vision work → `claude-opus-4.5` (only vision-capable model in catalog; non-negotiable).

**Fallback chains** (silent; max 3 retries before nuclear fallback):

```
Premium:  claude-opus-4.6 → claude-opus-4.5 → claude-sonnet-4.6 → claude-sonnet-4.5 → (omit model)
Standard: claude-sonnet-4.6 → claude-sonnet-4.5 → gpt-5.4 → gpt-5.3-codex → (omit model)
Fast:     claude-haiku-4.5 → gpt-5.4-mini → (omit model)
```

`(omit model)` = call `task` without the `model` parameter — platform default; always works.

---

## 2. Model catalog

> ⚠️ **Catalog vs. governance gap:** `.github/agents/squad.agent.md` lines 451–453 list an older catalog: `claude-opus-4.6` as the top Premium tier, plus `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1`, `gpt-5.1-codex-mini`, and `gemini-3-pro-preview`. None of these appear in the `task` tool's current `model` enum; the opus-4.7 family is absent entirely. The tables below reflect the **CLI tool's actual enum** as ground truth. The squad.agent.md catalog is out of date — flag for maintainer on next governance pass. **Do not change squad.agent.md here; it is maintainer-authored.**

### Premium tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-opus-4.7` | Standard | Advanced reasoning; architecture proposals | Top-tier reasoning; nuanced trade-offs | Highest cost | 💰💰💰 |
| `claude-opus-4.7-1m-internal` | **1M** (internal-only) | Long-context governance; multi-file artifact review | Entire codebase + artifact tree in one pass; no chunking | Highest cost; internal-only | 💰💰💰 |
| `claude-opus-4.7-high` | Standard (internal-only) | Hard problems needing extended reasoning | Extra thinking cycles; better on adversarial prompts | Internal-only; slower | 💰💰💰 |
| `claude-opus-4.7-xhigh` | Standard (internal-only) | Maximum reasoning depth | Deepest analysis in catalog | Internal-only; slowest | 💰💰💰 |
| `claude-opus-4.6` | Standard | General-purpose premium (fallback) | Reliable; well-tested | Older gen; prefer 4.7 variants | 💰💰💰 |
| `claude-opus-4.6-1m` | 1M (internal-only) | Long-context (older gen) | Handles massive input | Older gen; prefer 4.7-1m | 💰💰💰 |
| `claude-opus-4.5` | Standard | Vision + reasoning | Only model in enum capable of image/diagram analysis | Vision is the sole reason to choose over 4.7; non-negotiable for visual tasks | 💰💰💰 |

**Call-outs:**

- **`claude-opus-4.7-1m-internal`** — The 1M window is the specific value-add. Picard's 105-turn session `06e05633` is the canonical evidence: full constitution + plan + spec tree loaded in one pass without chunking; cross-document coherence preserved throughout. Standard-window models require chunking that loses that coherence on governance reviews. That use case alone justifies the override for Picard and Kirk.
- **`claude-opus-4.7-high` / `claude-opus-4.7-xhigh`** — Untested in this repo. Documented strengths: extended reasoning for hard problems. Not yet measured locally. Reserve for adversarial security reviews or architecture decisions where reasoning depth matters more than speed.

### Standard tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-sonnet-4.6` | Standard | **Platform default** · code review · general agent work | Excellent cost/quality balance; reliable for all code work | Slightly slower than GPT-5.x | 💰💰 |
| `claude-sonnet-4.5` | Standard | Code quality (older gen fallback) | Proven; stable | Older gen; prefer 4.6 | 💰💰 |
| `gpt-5.5` | Standard | General-purpose · current Scotty override | Latest OpenAI general model; strong code + prose | Context window unverified locally; no local benchmark yet | 💰💰 |
| `gpt-5.4` | Standard | General-purpose (mature release) | Reliable; solid code + analysis | Older than 5.5 | 💰💰 |
| `gpt-5.3-codex` | Standard | **Heavy code generation specialist** | 500+ LOC multi-file refactors; complex algorithms; purpose-built for code gen | Weaker on architectural framing and prose; not ideal for non-code tasks | 💰💰 |
| `gpt-5.2-codex` | Standard | Code generation (older gen) | Multi-file code work; lower cost than 5.3 | Older; prefer 5.3-codex | 💰💰 |
| `gpt-5.2` | Standard | General-purpose (older gen) | Cost-effective | Older; prefer 5.4 or 5.5 | 💰💰 |

**Call-outs:**

- **`gpt-5.5` (current Scotty override)** — Set in `.squad/config.json` directly; no decisions.md entry documents the rationale for switching from `gpt-5.3-codex`. The prior doc (2026-05-16) recommended codex for heavy refactors. `gpt-5.5` is a reasonable broader choice if Scotty's workload has shifted toward mixed code + prose tasks, but no local benchmark confirms the improvement. See Open Questions §3.
- **`gpt-5.3-codex` / `gpt-5.2-codex`** — Code-gen specialists. Great at producing large, syntactically correct TypeScript. Trade-off: weaker at the architectural framing narrative that reviewers (Kirk, Garak) expect in PRs. Best paired with a reasoning-capable review pass.

### Fast / cheap tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-haiku-4.5` | Standard | **Scribe's permanent home** · mechanical ops · docs · git plumbing | Cheapest Claude; fast; adequate for all pattern-matching work | Limited reasoning depth; not for design or review | 💰 |
| `gpt-5.4-mini` | Standard | Fast general-purpose | Quick, cheap alternative to full models | Reduced capability vs full models | 💰 |
| `gpt-5-mini` | Standard | Fast general (older gen) | Cost-efficient | Older; prefer 5.4-mini | 💰 |
| `gpt-4.1` | Standard | Nuclear fallback only | Always available | Slow; outdated | 💰 |

**Call-outs:**

- **`claude-haiku-4.5`** — Scribe's permanent model. Mechanical file ops, append-only writes, JSON manipulation, git commits. **Never bump.** Cost constraint is non-negotiable: Scribe runs on every session boundary; accumulating sonnet-class cost here compounds rapidly.
- **`gemini-3-pro-preview`** — Listed in `.github/agents/squad.agent.md` line 452 as a Standard-tier model for "analytical diversity for code reviews after a rejection." **NOT present in the current `task` tool enum. Cannot be dispatched.** Recommend removing this reference from squad.agent.md on the next maintainer governance pass, replacing with available cross-provider options (`gpt-5.5`, `gpt-5.4`). Out of scope for this doc to fix.

---

## 3. Per-squad-member recommendations

### Picard — M2 / Engineering Manager

**Current model:** `claude-opus-4.7-1m-internal` (Layer 0 config override)
**Workload mix:** Scope and governance reviews; speckit chain integrity; constitution review; triage; long multi-file artifact reads.
**Recommendation:** `claude-opus-4.7-1m-internal` — **unchanged**
**Why:**
- Session `06e05633` (105 turns) is the evidence base: full constitution + plan + spec tree read in a single pass. The 1M window is what makes that coherent. Standard-window models require chunking; chunked governance reviews lose cross-document consistency.
- Governance and scope reviews require premium reasoning depth. No cheaper substitute without measurable quality loss.

**Override when:** Routine triage with no multi-document reads → `claude-haiku-4.5` is safe for that spawn. Reinstate 1m-internal for any constitution or multi-artifact review session.

---

### Kirk — Lead (technical)

**Current model:** `claude-opus-4.7-1m-internal` (Layer 0 config override)
**Workload mix:** Architecture proposals; technical code reviews; cross-cutting design decisions; PR approvals.
**Recommendation:** `claude-opus-4.7-1m-internal` — **unchanged** (see override condition)
**Why:**
- Kirk's APPROVE/CHANGES_REQUESTED carries merge authority under Rule 7. A cheaper model on a consequential review is a governance risk.
- Architecture reviews that span multiple files, diffs, and contracts benefit from the 1M window for the same reasons as Picard's governance work.

**Override when:** Single-file code reviews with narrow scope → `claude-sonnet-4.6` is sufficient and cheaper. Reserve 1m-internal for architecture reviews, multi-file diffs, or post-rejection re-reviews.

---

### Scotty — Core Dev

**Current model:** `gpt-5.5` (Layer 0 config override)
**Workload mix:** TypeScript CLI implementation; multi-file refactors; workflow YAML; test scaffolding.
**Recommendation:** `gpt-5.5` — **unchanged pending Cyrus confirmation** (see Open Questions §3)
**Why:**
- `gpt-5.5` is the latest general-purpose OpenAI model and a plausible upgrade from `gpt-5.3-codex`.
- No decisions.md entry documents why the switch was made. No local benchmark confirms `gpt-5.5` outperforms `gpt-5.3-codex` on heavy TypeScript refactors — the core of Scotty's workload.

**Override when:** 500+ LOC single-purpose code-gen tasks → `gpt-5.3-codex` may still outperform on pure code volume. Recommended: compare on the next large Scotty task before treating gpt-5.5 as permanent.

---

### Uhura — Integrations Dev

**Current model:** `claude-opus-4.7-1m-internal` (Layer 0 config override)
**Workload mix:** Discord API integration; STFC store API; webhook handling; multi-file integration code.
**Recommendation:** Downgrade to `claude-sonnet-4.6` for standard tasks; reinstate 1m-internal via session directive for explicit cross-API multi-file reads.
**Why:**
- Most of Uhura's work is targeted integration code — writing adapters, handling HTTP responses, wiring webhooks. `claude-sonnet-4.6` is the code-quality standard and costs significantly less.
- The 1M window justification for Picard and Kirk is specific: loading entire governance artifact trees. Uhura's tasks rarely require ingesting the full artifact tree simultaneously. Applying the same override by default is cost without proportionate value.

**Override when:** A session explicitly requires reading discord.com API docs + STFC API specs + integration contracts together → reinstate 1m-internal for that session via directive.

---

### Bashir — Tester

**Current model:** Auto (no Layer 0 override) → task-aware auto → `claude-sonnet-4.6` for code tasks
**Workload mix:** Test authorship under Principle IX (test-first); edge-case coverage; integration test scaffolding.
**Recommendation:** No override; leave at task-aware auto
**Why:**
- Tests are executable specifications under Principle IX. Quality matters as much as for production code; `claude-sonnet-4.6` is the right default.
- No evidence Bashir's workload needs premium reasoning or specialist code-gen volume. Adding a codex override would help LOC output but not behavioral-coverage reasoning.

**Override when:** A session produces 500+ LOC of boilerplate test scaffolding → `gpt-5.3-codex` for that spawn only, then back to auto.

---

### Garak — Critic

**Current model:** Auto (no Layer 0 override)
**Workload mix:** Hostile code reviews; security reviews; governance reviews; post-rejection architecture critiques.
**Recommendation:** No fixed override; task-aware per-spawn selection
**Why:**
- Garak's authority derives partly from analytical independence. A fixed override to the same model family as Kirk reduces cross-family diversity on joint reviews — exactly the kind of diversity the squad.agent.md `gemini-3-pro-preview` recommendation was trying to preserve (that model is now unavailable).
- Standard code reviews → `claude-sonnet-4.6`. High-stakes security/governance → `claude-opus-4.7-high`. Cross-provider diversity passes → `gpt-5.5` or `gpt-5.4` (dispatch Garak on an OpenAI model when Kirk has already reviewed on Anthropic).

**Override when:** Any review where Kirk has already approved → dispatch Garak on `gpt-5.5` or `gpt-5.4` via session directive for family diversity. Never add a permanent override — this must stay flexible.

---

### Tuvok — Process Auditor / Editorial Specialist

**Current model:** Auto (no Layer 0 override)
**Workload mix:** (a) Surgical governance edits, cross-reference checks, table updates — mechanical; (b) Agent prompt authorship, amendment audit memos, doc refreshes — require coherent prose and editorial judgment.
**Recommendation:** Task-aware split — no single override
**Why:**
- Mechanical work (cross-ref grepping, table updates, surgical line edits) → `claude-haiku-4.5`. Adequate; cheapest.
- Editorial work (agent prompts, amendment audit memos, this doc) → `claude-sonnet-4.6`. Agent prompts are executable text; sub-sonnet quality risks behavioral regression. Amendment audits require reasoning through cross-artifact consistency.
- A fixed sonnet override wastes cost on mechanical sessions. A fixed haiku override produces lower-quality agent prompts and audit memos.

**Override when:** Task is unambiguously mechanical → explicit `claude-haiku-4.5` session directive. Task involves authoring executable text or governance artifacts → explicit `claude-sonnet-4.6` directive.

---

### Scribe — Session Logger

**Current model:** Auto → `claude-haiku-4.5` (Layer 3 default / charter preference)
**Workload mix:** history.md appends; decisions/inbox writes; JSON manipulation; git commits; log compaction.
**Recommendation:** `claude-haiku-4.5` — **permanent; never bump**
**Why:**
- Scribe runs on every session boundary. Accumulating sonnet or opus cost here compounds rapidly with no quality benefit.
- Scribe's entire workload is pattern-matching and file manipulation — no judgment calls, no reasoning required. Haiku is not a compromise; it is the correct tool for this work.

**Override when:** Never. If a Scribe session seems to require more reasoning, the task has been mis-routed. Re-route to the appropriate agent.

---

### Ralph — Work Monitor

**Current model:** N/A (Ralph is not dispatched via `task` tool — work-monitor pattern)
**Workload mix:** Issue/PR list scanning; label routing; triage comments; digest summaries.
**Recommendation:** N/A for current pattern. If Ralph ever becomes spawnable for batch ops → `claude-haiku-4.5` (cost-first; workload is mechanical scanning).
**Why:** Ralph's current pattern does not use the `task` tool dispatch path. Model selection is not applicable. If spawnable batch ops are added, the workload profile is identical to Scribe — haiku is the right default, sonnet only for rare synthesis tasks.

---

## 4. Accepted changes to `.squad/config.json`

Cyrus reviewed § 5 open questions on 2026-05-17. Applied changes:

```json
{
  "version": 1,
  "worktrees": true,
  "agentModelOverrides": {
    "picard": "claude-opus-4.7-1m-internal",  // unchanged — long-context governance work
    "kirk":   "claude-opus-4.7-1m-internal",  // unchanged in config; scoping rule deferred to issue #21
    "uhura":  "claude-sonnet-4.6",             // CHANGED from 1m-internal — standard integration work
    "scotty": "gpt-5.3-codex",                 // CHANGED from gpt-5.5 — code specialist for code role
    "garak":  "gpt-5.5"                        // NEW — cross-provider diversity for hostile fact-check
  }
}
```

**Per-decision rationale:**
- **Uhura → sonnet-4.6:** Integration code rarely needs 1M context. Reinstate per-session when explicitly required.
- **Kirk:** Config unchanged. Scoping rule (opus-1m for architecture / sonnet-4.6 for narrow review) tracked in issue #21 — codifies behavior at the coordinator level.
- **Scotty → gpt-5.3-codex:** Code-specialist model for code-writing role. Replaces the unanchored gpt-5.5 override; rationale now captured in decisions ledger.
- **Garak → gpt-5.5:** New override. Cross-provider diversity from Claude-heavy reviewers. Replaces the `gemini-3-pro-preview` recommendation that's no longer in the CLI catalog.

---

## 5. Open questions for Cyrus — RESOLVED 2026-05-17

| # | Question | Decision |
|---|---|---|
| 1 | Accept Uhura downgrade? | **Accept** — sonnet-4.6 |
| 2 | Kirk always-on vs scoped? | **Scoped** — tracked in issue #21 |
| 3 | Scotty gpt-5.5 rationale? | **Switch to gpt-5.3-codex** (code specialist) |
| 4 | Garak diversity model? | **gpt-5.5** (Claude-family alternative) |
| 5 | squad.agent.md drift? | **File issue** — tracked as #21 |

All resolutions captured in `.squad/decisions.md` (via inbox → Scribe merge).

---

## Maintenance

Refresh when the `task` tool's model enum changes. Checklist:

1. Compare table entries against the current `task` tool model parameter values.
2. Confirm `internal-only` markers (periodically promoted to general availability).
3. Update per-member recommendations if workload mix has shifted.
4. Update "Last refreshed" date at the top.
5. Drop a decisions/inbox entry for the session.

---

## See also

- [docs/squad.md](squad.md) — Squad roster and roles
- [.github/agents/squad.agent.md](../.github/agents/squad.agent.md) — Coordinator rules and model-selection implementation
- [.squad/config.json](../.squad/config.json) — Active per-agent overrides
