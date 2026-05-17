# Quickstart: Tuvok Token-Usage Telemetry

**Feature**: 002-tuvok-telemetry

## What it does

Tuvok collects token-usage telemetry from the cloud session store after
agent sessions, stores structured records locally, and generates summary
reports with model-selection recommendations.

## Prerequisites

- Node.js ≥ 24 (per `.nvmrc`)
- `npm ci` (dependencies installed)
- Access to the cloud session store (Copilot CLI environment)

## Run telemetry collection + report

```bash
# Full cycle: collect → report → recommend
npm run skill:telemetry

# Individual steps
npm run skill:telemetry collect
npm run skill:telemetry report
npm run skill:telemetry recommend
```

## Output locations

| Artifact | Path | Format |
|----------|------|--------|
| Telemetry records | `data/telemetry/sessions.jsonl` | Append-only JSONL |
| Collection audit log | `data/telemetry/collection-log.jsonl` | Append-only JSONL |
| Summary reports | `data/telemetry/reports/YYYY-MM-DD.md` | Markdown |
| Model tier config | `config/model-tiers.json` | JSON (operator-edited) |

## Configuration

### Model tier mapping

Edit `config/model-tiers.json` to add new model → tier mappings:

```json
{
  "version": 1,
  "tiers": {
    "claude-opus-4.6": "high",
    "gpt-5.4-mini": "standard"
  },
  "defaultTier": "unknown"
}
```

### Recommendation threshold

The minimum number of sessions per agent/model combination before
recommendations are generated defaults to **10**. This is configurable
via the `minSessionsForRecommendation` option (future: environment
variable or config file entry).

## Development

```bash
# Run tests
npm test

# Run only telemetry tests
node --import tsx --test tests/telemetry/collector.test.ts
node --import tsx --test tests/telemetry/reporter.test.ts
node --import tsx --test tests/telemetry/schemas.test.ts

# Typecheck
npm run typecheck
```

## Architecture

```
src/telemetry/
├── schemas.ts        # Zod schemas for all telemetry entities
├── collector.ts      # Session store → sessions.jsonl
├── reporter.ts       # sessions.jsonl → reports/*.md
├── recommender.ts    # sessions.jsonl → recommendations
└── tiers.ts          # Model tier resolution from config

src/skills/
└── telemetry.ts      # CLI skill entry point

config/
└── model-tiers.json  # Operator-maintained tier map

data/telemetry/
├── sessions.jsonl
├── collection-log.jsonl
└── reports/
```

## Privacy

- **No user content**: Telemetry records contain only aggregate metadata
  (token counts, model names, durations, outcomes). No user messages or
  assistant responses are collected (FR-009).
- **Hashed session IDs**: Raw session IDs are replaced with SHA-256
  truncated hashes for deduplication without traceability (FR-010).
- **No data leaves the runner**: All processing is local (consistent with
  existing Security & Compliance Constraints).
