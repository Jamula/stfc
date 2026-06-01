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

---

**[2026-06-01T03:28Z] PR #124 Garak P1 Editorial Fixes**

### Context

Garak's hostile fact-check on PR #124 (Wave 3 auth + frontend shell) flagged 2 stale documentation findings:
- **P1#7:** PR body test count was 905, live repo now has 914 tests. Also missing test inventory in the `## Tests` section (Rule 15 violation).
- **P1#8a:** quickstart.md said "Phase 1 will populate this later" despite Phase 1 shipping in PR #124.
- **P1#8b:** shared/contracts/README.md said "intentionally empty" but Phase 1 shipped with 3 auto-generated contracts.

### Approach

Three surgical edits per Garak's explicit findings (no improvisation):

1. **PR #124 body** — Updated via `gh pr edit 124 --body-file <new-body>`:
   - Test count: 905 → 914
   - Added full test inventory to `## Tests` section, mapping new test files to their coverage areas
   - Kept all other sections unchanged (Summary, Verification, Docs, Reviewers, Closes)

2. **quickstart.md** — Replaced 27-line "will populate later" placeholder with actual Phase 1 capability surface:
   - 4-item capability list (auth library, frontend shell, data-read endpoints, deployment contract)
   - Cross-references to docs (SWA-SETUP.md, SWA-INVITATION-RUNBOOK.md, auth.ts)
   - "Getting started" section with next-phase pointers
   - Removed the "refer to v3 plan session-specific path" (non-canonical for shipped phase)

3. **shared/contracts/README.md** — Replaced "intentionally empty" boilerplate with actual contract documentation:
   - Listed 3 auto-generated contracts: chat-tool-call, audit-event, run-result
   - Documented auto-generated banner language (don't hand-edit)
   - Added `npm run build:contracts` and `npm run check:contracts` commands
   - Kept path-alias definitions (unchanged from original)

### Learnings: "will populate later" placeholders in shipped phases

**Pattern:** A docs artifact says "Phase N will populate this" or is marked "intentionally empty" with a task number for a future phase. The phase ships; the docs are never updated.

**Fix checklist for editorial audits after phase ship:**
1. Search `specs/*/` for "will populate", "Phase N will", "intentionally empty", and "TODO" markers.
2. For each match, confirm the referenced phase/task:
   - If the phase shipped → update the docs with actual content.
   - If the phase is still pending → leave as-is (but update the cross-reference if the task number changed).
3. For "intentionally empty" specifically: check the referenced task/PR. If it shipped (especially if auto-generation or build steps created content), replace the boilerplate with actual inventory + regeneration docs.
4. Use the shipped phase's own cross-references (PR#, issue#, file paths) rather than session-specific artifacts (session-state paths).

**Why this matters:** These placeholders trip hostile fact-checks because they signal "work not done" even when it is. They also confuse operators reading the quickstart (does this need setup or not?). A single grep for "will populate\|intentionally empty" post-phase-ship is a fast audit gate.

### Changes

- **PR #124 body:** test count 905→914, added 12-item test inventory
- **quickstart.md:** 27 lines → ~40 lines, replaced placeholder with Phase 1 capability surface
- **shared/contracts/README.md:** 24 lines → ~60 lines, replaced empty boilerplate with contract inventory + build/check docs
- **Commit:** `66a8d61` on `squad/005-phase1-dashboard`
- **Push:** successful to origin

### Validation

- `git status --short` showed exactly 2 expected file changes (✓)
- All 914 tests continue to pass after edits (✓)
- No code files touched; editorial only (✓)
- Did not collide with Kirk's parallel auth.ts work (✓)
- Appended to history.md as instructed (this entry)


- PR #124 merged 2026-06-01T03:55:00Z (Round 2 close-out, 8 issues closed, auth hardening + frontend shell foundation)

## 2026-06-01 — Issue #95: Crew v2 operator docs (PR #133)

**Context:** v2 crew handlers and knowledge embedding pipeline just merged to main in three PRs (#129, #130, #132). All 9 verbs live on main; knowledge-rebuild.yml workflow auto-triggers on source changes; manual CLI is `npm run crew:knowledge:rebuild` with optional `STFC_KNOWLEDGE_MODEL=minilm` env var.

**Work completed:**
- Expanded `docs/CREW-OPTIMIZER.md` "Discord v2 commands" section with comprehensive operator reference
- Added reference table with all 9 handlers, flags, and truncation limits (1900 chars)
- Wrote detailed subsections per handler (best, status, progression, roster show, explain, synergy, tasks, officers, knowledge)
- Documented knowledge retrieval, citation format (source:LX-LY), embedding cache, rebuild workflow
- Added "Knowledge embedding and rebuild" section covering:
  - Source paths watched by knowledge-rebuild.yml
  - Manual CLI: `npm run crew:knowledge:rebuild [--force]`
  - `STFC_KNOWLEDGE_MODEL` env var: default hashed vs opt-in MiniLM
  - Rebuild workflow trigger, commit-back behavior, output format
- Updated Roadmap: marked v2 complete, added v3 slash commands as future scope

**Validation:** npm test 1000/1000 green (no test changes; docs-only PR).

**Constitution:** No amendment needed. Knowledge embedding paths (hashed default + opt-in MiniLM) both covered by existing HF carve-out.

**Reviewer gates:** PR #133 awaiting approval from Kirk (technical accuracy), Garak (hostile fact-check), Picard (scope verification).

**Learnings:**
1. Operator docs for embeddings should be explicit about the two embedder paths (hashed vs MiniLM) and when each is used. The hashed path is fast offline; MiniLM is better semantics but requires network on first run + model download.
2. Discord truncation at 1900 chars is hard limit in v2 command surface — doc operators on when to expect truncation + how to narrow.
3. Knowledge citation format (source:LX-LY) is critical for traceability in retrieval-only systems; operators need to see this in every example.

## 2026-06-01 — Session wrap-up (operator docs + follow-up #136)

**Session:** crew-v2-chain-wrapup
**Role:** Documentation + operator-facing contracts
**Outcome:** Operator docs drafted (PR #133), parked for accuracy fixes (issue #136)

Participated in:
- PR #133 (squad/95-crew-v2-operator-docs): CREW-OPTIMIZER.md expansion (+254 lines), operator CLI specs, doc-only scope

**PR #133 status:** OPEN, awaiting #136 fix (routed to non-Tuvok agent per Lockout label)
- Kirk findings: 2 doc-accuracy issues included in #136 scope
- Garak findings: 5 doc-accuracy issues primary #136 scope

**Next phase:** After #136 completion, merge #133 to main. Then continue Phase 0 (005-web-control-panel) on stfc-76 worktree.

