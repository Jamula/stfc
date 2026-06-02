# Kirk — Code Review History

Recent decisions from this session. Full history archived in `history-archive.md`.

## 2026-06-02 — PR #141 re-review (cleanup-old-runs workflow)

**Verdict:** APPROVE ✅ on `1068c1c`. All three blockers (B1 counter-abort, B2 subshell-counter-loss, B3 fake-backoff) addressed. Input validation, 404 idempotency, self-decap guard, permissions, status filter all clean. CI all-green. No Rule 3 pin needed (dispatch-only workflow).

### Learnings (bash-hygiene patterns reusable across workflows)

- **`set -e` + `((x++))` from 0 is a foot-gun**: `((0++))` returns exit 1 because the pre-increment value is 0. Always use `x=$((x + 1))` for counters under `set -e`. Trivial to verify with `grep -nE '\(\(\w+\+\+\)\)' .github/workflows/*.yml`.
- **Pipe-to-while in bash spawns a subshell** — every counter mutated inside the loop is lost when the pipe closes. Process substitution `done < <(cmd)` keeps the loop in the parent shell. Pattern to look for: `cmd | while read x; do counter=...`.
- **"Backoff" needs evidence of actual backoff** — a modulo on accumulated failure count (e.g. `if (( fail % 10 == 0 )); then sleep`) is a *circuit-breaker pulse*, not backoff. Acceptable minimum: one `sleep N` + single retry on every non-zero, classify the retry's stderr.
- **Workflow-pin Rule 3 only applies to scheduled/concurrency-bearing workflows.** Pure `workflow_dispatch` with no cron/concurrency/literal-secret-name doesn't need a pin test — confirmed via `grep -rn '<file>' tests/`.

## 2026-06-02 — PR #96 review (discord-channel stub + ingest script)

**Verdict:** APPROVE ✅ — https://github.com/Jamula/stfc/pull/96#issuecomment-4598333241

**Scope:** 4 files, +441 LOC, all docs + one offline ingest script. Picard un-drafted as Option C ship-prep on an external blocker (bot not in guild `639255937869152267`).

**What I verified:**
- `scripts/fetch-discord-channel.mjs` — token read from env, never echoed, JWT-regex redaction in FATAL handler. Pins-first then paginated history with `before=` cursor + 500 ms polite delay. 429→retry-after→single recursive retry. 401/403 produce actionable messages including invite URL template. Lineage block generated from constants. Read-only (no POST/PATCH/DELETE codepath). Idempotent (only overwrites its own two output files).
- Permission bitmask **66560 = 1024 + 65536** (VIEW_CHANNEL + READ_MESSAGE_HISTORY) verified numerically.
- Six-field Lineage block in channel stub matches convention.
- Rule 3 N/A (no workflow YAML); Rule 16 satisfied (script docs in header + 2 READMEs).
- `npm test`: 567/567 pass on `cae7efe`.

**One non-blocking observation (logged in PR comment):** repo convention for ingest-script exit codes is `0/1/2`. Currently 401 and 403 both exit 1. A future revision could split 403/5xx → exit 2 for cleaner CI signaling.

### Learnings (reusable for reviewing data-ingest scripts)

- **Token-leak defensive regex in the FATAL handler** (matches JWT-shaped `[\w-]{20,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{10,}`) is a cheap belt-and-suspenders pattern. Look for it in every script that handles `*_TOKEN`/`*_SECRET` env vars — error-bubbling via `err.message` can leak the raw token if a fetch implementation includes the Authorization header in its error text.
- **Permission-bitmask verification is fast** — `node -e "console.log(1024+65536)"`. Always cross-check the bitmask against the README's stated permission names; a wrong bitmask silently over-permissions a bot.
- **Idempotency check for ingest scripts** = grep for every `writeFile`/`mkdir` call and confirm each target is either (a) one of the script's own managed files, or (b) created with `{recursive: true}`. Anything writing to a hand-maintained file (like the channel `README.md` stub) is a footgun — confirm those are `console.log` advisories not actual writes.
- **"Defensible no-test" criteria for one-shot scripts:** (1) script is non-runtime, (2) main dependency is a live API the test environment can't reach, (3) script will be re-touched the moment it's actually used (forcing a test-add at that point). All three apply to #96 — no test gate today.
- **`Closes #N` per-line still applies even for single-issue PRs** — PR #96 has `Closes #76` on its own line. Confirmed Rule 6a compliant; no comma-list hazard.

## Re-review pattern for fix commits

**Date:** 2026-06-02T03:03:50Z

When reviewing a fix commit to CHANGES_REQUESTED blockers, structurally verify each blocker is addressed:

1. Link each blocker to the commit diff (make the fix visible in the verdict).
2. Verify non-blocking items from the original review are also addressed (signals thoroughness + builds confidence).
3. Confirm CI status (all-green = merge-safe).
4. Rule 3 pin: dispatch-only workflows don't need cron/concurrency pins; only code-path workflows need pinning.

This pattern distinguishes a "re-review pass" from a "spot-check" and elevates confidence in fix commits that touch multiple reviewers' feedback threads.

— Scribe (logged from orchestration)
