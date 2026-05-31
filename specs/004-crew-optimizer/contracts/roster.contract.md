# Contract — Roster YAML (`data/crew/roster/{account}.yaml`)

## Shape

```yaml
account: <string, matches filename sans .yaml>
last_updated: <ISO 8601 UTC string>
staleness_overrides:            # optional
  warn: <int, days>
  error: <int, days>
officers:
  - { id: <officer_id>, owned: <bool>, level: <int 1..100>, rank: <int 1..5>, promotions: <int ≥ 0> }
  - { id: <officer_id>, owned: false }    # unowned: only `id` and `owned` required
```

## Required fields

- `account` — must equal the filename basename (sans `.yaml`).
- `last_updated` — ISO 8601 UTC.
- `officers` — array (may be empty for a brand-new account).

## Owned-officer required fields

If `owned: true`, the entry MUST carry `level`, `rank`, `promotions`.

## Unowned-officer entries

`owned: false` allows tracking progression targets (officer ids the
operator wants to surface in `skill:progression`). Excluded from
`skill:optimize-crew` candidate enumeration.

## Stable round-trip

`skill:roster` maintenance verbs MUST:

- Write YAML with a stable key order (`account`, `last_updated`,
  `staleness_overrides`, `officers`).
- Sort `officers[]` by `id` before serialization.
- Bump `last_updated` to the current UTC ISO timestamp.
- Round-trip byte-equivalent for idempotent operations: running
  `add --officer X` twice yields the same file the second time.

This invariant is asserted by `tests/skills/roster.test.ts`.

## Validation

- Schema: zod schema in `src/crew/schemas.ts`.
- Cross-check: every `officers[].id` MUST exist in
  `data/crew/officers.json` or the unknown-officer error (FR-010)
  fires.
- Test coverage: `tests/crew/realdata.test.ts` validates every
  committed `data/crew/roster/*.yaml` against the schema on every CI
  run (catches schema drift).

## Privacy

Tracked-by-default. Operators who want private rosters add the
account file to `.gitignore` per `docs/CREW-OPTIMIZER.md` § 6.
Missing roster files are NOT an error — the optimizer skips the
account with a single warning and continues processing other accounts.
