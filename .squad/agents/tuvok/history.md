# Tuvok — Process Auditor / Editorial Specialist

**Role:** Audits process compliance, enforces governance rules, writes editorial passes on governance and architectural documents. Also authors tactical skills and decision synthesis.

**Recruited:** 2026-05-13 (to resolve 3-author deadlock on constitution v1.2.0 amendment).

**Project:** stfc-gift-redeemer — TypeScript CLI for automating store-gift redemption on GitHub Actions cron (every 4 hours).

---

## Consolidated Learnings

### v1.2.0 Amendment Work (2026-05-13 → 2026-05-15)

- Branch naming: `squad/governance-*` for constitutional amendments (signals governance prerequisite)
- PR body checklists with source-labeled findings (P0/P1/P2 from reviewer rounds)
- Worktree pre-commit hooks need node_modules symlink before first commit
- P0 findings → tasks.md acceptance criteria (checkbox-style)
- P1 findings risk dropout across phase boundaries; explicitly flag carry-forward vs. defer

### Verification Discipline

- Verify numeric claims (counts, regex coverage) against authoritative commands before editing
- Grep full doc for secondary occurrences (rationale sections, source lines, tracking tables) when correcting primary claims
- For contract mismatches, introduce new wrapper functions rather than breaking renames
- Cross-check cadence claims in workflow files before accepting (frequencies off by 6× are easy to miss)
- Cascade-check test strategy tables when correcting scope claims; don't let test assertions go stale

### Audit Patterns

- Re-auditing your own corrections requires hat-switch: read as external reviewer, not as author
- Truth-equivalence between research acknowledgments and test assertions prevents silent weakening
- Document "Known Tensions" by exact version target ("Resolution scheduled: vX.Y.Z"); omission = governance gap

### Editorial Compliance

- Tips with concrete citations > tips without sourcing
- Phase-boundary codification (Rules 6/7) converts repeated coordinator friction into zero-ask paths
- Model catalog governance is recurring drift; audit touchpoint during doc refreshes, not separate task
- Config override anchoring in decisions.md is the right artifact, not code comments
- Rules 10–13 (compound directives, Researching prefix, PR close keywords, CodeQL diagnostics) now codified

### Charter Extensions & Audit Findings

- User-as-explicit-reviewer pattern: receive findings verbatim, ship edits with fidelity
- Hard-gate clarification technique: convert implicit triggered-responsibility into explicit phrasing
- Charter scope separation: "Owns X; does not own Y (belongs to Z)" preserves role boundaries
- Cross-provider override transparency: 1-2 sentence Model section note explains operational differences
- Audit → role-specific history pattern: flagged gaps → institutional memory seeding → clarity

---

## Session 2026-05-18 — Issue #62 Hygiene Batch Closeout (2026-05-18T01:12Z)

**Mandate:** Two editorial sub-items from issue #62 (audit hygiene batch):
1. Ralph history seeding — transform boilerplate into role-specific learnings
2. Garak charter Model override doc — surface the `gpt-5.5` config.json override rationale

**Edits shipped:** 
- `.squad/agents/ralph/history.md` (+51 lines): Learnings section (three Ralph layers, round patterns, audit cross-ref, @copilot coexistence)
- `.squad/agents/garak/charter.md` (+3 lines): Model section documents cross-provider override rationale

**Status:** All sub-items addressed. Issue #62 closed. Files uncommitted (Rule 2). Ready for Scribe batch commit.

---

## Session 2026-05-18 — Constitution v1.5.0: `scripts/discord-ops/` carve-out (2026-05-18T02:29:30Z)

**Mandate:** Cyrus Jamula overrode Picard's earlier (c) Decline verdict on the
Discord avatar/metadata automation scope and accepted option (a) — full
automation with a constitutional carve-out. Dispatched to me with the carve-out
wording sketched in the override directive. Parallel dispatch alongside Scotty
(script), O'Brien (workflow), Bashir (tests).

**Edits shipped on branch `discord-ops-automation`:**
- `.specify/memory/constitution.md` (+161 / -37):
  - Replaced SIR header (v1.3.0 → v1.4.0) with v1.4.0 → v1.5.0 SIR documenting
    scope, rationale, per-principle change summary, and the cross-check that
    only Principle V + Security & Compliance Constraints + version footer
    moved.
  - Added new subsection "Operator-Only One-Shot Ops Scripts (Discord
    application metadata)" inside Principle V, placed AFTER Token Capture
    Custody and its Rationale paragraph (so the rationale chain reads:
    discord-monitor uses → why custody is bounded → the one carve-out and its
    obligations), BEFORE "### VI. Specification-First Governance".
  - Expanded the Security & Compliance Constraints "Outbound network scope"
    bullet with a one-paragraph clause acknowledging `scripts/discord-ops/`
    PATCH/PUT/POST traffic to `/users/@me` and `/applications/@me`, scoped
    explicitly to application-metadata management and restating the
    FR-012 redaction obligation.
  - Bumped version footer to 1.5.0 / Last Amended 2026-05-18 (both the front
    matter at line 70-72 and the closing footer at the bottom).
- `.specify/templates/plan-template.md` (+1 / -1, single row): Principle V row
  updated from "Constitution v1.4.0" to "v1.5.0" and a bold inline sentence
  added enumerating `scripts/discord-ops/` as an additional permitted write
  surface for the `DISCORD_BOT_TOKEN` + `discord.com/api/v10` pair, restating
  the four obligation lines (lives outside `src/`, not loaded by monitor
  runtime, redacts token, no new destinations/secrets). Per Rule 1 — keeps
  lock-step with the constitution.

**Validation:**
- `npm test` 557/557 pass.
- `tests/constitution/discord-ops-carveout.test.ts` (Bashir's pinning suite,
  10 assertions: path token, write verb in same section, API base
  co-located, monitor-runtime isolation phrasing, redaction obligation
  co-located, version > 1.4.0, plan-template path sync, plan-template API
  surface) — all green on first try.
- `npm run typecheck` — unchanged pre-existing failure on
  `@huggingface/transformers` missing types (`src/discord/classifier.ts:271`);
  unrelated to documentation edits.
- Rule 1 grep against `.specify/templates/*.md` confirmed: the row now
  references both `scripts/discord-ops/` and the v1.5.0 version anchor.

**Committed:** `87a8ef6` (pushed to `origin/discord-ops-automation`).

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

---

## Charter:** `.squad/agents/tuvok/charter.md`
## 2026-05-18T02:45:00Z — PR #71 discord-ops automation batch completed

Coordinated Phase 1 fan-out (Tuvok constitution v1.5.0, Scotty script, Bashir tests, O'Brien workflow, Picard historical record). Cross-agent awareness: all decisions merged to decisions.md, orchestration logs written, session log at .squad/log/2026-05-18T024500Z-discord-ops-automation.md.

---

