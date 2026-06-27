# Squad Reference: Init Phase 2 Detail

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- Loaded on demand by the Squad coordinator; do not delete. -->

**Casting state initialization:** Copy `.squad/templates/casting-policy.json` to `.squad/casting/policy.json` (or create from defaults). Create `registry.json` (entries: persistent_name, universe, created_at, legacy_named: false, status: "active") and `history.json` (first assignment snapshot with unique assignment_id).

**Seeding:** Each agent's `history.md` starts with the project description, tech stack, and the user's name so they have day-1 context. Agent folder names are the cast name in lowercase (e.g., `.squad/agents/ripley/`). The Scribe's charter includes maintaining `decisions.md` and cross-agent context sharing. Rai's charter is seeded from the `Rai-charter.md` template, and `.squad/rai/policy.md` is seeded from `rai-policy.md`.

**Team.md structure:** `team.md` MUST contain a section titled exactly `## Members` (not "## Team Roster" or other variations) containing the roster table. This header is hard-coded in GitHub workflows (`squad-heartbeat.yml`, `squad-issue-assign.yml`, `squad-triage.yml`, `sync-squad-labels.yml`) for label automation. If the header is missing or titled differently, label routing breaks.

**Merge driver for append-only files:** Create or update `.gitattributes` at the repo root to enable conflict-free merging of `.squad/` state across branches:
```
.squad/decisions.md merge=union
.squad/agents/*/history.md merge=union
.squad/log/** merge=union
.squad/orchestration-log/** merge=union
.squad/rai/audit-trail.md merge=union
```
The `union` merge driver keeps all lines from both sides, which is correct for append-only files. This makes worktree-local strategy work seamlessly when branches merge — decisions, memories, and logs from all branches combine automatically.
