# Data Model — Crew Optimizer

## Officer (in `data/crew/officers.json`)

```ts
type Officer = {
  id: string;                       // kebab-case stable id, e.g. "kirk", "chen", "spock"
  name: string;                     // display name, e.g. "James T. Kirk"
  faction: "federation" | "klingon" | "romulan" | "independent" | "rogue" | "non_aligned";
  synergy_groups: string[];         // e.g. ["original_crew", "kirk_captains"]
  captain_maneuver: {
    text: string;                   // human-readable description from the game
    tags: TagId[];                  // closed enum, see FR-002
  };
  officer_ability: {
    text: string;
    tags: TagId[];
  };
  bda_role: "captain" | "officer" | "either";
  rank_curve: "linear" | "back_loaded" | "front_loaded";
  added_in_patch: string;           // e.g. "M91"
  source: string;                   // provenance: "docs/stfc-game-knowledge.md#kirk" or stfc.space URL
};

type TagId =
  | "mining_rate" | "hostile_crit" | "hostile_mitigation"
  | "armada_damage" | "armada_mitigation"
  | "isolytic_damage" | "isolytic_mitigation"
  | "warp_range" | "cargo_capacity"
  | "station_defense" | "pvp_damage" | "pvp_mitigation"
  | "dispatch_speed" | "repair_cost" | "morale_recovery";
```

**Invariants:**

- `id` is unique across the officer database.
- `synergy_groups` entries are lowercase snake_case; the engine
  computes synergy bonuses from group co-occurrence on a crew.
- `tags[]` entries are members of the `TagId` enum (FR-002).
- `source` is a verifiable provenance reference (file path + anchor or
  external URL).

## Task (in `data/crew/tasks/*.yaml`)

```yaml
id: mining-g3
name: "G3 Mining Run"
description: "Standard tritanium/dilithium pull at G3 nodes."
slots:
  captain: { bda_role: captain }
  officer_a: { bda_role: officer }
  officer_b: { bda_role: officer }
tag_weights:                        # tag → weight in the score function
  mining_rate: 10
  cargo_capacity: 4
  warp_range: 1
synergy_bonus: 5                    # added per matched synergy group on the crew
faction_bonus:                      # optional: faction-purity bonus, e.g. for armada crews
  federation: 0
constraints:
  exclude_officers: []              # e.g. ["khan"] if a quest forbids
notes: |
  Standard G3 mining; warp range bonus is small but breaks ties.
```

**Invariants:**

- `id` matches the filename (sans `.yaml`).
- Tag keys in `tag_weights` are members of `TagId` (FR-002).
- `synergy_bonus` ≥ 0.
- `constraints.exclude_officers` entries are officer ids that must
  exist in `officers.json` (validated at load time).

## Roster (in `data/crew/roster/{account}.yaml`)

```yaml
account: main
last_updated: 2026-05-31T19:50:05Z   # UTC ISO, auto-bumped by skill:roster maintenance verbs
staleness_overrides:                 # optional per-account override
  warn: 7                            # days
  error: 14                          # days
officers:
  - { id: kirk,  owned: true, level: 60, rank: 3, promotions: 2 }
  - { id: chen,  owned: true, level: 28, rank: 1, promotions: 0 }
  - { id: spock, owned: false }      # known unowned — surfaced by skill:progression as a candidate
```

**Invariants:**

- `account` matches the filename (sans `.yaml`).
- `last_updated` is a valid ISO 8601 UTC timestamp.
- Every `officers[].id` is present in `officers.json`. If not,
  `skill:roster validate` and `skill:optimize-crew` MUST emit the
  unknown-officer error (FR-010) and exit non-zero.
- `level` ∈ [1, 100]; `rank` ∈ [1, 5]; `promotions` ≥ 0.
- `owned: false` entries are allowed (progression target tracking) and
  excluded from `skill:optimize-crew` candidate generation.

## Recommendation (in-memory only — not persisted)

```ts
type Recommendation = {
  task_id: string;
  rank: number;                    // 1 = top
  score: number;
  crew: { captain: string; officer_a: string; officer_b: string };
  rationale: {
    matched_tags: { tag: TagId; weight: number; contributor: string }[];
    synergy_matches: { group: string; members: string[]; bonus: number }[];
    captain_maneuver: string;
    officer_abilities: string[];
  };
};
```

## Per-account report (in `docs/crew/{account}.md`)

Generated from a deterministic template; `tests/crew/report.test.ts`
snapshots against a golden file for the fixture account.

```markdown
# Crew recommendations — {account}

> _Last input hash: {sha256-12}._
> _Generated: {iso8601 UTC}._
> _Roster age: {N} days. {staleness banner if N ≥ warn threshold}_

## Top crews per task

### Task: {task.name} (`{task.id}`)

1. **{captain} + {officer_a} + {officer_b}** — score {N}
   - matched tags: {tag (weight) ← contributor}, …
   - synergy: {group} ({members joined by ", "}) +{bonus}
   - captain maneuver: {text}
   - officer abilities: {text 1}; {text 2}

## Progression candidates

1. **{officer name}** ({current rank/level} → {next rank/level})
   - marginal utility: {N} across {task ids}
   - rationale: …
```

## Knowledge chunk (v2, in `data/crew/knowledge-embeddings.json`)

```ts
type KnowledgeChunk = {
  id: string;                      // deterministic: "docs/stfc-game-knowledge.md#section-anchor" or "officer:kirk"
  source: "game_knowledge" | "officer" | "task";
  source_path: string;             // file path
  heading_path: string[];          // e.g. ["6. Officers", "Federation Crews", "Kirk"]
  line_start: number;
  line_end: number;
  text: string;                    // chunk content used as embedding input
  embedding: number[];             // 384-dim float vector from all-MiniLM-L6-v2
};
```

**Invariants:**

- `embedding.length === 384`.
- Chunking is **deterministic**: same input file + same chunking
  config → same `id`s and `embedding`s. Asserted by
  `tests/crew/knowledge.test.ts`.
- The file is regenerated by `skill:knowledge-rebuild` (local) or
  `knowledge-rebuild.yml` (CI on push to the relevant inputs).

## File-system invariants

- `data/crew/officers.json` — committed; written only via PR review.
- `data/crew/tasks/*.yaml` — committed; written via PR review or via
  `skill:roster` only if a future helper adds it (none planned for v1).
- `data/crew/roster/*.yaml` — committed by default (FR-004); written by
  `skill:roster` maintenance verbs (always with stable key order +
  `last_updated` bump) OR by hand-edit + PR.
- `docs/crew/*.md` — committed; written by `optimize-crew.yml` ONLY
  when the input hash changes (FR-013); rebased before push (Rule 4).
- `data/crew/knowledge-embeddings.json` (v2) — committed; written by
  `knowledge-rebuild.yml` ONLY on the relevant input pushes.
- No screenshot bytes are ever committed (v1.5 invariant; tmpfs only).
