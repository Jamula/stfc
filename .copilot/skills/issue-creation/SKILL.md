---
name: "issue-creation"
description: "How squad members create GitHub issues with the correct routing labels"
domain: "github-workflow"
confidence: "high"
source: "manual"
---

## Context

When a squad member needs to file a GitHub issue (capturing follow-up work, an idea, a bug they noticed but won't fix now, a question for triage), the issue MUST carry the right labels so Squad's routing automation works.

This applies to:
- Agents creating issues from in-session work (`📌 Proactive: filed #N`)
- Agents creating issues to hand off scope they don't own
- The coordinator filing issues when a directive needs follow-up
- Anyone using `gh issue create` from this repo

## The convention

Every squad-created issue MUST carry **at minimum** the `squad` label. The `squad` label is the team's inbox — it tells the workflows "this is squad work."

On top of `squad`, choose ONE of:

| Situation | Add label | What happens |
|-----------|-----------|--------------|
| Issue is in **my own** domain | `squad:{my-name}` | Self-assigned. I (or future-me in another session) pick it up. |
| Issue clearly belongs to **another agent's** domain | `squad:{their-name}` | Direct hand-off. They pick it up next session. |
| Issue spans multiple domains OR I'm not sure who should own it | (no sub-label — `squad` only) | Picard (M2/EM) triages on next session start. |

Then add **content labels** as appropriate (these already exist on the repo):
- `bug` — something is broken
- `enhancement` — new feature or improvement
- `documentation` — docs change only
- `question` — needs human input before work can start

## Required commands

**From any agent — file with self-assignment:**
```bash
gh issue create \
  --title "{concise actionable title}" \
  --body "{context, repro/intent, acceptance criteria}" \
  --label "squad,squad:{my-name},{enhancement|bug|...}"
```

**From any agent — hand off to another member:**
```bash
gh issue create \
  --title "..." \
  --body "Originally surfaced by {my-name} during {work}. Handing off to {their-name} because {reason}." \
  --label "squad,squad:{their-name},{enhancement|bug|...}"
```

**From any agent — needs triage:**
```bash
gh issue create \
  --title "..." \
  --body "Surfaced by {my-name}. Routing unclear — flagging for Picard's triage." \
  --label "squad,{enhancement|bug|...}"
```

Note: `squad` (no sub-label) routes to Picard (M2/EM) who triages. For
technical-direction issues, Picard may sub-triage to Kirk (Lead) by adding
`squad:kirk`.

## Body template

Every squad-created issue body should include:

```markdown
**Surfaced by:** {agent-name} during {brief context}
**Why it matters:** {one line}

## What
{the specific change / behaviour wanted}

## Why
{user-facing or system-facing rationale}

## Acceptance
- [ ] {checkable outcome 1}
- [ ] {checkable outcome 2}

## Notes
{any relevant file paths, decisions, links}
```

Keeps Picard's (M2/EM) triage cheap and the next-session pickup unambiguous.

## Anti-patterns

- ❌ Filing an issue without ANY `squad*` label — it disappears from Ralph's scan and from squad workflows.
- ❌ Adding multiple `squad:{member}` labels — only one owner per issue. If it spans domains, leave just `squad` and let Picard (M2/EM) triage.
- ❌ Self-assigning when the work is clearly out of your charter — hand off explicitly instead.
- ❌ Filing a "do everything" mega-issue. Decompose first; one issue = one ownable chunk of work.
- ❌ Using arbitrary new labels without confirming they exist (`gh label list`). The sync-squad-labels workflow manages `squad*`, `go:*`, and `release:*` — extending those families requires updating `team.md` or the workflow.

## Verification

After creating an issue, confirm the labels stuck:
```bash
gh issue view {N} --json labels --jq '.labels[].name'
```

Expected output includes `squad` and exactly one of: nothing else from the squad family (untriaged), or one `squad:{member}` (assigned).

## Related

- `.squad/routing.md` — full routing table and triage rules
- `.github/workflows/sync-squad-labels.yml` — auto-creates `squad:{member}` labels from `team.md`
- `.github/workflows/squad-triage.yml` — runs Picard's (M2/EM) triage when `squad` label is added
- `.github/workflows/squad-issue-assign.yml` — handles `squad:{member}` → assignment
