# Skill: Re-register Orphaned Test Imports

**Category:** Test reliability  
**Owner:** Bashir  
**Last updated:** 2026-05-18T04:00:10Z

## Problem

A refactor removes import lines from `tests/index.test.ts` but leaves the
test files on disk. The tests compile and run in isolation but are silently
skipped by the full `npm test` suite. The pinning they provide is lost without
any visible failure.

## Detection

```bash
# Find .test.ts files NOT referenced in tests/index.test.ts
for f in $(find tests/ -name '*.test.ts' | grep -v 'index.test.ts'); do
  rel="${f#tests/}"
  grep -q "\"\./${rel%.ts}\"" tests/index.test.ts \
    || echo "ORPHANED: $f"
done
```

## Fix

Re-add the import lines to `tests/index.test.ts` in the correct position
(usually grouped by feature area, next to the other test for the same script):

```ts
import "./scripts/discord-ops/partial-success.test.ts";
import "./scripts/discord-ops/endpoint-narrowing.test.ts";
```

Run `npm test` to confirm the suite count increases by the number of tests
in the re-registered files.

## When to Apply

- After any refactor that touches `tests/index.test.ts`.
- After a `git diff` shows deleted import lines with the file still present.
- During PR review: check that every `tests/**/*.test.ts` has a corresponding
  import in `tests/index.test.ts`.

## Pattern origin

Observed in commit b01ffdf (2026-05-18): dropped `partial-success.test.ts`
and `endpoint-narrowing.test.ts` imports but kept both files, silently
de-registering ~9 tests covering partial-success and endpoint-narrowing
invariants.
