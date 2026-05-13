# Skill: Hostile Fact-Check

**Owner:** Borg Queen (Critic)
**Trigger:** Any plan review gate that makes concrete claims about the live repo.

## Purpose

Verify every falsifiable claim in a plan/spec against ground truth before
the team builds on those claims. Plans that ship with wrong numbers become
wrong tests, wrong configs, and wrong assumptions — the cost compounds.

## Checklist

### 1. Regex coverage
- Extract the proposed regex from the plan.
- Run it against every non-comment line in the target file (e.g., `promo-codes.txt`).
- Use `grep -P '<regex>'` on each line; report misses as P0.
- Check the plan's stated count against `wc -l` on the actual file.

### 2. Dependency metadata
- For every new npm dependency, run:
  ```
  npm view <pkg> dist.unpackedSize version license
  npm view <pkg> dependencies
  ```
- Sum unpacked sizes including transitive deps.
- Compare against the plan's stated install size.
- Verify license claims.

### 3. Cron expressions
- Read the actual `cron:` line from every referenced workflow YAML.
- Translate to human-readable cadence.
- Compare against the plan's prose description. "Same cadence" claims
  are wrong more often than they are right.

### 4. Concurrency groups
- `grep 'group:' .github/workflows/*.yml` across all workflows.
- Byte-compare the literal string. Whitespace, casing, prefix — every character.

### 5. Enumeration counts ("N new files", "M codes", etc.)
- Never trust prose counts. Always re-count programmatically.
- `ls`, `wc -l`, `find | wc -l` against the actual repo.

### 6. Function/type name references
- When the plan references an existing function by name, verify the name
  exists in the actual source file.
- `grep -n 'export.*function\|export.*const' <file>` catches mismatches.

### 7. Model/artifact pinning
- If the plan claims a SHA-256 pin, verify the hash exists as a concrete
  value (not just a schema field).
- If possible, download the artifact and verify. If not, flag as
  "unverifiable — no concrete hash provided."

### 8. Workflow parity
- When a new workflow claims to mirror patterns from an existing one
  (e.g., git push with rebase, concurrency, timeout), diff the relevant
  sections. Missing safety patterns (like `git pull --rebase`) are findings.
