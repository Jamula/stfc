# Contract — Task YAML (`data/crew/tasks/*.yaml`)

## Shape

```yaml
id: <string, matches filename sans .yaml>
name: <string, human-readable display name>
description: <string>
slots:
  captain:   { bda_role: captain }
  officer_a: { bda_role: officer }
  officer_b: { bda_role: officer }
tag_weights:                # tag → integer weight added to the score per matched contributor
  <TagId>: <int>
  ...
synergy_bonus: <int ≥ 0>    # added per matched synergy group present on the crew
faction_bonus:              # optional
  <faction>: <int>
constraints:
  exclude_officers: [<officer_id>, ...]   # optional; officer ids that must NOT appear on the crew
notes: |
  Free-form prose surfaced in the recommendation rationale and in docs/crew/{account}.md.
```

## Required fields

- `id` (matches filename).
- `name`, `description`.
- `slots.captain`, `slots.officer_a`, `slots.officer_b`.
- `tag_weights` (may be empty for a task that scores purely on synergy
  / faction bonuses, but at least one of `tag_weights`, `synergy_bonus
  > 0`, or `faction_bonus` MUST be present so the score function is
  non-trivial).

## Closed enums

- `slots.*.bda_role` ∈ `{ captain, officer, either }`.
- `tag_weights` keys ∈ the v1 `TagId` enum (FR-002).
- `faction_bonus` keys ∈ the faction enum from
  `officer-db.contract.md`.

## Invariants

- `tag_weights` values are integers (positive or negative; negative
  weights act as soft penalties — e.g., to express "prefer non-Romulan
  for this Federation armada").
- `synergy_bonus ≥ 0`.
- `constraints.exclude_officers[]` entries are valid officer ids
  (validated at load time).

## Validation

`src/crew/tasks.ts` loads every file in `data/crew/tasks/` and
validates each against the zod schema. Schema failures throw
`SchemaError` and exit non-zero.

## Stability

The shape is **stable for v1**. Adding a new task = drop a new YAML
file under `data/crew/tasks/` and PR. No tasks deleted or modified in
v1 require a schema migration.
