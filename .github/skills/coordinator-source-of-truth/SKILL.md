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

The durable decision record is the only mutable Squad state governed by this hierarchy. Access it with the configured `squad_state_*` tools; the runtime selects the storage backend. Static configuration always lives on disk. Do not create specialist histories, session logs, orchestration logs, or audit trails as Squad state. Snapshot reconciliation may preserve existing append-only histories and logs; it must not manufacture new records.

For decisions, the logical state-tool key is `decisions.md`. The canonical local path in this repository is `.squad/decisions/decisions.md`; other backends need not store it at that path.

## File hierarchy

| File | Status | Who May Write | Who May Read |
|------|--------|---------------|--------------|
| `.github/agents/squad.agent.md` | **Authoritative governance.** Roles, handoffs, gates, and enforcement rules. | Repo maintainer (human) | Squad (Coordinator) |
| `.squad/team.md` | **Authoritative roster.** Current team composition. | Squad (Coordinator) | All agents |
| `.squad/routing.md` | **Authoritative routing.** Work assignment rules. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/decisions/inbox/` | **Derived decision proposals.** Candidates for the durable ledger. | Authorized agents through runtime state tools | Squad (Coordinator), Scribe |
| `.squad/decisions/decisions.md` | **Authoritative durable decision ledger.** Accepted scope, architecture, and process decisions. | Scribe through runtime state tools, after coordinator acceptance | All agents |
| `.squad/agents/{name}/charter.md` | **Authoritative agent identity.** Per-agent role and boundaries. | Squad (Coordinator) at creation; agents may not self-modify | Squad (Coordinator) and owning agent |
| `.squad/templates/` | **Reference.** Bootstrap and on-demand format guides; not authoritative for enforcement. | Squad (Coordinator) at init | Squad (Coordinator) |
| `.squad/plugins/marketplaces.json` | **Authoritative plugin config.** Registered marketplace sources. | Squad CLI (`squad plugin marketplace`) | Squad (Coordinator) |

## Rules

1. **If `squad.agent.md` conflicts with another file, `squad.agent.md` wins.** It is the only file with hard governance authority.
2. **Only accepted durable decisions belong in mutable Squad state.** Do not use the state backend for personal histories, session or orchestration logs, audit trails, communications records, or generated reports.
3. **Agents may write only to the durable-decision paths listed above, and only through the configured runtime state tools.** Non-local backends reject raw file writes.
4. **Scribe merges accepted inbox entries into the ledger.** Scribe verifies the persisted merge before deleting inbox sources and reports failures without consuming them. Scribe does not create or maintain specialist histories, logs, or audit trails; snapshot reconciliation only preserves existing append-only entries.
