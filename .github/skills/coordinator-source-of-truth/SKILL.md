---
name: "coordinator-source-of-truth"
description: "The complete file-by-file source-of-truth hierarchy for Squad: which files are authoritative, which are derived/append-only, who may write each one, who may read each one, and the precedence rules when they conflict. Squad coordinator loads this on demand when it needs to resolve a write conflict, decide where a piece of state belongs, or answer a 'who owns this file' question."
allowedTools: []
confidence: high
domain: squad-internals
source: "Extracted from squad.agent.md as part of the slimming effort (bradygaster/squad#1308). Behaviour unchanged — coordinator loads this satellite skill when a routing decision needs the full hierarchy."
---

> **Load this skill when:** the coordinator (or any agent) needs to resolve a "where does this state belong?" or "who is allowed to write this file?" question — e.g., when reading the `decisions.md` state key through the configured bridge, when reviewing whether an agent broke the append-only rule, when answering a user question about Squad's file layout, or when adjudicating a conflict between two files. The short summary in `squad.agent.md` is for routing; this skill is the full reference.

## State backend note

Authority and persistence are separate: an authoritative record can also be runtime-owned mutable state. The decision ledger and files marked **"Derived / append-only"** are accessed through the configured state bridge (`squad_state_read`, `squad_state_write`, `squad_state_append`, `squad_state_create_if_absent`, `squad_state_delete`, `squad_state_list`), not by assuming an on-disk copy is current. The runtime decides whether the backend stores them on disk, git-native state, or an external provider. Other authoritative entries in the table are static configuration on disk. Verify the bridge as described in `.squad/templates/spawn-reference.md`; if it is unavailable, report the limitation rather than falling back to direct mutable-state access.

## File hierarchy

| File | Status | Who May Write | Who May Read |
|------|--------|---------------|--------------|
| `.github/agents/squad.agent.md` | **Authoritative governance.** All roles, handoffs, gates, and enforcement rules. | Repo maintainer (human) | Squad (Coordinator) |
| `decisions.md` (state key) | **Authoritative, runtime-owned decision ledger.** Canonical record for scope, architecture, and process decisions; do not assume an on-disk path. | No writes until cross-process serialization is verified | All agents, through the state bridge |
| `.squad/team.md` | **Authoritative roster.** Current team composition. | Squad (Coordinator) | All agents |
| `.squad/routing.md` | **Authoritative routing.** Work assignment rules. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/ceremonies.md` | **Authoritative ceremony config.** Definitions, triggers, and participants for team ceremonies. | Squad (Coordinator) | Squad (Coordinator), Facilitator agent (read-only at ceremony time) |
| `.squad/casting/policy.json` | **Authoritative casting config.** Universe allowlist and capacity. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/casting/registry.json` | **Authoritative name registry.** Persistent agent-to-name mappings. | Squad (Coordinator) | Squad (Coordinator) |
| `.squad/casting/history.json` | **Derived / append-only.** Universe usage history and assignment snapshots. | Squad (Coordinator) — append only | Squad (Coordinator) |
| `.squad/agents/{name}/charter.md` | **Authoritative agent identity.** Per-agent role and boundaries. | Squad (Coordinator) at creation; agent may not self-modify | Squad (Coordinator) reads to inline at spawn; owning agent receives via prompt |
| `.squad/agents/{name}/history.md` | **Derived / append-only.** Personal learnings. Never authoritative for enforcement. | Owning agent (append only), Scribe (cross-agent updates, summarization) | Owning agent only |
| `.squad/agents/{name}/history-archive.md` | **Derived / append-only.** Archived history entries. Preserved for reference. | Scribe | Owning agent (read-only) |
| `.squad/orchestration-log/` | **Derived / append-only.** Agent routing evidence. Never edited after write. | Scribe | All agents (read-only) |
| `.squad/log/` | **Derived / append-only.** Session logs. Diagnostic archive. Never edited after write. | Scribe | All agents (read-only) |
| `.squad/templates/` | **Reference.** Format guides for runtime files. Not authoritative for enforcement. | Squad (Coordinator) at init | Squad (Coordinator) |
| `.squad/rai/policy.md` | **Authoritative RAI policy.** Check categories, terminology standards, and opt-out rules. | Squad (Coordinator) at init; Rai may propose updates via decisions inbox | Rai, All agents (read-only) |
| `.squad/rai/audit-trail.md` | **Derived / append-only.** RAI review evidence log. Redacted — never contains raw secrets or harmful content. | Rai (append only) | Rai, Squad (Coordinator) |
| `.squad/fact-checker/policy.md` | **Authoritative verification + Devil's Advocate policy.** Confidence rating taxonomy, hard anti-fabrication rules, mode triggers, opt-out model. | Squad (Coordinator) at init; Fact Checker may propose updates via decisions inbox | Fact Checker, All agents (read-only) |
| `.squad/fact-checker/audit-trail.md` | **Derived / append-only.** Verification verdicts + DA brief evidence log. Succinct — verdict + citation, never raw source material. | Fact Checker (append only) | Fact Checker, Squad (Coordinator) |
| `.squad/plugins/marketplaces.json` | **Authoritative plugin config.** Registered marketplace sources. | Squad CLI (`squad plugin marketplace`) | Squad (Coordinator) |

## Rules

1. **If `squad.agent.md` and any other file conflict, `squad.agent.md` wins.** It is the only file with hard governance authority.
2. **Append-only files must never be retroactively edited** to change meaning. For other append-only records, corrections go in a new entry that references the prior one; the decision ledger is subject to rule 4.
3. **Agents may only write to files listed in their "Who May Write" column above.** Violations are a contract bug; runtime state-backends will refuse the write on non-local backends.
4. **Do not consolidate, rewrite, or append to the decision ledger until cross-process serialization is verified.** Retain all inbox entries; do not delete them. Report the limitation. Create proposals as unique inbox entries through `squad_state_create_if_absent` and read them through the bridge as pending proposals, not accepted policy.
