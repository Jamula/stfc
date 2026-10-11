# PR landing safety (#220)

Issue sessions open a draft PR and stop. Never merge, enable auto-merge, or mark
a PR ready without an explicit user request in the current, active conversation.
CI and reviewer verdicts determine eligibility, not permission: leave PRs open
when CI is red, unavailable, or has not started, and when reviews are absent.

## Evidence and boundary

GitHub records PRs #215, #216, #217, and #219 merged by `cyrusjamula` on
2026-08-21, with empty `reviewDecision`. Issue #220 records checks that never
executed during the billing incident (#218), issue-session reports of no
merge/ready call, and later draft-to-ready-to-merge incidents (#263 and #283).
The account identity and Copilot App commit trailer do **not** identify the
initiating host/client or prove a Ralph trigger. A null `autoMergeRequest` is
not sufficient to attribute or reconstruct an earlier action.

The tracked heartbeat triages and assigns issues; it does not land PRs.
`squad-issue-assign.yml` and `squad-heartbeat.yml`, including their installed
templates, send the open-PR-only boundary in `agent_assignment.custom_instructions`.
If guarded assignment fails, the workflow fails visibly; it never retries
without those instructions. Tests execute the actual assignment scripts with
mocked GitHub APIs and inspect the submitted payload and failure path.

Existing Ralph, coordinator, coding-agent and routing instructions already
revoke unattended merge authority. These instructions and regression tests are
repo-controlled mitigations, not enforcement against an external owner-identity
client. No initiating merge operation was found in the tracked assignment paths;
the host/session completion path is outside this repository.

## Safe Ralph operation until host acceptance is proven

Use a supervised, **report-only** Ralph round: explicitly ask it to read the
board and report next owners, without assigning issues, spawning implementation
sessions, editing files, or changing PR state. Do not run unattended
`squad watch --execute`, blanket "Ralph, go" implementation loops, or host
auto-landing/Agent Merge for this project until the owner completes the checks
below. Plain watch/heartbeat can assign coding work; neither is a read-only
alternative. The assignment safeguards do not make them safe against the
unidentified host path.

For individually authorized implementation, use one bounded issue session with
the explicit instruction: "Implement this issue, open a draft PR, report its URL,
and stop; no merge, auto-merge, or ready action." Draft is defense in depth, not
proof of safety: #220 records drafts readied by an unidentified client. Keep
session transcripts and verify PR state independently. If any unrequested state
transition appears, stop launching implementation sessions and escalate to the
host operator; do not automatically close, redraft, revert, or merge the PR.

## Owner actions and acceptance evidence

1. **Host/operator attribution.** Correlate GitHub timeline timestamps with the
   app's PR-creation, session-idle/completion, Agent Merge and automation logs.
   Record session ID, PR number/head SHA, client/component version, initiating
   request/trigger and authorization source. Do not include tokens. Disable the
   identified automatic ready/landing trigger in the host only after explicit
   owner authorization; this repo does not define that setting.
2. **Verify current enforcement, not the historical plan assumption.** In
   Settings > Rules > Rulesets, inspect every rule targeting `main`, required
   contexts, pull-request review rules and bypass actors. Read-only checks on
   2026-10-11 UTC found `Default` ruleset `16162127` active, requiring only
   `npm test (required)` and retaining two `always` Integration bypasses
   (`29110`, `1143301`). `Squad reviewer gate` is not a required context.
   Reviewer workflow `341796180` was already `active`; no re-enable was performed.
   The August protection-API 403 is historical, not proof of today's entitlement.
   Re-fetch effective settings before deciding anything.
3. **Owner policy decision.** Keep visibility, billing, bypass actors and required
   checks unchanged during investigation. The owner must decide whether the
   current plan supports the desired private-repo enforcement, whether an upgrade
   is necessary, and which reviewers/checks and narrowly scoped bypasses to
   authorize. Do not make the repo public as a workaround. Only after explicit
   approval, require the proven current-head reviewer status and test context,
   assess each Integration bypass and owner/admin bypass, and verify the effective
   result. See [reviewer-gate limits](REVIEWER-GATE.md) and #345; do not re-enable
   or alter that gate based on this runbook alone.
4. **Controlled issue-session smoke test.** After the host is configured, authorize
   one harmless PR with a deliberately pending check and missing reviewer verdicts.
   Capture its draft/normal state, head SHA, timeline and check/review state before
   and after the session goes idle and after the next supervised Ralph scan.
   Repeat with a red check and an unavailable/unstarted check. All PRs must remain
   open, with no unrequested ready/merge/auto-merge event. Test draft and normal
   PRs; normal creation must be separately authorized. Preserve links to the
   checks, session closeout and post-idle observations. Do not merge as part of
   this test; any later ready/merge action needs a separate explicit user request.

Until attribution, host configuration and post-idle observations are recorded,
#220 remains open/blocked. A PR being open immediately after creation proves
only that observation, not the session-idle acceptance criterion.
