# Skill: dispatch-precheck

**Scope:** Coordinator / agent-dispatch coordination  
**Owner:** Scribe (documented); Coordinator (execution)  
**Version:** 1.0.0  
**Created:** 2026-05-18T02:21:30Z

## Purpose

Prevent no-op dispatches of `speckit.implement` when the target issue has already been resolved (closed, merged, or superseded).

## Trigger

Before dispatching `speckit.implement` for any issue N:

```bash
gh issue view N --json state,closedAt --jq '"\(.state) \(.closedAt)"'
```

## Decision Tree

| Condition | Action |
|-----------|--------|
| `OPEN` + `closedAt: null` | ✅ Proceed with dispatch |
| `CLOSED` + `closedAt: <timestamp>` | ❌ Abort. Report to user: "Issue #N was closed on <date>. No dispatch needed." |
| `MERGED` (PR state, if applicable) | ❌ Abort. Report to user: "Issue #N was merged as PR #X on <date>. No dispatch needed." |

## Example

```bash
# Correct flow (Issue #51 already merged on 2026-05-17)
$ gh issue view 51 --json state,closedAt
{"state":"CLOSED","closedAt":"2026-05-17T21:41:34Z"}

# Coordinator action:
# ❌ Abort dispatch. Report: "Issue #51 was closed on 2026-05-17T21:41:34Z (merged as PR #59). No dispatch needed."
```

## Related Rules

- **Repo Rule 5:** `/speckit.implement` commits at phase boundaries. Prevents phased dispatch to wrong branches.
- **Repo Rule 6:** "ship it" ritual codifies merge-to-main sequence. Dispatch checks assume issue state reflects main, not ahead of it.

## Cross-ref Incident

- **2026-05-18T02:21:30Z:** Coordinator skipped this check on issue #51. Issue had been merged 21 hours prior. Led to no-op dispatch and wasted cycle. Skill added to prevent recurrence.

