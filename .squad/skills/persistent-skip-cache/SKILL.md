# Persistent Skip Cache (Batch Jobs)

## When to use
Use this pattern when a batch job repeatedly processes operator-managed candidates (codes, IDs, URLs) and some outcomes are permanently un-actionable.

## Pattern
1. Keep the source list immutable (operator-owned).
2. Track permanently-dead candidates in a runtime cache file.
3. On each run, pre-filter candidates by cache before issuing network calls.
4. When a terminal outcome occurs, persist it immediately.

## Data model
```json
{
  "<candidate>": {
    "marked_dead_at": "ISO-8601",
    "first_seen_outcome": "TERMINAL_REASON",
    "accounts_tried": ["acct1", "acct2"]
  }
}
```

## Reliability rules
- Use atomic write: write `<path>.tmp`, then rename to `<path>`.
- Treat missing cache as empty.
- If cache is malformed, warn and continue with empty cache.

## Operator controls
- Reset behavior by deleting the cache file.
- Never mutate the source input list automatically.
