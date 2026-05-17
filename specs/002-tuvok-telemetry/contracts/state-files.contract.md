# Contract: Telemetry State Files

**Feature**: 002-tuvok-telemetry  
**Date**: 2026-05-17  
**Convention**: Follows `specs/001-discord-monitor/contracts/state-files.contract.md`

This contract defines the structure, read/write rules, and invariants for
every file the telemetry feature reads or writes. It is the authoritative
source; runtime schemas in `src/telemetry/schemas.ts` mirror these shapes.

---

## 1. `data/telemetry/sessions.jsonl`

**Type**: Append-only JSONL (one JSON object per line)  
**Writer**: Tuvok telemetry collector (`src/telemetry/collector.ts`)  
**Reader**: Tuvok report generator (`src/telemetry/reporter.ts`)  
**Commit owner**: Scribe (Rule 2 — `.squad/` boundary does not apply here, but Tuvok must stage only its own paths)

### Schema (per line)

```jsonc
{
  "sessionHash": "a1b2c3d4e5f67890",     // 16 hex chars, SHA-256 truncated
  "collectedAt": "2026-05-17T12:00:00Z",
  "sessionStartedAt": "2026-05-17T10:00:00Z",
  "sessionEndedAt": "2026-05-17T11:30:00Z",
  "durationSeconds": 5400,
  "inputTokens": 125000,
  "outputTokens": 8500,
  "cacheReadTokens": 45000,
  "modelBreakdown": [
    {
      "model": "claude-opus-4.6",
      "tier": "high",
      "inputTokens": 100000,
      "outputTokens": 7000,
      "callCount": 15
    },
    {
      "model": "gpt-5.4-mini",
      "tier": "standard",
      "inputTokens": 25000,
      "outputTokens": 1500,
      "callCount": 5
    }
  ],
  "agentName": "Copilot CLI",
  "taskCategory": "implementation",
  "outcome": "success",
  "usageEventCount": 20,
  "status": "complete"
}
```

### Invariants

- **Append-only**: Lines are never modified or deleted. The file grows monotonically.
- **Idempotent writes**: Before appending, the collector checks whether `sessionHash` already exists in the file. If it does, the session is skipped (FR-004).
- **Dedup by `sessionHash`**: If duplicate lines somehow exist, readers use last-line-wins semantics (same as `data/discord/candidates.jsonl`).
- **No user content**: No field contains user messages, assistant responses, or raw session IDs (FR-009, FR-010).
- **Pretty-printing**: NOT pretty-printed (JSONL; one compact JSON per line).

---

## 2. `data/telemetry/collection-log.jsonl`

**Type**: Append-only JSONL  
**Writer**: Tuvok telemetry collector (`src/telemetry/collector.ts`)  
**Reader**: Auditors, operators

### Schema (per line)

```jsonc
{
  "runAt": "2026-05-17T12:00:00Z",
  "sessionsProcessed": 5,
  "sessionsSkipped": 2,
  "errors": [],
  "durationMs": 1200
}
```

### Invariants

- **Append-only**: One line per collection run.
- **Always written**: Even on zero sessions processed or errors, a log line is appended (FR-012).

---

## 3. `data/telemetry/reports/YYYY-MM-DD.md`

**Type**: Markdown report  
**Writer**: Tuvok report generator (`src/telemetry/reporter.ts`)  
**Reader**: Human operators, Tuvok audit trail

### Structure

```markdown
# Telemetry Report — YYYY-MM-DD

**Generated**: 2026-05-17T12:00:00Z  
**Period**: 2026-05-10 to 2026-05-17  
**Sessions**: 42

## Token Usage by Model

| Model | Tier | Sessions | Input Tokens | Output Tokens | Avg Duration |
|-------|------|----------|--------------|---------------|--------------|
| ... | ... | ... | ... | ... | ... |

## Token Usage by Agent

| Agent | Sessions | Avg Tokens/Session | Avg Duration |
|-------|----------|-------------------|--------------|
| ... | ... | ... | ... |

## Outcome Summary

| Outcome | Sessions | Percentage |
|---------|----------|------------|
| ... | ... | ... |

## Recommendations

> ⚠️ Recommendations require human review before action (FR-011).

### 1. [Recommendation title]

- **Type**: cost-saving / quality-improving
- **Target**: Agent X on task category Y
- **Current model**: ...
- **Recommended model**: ...
- **Evidence**: ...
- **Confidence**: low / medium / high

---

*No data collected.* ← (shown when sessions.jsonl is empty; US2-S4)
```

### Invariants

- **Idempotent**: Re-generating a report for the same date overwrites deterministically (same pattern as `data/digests/YYYY-MM-DD.md`).
- **Human-readable**: Must be renderable as valid Markdown (FR-011).
- **No secrets**: No session IDs, no user content, no tokens (FR-009, FR-010, Principle VII).

---

## 4. `config/model-tiers.json`

**Type**: JSON (pretty-printed, 2-space indent, sorted keys, trailing newline)  
**Writer**: Human operator (manual edit, reviewed PR)  
**Reader**: Tuvok telemetry collector (`src/telemetry/collector.ts`)

### Schema

```jsonc
{
  "defaultTier": "unknown",
  "tiers": {
    "claude-haiku-4.5": "standard",
    "claude-opus-4.5": "high",
    "claude-opus-4.6": "high",
    "claude-opus-4.7-1m-internal": "extra-high",
    "claude-opus-4.7-high": "extra-high",
    "claude-opus-4.7-xhigh": "extra-high",
    "claude-opus-4-7": "high",
    "claude-sonnet-4-6": "standard",
    "claude-sonnet-4.5": "standard",
    "claude-sonnet-4.6": "standard",
    "gpt-4.1": "standard",
    "gpt-5-mini": "standard",
    "gpt-5.2": "standard",
    "gpt-5.2-codex": "standard",
    "gpt-5.3-codex": "standard",
    "gpt-5.4": "standard",
    "gpt-5.4-mini": "standard",
    "gpt-5.5": "standard"
  },
  "version": 1
}
```

### Invariants

- **Operator-only writes**: Feature code reads but NEVER writes this file (same pattern as `config/discord-allowlist.json`).
- **Pretty-printed**: 2-space indent, keys sorted alphabetically, trailing newline (same convention as all `config/` JSON files).
- **Unknown models**: Models not found in `tiers` use `defaultTier` value. The collector logs a warning for unmapped models.
- **Zod-validated on load**: Schema failure produces a typed error, not silent fallback (Principle III).
