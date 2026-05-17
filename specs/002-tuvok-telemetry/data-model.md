# Data Model: Tuvok Token-Usage Telemetry

**Feature**: 002-tuvok-telemetry  
**Date**: 2026-05-17  
**Source**: `specs/002-tuvok-telemetry/spec.md` (Key Entities), `specs/002-tuvok-telemetry/research.md`

## Entity 1: TelemetryRecord

A single observation of resource usage for one agent session. Stored as one
line in `data/telemetry/sessions.jsonl`.

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `sessionHash` | `string` | ✅ | SHA-256 truncated hash of `session_id` | 16 hex chars; dedup key (FR-004); not traceable to user (FR-010) |
| `collectedAt` | `string` (ISO 8601 UTC) | ✅ | Collection timestamp | When Tuvok ran collection |
| `sessionStartedAt` | `string` (ISO 8601 UTC) | ✅ | `sessions.created_at` | Session creation time |
| `sessionEndedAt` | `string` (ISO 8601 UTC) | ✅ | `sessions.updated_at` | Last activity time |
| `durationSeconds` | `number` | ✅ | Derived: `updated_at - created_at` | Wall-clock duration in seconds |
| `inputTokens` | `number` | ✅ | `SUM(events.usage_input_tokens)` | Total input tokens across all usage events |
| `outputTokens` | `number` | ✅ | `SUM(events.usage_output_tokens)` | Total output tokens across all usage events |
| `cacheReadTokens` | `number` | ✅ | `SUM(events.usage_cache_read_tokens)` | Total cache-hit tokens |
| `modelBreakdown` | `ModelUsage[]` | ✅ | Grouped from `events` | Per-model token breakdown |
| `agentName` | `string` | ✅ | `sessions.agent_name` | Platform agent name (e.g. `"Copilot CLI"`) |
| `taskCategory` | `string` | ✅ | Derived from `sessions.summary` | Keyword-matched category or `"uncategorized"` |
| `outcome` | `"success" \| "completed" \| "partial"` | ✅ | Derived heuristically | See research.md R-006 |
| `usageEventCount` | `number` | ✅ | `COUNT(events)` | Number of `assistant.usage` events |
| `status` | `"complete" \| "partial"` | ✅ | Derived | `"partial"` if session had no clean end |

### Nested: ModelUsage

| Field | Type | Notes |
|-------|------|-------|
| `model` | `string` | Model identifier from `usage_model` |
| `tier` | `string` | Resolved from `config/model-tiers.json`; `"unknown"` if unmapped |
| `inputTokens` | `number` | Per-model input token sum |
| `outputTokens` | `number` | Per-model output token sum |
| `callCount` | `number` | Number of usage events for this model |

### Validation Rules

- `sessionHash` must be exactly 16 lowercase hex characters (`/^[a-f0-9]{16}$/`)
- `collectedAt`, `sessionStartedAt`, `sessionEndedAt` must be ISO 8601 UTC (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/`)
- `durationSeconds` must be ≥ 0
- `inputTokens`, `outputTokens`, `cacheReadTokens` must be ≥ 0
- `modelBreakdown` must have at least one entry
- `outcome` must be one of the three allowed values
- `status` must be one of the two allowed values

### Zod Schema Location

`src/telemetry/schemas.ts` — follows the convention of `src/discord/schemas.ts`.

---

## Entity 2: TelemetrySummary

An aggregated view over multiple TelemetryRecords. Generated on-demand for
reports; not persisted as a state file. Output rendered to
`data/telemetry/reports/YYYY-MM-DD.md`.

| Field | Type | Notes |
|-------|------|-------|
| `generatedAt` | `string` (ISO 8601 UTC) | Report generation timestamp |
| `periodStart` | `string` (ISO 8601 UTC) | Earliest session in scope |
| `periodEnd` | `string` (ISO 8601 UTC) | Latest session in scope |
| `totalSessions` | `number` | Total sessions in scope |
| `totalInputTokens` | `number` | Grand total input tokens |
| `totalOutputTokens` | `number` | Grand total output tokens |
| `byModel` | `ModelSummary[]` | Per-model aggregates |
| `byAgent` | `AgentSummary[]` | Per-agent aggregates |
| `byCategory` | `CategorySummary[]` | Per-task-category aggregates |
| `byOutcome` | `OutcomeSummary[]` | Per-outcome aggregates |

### Nested: ModelSummary

| Field | Type |
|-------|------|
| `model` | `string` |
| `tier` | `string` |
| `sessionCount` | `number` |
| `inputTokens` | `number` |
| `outputTokens` | `number` |
| `avgDurationSeconds` | `number` |
| `successRate` | `number` (0–1) |

### Nested: AgentSummary

| Field | Type |
|-------|------|
| `agentName` | `string` |
| `sessionCount` | `number` |
| `inputTokens` | `number` |
| `outputTokens` | `number` |
| `avgTokensPerSession` | `number` |
| `avgDurationSeconds` | `number` |

### Nested: CategorySummary

| Field | Type |
|-------|------|
| `category` | `string` |
| `sessionCount` | `number` |
| `inputTokens` | `number` |
| `outputTokens` | `number` |
| `successRate` | `number` (0–1) |

### Nested: OutcomeSummary

| Field | Type |
|-------|------|
| `outcome` | `string` |
| `sessionCount` | `number` |
| `percentage` | `number` (0–1) |

---

## Entity 3: ModelRecommendation

An actionable suggestion derived from TelemetrySummary data. Generated
alongside reports when sufficient data exists.

| Field | Type | Notes |
|-------|------|-------|
| `generatedAt` | `string` (ISO 8601 UTC) | When recommendation was generated |
| `type` | `"cost-saving" \| "quality-improving"` | Recommendation category |
| `targetAgent` | `string` | Agent the recommendation applies to |
| `targetCategory` | `string \| null` | Task category, if scoped |
| `currentModel` | `string` | Currently-used model |
| `recommendedModel` | `string` | Suggested model |
| `evidence` | `RecommendationEvidence` | Supporting data |
| `confidence` | `"low" \| "medium" \| "high"` | Based on data volume |
| `minimumSessionsMet` | `boolean` | Whether the configurable threshold is met |

### Nested: RecommendationEvidence

| Field | Type |
|-------|------|
| `currentSuccessRate` | `number` (0–1) |
| `recommendedSuccessRate` | `number` (0–1) |
| `currentAvgTokens` | `number` |
| `recommendedAvgTokens` | `number` |
| `tokenSavingsPercent` | `number` |
| `sessionCount` | `number` |

---

## Entity 4: CollectionLog

A record of each telemetry collection run for auditability (FR-012).
Appended to `data/telemetry/collection-log.jsonl`.

| Field | Type | Notes |
|-------|------|-------|
| `runAt` | `string` (ISO 8601 UTC) | When collection ran |
| `sessionsProcessed` | `number` | How many sessions were collected |
| `sessionsSkipped` | `number` | Already-collected (dedup) |
| `errors` | `string[]` | Error messages from failed extractions |
| `durationMs` | `number` | Collection run duration |

---

## Entity 5: ModelTierMap (config)

Operator-maintained mapping from model identifiers to tier labels.
Stored at `config/model-tiers.json`.

```json
{
  "version": 1,
  "tiers": {
    "claude-haiku-4.5": "standard",
    "gpt-5.4-mini": "standard",
    "claude-sonnet-4.6": "standard",
    "claude-opus-4.6": "high",
    "claude-opus-4.7-1m-internal": "extra-high"
  },
  "defaultTier": "unknown"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `version` | `number` (literal `1`) | Schema version |
| `tiers` | `Record<string, string>` | Model ID → tier label |
| `defaultTier` | `string` | Tier for unmapped models |

---

## State Transitions

```
Session completed in cloud store
  → [Collection] TelemetryRecord created in sessions.jsonl
    → [already collected?] Skip (idempotent, FR-004)
  → [Report requested] TelemetrySummary generated from records
    → [sufficient data?] ModelRecommendation generated
    → [insufficient data?] "Insufficient data" note in report
```

## File Layout

```
config/
└── model-tiers.json             # Entity 5: operator-maintained tier map

data/telemetry/
├── sessions.jsonl               # Entity 1: append-only telemetry records
├── collection-log.jsonl         # Entity 4: append-only collection audit
└── reports/
    └── YYYY-MM-DD.md            # Entity 2+3: rendered summary + recommendations
```
