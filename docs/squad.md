# The Squad

The squad is an AI team that lives in this repository under `.squad/`. Each member has a persistent name, a charter, and an append-only history. Decisions are recorded in `.squad/decisions.md`. The coordinator (Squad) routes work; the members execute it.

---

## Coordinator

**Squad** — Coordinator
- **Role:** Dispatcher only — routes work, enforces handoffs and reviewer gates.
- **Generates:** Nothing — coordinates by spawning agents and routing issues to them.
- **Authority:** Lives in agent instructions, not in `.squad/agents/`.

---

## Members

### 🧭 Picard — M2 / Engineering Manager (boss)

- **Charter:** `.squad/agents/picard/charter.md`
- **Role:** Engineering Manager — manages Kirk (Lead) and the contributors through him
- **Capabilities:**
  - Project scope and roadmap — what we build, what we defer, what ships in which release
  - Priorities — when two valuable things compete, picks which goes first
  - Issue triage — incoming `squad`-labelled issues, assignment to the right member
  - Blocker removal — cross-team coordination, secret-custody escalations, environment fixes
  - Governance — constitution amendments, speckit chain integrity, reviewer-gate enforcement on scope/process grounds
  - External comms — issue framing, decision narrative, release messaging
- **How to address:** "Picard, …" or assign issue label `squad:picard`
- **Reviewer authority:** Can block merge on scope creep, governance violations, or speckit bypass without justification. On rejection, names a different agent to revise (never the original author).

### 🏗️ Kirk — Lead (technical)

- **Charter:** `.squad/agents/kirk/charter.md`
- **Role:** Technical Lead — reports to Picard
- **Capabilities:**
  - Technical direction for the TypeScript CLI, redemption orchestrator, Discord monitor, and GitHub Actions workflows
  - Architectural decisions — module boundaries, contract shapes, state file layout, dependency choices
  - Code review for non-trivial changes — quality gate before merge, focused on technical correctness
  - Cross-cutting technical concerns spanning multiple contributors' domains
- **How to address:** "Kirk, …" or assign issue label `squad:kirk`
- **Reviewer authority:** Can block merge on architectural violations or technical-correctness gaps. On rejection, names a different agent to revise (never the original author).

### 🔧 Scotty — Core Dev

- **Charter:** `.squad/agents/scotty/charter.md`
- **Role:** Core TypeScript / CLI Developer
- **Capabilities:**
  - TypeScript codebase under `src/` — orchestrator, command surface, config loading
  - Build and tooling: `tsconfig.json`, `package.json` scripts, dependency hygiene
  - Runtime concerns: error handling, retries, exit codes, logging
  - Local developer experience — CLI must be runnable and debuggable without ceremony
  - GitHub Actions workflows (build/test gates)
- **How to address:** "Scotty, …" or assign issue label `squad:scotty`

### 🔧 Uhura — Integrations Dev

- **Charter:** `.squad/agents/uhura/charter.md`
- **Role:** API & Integrations Developer
- **Capabilities:**
  - Integration with the STFC web-store API — request/response shapes, error modes
  - JWT token capture, validation, and refresh flows
  - Promo-code redemption requests and response parsing
  - Secret handling: `STFC_ACCOUNTS` format and safe storage in CI
  - Discord monitor integration (new in v1): `DISCORD_BOT_TOKEN` custody, Discord API calls
  - GitHub Actions workflows (secrets and integrations)
- **How to address:** "Uhura, …" or assign issue label `squad:uhura`

### 🧪 Bashir — Tester

- **Charter:** `.squad/agents/bashir/charter.md`
- **Role:** Tester / QA Reviewer
- **Capabilities:**
  - Test design and edge-case enumeration — "what happens when …?"
  - Fixture authoring and mocks for STFC API responses
  - Test reliability — no flakes, no skipped tests without tracked reason
  - Reviewer gate: can reject changes that lack coverage for the behaviour they touch
  - CI test infrastructure and debugging flaky tests
- **How to address:** "Bashir, …" or assign issue label `squad:bashir`
- **Reviewer authority:** Can block merge on: untestable acceptance criteria, task lists that violate test-first, missing implementation coverage, or bug-fix PRs without reproducing test + evidence. On rejection, names a different agent to revise.

### 🔒 Garak — Critic

- **Charter:** `.squad/agents/garak/charter.md`
- **Role:** Critic / Devil's Advocate
- **Capabilities:**
  - Challenging proposals before they ship — "why this approach, why now, what breaks?"
  - Surfacing unstated assumptions in plans, designs, and code reviews
  - Pre-mortems on non-trivial changes — "imagine this fails in production; what failed?"
  - Threat modelling and failure-mode analysis
  - Hostile fact-checks: every concrete claim in a plan or spec verified against the live repository, not against memory
  - Naming risks the team is implicitly accepting (without making veto calls)
- **How to address:** "Garak, …" or assign issue label `squad:garak`
- **Note:** Produces written findings; does not block merges directly (Kirk calls the technical veto, Picard calls the scope/governance veto). But if a reviewer has hard-rejected work, the Coordinator routes the revision to a different agent.
- **Lineage:** This seat was previously held by Borg Queen (cross-provider critic, gpt-5.4) through 2026-05-16. Her hostile-fact-check methodology is preserved in the role-history under `.squad/agents/garak/` and remains the standard for this role.

### 📝 Tuvok — Process Auditor / Editorial Specialist

- **Charter:** `.squad/agents/tuvok/charter.md`
- **Role:** Process Auditor / Editorial Specialist
- **Capabilities:**
  - Surgical text editing of governance artifacts per explicit reviewer findings
  - Applying Garak's critique findings as precise edits
  - Change-impact accounting: when I edit X, what cross-references in Y need touching
  - Documentation audits and targeted updates based on shipped functionality
  - Cross-reference discipline and consistency across docs
- **How to address:** "Tuvok, …" or assign issue label `squad:tuvok`
- **Constraint:** Does not author new principles or design processes — only edits per explicit findings. If a task requires those, escalates to Picard (M2/EM) or Garak.

### 📋 Scribe — Session Logger

- **Charter:** `.squad/agents/scribe/charter.md`
- **Role:** Session Logger / Decision Historian
- **Capabilities:**
  - Maintains `.squad/decisions.md` — merges all decision inboxes into the team record
  - Writes orchestration logs and session summaries
  - Archives oversized history files to maintain hygiene
  - Automatic decision collection (never needs explicit routing)
- **How to address:** Never directly — Scribe runs in background after substantial work
- **Visibility:** Silent by design — runs as background task, no messages to the user

### 🔄 Ralph — Work Monitor

- **Role:** Work Monitor / Continuity Agent
- **Capabilities:**
  - Continuous polling of GitHub issues/PRs board
  - Drives work end-to-end: untriaged → assigned → CI failures → review feedback → approved PRs
  - Tracks issue state and detects blockers in real time
- **How to activate:** 
  - **In-session:** "Ralph, go" → activates continuous work loop while you're at the keyboard
  - **Status check:** "Ralph, status" → runs one work-check cycle
  - **Suspend:** "Ralph, idle" → stops the loop
- **Background polling:** Run `npx @bradygaster/squad-cli watch --interval 10` (standalone process; checks GitHub every N minutes, survives session shutdown)
- **Cloud heartbeat:** `.github/workflows/squad-heartbeat.yml` — runs on schedule, fully unattended

---

## How the squad works

**Information sharing:**
- Each agent reads ONLY: its own `.squad/agents/{name}/` files + `.squad/decisions.md` + the specific input artifacts provided in the spawn prompt
- Decisions are shared via `.squad/decisions.md`; knowledge is personal (`.squad/agents/{name}/history.md`)

**Reviewer gates (the lockout rule):**
- When a Reviewer (Bashir, Garak, Kirk, Picard) **rejects** work, the original author is **locked out** of producing the revision
- A different agent must own the revision (enforced by the Coordinator in the spawn prompt)
- This breaks author-reviewer conflicts of interest and ensures fresh eyes

**Handoff protocol:**
- Eager by default — spawn all agents who could usefully start work, including anticipatory downstream work
- When two agents could handle something, pick the one whose domain is the primary concern
- Issue-labeled work: when a `squad:{member}` label is applied to an issue, that member picks it up

---

## Where the squad lives

| Artifact | Path | Purpose |
|----------|------|---------|
| **Roster** | `.squad/team.md` | Who is on the squad, roles, status |
| **Routing rules** | `.squad/routing.md` | Work routing table (which agent handles what type of work) |
| **Decisions** | `.squad/decisions.md` | Team-wide shared record; immutable once committed |
| **Inboxes** | `.squad/decisions/inbox/*.md` | Per-agent decision inboxes (merged to decisions.md by Scribe) |
| **Charters & histories** | `.squad/agents/{name}/charter.md`, `history.md` | Role definition and personal learnings for each member |
| **Skills (patterns)** | `.copilot/skills/` (coordinator-level), `.squad/skills/` (team-level) | Reusable patterns the team has earned |

---

## Running the squad

### In-session (active keyboard)

```bash
# Continuous work loop while you're working
"Ralph, go"

# One-cycle status check
"Ralph, status"

# Stop the loop
"Ralph, idle"
```

### Background poller (hands-off)

```bash
# Standalone process; checks GitHub every 10 minutes
# (survives session shutdown if run with nohup or in a persistent shell)
npx @bradygaster/squad-cli watch --interval 10
```

### Cloud heartbeat (fully unattended)

GitHub Actions workflow `.github/workflows/squad-heartbeat.yml` — event-based, runs on a schedule, no manual trigger needed.

---

## Governance

All squad work follows the constitution at `.specify/memory/constitution.md` (currently v1.3.0). Key principles:

- **User Safety & Trust First** — never compromise privacy or security for convenience
- **Specification-First Governance** — all non-trivial changes start with a spec, not a commit
- **Artifact Hygiene** — credentials, JWTs, real account data never appear in committed artifacts
- **Stateless Operation & Secret Custody** — strict rules about which secrets can be written where
- **Wire-First Discovery** — capture real API responses before writing parsers

When in doubt, read the constitution.
