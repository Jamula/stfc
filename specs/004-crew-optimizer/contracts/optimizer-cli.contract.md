# Contract — Optimizer CLI surface

> Three skills are registered in `src/cli.ts`: `skill:roster` (subcommand
> family), `skill:optimize-crew`, `skill:progression`. All three return
> `{ result, exitCode }` from their `src/skills/*.ts` module and
> `src/cli.ts` is the only file that calls `process.exit`.

## `skill:roster <subcommand> [flags]`

| Subcommand | Flags | Exit | Side-effects |
|---|---|---|---|
| `status`   | `--account X` (optional; all if omitted) | 0 (informational) | None. |
| `add`      | `--account X --officer Y [--level N] [--rank R] [--promotions P]` | 0 / 1 (unknown officer) | Writes `data/crew/roster/{account}.yaml` (creates if absent), bumps `last_updated`. |
| `promote` | `--account X --officer Y --level +N` (also accepts absolute `--level N`) | 0 / 1 | Same. |
| `rankup`   | `--account X --officer Y [--rank +1 \| --rank R]` | 0 / 1 | Same. |
| `validate` | `--account X` (optional; all if omitted) | 0 / 1 | None — read-only check. |

### Exit codes (per `runAll` convention, FR-009)

- `0` — success or successful informational completion.
- `1` — infrastructure-class error (schema failure, unknown officer,
  file-system error). The CLI emits the verbatim FR-010 message for
  unknown officers.
- `2` — unknown / missing subcommand (delegated to `src/cli.ts`
  dispatch error).

### Stable YAML round-trip

Every maintenance subcommand (`add`, `promote`, `rankup`):

- Sorts `officers[]` by `id`.
- Writes keys in the canonical order (`account`, `last_updated`,
  `staleness_overrides`, `officers`).
- Bumps `last_updated` to the current UTC ISO timestamp.
- Is **idempotent** — running the same command twice with the same
  args yields the same file the second time (modulo `last_updated`,
  which always advances).

## `skill:optimize-crew --account X --task T [--top N]`

| Flag | Default | Notes |
|---|---|---|
| `--account` | _none — required_ | Roster file `data/crew/roster/{X}.yaml` must exist. |
| `--task` | _none — required_ | Task file `data/crew/tasks/{T}.yaml` must exist. |
| `--top` | `3` | Number of recommendations to return. |

### Output

Human-readable ranked list to stdout. Schema:

```
Top {N} crews for "{task.name}" (account: {X})
  Roster last updated: {iso}. Age: {N} days. [staleness banner if applicable]

  1. {captain} + {officer_a} + {officer_b} — score {N}
     matched: {tag} ({weight} ← {contributor}), ...
     synergy: {group} ({members}) +{bonus}
     captain maneuver: "{text}"
     officer abilities: "{a-text}"; "{b-text}"

  2. ...
```

### Exit codes

- `0` — recommendations rendered.
- `1` — schema/load error, unknown task, unknown officer (FR-010),
  missing roster (the operator opted out via `.gitignore`).

## `skill:progression --account X`

Returns the top progression candidates for the account against the
operator's full task mix.

### Output

```
Progression candidates for account: {X}
  Roster last updated: {iso}. Age: {N} days. [staleness banner]

  1. {officer.name} — {current state} → {next state}
     marginal utility: {N} across [{task ids}]
     rationale: {short prose}

  2. ...
```

### Exit codes

- `0` — list rendered.
- `1` — schema/load error or unknown officer (FR-010).

## Workflow contract — `.github/workflows/optimize-crew.yml`

| Field | Value |
|---|---|
| Triggers | `push` (paths: `data/crew/**`), `workflow_dispatch` |
| Cron | **none** |
| Concurrency group | `stfc-crew-optimizer` |
| Permissions | `contents: write` for the report-commit step; `contents: read` for the optimize step |
| Third-party action pins | every `uses:` MUST be a full commit SHA with the version in a trailing comment |
| Push policy | rebase-before-push (Rule 4) for the report-commit step |
| Outputs | `docs/crew/{account}.md` per account (regenerated only on input-hash change); GitHub Actions job summary |
| Optional output | Discord post to `#stfc-recommendations` channel — gated by an opt-in `OPTIMIZER_DISCORD_CHANNEL` config |

Pinning test (Rule 3): `tests/skills/optimizeCrew.test.ts` asserts the
above values literally.

## v1.5 / v2 surfaces

Out of scope for v1 contracts. Documented in their own contracts when
the respective amendments land (v1.5 amendment in issue #81, v2
amendment in issue #93). Forward references only.
