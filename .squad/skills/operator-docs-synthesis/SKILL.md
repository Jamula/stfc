# Skill: operator-docs-synthesis

**Owner:** Tuvok (editorial)
**Extracted:** 2026-05-31 from issue #83 (crew optimizer docs)
**Reuse signal:** v1.5 and v2 docs will follow the same pattern.

## Purpose

Synthesize an operator-facing reference guide from an existing speckit
pipeline (spec.md, plan.md, research.md, data-model.md, contracts/*.md)
plus live source files, without authoring new principles or design decisions.

## When to invoke

- A feature has shipped (all implementation phases closed).
- No `docs/{FEATURE}.md` exists yet.
- The spec/plan/contracts and source are the authoritative inputs.

## Steps

1. **Inventory inputs.** List: spec.md, plan.md, research.md, data-model.md,
   contracts/*.md, relevant src/ files, any quickstart.md.

2. **Verify numeric claims before writing.** For every count, threshold,
   or default:
   - Officer count: `python3 -c "import json; print(len(json.load(open('data/crew/officers.json'))))"`
   - Staleness thresholds: grep src/ for the actual constants.
   - Flags: read src/skills/*.ts, not only the contracts.

3. **Check workflow landed.** `git log origin/main --oneline | grep workflow-name`.
   If not landed, document as "pending PR #N" rather than asserting shipped.

4. **Assemble guide sections** in this order:
   - What it does (1 para, from spec summary)
   - Quick start (use the demo/fixture file as the example)
   - Data layer sections (DB / tasks / rosters), sourced from contracts
   - Skill reference sections (flags + output format from contracts + src)
   - Workflow section (from workflow contract; note pending if not yet merged)
   - Roadmap (from spec; link to issues)
   - Troubleshooting (error messages verbatim from src/; cross-ref schema)

5. **Cross-references.** README → docs/FEATURE.md; docs/FEATURE.md →
   docs/stfc-game-knowledge.md and quickstart.md (if it exists).

6. **Promote "preview" label** from README section header once all guide
   sections are filled and the feature is confirmed shipped.

7. **Test.** `npm test` must pass. README changes rarely break tests, but
   check for README-pinning tests with `grep -rn "README" tests/`.

8. **Single commit.** Stage `README.md` and `docs/FEATURE.md` individually
   (Rule 2: never `git add .`). Commit message:
   `docs({spec-folder}): Phase N — operator docs synthesis ({task-id})`

## Gap protocol

If a required section needs genuinely novel authoring (not assembly), STOP.
Write the gap to `.squad/decisions/inbox/{agent}-docs-gap.md` and ship what
you can. Do not improvise design decisions.
