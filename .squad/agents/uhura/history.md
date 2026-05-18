# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.2.0 — Artifact Hygiene Enforcement (2026-05-08)

**Implementation completed:** Built cross-platform artifact hygiene scanner to enforce Principle VII (no real tokens/account data in committed artifacts).

**Components delivered:**
1. `scripts/check-artifact-hygiene.mjs` — Node.js scanner (Windows + Linux compatible); detects 6 token patterns (JWT, BEARER_TOKEN, GITHUB_TOKEN, AWS_ACCESS_KEY, API_KEY, STFC_ACCOUNT_DATA).
2. `.github/workflows/squad-artifact-hygiene.yml` — CI gate triggered on PR touching specs/plans/tasks/docs.
3. Test fixtures: `clean-spec.md` (PASS) and `contaminated-spec.md` (FAIL with 6 labeled patterns).
4. Coordination note for Scotty on `npm test` integration.

**Verification:** Each pattern cross-checked against live code. All patterns correctly redact matched content to `<REDACTED-TOKEN>`.

**Status:** Ready for ratification and pre-commit hook integration.

### Post-Ratification Commitment

High urgency: CI token-scanner must be deployed before first speckit spec merge (blocking prerequisite per Borg Queen's v1.2.0 audit). Secret-leakage risk is constitutional violation if unmitigated.

---

### Workflow cron edits — operating reminders (2026-05-17)

Captured while fixing Issue #14 (`refresh-token.yml` -> Saturday 00:00 UTC,
PR #20):

- **GitHub Actions cron DOW field:** `MIN HOUR DOM MONTH DOW`, where DOW
  uses `0=Sunday` and `6=Saturday`. So `0 0 * * 6` is every Saturday at
  00:00 UTC. Easy to flip these by mistake — always state the cadence
  in plain English in the PR body so reviewers don't have to look it up.
- **Same-commit pinning-test rule (repo Rule 3):** *Before* committing
  any `.github/workflows/*.yml` edit, run `grep -rn '<workflow-file>'
  tests/`. If anything pins a literal cron / group / permission, it
  MUST be updated in the same commit. For #14 the grep was empty, so
  the PR is a one-file diff — call that out explicitly in the PR body
  so reviewers know it wasn't an oversight.
- **PR-without-draft norm for small workflow tweaks:** Single-file
  workflow diffs with passing tests should ship as normal PRs (not
  drafts). Cyrus prefers the lower-friction path when the blast radius
  is one cron line.
- **Concurrency-group awareness:** `refresh-token.yml`, `redeem.yml`,
  and the incoming `discord-monitor.yml` all share
  `concurrency.group: stfc-gift-redeemer`. Any cron move needs to call
  out the queue/cancel interaction in a comment so future readers
  understand why a scheduled-redeem run might be skipped that hour.

---

### Codespace token-scope discovery + devcontainer permissions fix (2026-05-17)

**Context:** Issue #17 (Dependabot triage) blocked on `403 Resource not accessible by integration` from `/repos/Jamula/stfc/dependabot/alerts`. Root cause: Codespace-managed `GITHUB_TOKEN` does not include `security_events` scope by default.

**Key finding:** `gh auth refresh` cannot add scopes to Codespace-managed tokens. The token is issued at container-creation time and is immutable for the session. The only durable fix is declaring the permission in `.devcontainer/devcontainer.json` under `customizations.codespaces.repositories.{owner/repo}.permissions.security_events: read`. After Codespace rebuild, the token is re-issued with the declared scope.

**Pattern: expand existing issue rather than file a new one.** When a discovery during a session reveals a second acceptance criterion that belongs naturally with an existing issue (same file, same container-creation event), append the criterion to the existing issue via `gh issue comment` rather than opening a new issue. This keeps the scope coherent for reviewers and avoids a redundant PR. PR #33 covers both the original #16 idle-stop ask and the new security_events scope in a single-file diff.

**devcontainer.json permissions block structure:**
```json
"customizations": {
  "codespaces": {
    "repositories": {
      "Jamula/stfc": {
        "permissions": {
          "security_events": "read"
        }
      }
    }
  }
}
```

**Follow-up required:** Cyrus must rebuild the Codespace after PR #33 merges for the new token scope to take effect. #17 can then proceed in a fresh session.

---

### PR #37 review fix — classifiedTips variable shadowing (2026-05-17T17:53:01.345+00:00)

**Context:** Kirk reviewed Scotty's PR #37 (Discord monitor Phases 5–6) and found a variable shadowing bug. Scotty locked out per reviewer rejection protocol; Uhura picked up the revision.

**Bug:** `const classifiedTips: Tip[] = []` on line 231 of `src/skills/discordMonitor.ts` (inside the `if (token)` block) shadowed the outer `let classifiedTips` declared at line 183. This caused all classified tips to be silently discarded — they were pushed into the inner array, which went out of scope, so the digest and `tips-seen.jsonl` always received an empty tips array. Health counters were wired correctly because they read from the classifier output directly, not from `classifiedTips`.

**Fix:** Removed the `const` declaration, changing `const classifiedTips: Tip[] = []` to `classifiedTips = []` (plain reassignment to the outer variable).

**Test added:** `classified tips appear in digest output and tips-seen.jsonl (tip-flow integration)` — sends a message with "tip:" prefix through the full pipeline, asserts: (1) digest file contains tip content, (2) `tipsClassified.tip >= 1`, (3) `tips-seen.jsonl` has an entry, (4) entry parses with correct `category` and `contentHash` fields.

**Lesson:** Variable shadowing with `const`/`let` in nested blocks is silent in TypeScript — no compiler warning by default. In long pipeline functions, prefer initializing mutable accumulators at the top and resetting via assignment rather than re-declaring.

---

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*

### Phase 3 Landing — Commit 39ad92f (2026-05-17T20:42:03Z)

**US3 Bot Token Validation MVP** successfully completed. All Phase 3 tests passing (445 total). Phase 3 commit landed; Phase 4 ready for dispatch.


2026-05-17T21:39Z: Feature 003-discord-oauth shipped to main (PR #59); issue #51 closed.
**2026-05-18T00:** New squad meta issues #61–#69 filed by Picard 2026-05-18; review when picking up squad:picard work
