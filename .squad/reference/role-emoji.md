# Squad Reference: Role Emoji Map

<!-- Extracted from squad.agent.md to keep the agent file under github.com's size limit. -->
<!-- This content is loaded on demand by the Squad coordinator; do not delete. -->

### Role Emoji in Task Descriptions

When spawning agents, include the role emoji in the `description` parameter to make task lists visually scannable. The emoji should match the agent's role from `team.md`.

**Standard role emoji mapping:**

| Role Pattern | Emoji | Examples |
|--------------|-------|----------|
| Lead, Architect, Tech Lead | 🏗️ | "Lead", "Senior Architect", "Technical Lead" |
| Frontend, UI, Design | ⚛️ | "Frontend Dev", "UI Engineer", "Designer" |
| Backend, API, Server | 🔧 | "Backend Dev", "API Engineer", "Server Dev" |
| Test, QA, Quality | 🧪 | "Tester", "QA Engineer", "Quality Assurance" |
| DevOps, Infra, Platform | ⚙️ | "DevOps", "Infrastructure", "Platform Engineer" |
| Docs, DevRel, Technical Writer | 📝 | "DevRel", "Technical Writer", "Documentation" |
| Data, Database, Analytics | 📊 | "Data Engineer", "Database Admin", "Analytics" |
| Security, Auth, Compliance | 🔒 | "Security Engineer", "Auth Specialist" |
| Scribe | 📋 | "Session Logger" (always Scribe) |
| Ralph | 🔄 | "Work Monitor" (always Ralph) |
| Rai | 🛡️ | "RAI Reviewer" (always Rai) |
| @copilot | 🤖 | "Coding Agent" (GitHub Copilot) |

**How to determine emoji:**
1. Look up the agent in `team.md` (already cached after first message)
2. Match the role string against the patterns above (case-insensitive, partial match)
3. Use the first matching emoji
4. If no match, use 👤 as fallback

**Examples:**
- `name: "keaton"`, `description: "🏗️ Keaton: Reviewing architecture proposal"`
- `name: "fenster"`, `description: "🔧 Fenster: Refactoring auth module"`
- `name: "hockney"`, `description: "🧪 Hockney: Writing test cases"`
- `name: "scribe"`, `description: "📋 Scribe: Log session & merge decisions"`

The `name` parameter generates the human-readable agent ID shown in the tasks panel — it MUST be the agent's lowercase cast name (e.g., `"eecom"`, `"fido"`). Without it, the platform shows generic slugs like "general-purpose-task" instead of the cast name. The emoji in `description` makes task spawn notifications visually consistent with the launch table shown to users.
