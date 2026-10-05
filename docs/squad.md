# The Squad

An AI team that lives in this repository under `.squad/`. Each member has a persistent name, a charter, and an append-only history. Decisions are recorded in `.squad/decisions/decisions.md`. The coordinator routes work; the members execute it.

---

## Roster

| Icon | Name | Role | Model | Charter | Label | Reviewer? |
|------|------|------|-------|---------|-------|-----------|
| — | **Squad** | Coordinator — routes work, enforces handoffs and reviewer gates | — | _(agent instructions)_ | — | No |
| 🧭 | **Picard** | M2 / Engineering Manager (boss) | `claude-opus-4.7-1m-internal` | [`charter`](.squad/agents/picard/charter.md) | `squad:picard` | ✅ Scope, governance |
| 🏗️ | **Kirk** | Lead Engineer (technical) | `claude-opus-4.7-1m-internal` | [`charter`](.squad/agents/kirk/charter.md) | `squad:kirk` | ✅ Architecture, correctness |
| 🔧 | **Scotty** | Core Dev — TypeScript / CLI | `gpt-5.3-codex` | [`charter`](.squad/agents/scotty/charter.md) | `squad:scotty` | No |
| 🔧 | **Uhura** | Integrations Dev — API / Discord | `claude-sonnet-4.6` | [`charter`](.squad/agents/uhura/charter.md) | `squad:uhura` | No |
| 🧪 | **Bashir** | Tester / QA Reviewer | `claude-sonnet-4.6` (auto) | [`charter`](.squad/agents/bashir/charter.md) | `squad:bashir` | ✅ Coverage, test-first |
| 🔒 | **Garak** | Critic / Devil's Advocate | `gpt-5.5` | [`charter`](.squad/agents/garak/charter.md) | `squad:garak` | Advisory only |
| 📝 | **Tuvok** | Process Auditor / Editorial Specialist | `claude-sonnet-4.6` (auto) | [`charter`](.squad/agents/tuvok/charter.md) | `squad:tuvok` | No |
| 📋 | **Scribe** | Session Logger / Decision Historian | `claude-haiku-4.5` | [`charter`](.squad/agents/scribe/charter.md) | — | No |
| 🔄 | **Ralph** | Work Monitor / Continuity Agent | `claude-sonnet-4.6` (auto) | [`charter`](.squad/agents/ralph/charter.md) | — | No |

---

## Capabilities

| Agent | Owns | Boundaries |
|-------|------|------------|
| **Picard** | Scope & roadmap · Priorities · Issue triage · Blocker removal · Governance (constitution, reviewer gates) · External comms | Does not write code. Delegates technical decisions to Kirk. |
| **Kirk** | Technical direction (CLI, orchestrator, Discord, workflows) · Architecture (module boundaries, contracts, state layout, deps) · Code review (non-trivial) · Cross-cutting technical concerns · Reviewer-rejection lockout enforcement | Reports to Picard on scope/governance. |
| **Scotty** | TypeScript `src/` codebase (orchestrator, CLI, config) · Build & tooling (`tsconfig`, `package.json`, deps) · Runtime (errors, retries, exit codes, logging) · Local DX · GitHub Actions workflows (build/test gates) | Architecture decisions → Kirk. |
| **Uhura** | STFC web-store API (request/response, errors) · JWT token flows · Promo-code redemption · `STFC_ACCOUNTS` secret handling · Discord monitor (`DISCORD_BOT_TOKEN` custody, Discord API) · GitHub Actions (secrets & integrations) · Bookmarklet / client-side capture | Architecture decisions → Kirk. |
| **Bashir** | `tests/` directory (unit, integration, e2e) · Test design & edge-case enumeration · Fixture authoring & mocks · Test reliability (no flakes) · CI test infrastructure | Architecture decisions → Kirk. Can veto on: untestable AC, missing coverage, test-first violations, bug-fix PRs without reproducing test. |
| **Garak** | Challenging proposals · Surfacing unstated assumptions · Pre-mortems · Threat modelling & failure-mode analysis · Hostile fact-checks (verified against live repo, not memory) · Naming risks · Cross-provider critique | Advisory — does not block merges. Kirk calls technical veto; Picard calls scope/governance veto. **Lineage:** seat previously held by Borg Queen (gpt-5.4, through 2026-05-16); hostile-fact-check methodology preserved. |
| **Tuvok** | Surgical text editing per explicit reviewer findings · Change-impact accounting · Documentation audits · Cross-reference discipline | Does not author new principles or processes. Escalates to the reviewer or Kirk (Lead). |
| **Scribe** | `.squad/decisions/decisions.md` maintenance · Orchestration logs & session summaries · History archiving · Decision inbox merging | Silent background operation. `.squad/` write authority (Rule 2) — only Scribe commits `.squad/` paths. Never modifies source code. |
| **Ralph** | GitHub issue/PR board polling · End-to-end work driving (untriaged → assigned → reviewed → merged) · Blocker detection | Not routable via labels. Runs as coordinator-level loop, not as a contributor. |

---

## Reviewer Authority

| Reviewer | Can Block On | On Rejection |
|----------|-------------|--------------|
| **Picard** | Scope creep · Governance violations · Process bypass without justification | Names a different agent to revise (never the original author) |
| **Kirk** | Architectural violations · Technical-correctness gaps | Names a different agent to revise (never the original author) |
| **Bashir** | Untestable acceptance criteria · Test-first violations · Missing implementation coverage · Bug-fix PRs without reproducing test | Names a different agent to revise |
| **Garak** | _(advisory only — produces written findings)_ | Findings routed to Tuvok or another agent for edits |

**The lockout rule:** when a reviewer rejects work, the original author is locked out. A different agent must own the revision. This breaks author-reviewer conflicts of interest and ensures fresh eyes.

---

## Activation

| Mode | Command / Trigger | Description |
|------|-------------------|-------------|
| **In-session loop** | `"Ralph, go"` | Continuous work loop while you're at the keyboard |
| **Status check** | `"Ralph, status"` | One-cycle scan and report |
| **Suspend** | `"Ralph, idle"` | Stops the loop |
| **Background poller** | `npx @bradygaster/squad-cli watch --interval 10` | Standalone process; checks GitHub every N minutes |
| **Cloud heartbeat** | `.github/workflows/squad-heartbeat.yml` | Scheduled, fully unattended |
| **Direct address** | `"{Name}, …"` or assign `squad:{name}` label | Routes work to a specific agent |

---

## Information Architecture

| Artifact | Path | Purpose |
|----------|------|---------|
| Roster | `.squad/team.md` | Authoritative team membership, roles, status |
| Routing rules | `.squad/routing.md` | Work routing table — which agent handles what |
| Decisions | `.squad/decisions/decisions.md` | Team-wide shared record; immutable once committed |
| Decision inboxes | `.squad/decisions/inbox/*.md` | Per-agent inboxes (merged to `decisions.md` by Scribe) |
| Charters | `.squad/agents/{name}/charter.md` | Role definition for each member |
| Histories | `.squad/agents/{name}/history.md` | Append-only personal learnings |
| Model overrides | `.squad/config.json` | Persistent per-agent model selections |
| Coordinator skills | `.copilot/skills/` | Coordinator-level reusable patterns |
| Team skills | `.squad/skills/` | Team-level reusable patterns |

---

## Governance

All squad work follows repository governance in `.github/copilot-instructions.md`. Key principles:

| Principle | Summary |
|-----------|---------|
| **User Safety & Trust First** | Never compromise privacy or security for convenience |
| **Specification-First Governance** | Non-trivial changes start with a spec, not a commit |
| **Artifact Hygiene** | Credentials, JWTs, real account data never appear in committed artifacts |
| **Stateless Operation & Secret Custody** | Strict rules about which secrets can be written where |
| **Wire-First Discovery** | Capture real API responses before writing parsers |

When in doubt, read the constitution.
