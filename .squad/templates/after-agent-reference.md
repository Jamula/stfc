# After Agent Reference

### After Agent Work

<!-- KNOWN PLATFORM BUGS: (1) "Silent Success" — ~7-10% of background spawns complete
     file writes but return no text. Mitigated by RESPONSE ORDER + filesystem checks.
     (2) "Server Error Retry Loop" — context overflow after fan-out. Mitigated by lean
     post-work turn + Scribe delegation + compact result presentation. -->

**⚡ Keep the post-work turn LEAN.** Coordinator's job: (1) present compact results, (2) spawn Scribe only when accepted durable decisions require merging. That's ALL. No orchestration logs, no decision consolidation, no heavy file I/O.

**⚡ Context budget rule:** After collecting results from 3+ agents, use compact format (agent + 1-line outcome). Report follow-up details to the coordinator without creating state records.

After each batch of agent work:

1. **Collect results** via `read_agent` (wait: true, timeout: 300).

2. **Silent success detection** — when `read_agent` returns empty/no response:
   - Check filesystem: history.md modified? New decision inbox files? Output files created?
   - Files found → `"⚠️ {Name} completed (files verified) but response lost."` Treat as DONE.
   - No files → `"❌ {Name} failed — no work product."` Consider re-spawn.

3. **Show compact results:** `{emoji} {Name} — {1-line summary of what they did}`

4. **Spawn Scribe** (background, never wait). Only when accepted durable decisions require merging:

```
agent_type: "general-purpose"
model: "claude-haiku-4.5"
mode: "background"
name: "scribe"
description: "📋 Scribe: Merge durable decisions"
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
  1. DECISIONS ARCHIVE [HARD GATE]: Size and age thresholds trigger eligibility review only, never
     archival by themselves. If `decisions/decisions.md` >= 20480 bytes, review entries older than
     30 days; if >= 51200 bytes, review entries older than 7 days. Retention taxonomy:
     `constitutional` = hot forever; `standing-rule` = hot forever; `active-blocker` = hot until
     closed; `unresolved-followup` = hot until closed; `canonical-pattern` = hot forever;
     `current-epic` = hot until epic closes; `operational-learning` = hot until a similar pattern
     recurs at least 3 times or 90 days pass without recurrence; `archive-eligible` = verified
     completion or resolution only, with 7 days hot before archive. Keep open, unresolved, or
     unverifiable entries in the active ledger. Verify linked GitHub issue/PR status for
     `current-epic` and `archive-eligible` entries at archive-decision time. Do not skip this review.
  1b. SEMANTIC TAGGING [HARD GATE]: Before bulk-tagging, dry-run classification against the live ledger and write one review artifact to logical state key `log/{timestamp}-decisions-classification-sample.md` (UTC timestamp; replace `:` with `-`). Re-read that key with `squad_state_read` and verify the artifact. Require user review of the artifact before bulk tagging. Use physical `.squad/log/{timestamp}-decisions-classification-sample.md` only as a local/worktree fallback when state tools are unavailable. On orphan, two-layer, or git-notes backends, do not create or use a checkout path; if the bridge is unavailable, stop and report it. If the write or read-back fails, preserve the source ledger, do not bulk-tag, and report failure. The artifact must define the durable tagging convention, sample-classify 10–15 entries, and specify future-inbox behavior. Do not invent a convention; until review, leave untagged entries unchanged and active and never infer archive eligibility from age alone. Write the artifact with `squad_state_write`.
  2. DECISION INBOX: Use `squad_state_list` and `squad_state_read` on `decisions/inbox`,
     merge only accepted, current durable decisions into `decisions/decisions.md` with
     `squad_state_write`, and deduplicate exact duplicate decision headings without
     rewriting unrelated decisions. Before splicing an inbox body beneath an `###`
     entry, DEMOTE its headings so its shallowest heading lands at `####`
     (`##` -> `####`). Preserve relative structure and fenced code blocks.
     Never emit an `##` under an `###`. Until the tagging gate above is approved,
     leave untagged entries active and unchanged.
  3. VERIFY: Re-read `decisions/decisions.md` with `squad_state_read` and confirm every merged entry is present before deleting its inbox source with `squad_state_delete` — Verify every merged entry and heading persisted, and preserve every inbox source file until that verification completes. If verification fails, leave the inbox source intact and report the failure; on orphan, two-layer, or git-notes backends, do not fall back to a stale checkout snapshot.
  4. REPORT: Return the merge result and any non-state repo changes to the coordinator
     in plain text only. Do not write orchestration logs, session logs, specialist
     histories, archival records, or health reports to state.

  HISTORY ARCHIVE PROCEDURE (backend-owned mutable state): If any `history.md` grows oversized, use the backend-aware procedure in the coordinator prompt. For local/worktree, archive through `.squad/agents/{agent}/history-archive.md` on the local state filesystem; for orphan, two-layer, or git-notes, use logical key `agents/{agent}/history-archive.md` through state tools. Verify archived entries and exact count growth before trimming. Never apply the tracked-destination rule or stage/commit history archives.

  Runtime state tools own persistence. Never switch branches, push note refs, reset
  `.squad/`, or commit mutable squad state from this prompt.

  Never speak to user. ⚠️ End with plain text summary after all tool calls.
```

5. **Immediately assess:** Does anything trigger follow-up work? Launch it NOW.

6. **Ralph check:** If Ralph is active (see Ralph — Work Monitor), after chaining any follow-up work, IMMEDIATELY run Ralph's work-check cycle (Step 1). Do NOT stop. Do NOT wait for user input. Ralph keeps the pipeline moving until the board is clear.
