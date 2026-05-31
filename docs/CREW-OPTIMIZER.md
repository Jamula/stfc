# Crew Optimizer — Operator Guide

> v1 shipped. v1.5 (iPhone → Discord OCR loop) and v2 (interactive Discord
> `!crew` commands) are in development — see [Roadmap](#roadmap).

## What it does

The crew optimizer is a pure-compute, offline CLI feature that reads your
`data/crew/` inputs (officer database, task definitions, roster) and
produces two outputs: a ranked list of the **best legal crew for a given
task** (annotated with the scoring rationale), and a **progression report**
identifying which officer investments will yield the largest marginal gain
across the built-in task classes. No game-API traffic; no credentials required.
All logic runs locally or in CI via the `optimize-crew.yml` workflow when
it fires on changes to `data/crew/**`.

---

## Quick start

The `demo` account (`data/crew/roster/demo.yaml`) has a pre-populated
five-officer roster. Use it to verify your install before working with
your own account.

```bash
# 1. Get the best crew for G3 mining
npm run skill:optimize-crew -- --account demo --task mining-g3
```

```text
=== optimize-crew (task: mining-g3, top 3) ===

Account: demo
Status: ok
Rank  Score  Captain  Bridge  Below Deck  Rationale
----  -----  -------  ------  ----------  ---------
1     0.00   kirk     chen
{"skill":"optimize-crew","task":"mining-g3","topN":3,"generatedAt":"2026-05-31T22:31:02.229Z","accounts":[{"account":"demo","status":"ok","stalenessDays":0,"docWrite":"written","docPath":"docs/crew/demo-optimize.md","topCrews":[{"score":0,"captain":"kirk","bridge":["chen"],"belowDeck":[],"rationale":{"tags":[],"factionBonus":0,"synergyBonuses":[]}}]}]}
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

**Seeding:** The 37 v1 officers were hand-curated from
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

## Tasks

**Location:** `data/crew/tasks/*.yaml` (4 definitions at v1 launch)

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

Rosters are tracked by default so CI can regenerate `docs/crew/` reports.
To keep an account private, add to `.gitignore` (or `.git/info/exclude`
for a local-only override):

```
# private roster — not committed
data/crew/roster/main.yaml
```

The optimizer skips accounts whose file is absent and continues processing
other accounts. CI will not generate a `docs/crew/main-optimize.md` report
for the missing file.

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

```text
=== optimize-crew (task: mining-g3, top 3) ===

Account: demo
Status: ok
Rank  Score  Captain  Bridge  Below Deck  Rationale
----  -----  -------  ------  ----------  ---------
1     0.00   kirk     chen
{"skill":"optimize-crew","task":"mining-g3","topN":3,"generatedAt":"2026-05-31T22:31:02.229Z","accounts":[{"account":"demo","status":"ok","stalenessDays":0,"docWrite":"written","docPath":"docs/crew/demo-optimize.md","topCrews":[{"score":0,"captain":"kirk","bridge":["chen"],"belowDeck":[],"rationale":{"tags":[],"factionBonus":0,"synergyBonuses":[]}}]}]}
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

```text
=== progression ===

Account: demo
Status: ok
Rank  Officer  Priority  Current    Reason
----  -------  --------  ---------  ----------------------------------------------------
1     chen     45.00     L35 R2 P1  Raises hostiles impact while closing level/rank gap.
2     pike     35.00     L45 R3 P2  Raises hostiles impact while closing level/rank gap.
{"skill":"progression","generatedAt":"2026-05-31T22:31:02.291Z","accounts":[{"account":"demo","status":"ok","stalenessDays":0,"docWrite":"written","docPath":"docs/crew/demo-progression.md","nextActions":[{"officerId":"chen","priority":45,"reason":"Raises hostiles impact while closing level/rank gap.","level":35,"rank":2,"promotions":1},{"officerId":"pike","priority":35,"reason":"Raises hostiles impact while closing level/rank gap.","level":45,"rank":3,"promotions":2}],"qualitySignals":[{"task_class":"pvp","covered_by_owned":1,"missing_high_value":19,"top_missing_officers":["mccoy","spock","sulu"]},{"task_class":"hostiles","covered_by_owned":2,"missing_high_value":12,"top_missing_officers":["sulu","chang","dajash-tolra"]},{"task_class":"utility","covered_by_owned":1,"missing_high_value":9,"top_missing_officers":["mccoy","spock","uhura"]},{"task_class":"armada","covered_by_owned":0,"missing_high_value":6,"top_missing_officers":["byr-chkelrer","chakotay","dajash-tolra"]},{"task_class":"mining","covered_by_owned":0,"missing_high_value":4,"top_missing_officers":["stonn","t-pring","tom-paris"]},{"task_class":"isolytic","covered_by_owned":0,"missing_high_value":2,"top_missing_officers":["locutus","seven-of-eleven"]}]}]}
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

## Workflow

> **Status:** `optimize-crew.yml` is pending merge in PR #102 (O'Brien).
> The skills run manually today. This section documents the intended
> workflow behavior once #102 lands.

The `optimize-crew.yml` workflow triggers on:

- **Push** to paths matching `data/crew/**`
- **`workflow_dispatch`** (manual trigger)

No cron. Concurrency group: `stfc-crew-optimizer`.

On each run it:

1. Computes an input hash per account (officers + tasks + roster).
2. Runs `skill:optimize-crew --all` and `skill:progression --all` once per
   push to `data/crew/**`. Per-task iteration is not in v1; file a follow-up
   issue if needed.
3. Regenerates `docs/crew/{account}-optimize.md` and
   `docs/crew/{account}-progression.md` **only when the hash changed**.
4. Commits the regenerated docs via rebase-before-push (Rule 4).
5. Posts a job summary listing accounts that ran + accounts skipped
   (hash unchanged).

Permissions: `contents: write` for the commit step. All `uses:` pins are
full commit SHAs.

**Reading the output:** After a workflow run, the regenerated docs are at:

```
docs/crew/{account}-optimize.md
docs/crew/{account}-progression.md
```

The job summary (GitHub Actions UI → the workflow run → Summary tab) lists
which accounts regenerated and which were skipped.

---

## Roadmap

| Version | Status | Notes |
|---|---|---|
| **v1** | ✅ Shipped | Pure-compute optimizer + `skill:roster` family + `skill:optimize-crew` + `skill:progression` + hand-curated 37-officer DB |
| **v1.5 — iPhone OCR** | 🔬 In development | iPhone screenshot → Discord → OCR → PR loop for roster refresh. Gated on OCR POC passing its acceptance bar. Tracked in issues [#85](https://github.com/Jamula/stfc/issues/85)–[#90](https://github.com/Jamula/stfc/issues/90). |
| **v2 — Discord commands** | 🔬 In development | Read-only `!crew best`, `!crew progression`, `!crew knowledge <q>` interactive Discord commands. Gated on v1 ship + v2 design. Tracked in issues [#91](https://github.com/Jamula/stfc/issues/91)–[#95](https://github.com/Jamula/stfc/issues/95). |

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
