# Tuvok — Process Auditor / Editorial Specialist

**Role:** Audits process compliance, enforces governance rules, writes editorial passes on governance and architectural documents. Also authors tactical skills and decision synthesis.

**Recruited:** 2026-05-13 (to resolve 3-author deadlock on constitution v1.2.0 amendment).

**Project:** stfc-gift-redeemer — TypeScript CLI for automating store-gift redemption on GitHub Actions cron (every 4 hours).

---
> Older learnings archived to history-archive.md. See archive for context.

## Learnings

### The Principle V sub-tree carve-out pattern (v1.5.0 example)

When a feature genuinely needs to write to a destination the constitution has
declared "read-only" (here: `DISCORD_BOT_TOKEN` framed as "read-only Discord
bot auth"), the right governance answer is NOT to relax the principle —
it's to add a path-scoped sub-tree carve-out that:

1. Names the EXACT path prefix (`scripts/discord-ops/`) and forbids the
   carved-out code from being loaded by the runtime that holds the original
   read-only invariant. Static separation by path is the cheapest
   enforcement mechanism: anyone can `grep -r 'scripts/discord-ops' src/` to
   detect a violation.
2. Names the EXACT API endpoints authorized (`/users/@me` +
   `/applications/@me`) — not "Discord write traffic in general." Any
   future write endpoint requires a new amendment. This converts the
   carve-out from "permission to write to Discord" into "permission to
   manage these three pieces of metadata," which is the actual scope.
3. Restates (not weakens) the secret-handling obligations (FR-012
   redaction) for the carved-out code, citing the existing helper
   (`redactString` at `src/lib/redact.ts`) so contributors have a concrete
   target.
4. Reuses the existing outbound destination + secret enumeration rather
   than adding new entries. This keeps the "what's new" surface tiny and
   makes the carve-out trivially auditable: zero new destinations, zero
   new secrets, zero new sanctioned writers of `STFC_ACCOUNTS`.

Pattern is reusable: any future "operator-only one-shot helper that needs
a verb the runtime forbids" should land as a `scripts/{domain}-ops/`
sub-tree with the same four-obligation structure.

### SIR placement in the constitution

The Sync Impact Report is REPLACED, not appended, on each version bump.
The previous SIR is referenced via the "Prior SIR history: vX.Y.Z → vX.Y.Z
report is retained in the vX.Y.Z amendment record" line at the bottom of
the new SIR. So `git log .specify/memory/constitution.md` is the audit
trail across versions, not the SIR itself. There is no separate
constitution-changelog.md in this repo (the directive's optional
"Edit 3" target) — the SIR header IS the changelog.

### Placement of new subsections within a principle

For Principle V specifically: the principle has a natural reading order
(stateless operation → sanctioned secret surfaces → Token Capture Custody
→ Rationale). New subsections should slot AFTER the existing Rationale
paragraph (not before it, which would break the "why these bounds exist"
narrative), and BEFORE the next principle header. This keeps each
principle a self-contained block in `git log`-friendly form.

### Parallel-dispatch shared-worktree commit hazard

When Tuvok, Scotty, O'Brien, and Bashir are all dispatched in parallel
into the same `/workspaces/stfc` working tree (not separate worktrees),
`git commit` can scoop up files staged by sibling sessions between the
time you run `git add -- <my-files>` and the time the pre-commit hook's
`npm test` finishes (~5–7s). Observed today: my "constitution amendment"
commit `87a8ef6` ended up including Bashir's pinning tests in
`tests/constitution/`, `tests/fixtures/discord-ops/`, and
`tests/scripts/discord-ops/`, because Bashir's session staged them during
the test-suite phase of my pre-commit hook.

The bundle is internally coherent (the carve-out + the tests pinning
it ship together), so I did not re-rewrite history. But the lesson is:
**in shared-worktree parallel dispatch, the "stage individually, commit
yours only" Rule 2 discipline is best-effort, not guaranteed.** If
attribution purity matters, use `git worktree add` per agent. The
work itself was correct on first try.

### GPG signing rejects custom author overrides

`git commit -c user.name='Tuvok' -c user.email='223556219+Copilot@...'`
fails with `gpg failed to sign the data: 403 | Author is invalid` in
Codespaces because the GPG signer is bound to the default identity
(`Cyrus Jamula <cyrus@jamula.net>`). Don't try to attribute commits to
agent personas via `-c user.*` overrides — use the default identity and
put the persona attribution in the commit body (or the
`Co-authored-by:` trailer for the Copilot bot identity).

## Charter:** `.squad/agents/tuvok/charter.md`
- Phase 0 shipped (PR #111, 078d01f)

---

**[2026-06-01T03:14Z] PR1 Cleanup Cycle Concluded**

- PR #128 merged (03:03Z)
- 3 PRs merged total (PR #125, #126, #128)
- 3 worktrees swept + removed (stfc-118, stfc-121, stfc-cleanup-docs)
- Decision inbox merged (7 files → decisions.md)
- Scribe finalization completed; all .squad/ logs written

Status: COMPLETE
