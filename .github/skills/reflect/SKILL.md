---
name: reflect
description: Learning capture system that extracts HIGH/MED/LOW confidence patterns from conversations to prevent repeating mistakes. Use after user corrections ("no", "wrong"), praise ("perfect", "exactly"), or when discovering edge cases. Complements logical state key agents/{agent}/history.md (local/worktree physical fallback: .squad/agents/{agent}/history.md) and logical key decisions/decisions.md.
license: MIT
version: 1.0.0-squad
domain: team-memory, learning
confidence: high
---

# Reflect Skill

**Critical learning capture system** for Squad. Prevents repeating mistakes and preserves successful patterns across sessions.

Analyze conversations and propose improvements to squad knowledge based on what worked, what didn't, and edge cases discovered. **Every correction is a learning opportunity.**

---

## Integration with Squad Architecture

**Reflect complements existing Squad knowledge systems:**

1. Logical state key `agents/{agent}/history.md` — Permanent learnings from completed work (append-only; each agent updates their own key). Physical `.squad/agents/{agent}/history.md` is a local/worktree-only fallback.
2. Logical state key `decisions/decisions.md` — Team-wide decisions that all agents respect; local/worktree physical path: `.squad/decisions/decisions.md`
3. **Tracked governing source** — Coordinator prompts, skills, and other behavior-defining files changed through focused pull requests
4. **`reflect` skill** — Identifies learnings that may warrant either runtime memory or an approved tracked behavior change

**Workflow:**
- Use `reflect` during work to capture learnings
- At session end, review captured learnings
- Promote HIGH confidence patterns → Squad Coordinator for `decisions/decisions.md` review
- Promote agent-specific patterns → logical key `agents/{agent}/history.md` updates

---

## Triggers

### 🔴 HIGH Priority (Invoke Immediately)

| Trigger | Example | Why Critical |
|---------|---------|--------------|
| User correction | "no", "wrong", "not like that", "never do" | Captures mistakes to prevent repetition |
| Architectural insight | "you removed that without understanding why" | Documents design decisions (Chesterton's Fence) |
| Immediate fixes | "debug", "root cause", "fix all" | Learns from errors in real-time |

### 🟡 MEDIUM Priority (Invoke After Multiple)

| Trigger | Example | Why Important |
|---------|---------|---------------|
| User praise | "perfect", "exactly", "great" | Reinforces successful patterns |
| Tool preferences | "use X instead of Y", "prefer" | Builds workflow preferences |
| Edge cases | "what if X happens?", "don't forget", "ensure" | Captures scenarios to handle |

### 🟢 LOW Priority (Invoke at Session End)

| Trigger | Example | Why Useful |
|---------|---------|------------|
| Repeated patterns | Frequent use of specific commands/tools | Identifies workflow preferences |
| Session end | After complex work | Consolidates all session learnings |

---

## Process

### Phase 1: Identify Learning Target

Determine what knowledge system should be updated:

1. **Agent-specific learning** → logical key `agents/{agent}/history.md`, written with `squad_state_append`
2. **Team-wide decision** → use `squad_state_write` in logical namespace `decisions/inbox/` for `{agent}-{topic}.md`. Use physical path `.squad/decisions/inbox/{agent}-{topic}.md` only as a local/worktree fallback. On orphan, two-layer, or git-notes backends, stop and report a missing bridge instead of writing a checkout snapshot.
3. **Skill-specific improvement** → Document in session, recommend to skill owner

### Phase 2: Analyze Conversation

Scan for learning signals with confidence levels:

#### HIGH Confidence: Corrections

User actively steered or corrected output.

**Detection patterns:**
- Explicit rejection: "no", "not like that", "that's wrong"
- Strong directives: "never do", "always do", "don't ever"
- User provided alternative implementation

**Example:**
```text
User: "No, use the azure-devops MCP tool instead of raw API calls"
→ [HIGH] + Add constraint: "Prefer azure-devops MCP tools over REST API"
```

#### MEDIUM Confidence: Success Patterns

Output was accepted or praised.

**Detection patterns:**
- Explicit praise: "perfect", "great", "yes", "exactly"
- User built on output without modification
- Output was committed without changes

**Example:**
```text
User: "Perfect, that's exactly what I needed"
→ [MED] + Add preference: "Include usage examples in documentation"
```

#### MEDIUM Confidence: Edge Cases

Scenarios not anticipated.

**Detection patterns:**
- Questions not answered
- Workarounds user had to apply
- Error handling gaps discovered

#### LOW Confidence: Preferences

Accumulated patterns over time.

---

### Phase 3: Propose Learnings

Present findings:

```text
┌─────────────────────────────────────────────────────────────┐
│ REFLECTION: {target (agent/decision/skill)}                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ [HIGH] + Add constraint: "{specific constraint}"            │
│   Source: "{quoted user correction}"                        │
│   Target: tracked governing source via focused PR            │
│                                                             │
│ [MED]  + Add preference: "{specific preference}"            │
│   Source: "{evidence from conversation}"                    │
│   Target: logical key agents/{agent}/history.md             │
│   Local/worktree fallback: .squad/agents/{agent}/history.md │
│                                                             │
│ [LOW]  ~ Note for review: "{observation}"                   │
│   Source: "{pattern observed}"                              │
│   Target: report only; no persistence                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Apply changes? [Y/n/edit]                                   │
└─────────────────────────────────────────────────────────────┘
```

**Confidence Threshold:**

| Threshold | Action |
|-----------|--------|
| ≥1 HIGH signal | Always propose (user explicitly corrected) |
| ≥2 MED signals | Propose (sufficient pattern) |
| ≥3 LOW signals | Propose (accumulated evidence) |
| 1-2 LOW only | Skip (insufficient evidence) |

### Phase 4: Persist Learnings

**ALWAYS show changes before applying.**

After user approval:

1. **For Agent History:**
   - Append with `squad_state_append` to logical key `agents/{agent}/history.md` under `## Learnings` section
   - Re-read the key with `squad_state_read` and verify the appended learning
   - Use physical `.squad/agents/{agent}/history.md` only as a local/worktree fallback when state tools are unavailable
   - On orphan, two-layer, or git-notes backends, fail closed and report a missing bridge rather than writing a checkout snapshot
   - If the write or read-back fails, preserve the source learning and report failure
   - Format: Date, assignment context, key learning

2. **For Team Decisions:**
   - Write with `squad_state_write` in logical namespace `decisions/inbox/` for `{agent}-{topic}.md`. Use physical path `.squad/decisions/inbox/{agent}-{topic}.md` only as a local/worktree fallback. On orphan, two-layer, or git-notes backends, stop and report a missing bridge instead of writing a checkout snapshot.
   - The Squad Coordinator reviews accepted team decisions and records them in logical key `decisions/decisions.md`

3. **For Skills:**
   - Document recommendation in session notes
   - Squad Coordinator reviews and routes to the skill owner

---

## Usage Examples

### Example 1: User Correction

**Conversation:**
```
Agent: "I'll use grep to search the repository"
User: "No, use the code search tools first, grep is too slow"
```

**Reflection Output:**
```
[HIGH] + Add constraint: "Use code intelligence tools before grep"
  Source: "No, use the code search tools first, grep is too slow"
  Target: accountable tracked instruction via focused PR; governed runtime
          memory for context only
```

### Example 2: Success Pattern

**Conversation:**
```
Agent: [Creates PR with detailed description and test plan]
User: "Perfect! This is exactly the format I want for all PRs"
```

**Reflection Output:**
```
[MED] + Add preference: "Include test plan in PR descriptions"
  Source: User praised detailed PR format
  Target: governed runtime memory; if adopted as team behavior, update the
          accountable tracked instruction in a focused PR
```

---

## When to Use

✅ **Use reflect when:**
- User says "no", "wrong", "not like that" (HIGH priority)
- User says "perfect", "exactly", "great" (MED priority)
- You discover edge cases or gaps
- Complex work session with multiple learnings
- At end of sprint/milestone to consolidate patterns

❌ **Don't use reflect when:**
- Simple one-off questions with no pattern
- User is just exploring ideas (no concrete decisions)
- Learning is already captured in `history.md`/`decisions/decisions.md`

---

## See Also

- Logical key `decisions/decisions.md` — Team-wide decisions; local/worktree physical path: `.squad/decisions/decisions.md`
- Logical key `agents/{agent}/history.md` — Agent-specific learnings; local/worktree physical fallback: `.squad/agents/{agent}/history.md`
- `.github/agents/squad.agent.md` — Coordinator behavior
- `.squad/routing.md` — Work assignment patterns
