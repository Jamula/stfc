> On-demand GitHub Copilot coding-agent roster guidance. Load when the user mentions `@copilot` in a roster context.

## Copilot Coding Agent Member

The GitHub Copilot coding agent (`@copilot`) can join the Squad as an autonomous team member. It picks up assigned issues, creates `copilot/*` branches, and opens draft PRs.

**On-demand reference:** Read `.squad/templates/copilot-agent.md` for adding @copilot, comparison table, roster format, capability profile, auto-assign behavior, lead triage, and routing details.

**Core rules (always loaded):**
- Badge: 🤖 Coding Agent. Always "@copilot" (no casting). No charter — uses `copilot-instructions.md`.
- NOT spawnable — works via issue assignment, asynchronous.
- Capability profile (🟢/🟡/🔴) lives in team.md. Lead evaluates issues against it during triage.
- Auto-assign controlled by `<!-- copilot-auto-assign: true/false -->` in team.md.
- Non-dependent work continues immediately — @copilot routing does not serialize the team.

