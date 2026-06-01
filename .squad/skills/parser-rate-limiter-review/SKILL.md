---
name: "parser-rate-limiter-review"
description: "Checklist for reviewing Discord command parser + rate-limiter PRs integrated into a monitor skill"
domain: "code-review"
confidence: "high"
source: "extracted from Kirk PR #123 review, 2026-06-01"
---

## Context

PRs that add a command parser + in-memory rate limiter piggybacked onto an existing Discord monitor skill. Applies directly to the `discordMonitor.ts` + `crewCommandParser.ts` pattern and generalises to similar monitor integrations.

## Review Checklist

### 1. Scope isolation (CRITICAL)
The most important invariant in a merged-ingest / separated-processing design:
- [ ] The **original** channel allowlist (not the merged one) is used to build `codeChannelIds` or equivalent filter.
- [ ] Existing pipeline steps (promo-code extraction, tip classification, etc.) filter `ingestedMessages` against the original channel set.
- [ ] New pipeline steps (command processing) use the full `ingestOut.discordMessages` (or equivalent) covering both original and new channels.
- [ ] No cross-contamination path exists between the two sets.

### 2. Rate-limiter correctness (four invariants)
- [ ] **Values bounded:** per-key arrays are pruned on every `check()` call (rolling window filter applied before comparison).
- [ ] **Rejected not counted:** rejected calls return before the timestamp is pushed into any window.
- [ ] **Window semantics:** boundary comparison is `ts > nowMs - WINDOW_MS` (strict `>`), not `>=`. This is the correct strictly-rolling semantics.
- [ ] **Keys bounded (long-running concern):** Map keys accumulate if the process runs indefinitely. For restart-per-run (GHA), this is a non-issue. For daemon models, flag for a periodic cleanup sweep.

### 3. Parser edge cases
- [ ] Prefix word-boundary check: `!crewbest` should NOT match; `!crew` (bare) should default to `help`.
- [ ] Case sensitivity matches documented behavior (check the spec).
- [ ] Quoted args parsed correctly (single + double quotes).
- [ ] Backslash escape in quoted context handled.
- [ ] `--` (exactly 2 dashes) treated as positional (end-of-flags convention), not a flag key.
- [ ] Empty allowlist → `undefined` / no-op (guard before any further parsing).

### 4. Backward compatibility
- [ ] Any schema extension uses `.optional()` (additive, never removes a required field).
- [ ] Any new field on an existing output type is additive (existing callers ignore it).
- [ ] Loader for new operator file returns a safe default (e.g., `[]`) on missing file.

### 5. Constitution / durable-inputs check
- [ ] Is the new operator file committed or operator-local? If operator-local, no constitution amendment needed.
- [ ] Is the `.example` file committed so operators can discover the schema?
- [ ] Does the PR defer full docs to a follow-up issue? If so, confirm the follow-up issue is OPEN.

### 6. `withXxx` allowlist merge functions
- [ ] Carry `source.version` forward; don't hardcode a version literal.
- [ ] Use a dedup key of the form `serverId:channelId` (or equivalent composite key) to avoid duplicate entries.

### 7. Metrics / stats counting
- [ ] Are `seen` / `ignored` / `processed` / `rateLimited` counts semantically correct?
- [ ] Will `ignored` be inflated by messages from channels outside the new feature's scope? If the input includes messages from other-purpose channels, note whether the inflation is logged or suppressed.

### 8. Tests
- [ ] Rate-limiter: test the (N+1)th command for both channel and user limits with a deterministic clock.
- [ ] Parser: test prefix word boundary, case sensitivity, quoted args with flags, empty allowlist.
- [ ] Help command: assert every planned subcommand appears in the help text.
- [ ] Non-help stub: assert the reply text contains the subcommand name.
- [ ] `tests/index.test.ts` import added.

## Anti-Patterns to Flag

- ❌ Building `codeChannelIds` from the merged allowlist — contaminates existing pipelines with new channels.
- ❌ Pushing a rejected command's timestamp before returning — inflates the window count.
- ❌ `>= WINDOW_MS` in the pruning cutoff — includes boundary timestamps twice.
- ❌ Hardcoding `version: 1` in a function that reconstructs an allowlist object.
- ❌ Logging `ignored` count unconditionally — inflated counts spam the log in high-traffic channels.

## Reference Implementations

- **Scope isolation (good):** `src/skills/discordMonitor.ts` lines ~161–254 (PR #123)
- **Rate limiter (good):** `src/discord/crewCommandParser.ts` `CrewCommandRateLimiter` + `pruneWindow` (PR #123)
- **Parser (good):** `src/discord/crewCommandParser.ts` `tokenizeArgs` + `parseArgs` (PR #123)
