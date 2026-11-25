# Crew Optimizer — Operator Guide

> The optimizer, roster CLI, progression reports, local knowledge retrieval,
> and read-only Discord `!crew` message commands are implemented.

## What it does

The crew optimizer is a pure-compute, offline CLI feature that reads your
`data/crew/` inputs (officer database, task definitions, roster) and
produces two outputs: a ranked list of the **best legal crew for a given
task** (annotated with the scoring rationale), and a **progression report**
identifying which officer investments will yield the largest marginal gain
across the built-in task classes. No game-API traffic; no credentials required.
The skills run locally. Discord `!crew` queries are handled by the Discord
monitor workflow; the `knowledge-rebuild.yml` workflow separately refreshes
the committed knowledge-embedding artifact when its source files change.

---

## Quick start

The `demo` account (`data/crew/roster/demo.yaml`) has a pre-populated
five-officer roster. Use it to verify your install before working with
your own account.

```bash
# 1. Get the best crew for G3 mining
npm run skill:optimize-crew -- --account demo --task mining-g3
```

> Note: `generatedAt` and `stalenessDays` are replaced with placeholders; the actual CLI emits a fresh ISO-8601 timestamp and current staleness value per run.

```text
=== optimize-crew (task: mining-g3, top 3) ===

Account: demo
Status: ok
Rank  Score  Captain  Bridge  Below Deck  Rationale
----  -----  -------  ------  ----------  ---------
1     0.00   kirk     chen
{"skill":"optimize-crew","task":"mining-g3","topN":3,"generatedAt":"<timestamp>","accounts":[{"account":"demo","status":"ok","stalenessDays":<N>,"docWrite":"written","docPath":"docs/crew/demo-optimize.md","topCrews":[{"score":0,"captain":"kirk","bridge":["chen"],"belowDeck":[],"rationale":{"tags":[],"factionBonus":0,"synergyBonuses":[]}}]}]}
```

```bash
# 2. Get progression recommendations
npm run skill:progression -- --account demo
```

For your own account, first build a roster (see [skill:roster family](#skillroster-family)):

```bash
npm run skill:roster -- add --account main --officer kirk --level 60 --rank 4 --promotions 3
npm run skill:roster -- add --account main --officer chen --level 35 --rank 2 --promotions 1
npm run skill:roster -- validate --account main
npm run skill:optimize-crew -- --account main --task mining-g3
```

---

## Officer database

**Location:** `data/crew/officers.json`

A JSON array of 37 `Officer` objects. Each officer has:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable kebab-case id (e.g. `"kirk"`, `"chen"`) |
| `name` | `string` | Display name (e.g. `"James T. Kirk"`) |
| `faction` | enum | `federation`, `klingon`, `romulan`, `independent`, `rogue`, `non_aligned` |
| `synergy_groups` | `string[]` | Group names used for synergy-bonus computation |
| `captain_maneuver` | `{ text, tags[] }` | Maneuver description + closed `TagId` tags |
| `officer_ability` | `{ text, tags[] }` | Ability description + closed `TagId` tags |
| `bda_role` | enum | `captain`, `officer`, or `either` |
| `rank_curve` | enum | `linear`, `back_loaded`, or `front_loaded` |
| `added_in_patch` | `string` | Patch reference (e.g. `"M91"`) |
| `source` | `string` | Provenance (e.g. `"docs/stfc-game-knowledge.md#section-6"`) |

**Seeding:** The initial 37 officers were hand-curated from
`docs/stfc-game-knowledge.md` Section 6 and community knowledge. Coverage
varies by faction and BDA role; the current distribution is:

| Faction | Captains | Officers | Either |
|---|---:|---:|---:|
| `federation` | 3 | 9 | 2 |
| `independent` | 1 | 0 | 1 |
| `klingon` | 3 | 4 | 1 |
| `non_aligned` | 1 | 3 | 1 |
| `rogue` | 1 | 0 | 0 |
| `romulan` | 2 | 5 | 0 |

See `data/crew/officers.json` for the current records; PRs are welcome to
broaden coverage.

**Adding a new officer:** Drop a new entry in `data/crew/officers.json`
following the shape above. The closed `TagId` enum (15 tags) is defined in
`src/crew/schemas.ts`; use only those values in `tags[]`. Submit as a PR.
The unknown-officer error (FR-010) in `src/crew/database.ts` fires when a
roster references an id not in this file — that is the in-CLI signal that a
new officer entry is needed.

---

## OCR roster import (planned)

Automated screenshot-to-roster OCR is planned for `v0.3.0` and tracked under
[#85](https://github.com/Jamula/stfc/issues/85) (the earlier crop-only
synthetic bitmap experiment was removed during `0.1.0` cleanup). Until `#85`
lands, maintain rosters via `npm run skill:roster` or direct edits to
`data/crew/roster/{account}.yaml`.

---

## Tasks

**Location:** `data/crew/tasks/*.yaml` (4 built-in definitions)

| File | id | Name |
|---|---|---|
| `mining-g3.yaml` | `mining-g3` | G3 Mining Run |
| `hostile-grind.yaml` | `hostile-grind` | Hostile Grinding |
| `armada-25.yaml` | `armada-25` | Level 25 Armada |
| `station-defense.yaml` | `station-defense` | Station Defense |

Each task file specifies three crew slots (`captain`, `officer_a`,
`officer_b`), a `tag_weights` map (closed `TagId` keys → integer scores),
an optional `synergy_bonus`, optional `faction_bonus`, and
`constraints.exclude_officers`.

**Adding a new task:** Create a new YAML file under `data/crew/tasks/`
with a unique `id` matching the filename (sans `.yaml`). Include at least
one of `tag_weights`, `synergy_bonus > 0`, or `faction_bonus` so the score
function is non-trivial. Submit as a PR. See
`specs/004-crew-optimizer/contracts/task.contract.md` for the full schema.

---

## Rosters

**Location:** `data/crew/roster/{account}.yaml`

The filename basename (without `.yaml`) is the account name. The optimizer
iterates every file in `data/crew/roster/` — **skipping `demo.yaml`** —
unless `--account X` narrows the run to one file.

### Staleness policy

`last_updated` is bumped automatically by every `skill:roster` maintenance
verb. The optimizer emits a banner warning at **7 days** (`warn`) and
escalates at **14 days** (`error`). These thresholds are the defaults from
`src/crew/staleness.ts`; override them per-account via
`staleness_overrides` in the YAML:

```yaml
staleness_overrides:
  warn: 10
  error: 21
```

### Opting out of committing a roster

Rosters are tracked by default so `discord-monitor.yml` can answer read-only
`!crew` commands in Discord and operators can generate `docs/crew/` reports
locally. To keep an account private, add to `.gitignore` (or
`.git/info/exclude` for a local-only override):

```
# private roster — not committed
data/crew/roster/main.yaml
```

The optimizer skips accounts whose file is absent and continues processing
other accounts (no `docs/crew/main-optimize.md` report is written locally, and
Discord `!crew` commands will not see the ignored account).

---

## `skill:roster` family

Five subcommands for maintaining your roster. All verbs write keys in
stable order (`account`, `last_updated`, `staleness_overrides`,
`officers`) and sort `officers[]` by `id` before serializing (YAML
round-trip is idempotent modulo `last_updated`).

### `status`

```bash
npm run skill:roster -- status --account main   # single account
npm run skill:roster -- status                  # all accounts
```

Prints a table of account / officer count / age / freshness. Read-only;
no file mutations.

### `add`

```bash
npm run skill:roster -- add --account main --officer kirk --level 60 --rank 4 --promotions 3
```

Creates `data/crew/roster/main.yaml` if absent; upserts the named officer
entry; bumps `last_updated`. Flags: `--account` (required), `--officer`
(required), `--level`, `--rank`, `--promotions` (all optional; default to
1/1/0 for a new entry). Exits 1 if the officer id is unknown.

### `promote`

```bash
npm run skill:roster -- promote --account main --officer chen --level +5
npm run skill:roster -- promote --account main --officer chen --level 45
```

Updates `level` by delta (`+N`) or absolute value. Bumps `last_updated`.

### `rankup`

```bash
npm run skill:roster -- rankup --account main --officer pike
npm run skill:roster -- rankup --account main --officer pike --rank 3
```

Increments `rank` by 1 (default) or sets it to `--rank R`. Bumps
`last_updated`.

### `validate`

```bash
npm run skill:roster -- validate --account main   # single account
npm run skill:roster -- validate                  # all accounts
```

Validates the roster YAML against the zod schema in `src/crew/schemas.ts`
and cross-checks every officer id against `data/crew/officers.json`. Exit
0 = clean; exit 1 = schema or unknown-officer error (message names the
offending field). Read-only; no file mutations.

---

## `skill:optimize-crew`

Ranks the top N legal crews for a given task against a roster.

```bash
npm run skill:optimize-crew -- --account main --task mining-g3
npm run skill:optimize-crew -- --account main --task mining-g3 --top 5
npm run skill:optimize-crew -- --all --task hostile-grind
```

| Flag | Default | Notes |
|---|---|---|
| `--account X` | — | Roster `data/crew/roster/{X}.yaml` must exist. Mutually exclusive with `--all`. |
| `--all` | — | Run against every roster in `data/crew/roster/` (skipping `demo.yaml`). |
| `--task T` | required | Task file `data/crew/tasks/{T}.yaml` must exist. |
| `--top N` | `3` | Number of recommendations to return per account. |

**Output format:** text table followed by a single-line JSON summary. Example
from `npm run skill:optimize-crew -- --account demo --task mining-g3`:

> Note: `generatedAt` and `stalenessDays` are replaced with placeholders; the actual CLI emits a fresh ISO-8601 timestamp and current staleness value per run.

```text
=== optimize-crew (task: mining-g3, top 3) ===

Account: demo
Status: ok
Rank  Score  Captain  Bridge  Below Deck  Rationale
----  -----  -------  ------  ----------  ---------
1     0.00   kirk     chen
{"skill":"optimize-crew","task":"mining-g3","topN":3,"generatedAt":"<timestamp>","accounts":[{"account":"demo","status":"ok","stalenessDays":<N>,"docWrite":"written","docPath":"docs/crew/demo-optimize.md","topCrews":[{"score":0,"captain":"kirk","bridge":["chen"],"belowDeck":[],"rationale":{"tags":[],"factionBonus":0,"synergyBonuses":[]}}]}]}
```

Exit codes:

- Exit 0 = success, including partial success when at least one account
  produced a recommendation.
- Exit 1 = infrastructure/load failure, such as officer database, task
  definition, roster directory, or schema mismatch failure before per-account
  recommendation processing can proceed.
- Exit 2 = usage/selector error or all configured accounts degraded (for
  example, every selected roster is missing or malformed).

The skill also writes `docs/crew/{account}-optimize.md` (regenerated only
when the input hash changes) and appends a job summary for CI.

---

## `skill:progression`

Ranks the top officer upgrades by marginal utility across built-in task
classes (`mining`, `hostiles`, `armada`, `isolytic`, `pvp`, `utility`). The
progression analyzer uses hard-coded task-class tag groups in
`src/crew/progression.ts`; it does not iterate the task YAML files.

```bash
npm run skill:progression -- --account main
npm run skill:progression -- --all
```

| Flag | Default | Notes |
|---|---|---|
| `--account X` | — | Single account. Mutually exclusive with `--all`. |
| `--all` | — | Run against every roster in `data/crew/roster/` (skipping `demo.yaml`). |

**Output format:** text table followed by a single-line JSON summary. Example
from `npm run skill:progression -- --account demo`:

> Note: `generatedAt` and `stalenessDays` are replaced with placeholders; the actual CLI emits a fresh ISO-8601 timestamp and current staleness value per run.

```text
=== progression ===

Account: demo
Status: ok
Rank  Officer  Priority  Current    Reason
----  -------  --------  ---------  ----------------------------------------------------
1     chen     45.00     L35 R2 P1  Raises hostiles impact while closing level/rank gap.
2     pike     35.00     L45 R3 P2  Raises hostiles impact while closing level/rank gap.
{"skill":"progression","generatedAt":"<timestamp>","accounts":[{"account":"demo","status":"ok","stalenessDays":<N>,"docWrite":"written","docPath":"docs/crew/demo-progression.md","nextActions":[{"officerId":"chen","priority":45,"reason":"Raises hostiles impact while closing level/rank gap.","level":35,"rank":2,"promotions":1},{"officerId":"pike","priority":35,"reason":"Raises hostiles impact while closing level/rank gap.","level":45,"rank":3,"promotions":2}],"qualitySignals":[{"task_class":"pvp","covered_by_owned":1,"missing_high_value":19,"top_missing_officers":["mccoy","spock","sulu"]},{"task_class":"hostiles","covered_by_owned":2,"missing_high_value":12,"top_missing_officers":["sulu","chang","dajash-tolra"]},{"task_class":"utility","covered_by_owned":1,"missing_high_value":9,"top_missing_officers":["mccoy","spock","uhura"]},{"task_class":"armada","covered_by_owned":0,"missing_high_value":6,"top_missing_officers":["byr-chkelrer","chakotay","dajash-tolra"]},{"task_class":"mining","covered_by_owned":0,"missing_high_value":4,"top_missing_officers":["stonn","t-pring","tom-paris"]},{"task_class":"isolytic","covered_by_owned":0,"missing_high_value":2,"top_missing_officers":["locutus","seven-of-eleven"]}]}]}
```

Exit codes:

- Exit 0 = success, including partial success when at least one account
  produced a recommendation.
- Exit 1 = infrastructure/load failure, such as officer database, roster
  directory, or schema mismatch failure before per-account recommendation
  processing can proceed.
- Exit 2 = usage/selector error or all configured accounts degraded (for
  example, every selected roster is missing or malformed).

The skill also writes `docs/crew/{account}-progression.md` (regenerated
only when the input hash changes) and appends a job summary for CI.

---

## Automation

There is no `optimize-crew.yml` workflow in the repository. Run the optimizer
and progression skills locally to generate reports under `docs/crew/`.
`knowledge-rebuild.yml` only rebuilds `data/crew/knowledge-embeddings.json`;
it does not run the optimizer or regenerate account reports.

---

## Discord v2 commands

The read-only Discord message commands are implemented and reuse the committed
crew database, task definitions, and roster YAML.

Read-only Discord commands reuse the committed crew database, task
definitions, and roster YAML. Every account-scoped command requires
`--account X`; if omitted, the bot responds with the discovered roster file
names.

**Operator note:** Responses from `best`, `status`, `progression`, `roster show`, `knowledge`, and `officers` are rendered as plain Discord markdown strings and may be truncated to **1900 characters** to fit Discord's message limits. If
truncation occurs, the response ends with a footer suggesting you narrow the
query using available filters (e.g., `--owned`, `--faction`). The `synergy` and `tasks` commands produce fixed-shape output and do not truncate. Output is
**retrieval-only** — no LLM generation, no speculation; every byte is
traceable to a committed source.

### Reference table

| Command | Usage | Flags | Truncation behavior |
|---|---|---|---|
| `best` | `!crew best <task-id>` | `--account X` (req), `--top N` (opt, 1–3, def 1) | 1900-char footer with filter guidance |
| `status` | `!crew status` | `--account X` (req) | 1900-char limit (rarely hit; roster table is compact) |
| `progression` | `!crew progression` | `--account X` (req) | 1900-char footer with guidance |
| `roster show` | `!crew roster show` | `--account X` (req) | 1900-char footer with guidance |
| `explain` | `!crew explain <officer>` | `--account X` (req); officer id or case-insensitive name | 1900-char limit (single officer fits) |
| `synergy` | `!crew synergy <group>` | `--account X` (req); exact snake_case group name (case-insensitive input) | no truncation (fixed-shape output) |
| `tasks` | `!crew tasks` | `--account X` (req) | no truncation (fixed-shape output) |
| `officers` | `!crew officers` | `--account X` (req), `--owned` (opt), `--faction X` (opt) | 1900-char footer **requires** `--owned` or `--faction` to narrow |
| `knowledge` | `!crew knowledge <query>` | `--top N` (opt, 1–5, def 3) | 1900-char footer with guidance |

### Detailed usage

#### `!crew best <task-id> --account X [--top N]`

Ranks the top N legal crews for a task against your roster.

```
!crew best mining-g3 --account main
!crew best hostile-grind --account demo --top 3
```

**Flags:**
- `--account X` (required): Roster account name (`data/crew/roster/{X}.yaml` must exist)
- `--top N` (optional): Number of recommendations (1–3, default 1)

**Output:** Numbered crew recommendations with:
- Score (higher = better match; 0.00 = no matched signals)
- Captain, bridge officers, below-deck officers
- Matched tags and their weights (`tag(+weight)←contributor`)
- Synergy bonuses and groups
- Captain maneuver and officer ability summaries

**Example:**

```
**Crew best — mining-g3**
- account: `main`
- task: `mining-g3`
- top: 3

### #1 — score 0.00
\`\`\`text
captain   kirk
bridge    chen, scott
below     pike
\`\`\`
- matched tags: mining(+10)←task, exploration(+5)←kirk_maneuver, resilience(+3)←chen_ability
- synergies: federation_command (+10), minerology_experts (+5)
- captain maneuver: Boost mining yield
- officer abilities: Enhanced ore processing | Extended scan range
```

#### `!crew status --account X`

Summarizes roster freshness and validation (count of owned/unowned officers,
staleness level, unknown officer ids).

```
!crew status --account main
```

**Output:** A table of officer names, ownership status (yes/no), and for owned
officers: level, rank, promotions. Staleness level (`ok`/`warn`/`error`) and
staleness age in days. List of unknown officer ids (roster references an officer
not in `data/crew/officers.json`).

#### `!crew progression --account X`

Shows which officers to upgrade next for maximum impact across all task classes.

```
!crew progression --account main
```

**Output:** Two sections:
1. **Promotion order** — officers ranked by priority score (higher = bigger
   marginal gain). Each line shows: officer id, priority score, current state
   (L{level} R{rank} P{promotions}), and the reason (e.g., "Raises hostiles
   impact while closing level/rank gap").
2. **Missing high-value officers** — officers not in your roster that would
   yield large gains if obtained. Listed by task class (mining, hostiles,
   armada, isolytic, pvp, utility).

#### `!crew roster show --account X`

Displays your current roster entries (all officers, owned/unowned).

```
!crew roster show --account main
```

**Output:** Table with columns: id, owned (yes/no), level, rank, promotions.

#### `!crew explain <officer> --account X`

Looks up officer details by kebab-case id or case-insensitive name.

```
!crew explain kirk --account main
!crew explain "James T. Kirk" --account main
```

**Output:** Officer profile:
- Faction, BDA role, synergy groups
- Captain maneuver (text + tags)
- Officer ability (text + tags)
- Rank curve, added in patch, source citation

#### `!crew synergy <group> --account X`

Lists all members of a synergy group (case-insensitive input, matches exact
snake_case group name from the database).

```
!crew synergy federation_command --account main
!crew synergy FEDERATION_COMMAND --account main  # case-insensitive input
```

**Output:**
- Canonical group name (as stored in the database)
- Member count and member list: name (kebab-case id) — faction, BDA role

#### `!crew tasks --account X`

Lists available task definitions.

```
!crew tasks --account main
```

**Output:**
- Per-task line: \`{task-id}\` — {task-name}: {short description}

Built-in task ids: `mining-g3`, `hostile-grind`, `armada-25`,
`station-defense`. New tasks can be added to `data/crew/tasks/` — see
[Tasks](#tasks) section above.

#### `!crew officers --account X [--owned] [--faction X]`

Dumps the officer inventory, optionally filtered.

```
!crew officers --account main                   # all officers in database
!crew officers --account main --owned           # officers in your roster
!crew officers --account main --faction federation
!crew officers --account main --owned --faction klingon
```

**Flags:**
- `--owned` (optional): Show only officers in your roster
- `--faction X` (optional): Filter by faction (federation, klingon, romulan,
  independent, rogue, non_aligned; case-insensitive)

**Output:** Per-officer line: name (\`id\`) — faction, BDA role; roster state
(owned L{level} R{rank} P{promotions}, unowned, or not in roster); synergy
groups.

**Note:** Full output (all 37 officers) is ~3000 chars and truncates. Operators
are asked to use `--owned` or `--faction X` to narrow the results.

#### `!crew knowledge <query> [--top N]`

Retrieves knowledge from the embedded crew knowledge base without generation.
Query is matched against chunks from:
- `docs/stfc-game-knowledge.md` (domain reference)
- `data/crew/officers.json` (officer profiles)
- `data/crew/tasks/*.yaml` (task definitions)

```
!crew knowledge what are federation command synergies?
!crew knowledge mining gear requirements --top 5
```

**Flags:**
- `--top N` (optional): Number of results (1–5, default 3)

**Output:**
- Per-hit section: score (raw cosine similarity, -1..1), citation with line range,
  and 320-character preview of the matched chunk
- Citation format: `**source:LX-LY**` (e.g., `**docs/stfc-game-knowledge.md:L42-L58**`)
- Every byte is traceable to committed source files; no generation

**Example:**

```
**Crew knowledge — \`mining synergies\`** (top 3)

### #1 — score 0.843
**data/crew/officers.json:L142-L168**
\`\`\`text
Officer Scott (id: scott)
Faction: federation. Role: captain.
Synergy groups: federation_engineering, minerology_experts.
Captain maneuver: +15% mining yield per minerology_experts ally
Officer ability: Reduce ship power draw during extended mining…
\`\`\`

### #2 — score 0.781
**docs/stfc-game-knowledge.md:L423-L445**
\`\`\`text
Minerology synergy group bonuses:
- +5% ore value per member present in crew
- +2% mining duration reduction per promotion level of highest…
\`\`\`
```

### Knowledge embedding and rebuild

**Source files (auto-watched):**
- `docs/stfc-game-knowledge.md`
- `data/crew/officers.json`
- `data/crew/tasks/`

**Artifact:** `data/crew/knowledge-embeddings.json` — committed cache of chunked
and embedded knowledge. Built at:
1. **Push time:** The `knowledge-rebuild.yml` workflow watches the source paths
   and auto-rebuilds on change. Takes ~10 seconds; commits the updated
   `knowledge-embeddings.json` back to the branch.
2. **Manual rebuild:** Run `npm run crew:knowledge:rebuild -- --force` locally to force a
   rebuild; the bare command skips when sources are unchanged (useful for testing or offline development).

**CLI:** `npm run crew:knowledge:rebuild [--force]`

```bash
npm run crew:knowledge:rebuild              # rebuild if sources changed
npm run crew:knowledge:rebuild --force      # force rebuild even if unchanged
STFC_KNOWLEDGE_MODEL=minilm npm run crew:knowledge:rebuild    # use MiniLM embedder (opt-in)
```

**Environment variable:** `STFC_KNOWLEDGE_MODEL`
- Unset or `hashed` (default): Use hashed bag-of-words embedder (fast,
  offline, no network, ~384 dims, deterministic, no ML model download)
- `minilm`: Use Xenova/all-MiniLM-L6-v2 (requires network on first run to
  download ONNX weights, then cached locally, better semantic matching)

**Rebuild output:**
```
up-to-date: data/crew/knowledge-embeddings.json (<N> chunks, hash abcd1234…)
```

or (if changed):

```
rebuilt: data/crew/knowledge-embeddings.json (<N> chunks, hash efgh5678…)
```

**Workflow behavior (`knowledge-rebuild.yml`):**
1. Watches: `docs/stfc-game-knowledge.md`, `data/crew/officers.json`,
   `data/crew/tasks/**`
2. Triggers on: push to watched paths OR `workflow_dispatch` (manual run)
3. Runs: `npm run crew:knowledge:rebuild` with default embedder (hashed)
4. Commits back: If embeddings changed, commits
   `data/crew/knowledge-embeddings.json` with message
   `chore(crew): regen knowledge embeddings [skip ci]`
5. No periodic cron; pipeline is pure-compute and completes in seconds

---

The crew optimizer's Discord interface currently uses read-only `!crew`
message commands. The separate Discord interaction bridge exposes the
commands listed in `discord/commands.json`; crew slash commands are not
defined there.

See also `docs/stfc-game-knowledge.md` for the domain reference (officer
stats, faction synergy groups, BDA role taxonomy) that underpins the
officer database and scoring model.

---

## Troubleshooting

### Unknown-officer error

```text
ERROR: roster references officer 'X' which is not in data/crew/officers.json. Add the officer (PR welcomed) or remove it from the roster.
```

Source: `src/crew/database.ts` (`UNKNOWN_OFFICER_TEMPLATE`). The officer id
in your roster YAML does not exist in `data/crew/officers.json`. Either:

1. Fix the id spelling (kebab-case, e.g. `seven-of-eleven` not `7-of-11`).
2. Remove the entry from the roster with `skill:roster` if you don't own it.
3. Add the missing officer to `data/crew/officers.json` and file a PR.

### Stale roster

The optimizer emits a staleness banner but continues. To silence it,
refresh your roster by running `skill:roster add` or `skill:roster promote`
for any officer (this bumps `last_updated`). Or raise the thresholds via
`staleness_overrides` in the roster YAML.

### Missing task definition

```text
ERROR: Missing required --task <id>.
Usage: optimize-crew --task <id> [--account X | --all] [--top N]
```

or (from the task loader):

```text
ERROR: Could not load task "nope" (data/crew/tasks): Could not read task definition data/crew/tasks/nope.yaml: ENOENT: no such file or directory, open 'data/crew/tasks/nope.yaml'
```

Check `ls data/crew/tasks/` for the available ids, or add a new task YAML.

### Schema mismatch

```
Officer database schema mismatch in data/crew/officers.json at {path}: {message}
```

Source: `src/crew/database.ts`. The JSON at the named path failed zod
schema validation. The error message names the failing field. Run
`skill:roster validate` to surface roster-level schema issues separately.
If you've hand-edited `data/crew/officers.json`, compare against the shape
in `specs/004-crew-optimizer/contracts/officer-db.contract.md`.

### `Could not read officer database`

```
Could not read officer database data/crew/officers.json: ENOENT
```

The file is missing. Confirm you are running from the repo root and that
`data/crew/officers.json` is not in your `.gitignore`.
