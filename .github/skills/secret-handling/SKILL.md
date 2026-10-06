---
name: secret-handling
description: Never read .env files or write secrets to .squad/ committed files
domain: security, file-operations, team-collaboration
confidence: high
source: earned (issue #267 — credential leak incident)
---

## Context

Spawned agents have read access to the entire repository, including `.env` files containing live credentials. If an agent reads secrets and writes them to mutable Squad state (decisions, logs, history), those credentials may be exposed to other state consumers and accidentally persisted. This skill codifies absolute prohibitions and safe alternatives.

## Patterns

### Prohibited File Reads

**NEVER read these files:**
- `.env` (production secrets)
- `.env.local` (local dev secrets)
- `.env.production` (production environment)
- `.env.development` (development environment)
- `.env.staging` (staging environment)
- `.env.test` (test environment with real credentials)
- Any file matching `.env.*` UNLESS explicitly allowed (see below)

**Allowed alternatives:**
- `.env.example` (safe — contains placeholder values, no real secrets)
- `.env.sample` (safe — documentation template)
- `.env.template` (safe — schema/structure reference)

**If you need config info:**
1. **Ask the user directly** — "What's the database connection string?"
2. **Read `.env.example`** — shows structure without exposing secrets
3. **Read documentation** — check `README.md`, `docs/`, config guides

**NEVER assume you can "just peek at .env to understand the schema."** Use `.env.example` or ask.

### Prohibited Output Patterns

**NEVER write these to `.squad/` files:**

| Pattern Type | Examples | Regex Pattern (for scanning) |
|--------------|----------|-------------------------------|
| API Keys | `OPENAI_API_KEY=sk-proj-...`, `GITHUB_TOKEN=ghp_...` | `[A-Z_]+(?:KEY|TOKEN|SECRET)=[^\s]+` |
| Passwords | `DB_PASSWORD=super_secret_123`, `password: "..."` | `(?:PASSWORD|PASS|PWD)[:=]\s*["']?[^\s"']+` |
| Connection Strings | `postgres://user:pass@host:5432/db`, `Server=...;Password=...` | `(?:postgres|mysql|mongodb)://[^@]+@|(?:Server|Host)=.*(?:Password|Pwd)=` |
| JWT Tokens | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` |
| Private Keys | `-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----` | `-----BEGIN [A-Z ]+PRIVATE KEY-----` |
| AWS Credentials | `AKIA...`, `aws_secret_access_key=...` | `AKIA[0-9A-Z]{16}|aws_secret_access_key=[^\s]+` |
| Email Addresses | `user@example.com` (PII violation per team decision) | `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` |

**What to write instead:**
- Placeholder values: `DATABASE_URL=<set in .env>`
- Redacted references: `API key configured (see .env.example)`
- Architecture notes: "App uses JWT auth — token stored in session"
- Schema documentation: "Requires OPENAI_API_KEY, GITHUB_TOKEN (see .env.example for format)"

### Secret Scanning Before Authorized Commits

**Scribe never stages or commits mutable `.squad/` state.** Persist mutable state through the configured state backend. Filesystem fallback is permitted only at canonical `.squad/` paths when the configured backend is local/worktree and fallback is allowed; it is not permission to stage or commit that state.

For repository changes that an authorized owner is preparing to commit, scan staged files before the commit:

1. **Scan all staged files** for secret patterns (use regex table above)
2. **Check for prohibited file names** (don't commit `.env` even if manually staged)
3. **If secrets detected:**
   - STOP the commit (do NOT proceed)
   - Abort the commit. The authorized committer must unstage and remediate the affected file; Scribe must not stage, unstage, or commit mutable state.
   - Report without echoing matched secret content:
     ```
     🚨 SECRET DETECTED — commit blocked
     
     File: <affected file>
     Pattern: DATABASE_URL=postgres://user:password@localhost:5432/prod
     
     This file may contain credentials and MUST NOT be committed.
     The authorized committer must remove the secret or replace it with a placeholder.
     ```
   - Exit with error (never silently skip)

4. **If no secrets detected:**
   - The authorized committer may proceed with their commit

**Implementation note:**
- Run validation AFTER the authorized committer stages files, BEFORE they call `git commit`
- Use PowerShell `Select-String` or `git diff --cached` to scan staged content
- Never print the matched value while reporting a finding
- Fail loud — secret leaks are unacceptable, blocking the commit is correct behavior

### Remediation — If a Secret Was Already Committed

**If you discover a secret in git history:**

1. **STOP immediately** — do not make more commits
2. **Alert the user:**
   ```
   🚨 CREDENTIAL LEAK DETECTED
   
   A secret was found in git history:
   Commit: abc1234
   File: .squad/decisions/inbox/agent-config.md
   Pattern: API_KEY=sk-proj-...
   
   This requires immediate remediation:
   1. Revoke the exposed credential (regenerate API key, rotate password)
   2. Remove from git history (git filter-repo or BFG)
   3. Force-push the cleaned history
   
   Do NOT proceed with new work until this is resolved.
   ```
3. **Do NOT attempt to fix it yourself** — secret removal requires specialized tools
4. **Wait for user confirmation** before resuming work

## Examples

### ✓ Correct: Reading Config Schema

**Agent needs to know what environment variables are required:**

```
Agent: "What environment variables does this app need?"
→ Reads `.env.example`:
    OPENAI_API_KEY=sk-...
    DATABASE_URL=postgres://user:pass@localhost:5432/db
    REDIS_URL=redis://localhost:6379

→ Writes with state tools in logical namespace `decisions/inbox/` as `river-env-setup.md`
  (physical `.squad/decisions/inbox/river-env-setup.md` fallback only for local/worktree):
    "App requires three environment variables:
    - OPENAI_API_KEY (OpenAI API key, format: sk-...)
    - DATABASE_URL (Postgres connection string)
    - REDIS_URL (Redis connection string)
    See .env.example for full schema."
```

### ✗ Incorrect: Reading Live Credentials

**Agent needs to know database schema:**

```
Agent: (reads .env)
    DATABASE_URL=postgres://admin:super_secret_pw@prod.example.com:5432/appdb

→ Writes with state tools in logical namespace `decisions/inbox/` as `river-db-schema.md`
  (physical `.squad/decisions/inbox/river-db-schema.md` fallback only for local/worktree):
    "Database connection: postgres://admin:super_secret_pw@prod.example.com:5432/appdb"
    
🚨 VIOLATION: Live credential written to mutable Squad state
```

**Correct approach:**
```
Agent: (reads .env.example OR asks user)
User: "It's a Postgres database, schema is in migrations/"

→ Writes with state tools in logical namespace `decisions/inbox/` as `river-db-schema.md`
  (physical `.squad/decisions/inbox/river-db-schema.md` fallback only for local/worktree):
    "Database: Postgres (connection configured in .env). Schema defined in db/migrations/."
```

### ✓ Correct: Secret Scan for an Authorized Commit

**An authorized committer is preparing a repository commit.** The files are already staged by that committer; this scan does not authorize Scribe to stage or commit mutable state.

```powershell
# Scan staged content for secrets
$stagedContent = git diff --cached --no-ext-diff
$secretPatterns = @(
    '[A-Z_]+(?:KEY|TOKEN|SECRET)=[^\s]+',
    '(?:PASSWORD|PASS|PWD)[:=]\s*["'']?[^\s"'']+',
    'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
)

$detected = $false
foreach ($pattern in $secretPatterns) {
    if ($stagedContent -match $pattern) {
        $detected = $true
        Write-Error "🚨 SECRET DETECTED: matched content withheld"
        break
    }
}

if ($detected) {
    # Stop; the authorized committer must unstage and remediate the affected file.
    Write-Error "Commit blocked — secret detected in staged files"
    exit 1
}

# The authorized committer may proceed; Scribe does not run git commit.
```

## Anti-Patterns

- ❌ Reading `.env` "just to check the schema" — use `.env.example` instead
- ❌ Writing "sanitized" connection strings that still contain credentials
- ❌ Assuming "it's just a dev environment" makes secrets safe to commit
- ❌ Committing first, scanning later — validation MUST happen before commit
- ❌ Silently skipping secret detection — fail loud, never silent
- ❌ Trusting agents to "know better" — enforce at multiple layers (prompt, hook, architecture)
- ❌ Writing secrets to "temporary" files in `.squad/` — mutable state is still persisted and may be exposed
- ❌ Extracting "just the host" from a connection string — still leaks infrastructure topology
