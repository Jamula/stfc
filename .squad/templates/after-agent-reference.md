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
  1. DECISIONS ARCHIVE [HARD GATE]: Treat size and age thresholds as review triggers, not automatic
     archival eligibility. If `decisions/decisions.md` >= 20480 bytes, review entries older than
     30 days; if >= 51200 bytes, review entries older than 7 days. Archive only entries verified
     complete or resolved. Keep any entry or item with open/unresolved status, active blockers,
     open linked issues, or unverifiable status in the active ledger. If status cannot be
     confirmed, leave the entry in the active ledger. Do not skip this review.
  2. DECISION INBOX: Use `squad_state_list` and `squad_state_read` on `decisions/inbox`,
     merge only accepted, current durable decisions into `decisions/decisions.md` with
     `squad_state_write`, and deduplicate exact duplicate decision headings without
     rewriting unrelated decisions. Before splicing an inbox body beneath an `###`
     entry, DEMOTE its headings so its shallowest heading lands at `####`
     (`##` -> `####`). Preserve relative structure and fenced code blocks.
     Never emit an `##` under an `###`.
  3. VERIFY: Re-read `decisions.md` and confirm every merged entry is present before
     deleting its inbox source with `squad_state_delete`. If verification fails,
     leave the inbox source intact and report the failure.
  4. REPORT: Return the merge result and any non-state repo changes to the coordinator
     in plain text only. Do not write orchestration logs, session logs, specialist
     histories, archival records, or health reports to state.

  Runtime state tools own persistence. Never switch branches, push note refs, reset
  `.squad/`, or commit mutable squad state from this prompt.

  Never speak to user. ⚠️ End with plain text summary after all tool calls.
```

5. **Immediately assess:** Does anything trigger follow-up work? Launch it NOW.

6. **Ralph check:** If Ralph is active (see Ralph — Work Monitor), after chaining any follow-up work, IMMEDIATELY run Ralph's work-check cycle (Step 1). Do NOT stop. Do NOT wait for user input. Ralph keeps the pipeline moving until the board is clear.
