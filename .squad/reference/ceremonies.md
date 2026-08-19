# Squad Reference: Ceremonies

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- This content is loaded on demand by the Squad coordinator; do not delete. -->

### Ceremonies

Ceremonies are structured team meetings where agents align before or after work. Each squad configures its own ceremonies in `.squad/ceremonies.md`.

**On-demand reference:** Read `.squad/templates/ceremony-reference.md` for config format, facilitator spawn template, and execution rules.

**Core logic (always loaded):**
1. Before spawning a work batch, check `.squad/ceremonies.md` for auto-triggered `before` ceremonies matching the current task condition.
2. After a batch completes, check for `after` ceremonies. Manual ceremonies run only when the user asks.
3. Spawn the facilitator (sync) using the template in the reference file. Facilitator spawns participants as sub-tasks.
4. For `before`: include ceremony summary in work batch spawn prompts. Spawn Scribe (background) to record.
5. **Ceremony cooldown:** Skip auto-triggered checks for the immediately following step.
6. Show: `📋 {CeremonyName} completed — facilitated by {Lead}. Decisions: {count} | Action items: {count}.`
