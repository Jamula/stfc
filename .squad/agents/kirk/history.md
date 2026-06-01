# Kirk — History

> Append-only log of substantive technical decisions, architectural calls, and lessons learned. Scribe-owned commits.

## 2026-06-01 — PR #123 review: !crew command parser, Phase 19 (closes #91)

**Verdict:** APPROVE ✅ — Comment: https://github.com/Jamula/stfc/pull/123#issuecomment-4588860690

**Author:** Uhura. **Branch:** `squad/91-v2-parser`.

**Scope:** New `src/discord/crewCommandParser.ts` (229 LOC) + `tests/discord/crewCommandParser.test.ts` (150 LOC) + `data/discord/command-channels.json.example`. Edits to `schemas.ts`, `state.ts`, `ingest.ts`, `client.ts`, `discordMonitor.ts`, `tests/index.test.ts`. +556/-30.

**What I checked (pattern for parser + rate-limiter + monitor-integration PRs):**

1. **Scope isolation** — the critical invariant: promo-code extraction must not see command-channel messages. Verified by checking that `codeChannelIds` is built from `allowlist.entries` (original promo channels only), not from the merged `ingestAllowlist`. `codeMessages` then filters `ingestedMessages` against this set. Command messages pass through `processCrewCommands` separately. Fully isolated.
2. **Rate limiter rolling-window semantics** — `pruneWindow` rebuilds the value array on every call (filter + set), keeping per-key arrays bounded. Rejected commands return before `push`, so they don't count against limits. Both channel (10) and user (5) windows independent.
3. **Parser edge cases** — `isCrewCommandPrefix` checks `startsWith(PREFIX) && (next === undefined || /\s/.test(next))`. Handles: bare `!crew`, `!crew ` (trailing space), `!crewbest` (no boundary → false), `!Crew` (case sensitive → false). `tokenizeArgs` handles quoted strings and backslash escape. `parseArgs` treats `--` (exactly 2 dashes) as positional (end-of-flags convention).
4. **Backward compatibility** — `guild_id: optional()` on `DiscordMessageSchema` is additive. `discordMessages` field on `IngestOutput` is additive (existing callers ignore it). `loadCommandChannelAllowlist` returns `[]` on missing file.
5. **Constitution durable-inputs** — `data/discord/command-channels.json` is operator-local, not committed (only `.example` shipped). No constitution amendment needed. Deferred to #95 (confirmed OPEN).

**LOW findings (all non-blocking):**

- `CrewCommandRateLimiter` Map keys accumulate over process lifetime (values are bounded per key, but the key itself stays even after the array empties). Non-issue for restart-per-run (GHA). Tag for #92 if daemon model adopted.
- `withCommandChannels` hardcodes `version: 1` — safe for current schema but would need fixing at schema v2.
- PR body uses `## Verification` not `## Tests` (Rule 15 compliance gap — heading-only, substance was correct).
- `stats.ignored` inflated by non-crew messages from promo channels; surfaced only when `seen > 0 || rateLimited > 0`, so harmless.

**Handler seam assessment for #92:** `processCrewCommands` / `handleCrewCommand` are clean. `CrewCommand { subcommand, args, raw, message }` is a sufficient interface. Positional args available as `_0`, `_1`, `_`; flags drop `--` prefix. No rework needed for Phase 20 handler wires.

## Learnings

- **Parser PR review pattern:** The key invariant for any monitor-integration parser PR is scope isolation — verify the original channel set is used for existing pipelines, and only the merged/enriched set is used for new pipelines. In this repo, check `codeChannelIds` vs `ingestAllowlist`.
- **Rate-limiter sanity checks:** (1) Are values bounded? (values array pruned per call ✅) (2) Are rejected commands NOT registered? (early return before push ✅) (3) Are keys bounded? (NO — potential long-running concern; flag if daemon). (4) Is the window truly rolling, not fixed? (pruneWindow filters `ts > nowMs - WINDOW_MS` ✅ — note `>` not `>=`, so timestamps exactly at the boundary are excluded, which is the correct strict-window semantics).
- **Optional operator files** (not committed, only `.example` shipped) don't need constitution amendments. The constitution's committed durable-inputs list is for committed files only. `.example` is the discoverable convention.
- **`withCommandChannels` version field**: when building a new `DiscordAllowlist` from an existing one, carry `allowlist.version` forward rather than hardcoding. Catch this pattern in future allowlist manipulation PRs.

## 2026-06-01T01:25:00Z — Wave 3 close-out + Wave 4 fanout audit (Picard triage)
PR #124 (auth.ts + shell) open on `squad/005-phase1-dashboard`. Picard triage identifies Wave 4 #118 + #121 parallel-safe, queued for dispatch post-Kirk review gate.
