# Copilot CLI Model Catalog

> Last refreshed: 2026-05-16 by Tuvok via `/chronicle` request.
> Source: GitHub Copilot CLI `task` tool model parameter catalog.
> Recommendations derive from the coordinator's per-agent model
> selection rules (see `.github/agents/squad.agent.md`).

## Why this doc exists

The squad's coordinator picks a model per spawn from a four-layer hierarchy: persistent config (`.squad/config.json`) → session directive → charter preference → task-aware auto-select. This page is the human-readable reference for what's available, what each specializes in, and what fits whom.

---

## Model catalog — by tier

### Premium tier (best reasoning, most capable)

| Model ID | Provider | Context | Speciality | Pros | Cons |
|----------|----------|---------|------------|------|------|
| `claude-opus-4.7` | Anthropic | standard | Advanced reasoning & analysis | Top-tier reasoning for complex problems; handles nuanced trade-offs | Highest cost |
| `claude-opus-4.7-1m-internal` | Anthropic | 1M (internal) | Advanced reasoning + long context | Can process entire large codebases in one pass; internal-only | Highest cost; availability limited |
| `claude-opus-4.7-high` | Anthropic | standard, high reasoning (internal) | Extended reasoning mode | Extra thinking cycles; improves on hard problems | High cost; internal-only; slower |
| `claude-opus-4.7-xhigh` | Anthropic | standard, extra-high reasoning (internal) | Maximum reasoning depth | Deepest analysis available for hardest problems | Highest cost; internal-only; slowest |
| `claude-opus-4.6` | Anthropic | standard | General-purpose premium | Reliable, well-tested; good fallback from newer versions | Older generation; retiring soon |
| `claude-opus-4.6-1m` | Anthropic | 1M (internal) | Long-context premium | Handles massive input without summarization | Highest cost; internal-only; availability limited |
| `claude-opus-4.5` | Anthropic | standard, vision-capable | **Vision + reasoning** (only vision model in rotation) | Only model that can analyze images/diagrams; strong reasoning | Vision is non-negotiable; never downgrade |

### Standard tier (quality code + general-purpose)

| Model ID | Provider | Speciality | Pros | Cons |
|----------|----------|------------|------|------|
| `claude-sonnet-4.6` | Anthropic | Platform default, code quality | Excellent balance of cost & quality; reliable for all code work | Slightly slower than GPT-5.x |
| `claude-sonnet-4.5` | Anthropic | Code quality | Proven track record; fallback choice | Older generation; being phased out |
| `gpt-5.5` | OpenAI | General-purpose | Latest OpenAI model; strong all-rounder | Context window context: standard; verify with platform docs |
| `gpt-5.4` | OpenAI | General-purpose | Solid code + analysis quality | Mature release; reliable | Older than 5.5 |
| `gpt-5.3-codex` | OpenAI | **Heavy code generation specialist** | 500+ LOC refactors, multi-file impl, complex algorithms | Designed for code generation; excellent for large changes | Narrower domain; not ideal for non-code tasks |
| `gpt-5.2-codex` | OpenAI | Code specialist (older) | Multi-file code work | Proven for code; lower cost than 5.3 | Older generation; 5.3-codex preferred |
| `gpt-5.2` | OpenAI | General-purpose (older) | Code + planning + triage | Cost-effective general-purpose | Older; use GPT-5.4 if possible |

### Fast / cheap tier (docs, mechanics, triage)

| Model ID | Provider | Speciality | Pros | Cons |
|----------|----------|------------|------|------|
| `claude-haiku-4.5` | Anthropic | Mechanical ops, docs, triage | Cheapest Claude; fast turnaround; ideal for non-code | Limited reasoning depth; not for complex design |
| `gpt-5.4-mini` | OpenAI | Fast general-purpose | Quick, cheap alternative to full models | Reduced context window; limited capability |
| `gpt-5-mini` | OpenAI | Fast general (older) | Cost-efficient option | Older; use gpt-5.4-mini | if possible |
| `gpt-4.1` | OpenAI | Nuclear fallback | Used only when everything else is unavailable | Slow; outdated; last resort only |

---

## Selection rules (TL;DR)

**Cost-first principle** — with exceptions for code quality:

- **Writing code** (implementation, refactoring, test code, bug fixes) → `claude-sonnet-4.6` (quality first)
- **Heavy multi-file refactors** (500+ LOC) → `gpt-5.3-codex` (specialist)
- **Vision/design work** → `claude-opus-4.5` only (non-negotiable; only model with vision)
- **Non-code** (docs, planning, triage, logs, changelogs, mechanical ops) → `claude-haiku-4.5` (cost first)
- **Architecture proposals** → bump to premium (`claude-opus-4.7` or `-high`)
- **Security/reviewer gates** → bump to premium or analytical diversity
- **Never bump Scribe or git/release roles** — mechanical ops stay cheap

---

## Per-squad-member recommendations

### 🧭 Picard — M2 / Engineering Manager (boss)

- **Default:** `claude-opus-4.7-1m-internal`
- **For scope/governance reviews + speckit chain integrity:** `claude-opus-4.7` (or `-high`)
- **For routine triage / planning:** `claude-haiku-4.5`
- **Why:** governance work spans long constitution + spec + plan documents; 1M context window pays off. Downgrade only for cheap triage.

### 🏗️ Kirk — Lead (technical)

- **Default:** `claude-opus-4.7-1m-internal`
- **For architecture proposals:** `claude-opus-4.7` (or `-high` if available)
- **For code review (standard technical correctness):** `claude-sonnet-4.6`
- **For exploratory technical research:** `claude-haiku-4.5`
- **Why:** architectural decisions and cross-cutting technical reviews benefit from premium reasoning + 1M context; downgrade only when scope is narrow.

### 🔧 Scotty — Core Dev

- **Default:** `claude-sonnet-4.6`
- **For heavy multi-file refactors:** `gpt-5.3-codex`
- **For exploratory work (no code yet):** `claude-haiku-4.5`
- **Why:** writes TypeScript CLI code; quality first; downgrade only when not yet writing code

### 🔧 Uhura — Integrations Dev

- **Default:** `claude-sonnet-4.6`
- **For exploratory API research (reading specs, no implementation):** `claude-haiku-4.5`
- **For heavy integration refactors:** `gpt-5.3-codex`
- **Why:** writes Discord & STFC API code; quality first; downgrade only when pure research

### 🧪 Bashir — Tester

- **Default:** `claude-sonnet-4.6`
- **For simple test scaffolding:** `claude-haiku-4.5`
- **For complex edge-case coverage:** `claude-sonnet-4.6` (stay here; tests are executable specs)
- **Why:** writes test code under Principle IX (test-first); quality matters because tests define behavior

### 🔒 Borg Queen — Critic

- **Default:** auto (per-task)
- **For standard code review:** `claude-sonnet-4.6`
- **For high-stakes security/governance reviews:** `claude-opus-4.7-high` (deep reasoning)
- **For architectural review after rejection:** `claude-opus-4.5` (analytical diversity; vision bonus)
- **Why:** reviewer authority; quality on rejection cases warrants premium; high reasoning helps surface risks

### 📝 Tuvok — Process Auditor / Editorial Specialist

- **Default:** `claude-haiku-4.5`
- **Override:** never
- **Why:** docs + audit + cross-artifact consistency checks; pattern-matching is cheap; reasoning budget better spent elsewhere

### 📋 Scribe — Session Logger

- **Default:** `claude-haiku-4.5`
- **Override:** NEVER — mechanical file ops stay cheap; cost is non-negotiable
- **Why:** file merging, deduplication, JSON manipulation, git plumbing, history-keeping — pattern recognition over reasoning

### 🔄 Ralph — Work Monitor

- **Default:** `claude-haiku-4.5`
- **For deeper PR review synthesis (rare):** `claude-sonnet-4.6`
- **Why:** mostly issue/PR list scanning, label routing, brief comments — fast/cheap fits the workload

### 🤖 @copilot (GitHub Copilot platform, not `task` dispatch)

- **Note:** Not dispatched via `task` tool. Uses GitHub Copilot platform default. Out of scope here.

---

## How the coordinator picks (4-layer hierarchy)

The model selection follows a waterfall of sources; the first match wins:

1. **Layer 0 — Persistent Config** (`.squad/config.json`): Highest priority. User has set `defaultModel` or `agentModelOverrides.{agent}` to survive across sessions.
2. **Layer 1 — Session Directive:** User specified a model for this session ("use opus this session", "save costs").
3. **Layer 2 — Charter Preference:** Agent's charter has a `## Model` section naming a specific model (not `auto`).
4. **Layer 3 — Task-Aware Auto-Select:** Cost-first principle applied: non-code → Haiku, code → Sonnet, vision → Opus-4.5, heavy code gen → Codex.
5. **Layer 4 — Default:** `claude-haiku-4.5` (cost wins when in doubt).

If a model is unavailable (deprecation, org policy, rate limit), the coordinator retries up the fallback chain:
- **Premium chain:** `claude-opus-4.6` → `claude-opus-4.5` → `claude-sonnet-4.6` → `claude-sonnet-4.5` → (omit-model)
- **Standard chain:** `claude-sonnet-4.6` → `claude-sonnet-4.5` → `gpt-5.4` → `gpt-5.3-codex` → (omit-model)
- **Fast chain:** `claude-haiku-4.5` → `gpt-5.4-mini` → (omit-model)
- **(omit-model)** = use platform default (nuclear fallback; always works)

---

## Saving a preference

Users can adjust model selection three ways:

### "Always use X for everything"
Coordinator writes `defaultModel: "model-id"` to `.squad/config.json`. Persists across all sessions.

```bash
✅ Model preference saved: claude-opus-4.7 — all future sessions will use this until changed.
```

### "Always use X for {agent}"
Coordinator writes `agentModelOverrides.{agent}: "model-id"` to `.squad/config.json`. That agent always uses the override; others use default.

```bash
✅ Scotty will always use gpt-5.3-codex — saved to config.
```

### "Switch back to automatic"
Coordinator removes `defaultModel` and `agentModelOverrides` from `.squad/config.json`. Returns to Layer 1–4 (task-aware auto-select).

```bash
✅ Model preference cleared — returning to automatic selection.
```

---

## Maintenance

This catalog drifts as Copilot rotates models. To refresh:

1. Compare table entries against the current `task` tool documentation (model parameter values)
2. Confirm `internal-only` markers are still accurate (periodically promoted to general availability)
3. Update the "Last refreshed" date at the top
4. Note in the commit message any new/removed/promoted models and context changes

---

## See also

- [docs/squad.md](squad.md) — Squad roster and roles
- [.github/agents/squad.agent.md](../.github/agents/squad.agent.md) — Coordinator rules and model-selection implementation details
