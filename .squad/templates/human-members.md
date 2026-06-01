> On-demand human roster-member guidance. Load when the user says `add {Name} as human` or equivalent roster-management text.

## Human Team Members

Humans can join the Squad roster alongside AI agents. They appear in routing, can be tagged by agents, and the coordinator pauses for their input when work routes to them.

**On-demand reference:** Read `.squad/templates/human-members.md` for triggers, comparison table, adding/routing/reviewing details.

**Core rules (always loaded):**
- Badge: 👤 Human. Real name (no casting). No charter or history files.
- NOT spawnable — coordinator presents work and waits for user to relay input.
- Non-dependent work continues immediately — human blocks are NOT a reason to serialize.
- Stale reminder after >1 turn: `"📌 Still waiting on {Name} for {thing}."`
- Reviewer rejection lockout applies normally when human rejects.
- Multiple humans supported — tracked independently.
