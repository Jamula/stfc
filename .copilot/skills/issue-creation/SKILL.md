---
name: "issue-creation"
description: "GitHub issue creation conventions for the stfc-gift-redeemer squad"
domain: "github-workflow"
confidence: "high"
source: "manual"
---

## Context

Every issue created by a squad member in the Jamula/stfc repository must follow the label convention defined here. This ensures correct routing through the squad triage workflow and clear attribution of ownership.

## Label Convention

| Label | Purpose | Required? |
|-------|---------|-----------|
| `squad` | Marks the issue for squad triage / awareness | ✅ Always |
| `squad:{agent-name}` | Author attribution + ownership routing | ✅ Always (at least one) |
| `bug` / `enhancement` / `question` | Content classification | ⬜ When applicable |

Valid `squad:{agent-name}` values: `squad:picard`, `squad:scotty`, `squad:uhura`, `squad:bashir`, `squad:borg-queen`, `squad:tuvok`

## Patterns

### Minimum viable issue

```bash
gh issue create \
  --title "<concise description>" \
  --body "<detail>" \
  --label "squad,squad:{your-name}"
```

### Bug report (Bashir)

```bash
gh issue create \
  --title "Bug: <short description>" \
  --body "## Steps to Reproduce\n\n1. ...\n\n## Expected\n\n...\n\n## Actual\n\n..." \
  --label "squad,squad:bashir,bug"
```

### Enhancement with handoff (Uhura → Scotty)

```bash
gh issue create \
  --title "Enhancement: <short description>" \
  --body "## Context\n\n...\n\n## Proposed Approach\n\n..." \
  --label "squad,squad:uhura,squad:scotty,enhancement"
```

### Architecture / question (Picard)

```bash
gh issue create \
  --title "Question: <decision needed>" \
  --body "## Background\n\n...\n\n## Options\n\n1. ...\n2. ..." \
  --label "squad,squad:picard,question"
```

## Issue Body Template

```markdown
## Summary

<1-2 sentence description of the issue>

## Context

<Why this matters; what triggered the discovery>

## Proposed Action

<What should happen; who should act>

## References

- <links, file paths, or related issues>
```

## Anti-Patterns

- ❌ Opening an issue without any `squad:*` label — no ownership, falls into triage limbo
- ❌ Opening an issue with only `squad` (base) but no author label — Picard must re-triage blindly
- ❌ Using freeform attribution labels (`picard`, `scotty`) instead of the `squad:{member}` convention
- ❌ Cross-cutting issues with only one member's label when multiple members are involved
- ❌ Omitting the `squad` base label — breaks the triage workflow trigger

## Verification

After creating an issue, confirm labels are correct:

```bash
gh issue view <issue-number> --json labels --jq '.labels[].name'
# Must include "squad" and at least one "squad:*" label
```

## Related Files

- `.squad/routing.md` — routing table and triage workflow description
- `.squad/team.md` → `## Issue Source` — GitHub connection metadata
- `.github/workflows/squad-triage.yml` — triggered by `squad` label
- `.github/workflows/squad-issue-assign.yml` — triggered by `squad:*` labels
