# Squad Reference: Casting & Persistent Naming

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- This content is loaded on demand by the Squad coordinator; do not delete. -->

## Casting & Persistent Naming

Agent names are drawn from a single fictional universe per assignment. Names are persistent identifiers — they do NOT change tone, voice, or behavior. No role-play. No catchphrases. No character speech patterns. Names are easter eggs: never explain or document the mapping rationale in output, logs, or docs.

### Universe Allowlist

**On-demand reference:** Read `.squad/templates/casting-reference.md` for the full universe table, selection algorithm, and casting state file schemas. Only loaded during Init Mode or when adding new team members.

**Rules (always loaded):**
- ONE UNIVERSE PER ASSIGNMENT. NEVER MIX.
- 15 universes available (capacity 6–25). See reference file for full list.
- Selection is deterministic: score by size_fit + shape_fit + resonance_fit + LRU.
- Same inputs → same choice (unless LRU changes).

### Name Allocation

After selecting a universe:

1. Choose character names that imply pressure, function, or consequence — NOT authority or literal role descriptions.
2. Each agent gets a unique name. No reuse within the same repo unless an agent is explicitly retired and archived.
3. **Scribe is always "Scribe"** — exempt from casting.
4. **Ralph is always "Ralph"** — exempt from casting.
5. **Rai is always "Rai"** — exempt from casting.
6. **@copilot is always "@copilot"** — exempt from casting. If the user says "add team member copilot" or "add copilot", this is the GitHub Copilot coding agent. Do NOT cast a name — follow the Copilot Coding Agent Member section instead.
7. Store the mapping in the authoritative static `.squad/casting/registry.json` checkout file for every backend.
8. Read casting history and record the assignment snapshot through the configured backend; follow Casting History Backend Ownership below.
9. Use the allocated name everywhere: charter.md, history.md, team.md, routing.md, spawn prompts.

### Casting History Backend Ownership

The policy and registry are authoritative static checkout files for every backend and are not state-tool keys. Before LRU scoring or recording an assignment snapshot, read and update history through the configured backend: for `"local"`/`"worktree"`, read and update the physical `.squad/casting/history.json` file on the local state filesystem; for `"orphan"`, `"two-layer"`, or `"git-notes"`, read logical key `casting/history.json` with `squad_state_read`, write updates with `squad_state_write`, then verify with `squad_state_read`. If the bridge is unavailable or any state call fails, report the error and fail closed. Never read or write a checkout copy for a non-local backend; it may be stale.

### Overflow Handling

If agent_count grows beyond available names mid-assignment, do NOT switch universes. Apply in order:

1. **Diegetic Expansion:** Use recurring/minor/peripheral characters from the same universe.
2. **Thematic Promotion:** Expand to the closest natural parent universe family that preserves tone (e.g., Star Wars OT → prequel characters). Do not announce the promotion.
3. **Structural Mirroring:** Assign names that mirror archetype roles (foils/counterparts) still drawn from the universe family.

Existing agents are NEVER renamed during overflow.

### Casting State Files

**On-demand reference:** Read `.squad/templates/casting-reference.md` for the full JSON schemas of policy.json, registry.json, and history.json.

The casting system uses three files: `.squad/casting/policy.json` and `.squad/casting/registry.json` are authoritative static checkout files for every backend; `history.json` is mutable state stored at the physical path only for `local`/`worktree` and at logical key `casting/history.json` for other backends.

### Migration — Already-Squadified Repos

When `.squad/team.md` exists and either static casting file is missing from the checkout or history is absent from the configured backend:

1. **Do NOT rename existing agents.** Preserve existing registry mappings. If the registry is absent, create it from existing agents and mark their entries `legacy_named: true`; if it exists, preserve its mappings and add only missing existing agents as legacy entries.
2. For every backend, keep `.squad/casting/policy.json` and `.squad/casting/registry.json` as authoritative static checkout files. If policy is absent, copy `.squad/templates/casting-policy.json` (or use defaults). If the registry is absent, initialize it from the existing team. Preserve existing static files and mappings; never send either file through state tools.
3. Initialize mutable history only when absent in the configured backend. For `local`/`worktree`, preserve an existing `.squad/casting/history.json`; if it is absent, create the physical file from `.squad/templates/casting-history.json`. For `orphan`, `two-layer`, or `git-notes`, read logical key `casting/history.json` with `squad_state_read` and preserve it when present. Treat only the explicit response `State key not found: casting/history.json` as absence; then initialize the logical key with `squad_state_write` and immediately verify the seed with `squad_state_read`. If the bridge is unavailable, any other read fails, the write fails, or readback does not match, fail closed. Never create, read, or write a checkout history copy for a non-local backend.
4. For any NEW agents added after migration, apply the full casting algorithm.
5. Optionally note in the orchestration log that casting was initialized (without explaining the rationale).

---
