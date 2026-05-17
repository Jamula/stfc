# Contract: Telemetry CLI Skill

**Feature**: 002-tuvok-telemetry  
**Date**: 2026-05-17  
**Convention**: Follows `src/skills/*.ts` pattern per Principle II

---

## Skill Registration

The telemetry feature adds one new skill to the CLI dispatcher:

| Skill name | npm script | Entry point |
|-----------|------------|-------------|
| `telemetry` | `npm run skill:telemetry` | `tsx src/cli.ts telemetry` |

### Subcommands

The `telemetry` skill accepts a subcommand as `argv[3]`:

| Subcommand | Purpose | FR |
|------------|---------|-----|
| `collect` | Extract usage data from session store, write to `sessions.jsonl` | FR-001, FR-002, FR-003, FR-004, FR-008, FR-012 |
| `report` | Generate summary report from collected data | FR-005, FR-011 |
| `recommend` | Generate model-selection recommendations | FR-006, FR-007, FR-011 |

Default (no subcommand): runs `collect` then `report` then `recommend` in sequence.

### Skill Contract

```typescript
// src/skills/telemetry.ts

interface TelemetryOptions {
  /** Path to model-tiers.json config */
  modelTiersPath?: string;
  /** Path to data/telemetry/ directory */
  dataDir?: string;
  /** Minimum sessions per model/agent for recommendations (default: 10) */
  minSessionsForRecommendation?: number;
  /** Time range for collection: how many days back to look (default: 7) */
  lookbackDays?: number;
  /** Subcommand to run */
  subcommand?: "collect" | "report" | "recommend";
}

interface TelemetryResult {
  sessionsCollected: number;
  sessionsSkipped: number;
  errors: string[];
  reportPath: string | null;
  recommendations: number;
}

type TelemetryOutput = { result: TelemetryResult; exitCode: number };

export function telemetry(opts: TelemetryOptions): Promise<TelemetryOutput>;
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Successful collection/report/recommend (including zero sessions) |
| `1` | Infrastructure error (session store unreachable, file I/O failure) |

Note: Zero sessions collected is a successful run (exit 0), not an error.
The "no data available" case is reported in the summary (US2-S4).

### Dispatcher Integration

The skill is registered in `src/cli.ts` alongside existing skills. It does
NOT require `accounts` (unlike redeem skills) — it operates on the session
store, not on STFC API accounts.

```typescript
// In src/cli.ts SKILL_FNS:
"telemetry": (o) => telemetry({
  subcommand: (process.argv[3] as "collect" | "report" | "recommend") ?? undefined,
}),
```

### Session Store Access

The collector uses `session_store_sql` (the cloud session store query tool)
to extract usage data. This is a READ-ONLY operation — no data is written
to the session store.

**Query pattern** (per collection run):

```sql
-- Step 1: Get sessions with usage data in the lookback window
SELECT s.id, s.agent_name, s.summary, s.created_at, s.updated_at
FROM sessions s
WHERE s.created_at > now() - INTERVAL '{lookbackDays} days'
LIMIT 200;

-- Step 2: For each session, get usage events
SELECT usage_model, usage_input_tokens, usage_output_tokens,
       usage_cache_read_tokens, usage_duration
FROM events
WHERE session_id = '{id}'
  AND type = 'assistant.usage'
  AND usage_input_tokens IS NOT NULL;

-- Step 3: Check for outcome signals
SELECT ref_type, ref_value
FROM session_refs
WHERE session_id = '{id}';
```

### Privacy Constraints

- The collector MUST NOT store `sessions.summary` or any content from
  `events.user_content` / `events.assistant_content` in telemetry records.
- Session IDs are hashed (SHA-256 truncated to 16 hex chars) before storage.
- The queries above deliberately exclude content columns.
