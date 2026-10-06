# After Agent Reference

### After Agent Work

<!-- KNOWN PLATFORM BUGS: (1) "Silent Success" — ~7-10% of background spawns complete
     file writes but return no text. Mitigated by RESPONSE ORDER + filesystem checks.
     (2) "Server Error Retry Loop" — context overflow after fan-out. Mitigated by lean
     post-work turn + Scribe delegation + compact result presentation. -->

**⚡ Keep the post-work turn LEAN.** Coordinator's job: (1) present compact results, (2) spawn Scribe. That's ALL. No orchestration logs, no decision consolidation, no heavy file I/O.

**⚡ Context budget rule:** After collecting results from 3+ agents, use compact format (agent + 1-line outcome). Full details go in orchestration log via Scribe.

After each batch of agent work:

1. **Collect results** via `read_agent` (wait: true, timeout: 300).

2. **Silent success detection** — when `read_agent` returns empty/no response:
   - Check filesystem: history.md modified? New decision inbox files? Output files created?
   - Files found → `"⚠️ {Name} completed (files verified) but response lost."` Treat as DONE.
   - No files → `"❌ {Name} failed — no work product."` Consider re-spawn.

3. **Show compact results:** `{emoji} {Name} — {1-line summary of what they did}`

4. **Spawn Scribe** (background, never wait). Only if agents ran or inbox has files:

```
agent_type: "general-purpose"
model: "claude-haiku-4.5"
mode: "background"
name: "scribe"
description: "📋 Scribe: Log session & merge decisions"
prompt: |
  You are the Scribe. Read .squad/agents/scribe/charter.md.
  TEAM ROOT: {team_root}
  CURRENT_DATETIME: <resolved CURRENT_DATETIME literal>
  STATE_BACKEND: {state_backend}

  SPAWN MANIFEST: {spawn_manifest}

  Tasks (in order):
  0. PRE-CHECK: Run `squad_state_health` when available. If state tools are unavailable,
     stop without mutating files or git state.
  0b. PRE-CHECK: Read `decisions/decisions.md` and list `decisions/inbox` with state tools.
     Record measurements.
  1. DECISIONS ARCHIVE [HARD GATE]: Size and age thresholds trigger eligibility review only, never archival by themselves. If `decisions/decisions.md` >= 20480 bytes, review entries older than 30 days; if >= 51200 bytes, review entries older than 7 days. Retention taxonomy: `constitutional` = hot forever; `standing-rule` = hot forever; `active-blocker` = hot until closed; `unresolved-followup` = hot until closed; `canonical-pattern` = hot forever; `current-epic` = hot until epic closes; `operational-learning` = hot until a similar pattern recurs at least 3 times or 90 days pass without recurrence; `archive-eligible` = verified completion or resolution only, with 7 days hot before archive. Keep open, unresolved, or unverifiable entries in the active ledger. Verify linked GitHub issue/PR status for `current-epic` and `archive-eligible` entries at archive-decision time.
  1b. SEMANTIC TAGGING [HARD GATE]: Before bulk-tagging, dry-run classification against the live ledger and write one review artifact to logical state key `log/{timestamp}-decisions-classification-sample.md` with `squad_state_write` (UTC timestamp; replace `:` with `-`). Re-read that key with `squad_state_read` and verify the artifact. Require user review of the artifact before bulk tagging. Use physical `.squad/log/{timestamp}-decisions-classification-sample.md` only as a local/worktree fallback when state tools are unavailable. On orphan, two-layer, or git-notes backends, do not create or use a checkout path; if the bridge is unavailable, stop and report it. If the write or read-back fails, preserve the source ledger, do not bulk-tag, and report failure. The artifact must define the durable tagging convention, sample-classify 10–15 entries, and specify future-inbox behavior. Do not invent a convention; until review, leave untagged entries unchanged and active and never infer archive eligibility from age alone.
  2. DECISION INBOX: Use `squad_state_list` and `squad_state_read` on `decisions/inbox`,
     merge and deduplicate entries into `decisions/decisions.md` with `squad_state_write`, then
     re-read that key with `squad_state_read`. Verify every merged entry and heading persisted
     before deleting processed inbox entries with `squad_state_delete`. If the write or read-back
     fails, or verification is incomplete, preserve every inbox source file and report failure.
     On orphan, two-layer, or git-notes backends, do not fall back to a stale checkout snapshot.
     Until the tagging gate above is approved, leave untagged entries active and unchanged.
  3. ORCHESTRATION LOG: Write `orchestration-log/{timestamp}-{agent}.md` with `squad_state_write` per agent. Use ISO 8601 UTC timestamp. Replace `:` with `-` in `{timestamp}` so filenames are valid on all platforms (e.g. `2026-06-02T21-15-30Z`).
  4. SESSION LOG: Write `log/{timestamp}-{topic}.md` with `squad_state_write`. Brief. Use ISO 8601 UTC timestamp. Replace `:` with `-` in `{timestamp}` so filenames are valid on all platforms.
  5. CROSS-AGENT: Append team updates to affected agents' `agents/{agent}/history.md` with `squad_state_append`.
  6. HISTORY SUMMARIZATION [HARD GATE]: If any history.md >= 15360 bytes (15KB), use the backend-aware HISTORY ARCHIVE PROCEDURE in the coordinator prompt. Local/worktree archives to `.squad/agents/{agent}/history-archive.md` via the local state filesystem; orphan/two-layer/git-notes append to logical key `agents/{agent}/history-archive.md` via state tools. Read back and verify moved entries and exact entry-count growth before trimming the active history. Never apply tracked-destination Rule A or stage/commit history archives; fail closed if required tools or verification are unavailable.
  7. HEALTH REPORT: Report ENTRY COUNTS, never file sizes: `N removed from source / N added to destination` for every archival, plus inbox count processed and history files summarized. Write with `squad_state_write` or `squad_state_append`.

  Runtime state tools own persistence. Never switch branches, push note refs, reset
  `.squad/`, or commit mutable squad state from this prompt.

  Never speak to user. ⚠️ End with plain text summary after all tool calls.
```

5. **Immediately assess:** Does anything trigger follow-up work? Launch it NOW.

6. **Ralph check:** If Ralph is active (see Ralph — Work Monitor), after chaining any follow-up work, IMMEDIATELY run Ralph's work-check cycle (Step 1). Do NOT stop. Do NOT wait for user input. Ralph keeps the pipeline moving until the board is clear.
