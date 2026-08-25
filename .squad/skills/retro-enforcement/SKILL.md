# Skill: Retro Enforcement

> **Installed:** 2026-08-23, by Tuvok, per issue #245 (retro action item 5/6). Source:
> `.squad/templates/skills/retro-enforcement/`. This copy is the **active** skill — the
> template copy is a reference/starter and is not read by the coordinator. Every
> template section (`Coordinator Integration`, `Blocking Semantics`, etc.) is
> preserved here; the only additions are the `State-backend awareness` and
> `Fail-loud install check` sections, both required by issue #245.
>
> **Executable implementation (#248 Garak finding 2):** the PowerShell below is
> illustrative — it shows the shape of the check for a reader, but nothing
> calls it, and as written it cannot support the state-backend branch (there
> is no PowerShell "governed state tool" form; `Get-ChildItem`/`Get-Content`
> only ever see the filesystem). The concrete, testable, backend-aware
> implementation both the coordinator and the test suite actually call is
> `scripts/check-retro-overdue.mjs`, exporting `checkRetroOverdue`,
> `isRetroOverdue`, `parseLogTimestamp`, and `checkActionItemsCreated`. See
> "Coordinator Integration" below for exact invocation per backend.

## Purpose

Ensure retrospectives happen on schedule and that their action items are tracked in GitHub Issues — not markdown checklists.

This skill addresses a specific, measured failure mode: **0% completion rate on markdown retro action items across 6 consecutive retrospectives**. GitHub Issues have an 85%+ completion rate in the same squad. The format was the problem, not the people.

## Core Function: Test-RetroOverdue

```powershell
function Test-RetroOverdue {
    param(
        [string]$LogDir    = ".squad/log",
        [int]$WindowDays   = 7,
        [string]$Pattern   = "*retrospective*"
    )

    $cutoff = (Get-Date).AddDays(-$WindowDays)

    $retroLogs = Get-ChildItem -Path $LogDir -Filter $Pattern -ErrorAction SilentlyContinue |
                 Where-Object { $_.LastWriteTime -ge $cutoff }

    # @() forces array context so a zero/one-item result under strict mode
    # still exposes .Count instead of unwrapping to a scalar.
    return (@($retroLogs).Count -eq 0)
}
```

### Returns
- `$true` — No retro log found within the window. **Retro is overdue. Block other work.**
- `$false` — At least one retro log found within the window. Proceed normally.

### Detection Logic

The function checks `.squad/log/` for any file matching `*retrospective*` dated within the last `$WindowDays` days (default: 7). If none is found, the retro is overdue.

**File naming convention:** `.squad/log/{ISO8601-timestamp}-retrospective.md`

Example: `.squad/log/2026-03-24T14-45-00Z-retrospective.md`

### ⚠️ State-backend awareness (required — issue #245)

The literal `Get-ChildItem $LogDir` above only reflects reality when `STATE_BACKEND`
(`.squad/config.json` → `stateBackend`) is `"local"` or `"worktree"` — for those
backends the filesystem **is** the state, so scanning `.squad/log/` directly is correct.

For every other backend (`"orphan"`, `"two-layer"`, `"git-notes"`), `.squad/log/` on
disk is a **git-tracked historical snapshot only**, refreshed at commit boundaries, not
a live view. Verified empirically on this repo (two-layer): filesystem `.squad/log/`
tops out at 2026-06-02 while the runtime state backend's `log/` directory already
contains same-day session and retrospective entries. A coordinator that trusts the
filesystem under a non-local backend will see false-positive "overdue" forever, or
worse, a false-negative once the filesystem happens to contain a stale match.

**Resolution — the coordinator MUST branch on `STATE_BACKEND` before evaluating this
check, using the concrete implementation in `scripts/check-retro-overdue.mjs`
(not the illustrative PowerShell above, which has no governed-state-tool form):**

- `STATE_BACKEND ∈ {"local", "worktree"}` → run
  `node scripts/check-retro-overdue.mjs --backend local --log-dir .squad/log
  --window-days 7`. Internally this calls the exported `listLocalRetroLogs` +
  `isRetroOverdue`, scanning the filesystem `.squad/log/` — canonical for
  these backends.
- `STATE_BACKEND ∈ {"orphan", "two-layer", "git-notes"}` → the canonical log
  listing is `squad_state_list(dir: "log")` (the governed state tool), **not**
  `Get-ChildItem` and **not** a direct in-process import from the coordinator.
  Fetch those filenames first, then pipe them as `{"entries": [...]}` on stdin
  to `node scripts/check-retro-overdue.mjs overdue --backend <backend>`. If the
  caller is already in JS, `scripts/retro-gate-bridge.mjs` is the reusable adapter
  for that exact boundary: it takes injected `stateList` callbacks, serializes the
  result, spawns the CLI, and parses the single JSON line it prints. The same
  `isRetroOverdue` logic still applies identically once `entries` are in hand
  (parsing each entry's leading ISO-8601 timestamp from the filename, never
  filesystem `LastWriteTime`, which reflects worktree checkout time, not log
  creation time). This mirrors the existing state-backend handshake rule in
  `squad.agent.md`: mutable `log/**` is runtime-owned and must be read through
  `squad_state_*` / `memory.*` tools for these backends, never assumed to be
  reflected on disk.

This is not a new policy decision — it is the direct, mechanical consequence of the
state-backend contract already established in `squad.agent.md` (Source of Truth /
state-backend handshake sections). See `decisions.md` entry "A gate that cannot run
must never report as satisfied" (2026-08-24, #242/#245) for the accepted rule this
codifies.

**Timestamp parsing note:** `.squad/log/` on disk mixes filename formats (older
`YYYYMMDD-HHMMSS-*` alongside newer ISO-8601 `YYYY-MM-DDTHH-MM-SSZ-*`). State-backend
entries are consistently ISO-8601 today. `parseLogTimestamp` in
`scripts/check-retro-overdue.mjs` handles both formats explicitly, always in UTC,
and returns `null` (not a guess) for anything else; `isRetroOverdue` treats a
`null` parse as **not** within the window (fail closed on ambiguity, never
assumed recent), and separately rejects any timestamp in the future relative to
`now` (a clock-skewed or malformed future date must never suppress the gate).

## Coordinator Integration

**Two distinct enforcement surfaces exist for this gate — do not conflate them:**

1. **The interactive/CLI coordinator session** (`squad.agent.md` → Ceremonies
   → Core Logic, step 0) — a prompt instruction the coordinator model
   follows during its own turn. It is documented there, including the exact
   CLI invocation, but **no external test can verify a live session actually
   executed it** — that step's own text says so explicitly. Treat it as
   advisory, not as proof of enforcement. If/when a coordinator session
   does invoke this manually, `scripts/retro-gate-bridge.mjs` is the
   reusable, directly-testable shape of that invocation:
   `checkOverdueViaBridge({ backend, stateList, ... })` and
   `checkActionItemsViaBridge({ backend, stateRead, ... })` take an
   injected `stateList`/`stateRead` callback (the same shape as the real
   `squad_state_list`/`squad_state_read` MCP tools), serialize its result
   as JSON, and spawn the real `check-retro-overdue.mjs` child process —
   exactly the tool-call → JSON stdin → parsed-decision path a coordinator
   with a shell and MCP tools, but no in-process import surface, actually
   has available. See `tests/scripts/retroGateBridge.test.ts`.
2. **`.github/workflows/squad-heartbeat.yml` → `.squad/templates/ralph-triage.js`**
   — a real GitHub Actions job, triggered on real events, that evaluates
   this gate before constructing its own triage work queue, for
   `local`/`worktree` backends. This IS independently, externally
   verifiable: see `tests/scripts/ralphTriageRetroGate.test.ts`, which
   spawns the actual check and proves an overdue result suppresses queue
   construction, executing the real `runRound()` entry point directly (not
   a reimplemented predicate). It has no MCP access, so
   `orphan`/`two-layer`/`git-notes` backends are honestly reported as
   `evaluated: false` rather than fabricated (see `evaluateRetroGate` in
   that file). **Satisfiability:** this dispatcher's retro signal is the
   creation date of the most recent GitHub Issue labeled `retro-complete`
   — a dedicated completion marker, distinct from the `retro-action` label
   individual action items carry (see Action Item Enforcement below),
   applied only as the FINAL step of a completed retrospective. Using the
   in-progress `retro-action` signal instead would race this repo's
   `issues: labeled` heartbeat trigger: labeling the very first action item
   during an in-progress retro could start a heartbeat that sees that fresh
   issue and resumes triage before the log and remaining action items are
   verified. The signal is also not `.squad/log/`, which is gitignored and
   therefore invisible to a fresh CI checkout regardless of how many
   retrospectives actually ran.

```powershell
# At round start — before any work queue construction (illustrative control
# flow; see the CLI protocol below for what actually drives this in either
# real integration point above).
if (Test-RetroOverdue -LogDir ".squad/log" -WindowDays 7) {
    Write-Host "[RETRO] Retrospective overdue. Running before other work."

    # Spawn retro facilitator
    Invoke-RetroSession -Mode "catch-up"

    # Wait for retro log to be written
    # Then resume normal round
}

# Proceed with normal work queue
$workQueue = Get-PendingIssues | Sort-Object -Property Priority
```

The PowerShell above is illustrative control flow only. The actual overdue
decision comes from `scripts/check-retro-overdue.mjs`'s documented JSON
stdin/stdout protocol (see that file's header comment): run
`node scripts/check-retro-overdue.mjs overdue --backend <backend> [--log-dir DIR]`,
piping `{"entries": [...]}` on stdin for non-local backends. Exit code `0`
means "evaluated" — parse the single line of JSON on stdout and read its
`overdue` field; exit codes `2`/`3` are usage/fault errors, never a domain
result. Never infer overdue/not-overdue from the exit code alone.

### Blocking Semantics

When the round-start check reports overdue:

1. **Do not start any other work** until the retro completes.
2. **Spawn the facilitator agent** (Scribe or designated) with retro mode.
3. **Wait for the log to be written** — to `.squad/log/` for `local`/`worktree`
   backends, or via `squad_state_write` to the runtime `log/` namespace for
   `orphan`/`two-layer`/`git-notes` backends (see "State-backend awareness").
4. **Verify action items** were created as GitHub Issues, not markdown checkboxes —
   see `Test-RetroActionItemsCreated` below.
5. **Resume normal round** only after the retro log is confirmed via the same
   backend-appropriate read used in step 3 — never assume the write succeeded.

## Action Item Enforcement

Every retro action item MUST become a GitHub Issue. The facilitator agent is responsible for this. The coordinator verifies.

### Verification Check

```powershell
function Test-RetroActionItemsCreated {
    param([string]$RetroLogPath)

    $content = Get-Content $RetroLogPath -Raw

    # Check for Issue references (e.g., #1478, https://github.com/.../issues/1478)
    $issueRefs = [regex]::Matches($content, '(?:#\d{3,}|issues/\d{3,})')

    # Check for unclosed markdown checkboxes (bad pattern)
    $openCheckboxes = [regex]::Matches($content, '- \[ \]')

    if ($openCheckboxes.Count -gt 0) {
        Write-Warning "[RETRO] Found $($openCheckboxes.Count) markdown checkboxes — convert to Issues"
        return $false
    }

    return ($issueRefs.Count -gt 0)
}
```

As with `Test-RetroOverdue`, this PowerShell is illustrative only. The executable
implementation is `checkActionItemsCreated(content)` in
`scripts/check-retro-overdue.mjs`, fed via `readRetroLogContent`, which follows the
same state-backend branch: read the log's content via
`squad_state_read(key: "log/{filename}")` for `orphan`/`two-layer`/`git-notes`
(pass the result as `{ content }`), or `readRetroLogContent({ backend, retroLogPath })`
directly for `local`/`worktree`.

### Why Not Markdown Checklists

From production data in tamirdresher/tamresearch1:

| Retro | Action Items Format | Completion |
|-------|---------------------|------------|
| 2025-12-05 | Markdown `- [ ]` | 0/4 = **0%** |
| 2025-12-19 | Markdown `- [ ]` | 0/3 = **0%** |
| 2026-01-09 | Markdown `- [ ]` | 0/5 = **0%** |
| 2026-01-23 | Markdown `- [ ]` | 0/4 = **0%** |
| 2026-02-07 | Markdown `- [ ]` | 0/3 = **0%** |
| 2026-02-21 | Markdown `- [ ]` | 0/4 = **0%** |
| 2026-03-24 | GitHub Issues | 4/4 = **100%** (after enforcement) |

**Root cause:** Markdown checklists have no assignee, no notifications, no close event, and no query surface. They are invisible to every workflow that drives completion.

## Cadence Enforcement

### Recommended schedule
- Weekly squads: window = 7 days
- Bi-weekly squads: window = 14 days

### Ralph integration example

```powershell
# ralph-watch.ps1 — round start hook
function Invoke-RoundStart {
    # 1. Always check retro first
    if (Test-RetroOverdue -LogDir "$RepoRoot/.squad/log" -WindowDays 7) {
        Write-Host "[RALPH] Retro overdue — enforcing before work queue"
        Invoke-RetroSession
        return  # Re-enter round after retro completes
    }

    # 2. Normal work queue
    $issues = Get-ReadyIssues
    foreach ($issue in $issues) {
        Invoke-WorkItem -Issue $issue
    }
}
```

## Fail-loud install check (required — issue #245)

A ceremony that names an `Enforcement skill` field (see `.squad/ceremonies.md` →
"Retrospective with Enforcement") is **only enforced** if that skill is actually
installed and readable. Before trusting any such gate, the coordinator MUST first
confirm the named skill resolves against the **5 documented project skill paths**,
in precedence order (see `.squad/reference/skill-routing.md`):

1. `.squad/skills/{skill-id}/SKILL.md`
2. `.copilot/skills/{skill-id}/SKILL.md`
3. `.github/skills/{skill-id}/SKILL.md`
4. `.claude/skills/{skill-id}/SKILL.md`
5. `.agents/skills/{skill-id}/SKILL.md`

- **If any of the 5 paths exist:** proceed with `Test-RetroOverdue` as documented above.
- **If none of the 5 paths exist:** the ceremony is **unenforced**. Do not silently
  treat the gate as passed and do not silently skip it. Instead:
  1. Treat the retro as **overdue by definition** (fail closed, not open).
  2. Surface it loudly — post a decision/finding (`squad_decide` or
     `memory.write` class `decision`) naming the missing skill and the ceremony
     that references it, so the gap is visible in `decisions.md` rather than
     silently absorbed.
  3. Do not let other work proceed until either the skill is installed at one of
     the 5 paths or a human explicitly accepts the risk.

**⚠️ Non-circular by design:** this section documents the procedure for readers of
*this* file, but it is not the enforcement surface — a check for "is skill X
missing" that lives exclusively inside skill X is unreadable in exactly the case
it exists to catch. The authoritative, always-read copy of this procedure is
inlined directly in `.squad/ceremonies.md` (which the coordinator reads regardless
of whether this skill file is present), and it is additionally pinned by an
executable CI check: `.github/workflows/protected-paths.yml` runs
`node scripts/check-enforcement-skills.mjs`, and that script parses every
`**Enforcement skill**` row out of `ceremonies.md` and fails the build if the named
skill does not resolve at any of the 5 paths above. Pin test:
`tests/skills/enforcementSkillCheck.test.ts`.

This is the same principle applied to issue #242's vacuous `test` status check
(a required check that passes on a non-existent test glob is worse than no check,
because it reads as coverage). See `decisions.md`, "A gate that cannot run must
never report as satisfied."

## Skill Metadata

| Field | Value |
|-------|-------|
| **Skill ID** | `retro-enforcement` |
| **Category** | Ceremonies / Process |
| **Trigger** | Coordinator round start |
| **Dependencies** | `.squad/log/` directory (local/worktree backend) or `squad_state_list`/`squad_state_read` (orphan/two-layer/git-notes backend), GitHub Issues API |
| **Tested in** | tamirdresher/tamresearch1 (production, March 2026) |
| **Outcome** | Retro cadence restored; action item completion 0% → 100% |
| **Installed in this repo** | 2026-08-23, Tuvok, issue #245 |
