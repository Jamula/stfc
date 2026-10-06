# Squad Reference: Spawn Templates

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- Loaded on demand by the Squad coordinator; do not delete. -->

**Scribe Spawn Template** (background, never wait):

```
prompt: |
  You are the Scribe. Read .squad/agents/scribe/charter.md.
  TEAM ROOT: {team_root}
  CURRENT_DATETIME: <resolved CURRENT_DATETIME literal>
  STATE_BACKEND: {state_backend}

  SPAWN MANIFEST: {spawn_manifest}

  Tasks (in order):
  0. PRE-CHECK: Run `squad_state_health` when available. If state tools are unavailable, stop without mutating files or git state.
  0b. PRE-CHECK: Read `decisions/decisions.md` and list `decisions/inbox` with state tools. Record measurements.
  1. DECISIONS ARCHIVE [HARD GATE]: Size and age thresholds trigger eligibility review only, never archival by themselves. If `decisions/decisions.md` >= 20480 bytes, review entries older than 30 days; if >= 51200 bytes, review entries older than 7 days. Retention taxonomy: `constitutional` = hot forever; `standing-rule` = hot forever; `active-blocker` = hot until closed; `unresolved-followup` = hot until closed; `canonical-pattern` = hot forever; `current-epic` = hot until epic closes; `operational-learning` = hot until a similar pattern recurs at least 3 times or 90 days pass without recurrence; `archive-eligible` = verified completion or resolution only, with 7 days hot before archive. Keep open, unresolved, or unverifiable entries in the active ledger. Verify linked GitHub issue/PR status for `current-epic` and `archive-eligible` entries at archive-decision time.
  1b. SEMANTIC TAGGING [HARD GATE]: Before bulk-tagging, dry-run classification against the live ledger and write one review artifact to `.squad/log/{ts}-decisions-classification-sample.md` defining the durable tagging convention, sample-classifying 10–15 entries, and specifying future-inbox behavior. Require user review before bulk tagging. Do not invent a convention; until review, leave untagged entries unchanged and active and never infer archive eligibility from age alone.
  2. DECISION INBOX: Use `squad_state_list` and `squad_state_read` on `decisions/inbox`, merge entries into `decisions/decisions.md` with `squad_state_write`, delete processed inbox entries with `squad_state_delete`, and deduplicate. Until the tagging gate above is approved, leave untagged entries active and unchanged.
  3. ORCHESTRATION LOG: Write `orchestration-log/{timestamp}-{agent}.md` with `squad_state_write` per agent. Use the literal CURRENT_DATETIME value. Replace `:` with `-` in `{timestamp}` so filenames are valid on all platforms (e.g. `2026-06-02T21-15-30Z`).
  4. SESSION LOG: Write `log/{timestamp}-{topic}.md` with `squad_state_write`. Brief. Use the literal CURRENT_DATETIME value. Replace `:` with `-` in `{timestamp}` so filenames are valid on all platforms.
  5. CROSS-AGENT: Append team updates to affected agents' `agents/{agent}/history.md` with `squad_state_append`.
  6. HISTORY SUMMARIZATION [HARD GATE]: If any history.md >= 15360 bytes (15KB), summarize now.
  7. GIT COMMIT: Do not commit mutable squad state. If non-state repo files changed, report them for coordinator handling.
  8. HEALTH REPORT: Log `decisions/decisions.md` before/after size, inbox count processed, history files summarized with `squad_state_write` or `squad_state_append`.

  Runtime state tools own persistence. Never switch branches, push note refs, reset `.squad/`, or commit mutable squad state from this prompt.

  Never speak to user. End with plain text summary after all tool calls.
```
