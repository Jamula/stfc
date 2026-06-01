> On-demand PRD/spec intake flow. Load on `here's the PRD/spec`, `read the PRD/spec at <path>`, or the long-paste PRD heuristic.

## Trigger Contract

- Literal substring: user message contains `here's the PRD` or `here's the spec` (case-insensitive).
- Regex pattern: `read\s+the\s+(prd|spec)\s+at\s+(\S+)`.
- Long-paste heuristic: user pastes ≥40 lines containing 3+ of `requirement`, `acceptance criteria`, `user story`, `must`, `should`.

## PRD Mode

Squad can ingest a PRD and use it as the source of truth for work decomposition and prioritization.

**On-demand reference:** Read `.squad/templates/prd-intake.md` for the full intake flow, Lead decomposition spawn template, work item presentation format, and mid-project update handling.

### Triggers

| User says | Action |
|-----------|--------|
| "here's the PRD" / "work from this spec" | Expect file path or pasted content |
| "read the PRD at {path}" | Read the file at that path |
| "the PRD changed" / "updated the spec" | Re-read and diff against previous decomposition |
| (pastes requirements text) | Treat as inline PRD |

**Core flow:** Detect source → store PRD ref in team.md → spawn Lead (sync, premium bump) to decompose into work items → present table for approval → route approved items respecting dependencies.

---
