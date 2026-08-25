# Squad reviewer gate

The Squad reviewer gate turns the repository's reviewer-comment convention into
an observable commit status. It is operational governance, not an authorization
or identity security boundary.

## Verdict contract

Every pull request must declare its required reviewers:

```markdown
## Reviewer lanes
- **Kirk** (technical correctness): workflow and script behavior
- **Garak** (hostile fact-check): trust boundary and failure modes
```

Each required reviewer posts a pull request comment in this exact form:

```markdown
**APPROVE** ✅
**Reviewer:** Kirk
**Head:** `0123456789abcdef0123456789abcdef01234567`

Review details...
```

Use `**CHANGES_REQUESTED** ⚠️` for a rejection. The full 40-character value on
`**Head:**` must equal the pull request's current head SHA. After any push, every
older verdict is stale and each required lane must post a new verdict for the
new head. The latest well-formed verdict per lane wins.

"Latest" means newest comment creation time, with GitHub's numeric comment ID
as the tie-breaker. Editing an older comment does not renew or resurrect that
verdict; post a new verdict comment when the decision changes.

Missing reviewer lanes, placeholder lane names, malformed verdict comments,
stale SHAs, missing verdicts, and latest `CHANGES_REQUESTED` verdicts all fail
closed.

## Trusted execution path

`.github/workflows/squad-reviewer-gate.yml` uses `pull_request_target` and
`issue_comment`, checks out the repository default branch explicitly, and never
checks out pull request code. The workflow evaluates issue comments and
publishes the `Squad reviewer gate` commit status on the exact pull request head
SHA.

The workflow has only read access to contents/issues/pull requests and write
access to commit statuses. It contains no merge, auto-merge, or ready action.

## Current enforcement limit

As of issue #220 Phase 1, `Squad reviewer gate` is not a required context in the
live `Default` ruleset. This phase proves the gate before any live ruleset
mutation. It must not be described as server-side merge enforcement yet.

Comment-based status is also not a security boundary against an owner-identity
session. A session acting as the repository owner may be able to edit comments,
change workflows, alter checks, or change repository settings. The gate catches
normal process drift and stale approvals; it does not constrain the owner as a
security principal.

The workflow first becomes active after its files merge to the default branch.
The pull request that introduces it is validated by unit and structural tests,
not by claiming that its not-yet-default workflow has already run.

## Break-glass runbook

Break glass only for a repository-wide incident where the gate cannot evaluate
and delaying the specific change would cause greater harm.

1. **Declare the incident.** Name the affected pull request, current head SHA,
   failed gate state, impact, and why normal reviewer comments cannot recover it.
2. **Get explicit authorization.** The user must approve the exact temporary
   action in the current, active conversation. Prior approval or inferred urgency
   does not count. This never authorizes auto-merge or marking a draft ready.
3. **Capture evidence.** Save the current workflow run URL, verdict comments,
   effective ruleset JSON, required contexts, and bypass actors before changing
   any live setting.
4. **Assess Dependabot.** Record whether the proposed temporary action changes
   Dependabot's ability to update or land dependency pull requests. Do not remove
   or add an Integration bypass without an explicit Dependabot-impact decision.
5. **Apply the narrowest temporary action.** Scope it to the named incident and
   avoid broad actor, branch, or repository bypasses. Keep the pull request open
   and draft unless the user separately requests otherwise.
6. **Restore immediately.** Revert the temporary action as soon as the incident
   change is safe. Re-fetch the effective settings and verify they match the
   captured baseline.
7. **Record follow-up.** File an issue with the evidence, duration, actor,
   restoration proof, and a permanent remediation owner.

Ruleset `16162127`, its bypass actors, and its required contexts are intentionally
unchanged by this phase. Requiring this status is a later action that needs
explicit user authorization after the gate is merged and proven.
