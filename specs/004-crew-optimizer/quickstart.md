# Quickstart — Crew Optimizer

> v1 walkthrough. v1.5 (Discord/OCR) and v2 (interactive `!crew`
> commands) are documented separately in `docs/CREW-OPTIMIZER.md`
> after they ship.

## Prerequisites

- The repo cloned locally.
- Node.js per `.nvmrc` installed; `npm ci` run.
- (Optional) `gh` CLI authenticated if you want to file an officer-DB PR.

## 1. Pick an account name

The roster file is named after the account: `data/crew/roster/main.yaml`,
`data/crew/roster/alt.yaml`, etc. The optimizer iterates over every
file in `data/crew/roster/` (skipping `demo.yaml`).

## 2. Bootstrap an empty roster

```bash
npm run skill:roster -- add --account main --officer kirk --level 60 --rank 3 --promotions 2
```

This:

- Creates `data/crew/roster/main.yaml` if it doesn't exist.
- Adds the kirk entry with the supplied stats.
- Bumps `last_updated` to the current UTC ISO timestamp.

Repeat for every owned officer. Unknown officer ids exit non-zero with
the verbatim error message (FR-010) — file a PR adding the officer to
`data/crew/officers.json` (or check spelling).

## 3. Validate

```bash
npm run skill:roster -- validate --account main
```

Exit 0 means the roster passes schema validation and every referenced
officer is present in the officer DB. Exit non-zero means a schema or
unknown-officer error — the message names the offender.

## 4. Ask for the best crew for a task

```bash
npm run skill:optimize-crew -- --account main --task mining-g3
```

Output (excerpt):

```
Top 3 crews for "G3 Mining Run" (account: main)

  1. Kirk + Chen + Carol — score 92
     matched: mining_rate (10 ← chen.captain), cargo_capacity (4 ← carol.officer)
     synergy: original_crew (kirk, chen, carol) +5
     captain maneuver: "Mining bonus: ..."
     officer abilities: "+15% cargo space"; "+10% mining speed"

  2. ...
```

## 5. Ask for progression recommendations

```bash
npm run skill:progression -- --account main
```

Output (excerpt):

```
Progression candidates for account: main

  1. Chen — promote to rank 3 (currently rank 2)
     marginal utility: 14 across [mining-g3, hostile-grind]
     unlocks the "original_crew" synergy on hostile-grind

  2. ...
```

## 6. Optional: opt out of committing your roster

If you'd rather not commit `data/crew/roster/main.yaml`, add this to
your `.gitignore` (or a local exclude in `.git/info/exclude`):

```
# private rosters
data/crew/roster/main.yaml
```

The optimizer will skip missing accounts with a warning and keep
processing other accounts. CI will not regenerate
`docs/crew/main.md` for an absent roster.

## 7. CI behaviour

On every push to `data/crew/**`, the `optimize-crew.yml` workflow:

1. Computes an input hash per account (officers + tasks + roster).
2. Regenerates `docs/crew/{account}.md` **only** when the hash changed.
3. Commits the regenerated files via rebase-before-push (Rule 4).
4. Posts a job summary listing accounts that ran + accounts that
   skipped (hash unchanged).

No cron. No periodic regeneration. New concurrency group:
`stfc-crew-optimizer`.

## 8. Forward reference: v1.5 and v2

When the OCR POC passes its acceptance bar (issue #85), v1.5 adds an
iPhone → Discord → PR loop so you can refresh the roster from your
phone. See `docs/CREW-OPTIMIZER.md#discord-bootstrap` after #88 lands.

When v1 ships, v2 adds read-only `!crew` interactive Discord
commands (`!crew best`, `!crew progression`, `!crew knowledge <q>`,
etc.). See `docs/CREW-OPTIMIZER.md#discord-commands` after #92 lands.
