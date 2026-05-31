# Contract — Officer Database (`data/crew/officers.json`)

## Shape

JSON array of `Officer` objects. See `data-model.md` for the full
type. Top-level array; no wrapper object.

## Required fields per entry

`id`, `name`, `faction`, `synergy_groups`, `captain_maneuver` (with
`text` + `tags`), `officer_ability` (with `text` + `tags`), `bda_role`,
`rank_curve`, `added_in_patch`, `source`.

## Closed enums

- `faction` ∈ `{ federation, klingon, romulan, independent, rogue, non_aligned }`
- `bda_role` ∈ `{ captain, officer, either }`
- `rank_curve` ∈ `{ linear, back_loaded, front_loaded }`
- `captain_maneuver.tags[]`, `officer_ability.tags[]` ∈ the v1 `TagId` enum (FR-002)

## Invariants

- `id` is unique across the database.
- `tags[]` entries are unique within their parent block.
- `source` is a non-empty string and resolves to a verifiable reference:
  - For game-knowledge sourcing: `docs/stfc-game-knowledge.md#<anchor>`
  - For external sourcing (deferred to v1.x): `https://stfc.space/officers/<slug>` (or similar)

## Validation

`src/crew/database.ts` loads the file and validates against the zod
schema in `src/crew/schemas.ts`. Schema failures throw `SchemaError`
and exit non-zero.

## v1 seed coverage

~30–50 officers covering:

- Every BDA role surfaced in `docs/stfc-game-knowledge.md` section 6.
- Every faction with at least one captain + two officers.
- At least one officer per v1 task definition's preferred tag list.

PRs adding officers are welcomed; the unknown-officer error path
(FR-010) is the in-CLI signal that an officer is missing.

## Stability

The shape is **stable for v1**. Additions to the closed enums or to
the per-officer fields require a constitution amendment (Principle V
— durable inputs).
