# Casting Reference

On-demand reference for Squad's casting system. Loaded during Init Mode or when adding team members.

## Universe Table

| Universe | Capacity | Shape Tags | Resonance Signals |
|---|---|---|---|
| The Usual Suspects | 6 | small, noir, ensemble | crime, heist, mystery, deception |
| Reservoir Dogs | 8 | small, noir, ensemble | crime, heist, tension, loyalty |
| Alien | 8 | small, sci-fi, survival | space, isolation, threat, engineering |
| Ocean's Eleven | 14 | medium, heist, ensemble | planning, coordination, roles, charm |
| Arrested Development | 15 | medium, comedy, ensemble | dysfunction, business, family, satire |
| Star Wars | 12 | medium, sci-fi, epic | conflict, mentorship, legacy, rebellion |
| The Matrix | 10 | medium, sci-fi, cyberpunk | systems, reality, hacking, philosophy |
| Firefly | 10 | medium, sci-fi, western | frontier, crew, independence, smuggling |
| The Goonies | 8 | small, adventure, ensemble | exploration, treasure, kids, teamwork |
| The Simpsons | 20 | large, comedy, ensemble | satire, community, family, absurdity |
| Breaking Bad | 12 | medium, drama, tension | chemistry, transformation, consequence, power |
| Lost | 18 | large, mystery, ensemble | survival, mystery, groups, leadership |
| Marvel Cinematic Universe | 25 | large, action, ensemble | heroism, teamwork, powers, scale |
| DC Universe | 18 | large, action, ensemble | justice, duality, powers, mythology |
| Futurama | 12 | medium, sci-fi, comedy | future, robots, space, absurdity |

**Total: 15 built-in universes** — capacity range 6–25.

## Descriptive Defaults

When the user does not request a themed universe, use **descriptive role-based names** instead of character names. Descriptive names are the default naming convention.

| Role | Descriptive Name |
|---|---|
| Lead | Lead |
| Frontend Dev | Frontend |
| Backend Dev | Backend |
| Tester / QA | Tester |
| Security | Security |
| DevRel / Docs | Docs |
| Reviewer | Reviewer |
| DevOps / Infra | Infra |

Rules for descriptive naming:
- Use short, functional names that describe the agent's role.
- Agent folder names are the descriptive name in lowercase (e.g., `.squad/agents/lead/`).
- Set `"universe": "descriptive"` in `registry.json`.
- If the user later requests a themed universe via re-cast, replace all descriptive names with character names from the chosen universe.

## Custom Universes

Users may request **any universe** — not just those in the built-in allowlist. When a user specifies a universe not in the table above, treat it as a custom universe.

### Custom Universe Rules

1. **Accept the request.** Do not reject a universe because it is not in the allowlist.
2. **Allocate character names from your knowledge** of the source material. Pick characters whose traits or roles loosely resonate with the agent's function.
3. **Spoiler awareness still applies.** Follow all spoiler rules (see below) — prefer names as introduced early, avoid fate-revealing epithets.
4. **Capacity is flexible.** There is no pre-set capacity for custom universes. If the source material has enough named characters for the team, proceed. If not, tell the user and suggest a different universe.
5. **Record as custom.** In `registry.json`, set `"universe"` to the user-specified universe name (e.g., `"Doctor Who"`, `"The Office"`). In `history.json`, record the universe name as given by the user.
6. **ONE UNIVERSE PER ASSIGNMENT** still applies — do not mix custom and built-in characters.
7. **Re-casting is allowed.** The user can re-cast at any time by requesting a different universe (custom or built-in). All active agents are renamed; folder names and file references are updated.

### Custom Universe in policy.json

When `"allow_custom_universes": true` is set in `policy.json` (this is the default), any user-specified universe is accepted. Built-in universes are preferred for auto-selection (no user preference), but the user can always override.

## Selection Algorithm

Universe selection is deterministic and applies **only when the user has not specified a universe**. If the user requests a specific universe (built-in or custom), use it directly — skip scoring.

When auto-selecting, score each built-in universe and pick the highest:

```
score = size_fit + shape_fit + resonance_fit + LRU
```

| Factor | Description |
|---|---|
| `size_fit` | How well the universe capacity matches the team size. Prefer universes where capacity ≥ agent_count with minimal waste. |
| `shape_fit` | Match universe shape tags against the assignment shape derived from the project description. |
| `resonance_fit` | Match universe resonance signals against session and repo context signals. |
| `LRU` | Least-recently-used bonus — prefer universes not used in recent assignments (from `history.json`, read from the configured state backend). |

Same inputs → same choice (unless LRU changes between assignments).

### Casting History Backend Ownership

The policy and registry are authoritative static checkout files for every backend and are not state-tool keys. Before LRU scoring or recording an assignment snapshot, read and update history through the configured backend: for `"local"`/`"worktree"`, read and update the physical `.squad/casting/history.json` file on the local state filesystem; for `"orphan"`, `"two-layer"`, or `"git-notes"`, read logical key `casting/history.json` with `squad_state_read`, write updates with `squad_state_write`, then verify with `squad_state_read`. If the bridge is unavailable or any state call fails, report the error and fail closed. Never read or write a checkout copy for a non-local backend; it may be stale.

## Spoiler Awareness

Character names are easter eggs shown in plain text across `team.md`, prompts, logs, and generated files. The user configuring the squad may be midway through the source material. A name that bakes in a future title, role, transformation, or fate can spoil later plot events even when the casting rationale stays hidden.

How to avoid it:

- Prefer the name a character has when first introduced.
- Avoid titles or epithets earned later.
- Avoid names that describe a transformation, fate, hidden identity, or reveal.
- When unsure, pick a safer character from the same universe.
- Keep existing name mappings stable — do not rename already-allocated agents or switch universes to dodge a spoiler. Only the next/new allocation should pick a different spoiler-safe character.

> **Motivating example.** A user setting up a squad requested the *Malazan Book of the Fallen* universe (Steven Erikson) and was only four books into the series. The casting allocated two spoiler-bearing names:
> - One name bundled a **title/epithet the character only earns after a major mid-series development** — encoding a role they do not yet hold at the reader's current point in the story.
> - The other referenced a **state/transformation that has not yet occurred** at the reader's position — revealing what later becomes of that character.
>
> Both leaked future plot. (Character names are deliberately omitted here so this document does not reproduce the spoiler.)

## Casting State File Schemas

### policy.json

Source template: `.squad/templates/casting-policy.json`
Authoritative static checkout file for every backend: `.squad/casting/policy.json`

```json
{
  "casting_policy_version": "1.1",
  "allowlist_universes": ["Universe Name", "..."],
  "universe_capacity": {
    "Universe Name": 10
  }
}
```

### registry.json

Source template: `.squad/templates/casting-registry.json`
Authoritative static checkout file for every backend: `.squad/casting/registry.json`

```json
{
  "agents": {
    "agent-role-id": {
      "persistent_name": "CharacterName",
      "universe": "Universe Name",
      "created_at": "ISO-8601",
      "legacy_named": false,
      "status": "active"
    }
  }
}
```

### history.json

Source template: `.squad/templates/casting-history.json`
Backend location: physical `.squad/casting/history.json` for `local`/`worktree`; logical key `casting/history.json` for `orphan`, `two-layer`, or `git-notes`.

```json
{
  "universe_usage_history": [
    {
      "universe": "Universe Name",
      "assignment_id": "unique-id",
      "used_at": "ISO-8601"
    }
  ],
  "assignment_cast_snapshots": {
    "assignment-id": {
      "universe": "Universe Name",
      "agents": {
        "role-id": "CharacterName"
      },
      "created_at": "ISO-8601"
    }
  }
}
```

### Migration — Already-Squadified Repos

When `.squad/team.md` exists and either static casting file is missing from the checkout or history is absent from the configured backend:

1. **Do NOT rename existing agents.** Preserve existing registry mappings. If the registry is absent, create it from existing agents and mark their entries `legacy_named: true`; if it exists, preserve its mappings and add only missing existing agents as legacy entries.
2. For every backend, keep `.squad/casting/policy.json` and `.squad/casting/registry.json` as authoritative static checkout files. If policy is absent, copy `.squad/templates/casting-policy.json` (or use defaults). If the registry is absent, initialize it from the existing team. Preserve existing static files and mappings; never send either file through state tools.
3. Initialize mutable history only when absent in the configured backend. For `local`/`worktree`, preserve an existing `.squad/casting/history.json`; if it is absent, create the physical file from `.squad/templates/casting-history.json`. For `orphan`, `two-layer`, or `git-notes`, read logical key `casting/history.json` with `squad_state_read` and preserve it when present. Treat only the explicit response `State key not found: casting/history.json` as absence; then initialize the logical key with `squad_state_write` and immediately verify the seed with `squad_state_read`. If the bridge is unavailable, any other read fails, the write fails, or readback does not match, fail closed. Never create, read, or write a checkout history copy for a non-local backend.
4. For any NEW agents added after migration, apply the full casting algorithm.
5. Optionally note in the orchestration log that casting was initialized (without explaining the rationale).

---
