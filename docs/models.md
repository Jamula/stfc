# Squad model selection — catalog & recommendations

> Last refreshed: 2026-08-20.
> Catalog source: Copilot CLI `task` tool model enum, 2026-08-20.
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

**Cost-first principle (Layer 3):** Non-code work → Haiku. Code generation → Sonnet. Heavy multi-file refactors → latest GPT. Architecture / governance review → Premium. Vision work → latest Opus.

**Fallback chains** (silent; max 3 retries before nuclear fallback):

```
Premium:  claude-opus-5 → claude-opus-4.8 → claude-opus-4.7 → claude-opus-4.6 → claude-sonnet-5 → (omit model)
Standard: claude-sonnet-5 → claude-sonnet-4.6 → gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna → gpt-5.5 → gpt-5.4 → gpt-5.3-codex → (omit model)
Fast:     claude-haiku-4.5 → gpt-5.4-mini → gpt-5-mini → (omit model)
```

`(omit model)` = call `task` without the `model` parameter — platform default; always works.

---

## 2. Model catalog

> ✅ **Catalog aligned:** As of PR #39, `.github/agents/squad.agent.md` lists the same model catalog as the CLI `task` tool enum. The tables below match both sources.

### Premium tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-opus-5` | Standard or long context | Advanced reasoning; architecture proposals | Latest Opus; supports the largest selectable context tier | Highest cost | 💰💰💰 |
| `claude-opus-4.8` | Standard or long context | Premium fallback | Strong reasoning and vision | Older generation | 💰💰💰 |
| `claude-opus-4.7` | Standard or long context | Premium fallback | Nuanced trade-offs | Older generation | 💰💰💰 |
| `claude-opus-4.6` | Standard or long context | Premium fallback | Reliable; well-tested | Older generation | 💰💰💰 |

**Call-outs:**

- **`claude-opus-5` + `long_context`** — Picard and Kirk retain premium reasoning and large-document coherence without relying on an internal model variant. Reasoning effort remains a separate session parameter.

### Standard tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-sonnet-5` | Standard or long context | Code review · general agent work | Latest Sonnet; excellent cost/quality balance | Less reasoning depth than Opus | 💰💰 |
| `claude-sonnet-4.6` | Standard or long context | Sonnet fallback | Proven and reliable | Older generation | 💰💰 |
| `gpt-5.6-sol` | Standard or long context | Current Scotty and Garak override | Latest GPT family; strong code and analysis | No local benchmark yet | 💰💰 |
| `gpt-5.6-terra` | Standard or long context | GPT fallback | Current-generation alternative | No local benchmark yet | 💰💰 |
| `gpt-5.6-luna` | Standard or long context | GPT fallback | Current-generation alternative | No local benchmark yet | 💰💰 |
| `gpt-5.5` | Standard or long context | General-purpose fallback | Strong code and prose | Older generation | 💰💰 |
| `gpt-5.4` | Standard or long context | General-purpose fallback | Reliable | Older generation | 💰💰 |
| `gpt-5.3-codex` | Standard | Legacy code specialist fallback | Purpose-built for code generation | Older generation; no long-context tier | 💰💰 |

**Call-outs:**

- **`gpt-5.6-sol`** — Current family-preserving upgrade for Scotty and Garak. It keeps GPT-family diversity while adding the `long_context` tier.

### Fast / cheap tier

| Model | Window | Best for | Pros | Cons | Cost |
|-------|--------|----------|------|------|------|
| `claude-haiku-4.5` | Standard | **Scribe's permanent home** · mechanical ops · docs · git plumbing | Cheapest Claude; fast; adequate for all pattern-matching work | Limited reasoning depth; not for design or review | 💰 |
| `gpt-5.4-mini` | Standard | Fast general-purpose | Quick, cheap alternative to full models | Reduced capability vs full models | 💰 |
| `gpt-5-mini` | Standard | Fast general (older gen) | Cost-efficient | Older; prefer 5.4-mini | 💰 |
| `gpt-4.1` | Standard | Nuclear fallback only | Always available | Slow; outdated | 💰 |

**Call-outs:**

- **`claude-haiku-4.5`** — Scribe's permanent model. Mechanical file ops, append-only writes, JSON manipulation, git commits. **Never bump.** Cost constraint is non-negotiable: Scribe runs on every session boundary; accumulating sonnet-class cost here compounds rapidly.

---

## 3. Per-squad-member recommendations

### Picard — M2 / Engineering Manager

**Current model:** `claude-opus-5` with `long_context` (Layer 0 config override)
**Workload mix:** Scope and governance reviews; constitution review; triage; long multi-file artifact reads.
**Recommendation:** `claude-opus-5` with `long_context`
**Why:**
- Session `06e05633` (105 turns) is the evidence base: full constitution + plan + spec tree read in a single pass. Long context is what makes that coherent; chunked governance reviews lose cross-document consistency.
- Governance and scope reviews require premium reasoning depth. No cheaper substitute without measurable quality loss.

**Override when:** Routine triage with no multi-document reads → `claude-haiku-4.5` is safe for that spawn.

---

### Kirk — Lead (technical)

**Current model:** `claude-opus-5` with `long_context` (Layer 0 config override)
**Workload mix:** Architecture proposals; technical code reviews; cross-cutting design decisions; PR approvals.
**Recommendation:** `claude-opus-5` with `long_context`
**Why:**
- Kirk's APPROVE/CHANGES_REQUESTED carries merge authority under Rule 7. A cheaper model on a consequential review is a governance risk.
- Architecture reviews that span multiple files, diffs, and contracts benefit from long context for the same reasons as Picard's governance work.

**Override when:** Single-file code reviews with narrow scope → `claude-sonnet-5` is sufficient and cheaper.

---

### Scotty — Core Dev

**Current model:** `gpt-5.6-sol` with `long_context` (Layer 0 config override)
**Workload mix:** TypeScript CLI implementation; multi-file refactors; workflow YAML; test scaffolding.
**Recommendation:** `gpt-5.6-sol`
**Why:**
- Latest GPT model for a code-writing role with strong reasoning and tool use across heavy TypeScript refactors.
- Preserves the GPT family while moving to the latest available version and context tier.

**Override when:** None by default; use `gpt-5.3-codex` only if a measured code-generation regression justifies the older specialist.

---

### Uhura — Integrations Dev

**Current model:** `claude-sonnet-5` with `long_context` (Layer 0 config override)
**Workload mix:** Discord API integration; STFC store API; webhook handling; multi-file integration code.
**Recommendation:** `claude-sonnet-5`
**Why:**
- Most of Uhura's work is targeted integration code — writing adapters, handling HTTP responses, wiring webhooks. `claude-sonnet-5` is the current code-quality standard.
- Long context lets Uhura keep integration specifications and implementation code together when needed.

**Override when:** Narrow, single-file work may use the default context tier to reduce cost.

---

### Bashir — Tester

**Current model:** Auto (no Layer 0 override) → task-aware auto → `claude-sonnet-5` for code tasks
**Workload mix:** Test authorship under Principle IX (test-first); edge-case coverage; integration test scaffolding.
**Recommendation:** No override; leave at task-aware auto
**Why:**
- Tests are executable specifications under Principle IX. Quality matters as much as for production code; `claude-sonnet-5` is the right default.
- No evidence Bashir's workload needs premium reasoning or specialist code-gen volume. Adding a codex override would help LOC output but not behavioral-coverage reasoning.

**Override when:** A session produces 500+ LOC of boilerplate test scaffolding → `gpt-5.6-sol` for that spawn only, then back to auto.

---

### Garak — Critic

**Current model:** `gpt-5.6-sol` with `long_context` (Layer 0 config override)
**Workload mix:** Hostile code reviews; security reviews; governance reviews; post-rejection architecture critiques.
**Recommendation:** `gpt-5.6-sol`
**Why:**
- Garak's authority derives partly from analytical independence. The GPT override preserves cross-family diversity when Kirk reviews on Anthropic.
- Standard code reviews use `gpt-5.6-sol`; high-stakes reviews can raise reasoning effort without changing model family.

**Override when:** A second non-GPT perspective is explicitly required.

---

### Tuvok — Process Auditor / Editorial Specialist

**Current model:** Auto (no Layer 0 override)
**Workload mix:** (a) Surgical governance edits, cross-reference checks, table updates — mechanical; (b) Agent prompt authorship, amendment audit memos, doc refreshes — require coherent prose and editorial judgment.
**Recommendation:** Task-aware split — no single override
**Why:**
- Mechanical work (cross-ref grepping, table updates, surgical line edits) → `claude-haiku-4.5`. Adequate; cheapest.
- Editorial work (agent prompts, amendment audit memos, this doc) → `claude-sonnet-5`. Agent prompts are executable text; sub-sonnet quality risks behavioral regression. Amendment audits require reasoning through cross-artifact consistency.
- A fixed sonnet override wastes cost on mechanical sessions. A fixed haiku override produces lower-quality agent prompts and audit memos.

**Override when:** Task is unambiguously mechanical → explicit `claude-haiku-4.5` session directive. Task involves authoring executable text or governance artifacts → explicit `claude-sonnet-5` directive.

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

**Current model:** `claude-sonnet-5` when dispatched
**Workload mix:** Issue/PR list scanning; label routing; triage comments; digest summaries.
**Recommendation:** `claude-sonnet-5`; use Haiku only for purely mechanical scans.
**Why:** Ralph performs structured polling and dispatch with moderate routing reasoning.

---

## 4. Accepted changes to `.squad/config.json`

Cyrus reviewed § 5 open questions on 2026-05-17. Applied changes:

```json
{
  "version": 1,
  "worktrees": true,
  "agentModelOverrides": {
    "picard": "claude-opus-5",
    "kirk":   "claude-opus-5",
    "uhura":  "claude-sonnet-5",
    "scotty": "gpt-5.6-sol",
    "garak":  "gpt-5.6-sol"
  },
  "defaultContextTier": "long_context"
}
```

**Per-decision rationale:**
- **Picard/Kirk → Opus 5:** Latest Opus family with long context for governance and architecture.
- **Uhura → Sonnet 5:** Latest Sonnet family for integration code.
- **Scotty/Garak → GPT-5.6 Sol:** Latest GPT family while preserving coding and cross-provider intent.
- **Context → `long_context`:** Largest selectable window by default; unsupported models clamp to their available tier.

---

## 5. Historical decisions — superseded 2026-08-20

These 2026-05-17 decisions explain the prior configuration and are retained as historical context. Section 4 is authoritative.

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
