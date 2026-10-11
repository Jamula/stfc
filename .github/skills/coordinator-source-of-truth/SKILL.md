---
name: "coordinator-source-of-truth"
description: "The complete file-by-file source-of-truth hierarchy for Squad: which files are authoritative, which are derived/append-only, who may write each one, who may read each one, and the precedence rules when they conflict. Squad coordinator loads this on demand when it needs to resolve a write conflict, decide where a piece of state belongs, or answer a 'who owns this file' question."
allowedTools: []
confidence: high
domain: squad-internals
source: "Extracted from squad.agent.md as part of the slimming effort (bradygaster/squad#1308)."
---

> **Load this skill when:** the coordinator (or any agent) needs to resolve a "where does this state belong?" or "who is allowed to write this file?" question — e.g., when about to write the decision ledger at `.squad/decisions/decisions.md`, when reviewing whether an agent broke the append-only rule, when answering a user question about Squad's file layout, or when adjudicating a conflict between two files. The short summary in `squad.agent.md` is for routing; this skill is the full reference.

## State backend note

Mutable Squad state is not limited to the decision ledger, and not all mutable state is append-only. Entries marked "Derived / append-only" below — the decision ledger, casting history, each agent's self-owned history, Scribe's backend-aware history archives, the orchestration log, the decision-archival tagging-review log artifact, and Rai's audit trail — are all mutable state, each accessed only through its own logical state key and only by the owner listed in its row. The decision-inbox proposal namespace (logical key `decisions/inbox/`; local/worktree path `.squad/decisions/inbox/`) is also mutable state: authorized agents write new proposal entries there through runtime state tools, even though it is not a single-owner append-only log. Access mutable state with the configured `squad_state_*` tools; the runtime selects the storage backend. Entries marked "Authoritative" are static configuration and always live on disk regardless of backend.

Do not invent new specialist histories, session logs, orchestration logs, or audit trails beyond the categories already defined in the table below. Snapshot reconciliation may preserve existing append-only histories and logs; it must not manufacture new records.

For decisions, the logical state-tool key is `decisions/decisions.md`. The canonical local path in this repository is `.squad/decisions/decisions.md`; other backends need not store it at that path.

## File hierarchy

| File | Status | Who May Write | Who May Read |
|------|--------|---------------|--------------|
| `.github/agents/squad.agent.md` | **Authoritative governance.** Roles, handoffs, gates, and enforcement rules. | Repo maintainer (human) | Squad (Coordinator) |
| `.squad/team.md` | **Authoritative roster.** Current team composition. | Squad (Coordinator) | All agents |
| `.squad/routing.md` | **Authoritative routing.** Work assignment rules. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/ceremonies.md` | **Authoritative ceremony config.** Definitions, triggers, and participants for team ceremonies. | Squad (Coordinator) | Squad (Coordinator), Facilitator agent (read-only at ceremony time) |
| `.squad/decisions/inbox/` | **Derived decision proposals.** Candidates for the durable ledger. | Authorized agents through runtime state tools | Squad (Coordinator), Scribe |
| `.squad/decisions/decisions.md` | **Authoritative durable decision ledger; derived / append-only state file.** Accepted scope, architecture, and process decisions. | Scribe through runtime state tools, after coordinator acceptance | All agents |
| `.squad/casting/policy.json` | **Authoritative casting config.** Universe allowlist and capacity. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/casting/registry.json` | **Authoritative name registry.** Persistent agent-to-name mappings. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/casting/history.json` | **Derived / append-only.** Universe usage history and assignment snapshots. | Squad (Coordinator) — append only | Squad (Coordinator) |
| `.squad/agents/{name}/charter.md` | **Authoritative agent identity.** Per-agent role and boundaries. | Squad (Coordinator) at creation; agents may not self-modify | Squad (Coordinator) and owning agent |
| `.squad/agents/{name}/history.md` | **Derived / append-only.** Personal learnings, self-owned at logical key `agents/{agent}/history.md`. Never authoritative for enforcement. | Owning agent (append only) | Owning agent only |
| `.squad/agents/{name}/history-archive.md` | **Derived / append-only.** Archived history entries, moved here by Scribe's backend-aware archival procedure when an agent's `history.md` grows oversized. Scribe archives existing entries; it does not author new ones. | Scribe — backend-aware archival only, not creation | Owning agent (read-only) |
| `.squad/orchestration-log/` | **Derived / append-only.** Agent routing evidence. Never edited after write. | None currently — Scribe does not create orchestration-log entries; it may only preserve existing append-only entries while reconciling a worktree snapshot | All agents (read-only) |
| `.squad/log/` | **Derived / append-only.** Diagnostic archive, including decision-archival review artifacts (e.g., bulk-tagging classification samples). Never edited after write. | Scribe — only the decision-archival bulk-tagging review artifact (`log/{timestamp}-decisions-classification-sample.md`); does not author general session logs. May preserve other existing append-only entries while reconciling a worktree snapshot | All agents (read-only) |
| `.squad/templates/` | **Reference.** Bootstrap and on-demand format guides; not authoritative for enforcement. | Squad (Coordinator) at init | Squad (Coordinator) |
| `.squad/rai/policy.md` | **Authoritative RAI policy.** Check categories, terminology standards, and opt-out rules. | Squad (Coordinator) at init; Rai may propose updates via decisions inbox | Rai, All agents (read-only) |
| `.squad/rai/audit-trail.md` | **Derived / append-only.** RAI review evidence log. Redacted — never contains raw secrets or harmful content. | Rai (append only) | Rai, Squad (Coordinator) |
| `.squad/plugins/marketplaces.json` | **Authoritative plugin config.** Registered marketplace sources. | Squad CLI (`squad plugin marketplace`) | Squad (Coordinator) |

## Rules

1. **If `squad.agent.md` conflicts with another file, `squad.agent.md` wins.** It is the only file with hard governance authority.
2. **Mutable Squad state is the decision ledger, the decision-inbox proposal namespace (`decisions/inbox/`), and the other append-only categories in the table above** (casting history, each agent's own history and its Scribe-archived history-archive, the orchestration log, the Scribe-owned decision-archival tagging-review artifact, and Rai's audit trail). Do not use the state backend for new, ad hoc personal histories, session or orchestration logs, audit trails, communications records, or generated reports outside those listed categories.
3. **Agents may write only to the mutable-state paths listed above for which they are the designated owner, and only through the configured runtime state tools.** Non-local backends reject raw file writes.
4. **Scribe merges accepted inbox entries into the ledger.** Scribe verifies the persisted merge before deleting inbox sources and reports failures without consuming them. Scribe may also perform only its explicitly owned backend-aware archive of existing agent history, and may create only the designated decision-archival classification artifact when the current authoritative prompt grants it. Scribe does not author specialist-history entries, general session or orchestration logs, or audit trails; snapshot reconciliation may preserve existing records.
