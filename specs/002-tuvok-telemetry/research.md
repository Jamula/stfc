# Research: Tuvok Token-Usage Telemetry

**Feature**: 002-tuvok-telemetry  
**Date**: 2026-05-17  
**Status**: Complete

## R-001: Cloud Session Store Data Shape

**Question**: What fields are available in the session store's `events` table for token-usage telemetry?

**Finding**: The `events` table contains `assistant.usage` event rows with the following usage columns:

| Column | Type | Notes |
|--------|------|-------|
| `usage_model` | VARCHAR | Model identifier, e.g. `claude-opus-4.6`, `gpt-5.4-mini` |
| `usage_input_tokens` | DOUBLE | Input tokens consumed |
| `usage_output_tokens` | DOUBLE | Output tokens produced |
| `usage_cache_read_tokens` | DOUBLE | Cache-hit tokens (may be 0) |
| `usage_cache_write_tokens` | DOUBLE | Cache-write tokens |
| `usage_cost` | DOUBLE | Platform-reported cost units |
| `usage_duration` | DOUBLE | Duration in milliseconds |
| `usage_initiator` | VARCHAR | What initiated the usage |
| `usage_api_call_id` | VARCHAR | Per-API-call identifier |
| `usage_provider_call_id` | VARCHAR | Provider-side call identifier |

Contextual columns available on the same event row:
- `session_id` — links to `sessions.id`
- `agent_name` — e.g. `"Copilot CLI"`
- `timestamp` — event timestamp (TIMESTAMPTZ)
- `type` — always `"assistant.usage"` for usage events

The `sessions` table provides:
- `summary` — session description/prompt
- `created_at` / `updated_at` — session timestamps (wall-clock duration derivable)
- `agent_name` — agent type

**Decision**: Use `session_store_sql` to query the `events` table filtered by `type = 'assistant.usage'`, joined to `sessions` for wall-clock duration and session metadata.  
**Rationale**: The data is already structured and queryable. No custom instrumentation needed — the platform captures usage transparently.  
**Alternatives considered**: (a) Instrumenting `src/cli.ts` to emit usage events — rejected because the session store already captures this data and our agents run through the Copilot platform. (b) Parsing GitHub Actions logs — rejected as fragile and incomplete.

## R-002: Model Tier Classification

**Question**: How should model identifiers be mapped to tiers (standard/high/extra-high)?

**Finding**: Observed model identifiers in the session store:

| Model | Proposed Tier |
|-------|---------------|
| `claude-haiku-4.5` | standard |
| `gpt-5.4-mini` | standard |
| `gpt-5-mini` | standard |
| `claude-sonnet-4.5` | standard |
| `claude-sonnet-4.6` | standard |
| `claude-sonnet-4-6` | standard |
| `gpt-5.2` | standard |
| `gpt-5.2-codex` | standard |
| `gpt-5.3-codex` | standard |
| `gpt-5.4` | standard |
| `gpt-5.5` | standard |
| `gpt-4.1` | standard |
| `claude-opus-4.5` | high |
| `claude-opus-4.6` | high |
| `claude-opus-4-7` | high |
| `claude-opus-4.7-1m-internal` | extra-high |
| `claude-opus-4.7-high` | extra-high |
| `claude-opus-4.7-xhigh` | extra-high |

**Decision**: Maintain a `config/model-tiers.json` mapping file. Unknown models default to `"unknown"` tier at collection time. The mapping is operator-maintained (same pattern as `config/discord-allowlist.json`).  
**Rationale**: A static mapping file is simple, version-controlled, and reviewable. No external API needed.  
**Alternatives considered**: (a) Regex-based tier inference — rejected as fragile when new model names appear. (b) Hardcoded in source — rejected because the mapping changes as new models appear; a config file keeps code stable.

## R-003: Storage Location and Format

**Question**: Where should telemetry records be stored, and in what format?

**Finding**: The project already uses:
- `data/discord/*.jsonl` — append-only JSONL for audit trails (candidates, tips-seen)
- `data/discord/*.json` — JSON for state files (cursors, cooldowns)
- `data/digests/YYYY-MM-DD.md` — Markdown for human-readable reports

**Decision**: Store telemetry in `data/telemetry/sessions.jsonl` (append-only, one record per collected session) and reports in `data/telemetry/reports/YYYY-MM-DD.md` (markdown summaries). This follows the existing `data/` directory conventions.  
**Rationale**: JSONL is append-friendly, grep-friendly, and diff-friendly in version control. The `data/discord/` pattern is proven and well-understood by the team.  
**Alternatives considered**: (a) SQLite — rejected because the project has no SQL runtime dependency and the test infrastructure uses `node:test` with file-based fixtures. (b) CSV — rejected because nested fields (model tier, outcome) are awkward in flat CSV.

## R-004: Constitution Amendment Scope

**Question**: Does this feature require a constitution amendment (v1.4.0)?

**Finding**: Principle V exhaustively enumerates durable inputs/outputs. This feature introduces:
- `config/model-tiers.json` — new operator-maintained config file
- `data/telemetry/sessions.jsonl` — new skill-written telemetry store
- `data/telemetry/reports/*.md` — new skill-written report artifacts

All three are new durable inputs/outputs not currently enumerated. Per Principle V: *"Any new feature MUST extend this enumeration via constitution amendment before introducing a new durable input or sanctioned writer."*

**Decision**: A constitution amendment (v1.3.0 → v1.4.0, MINOR bump) is required. It must enumerate the three new files and their writers. This amendment is a prerequisite for implementation and will be a separate task.  
**Rationale**: The constitution is explicit — no new durable inputs without amendment. The amendment is MINOR (new enumeration entries, no principle changes).  
**Alternatives considered**: Writing to a non-committed location — rejected because FR-003 requires local committed storage, and the constitution amendment is a one-time cost.

## R-005: Task Category Derivation

**Question**: How should "task category" (FR-002) be determined from session data?

**Finding**: The `sessions` table has `agent_name` (always `"Copilot CLI"` for our sessions) and `summary` (the user's prompt). The `agent_description` column also exists. Within the Squad, task categories map to agent roles: Scotty (implementation), Kirk (review), Bashir (testing), Tuvok (editing), Picard (governance), Uhura (API), Scribe (logging).

However, the session store does not expose which Squad agent was dispatched — `agent_name` is always `"Copilot CLI"`. The session `summary` sometimes contains routing hints but is unreliable.

**Decision**: For initial implementation, derive task category from session `summary` using keyword matching (e.g., contains "speckit.plan" → "planning", contains "test" → "testing"). Records where no category can be inferred are tagged `"uncategorized"`. Future iterations can improve classification. This satisfies FR-002 with a best-effort approach.  
**Rationale**: Perfect classification requires instrumenting the agent dispatch layer, which is out of scope. Keyword matching provides useful-enough categorization for initial reports.  
**Alternatives considered**: (a) Requiring manual tagging — rejected as it violates the "no manual intervention" success criterion SC-001. (b) Skipping task category entirely — rejected because FR-002 explicitly requires it and the reports are significantly more useful with it.

## R-006: Session Outcome Determination

**Question**: How should "outcome (success/failure/partial)" be determined?

**Finding**: The `events` table has a `type` column. A session that completed normally will have its last event as a normal type. The `sessions` table has `updated_at` which, compared to `created_at`, gives wall-clock duration. There is no explicit "session completed successfully" event.

The `session_refs` table tracks commits, PRs, and issues created during a session — a session that produced commits likely succeeded.

**Decision**: Derive outcome heuristically: if a session has `session_refs` with `ref_type = 'commit'` or `ref_type = 'pr'`, mark as `"success"`. If the session has usage events but no refs and the session duration is very short (< 60s), mark as `"partial"`. Otherwise mark as `"completed"` (usage happened but outcome unclear). This is explicitly imperfect and documented as such.  
**Rationale**: The session store doesn't expose a clean success/failure signal. A heuristic approach with clear documentation is better than fake precision.  
**Alternatives considered**: (a) Parsing assistant responses for error messages — rejected per FR-009 (must not collect message content). (b) Treating all sessions as "completed" — rejected as it makes the success/failure reporting (US2 scenario 3) vacuous.

## R-007: Privacy Constraints (FR-009, FR-010)

**Question**: What data must be excluded or redacted from telemetry records?

**Finding**: FR-009 prohibits collecting user messages or assistant responses — only aggregate metadata. FR-010 requires `<REDACTED>` for session identifiers traceable to user interactions. The existing redaction pattern is in `src/lib/redact.ts`.

**Decision**: Telemetry records store:
- ✅ Aggregate token counts, model names, durations, outcomes, timestamps
- ✅ A one-way hash of session_id (for deduplication, not traceability)
- ❌ No user_message, assistant_response, or summary content
- ❌ No raw session_id — use SHA-256 truncated hash (same pattern as `data/discord/` content hashes)

**Rationale**: FR-009/FR-010 are explicit. The hash provides dedup (FR-004) without traceability.  
**Alternatives considered**: Storing raw session_id with a disclaimer — rejected because FR-010 explicitly requires `<REDACTED>` placeholders.

## R-008: Tuvok Role Extension

**Question**: Does enhancing Tuvok with telemetry capabilities conflict with his current charter boundaries?

**Finding**: Tuvok's current charter says "I handle: Surgical edits per explicit reviewer findings; change-impact accounting; cross-reference fixes" and "I don't handle: Authoring principles, designing process, making architectural calls, deciding scope."

Token-usage telemetry is data collection and reporting — it doesn't involve authoring principles, designing process, or making architectural calls. It's an extension of his "Process Auditor" role: auditing resource usage is a natural fit.

**Decision**: The telemetry capability extends Tuvok's "Process Auditor" identity without conflicting with his editorial boundaries. His charter will need a minor update to declare telemetry collection as part of his ownership. This is a charter amendment, not a constitution amendment.  
**Rationale**: Tuvok already owns "change-impact accounting" — token usage is another form of impact accounting. The extension is additive, not conflicting.  
**Alternatives considered**: Creating a new agent for telemetry — rejected as unnecessary agent proliferation for a clearly-scoped auditing function.
