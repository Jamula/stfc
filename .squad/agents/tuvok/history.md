# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08
- **Joined:** 2026-05-08 (diegetic expansion within Star Trek universe; recruited specifically to break a constitutional revision deadlock after Picard, Uhura, Scotty, and Bashir all entered reviewer-rejection lockout on the constitution artifact)

## Initial Mandate

Surgical editorial pass on `.squad/.scratch/constitution-v1.2.0-assembled.md` per Borg Queen's 5 specific findings in `.squad/decisions/inbox/borg-queen-v1.2.0-verification.md`. Apply each finding as a minimal edit; do not author new principles; do not address tangential issues unless they are required to honor a specific finding.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-05-13 — Learnings from 001-discord-monitor plan corrections (Borg Queen findings)

**Verify numbers before editing claims:**
When a finding corrects a count (e.g., "42 → 30" or "6 → 7"), always run the authoritative
command against the committed file BEFORE writing any replacement text. In this pass the
coordinator pre-verified promo-codes.txt counts (`grep -vE … | awk … | grep -P … | wc -l`
= 27 matched; 30 total non-comment; 3 short-code gap: TNG, GQ5, GQ7). Using those
pre-verified numbers directly prevented introducing a third wrong count. If the coordinator
had not pre-verified, the correct action is to run the verification commands yourself and
record the output before touching the artifact.

**Surgical "42" replacement pattern:**
After replacing the primary claim, grep the entire document for the literal string before
closing the edit pass — secondary occurrences in "Why 10" rationale sections, source lines,
and Complexity Tracking tables each require independent edits. A single-pass sed/replace
risks context collapse; the `edit` tool's find-and-replace approach enforces deliberate
per-occurrence review.

**Function-name seam corrections (contract files):**
When a contract proposes a new seam function named X but the actual codebase has a function
named Y doing the same job, the minimal edit is: (a) rename X → a new name that clearly
wraps Y, (b) fix any prose that claims Y already exists under name X. Do NOT silently
rename X to Y if the signatures are incompatible (in this case `readPromoCodes(path: string)`
is async and mandatory-arg; `loadPromoCodes(opts?)` was sync and optional — cannot be
made the same function without a breaking change). The safest pattern: introduce
`readCodesForRun(opts?)` as a new wrapper, leave `readPromoCodes(path)` untouched.

**Cadence corrections:**
"Same cadence" claims are easy to miss because plan authors often write them to
simplify narrative. Always cross-check cron expressions in the referenced workflow files
before accepting the claim. In this case `redeem.yml:14` had `cron: "0 * * * *"` (hourly)
vs. the plan's "4-hour" — a 6× difference in run frequency. The cadence mismatch also
has downstream implications for freshness assumptions (redeemer can run 5× between monitor
runs) that reviewers will find if the plan misrepresents it.

**Unstated-assumptions sections:**
Transcribe Borg Queen's unstated-assumption text verbatim into the plan's Risks section.
Do not paraphrase. The "Failure mode:" line is especially important — it converts an
abstract assumption into a concrete failure signal the implementer can test for. This
pattern mirrors the Known Tensions transcription discipline from the v1.2.0 editorial pass.

### 2026-05-13 — Learnings from v1.3.0 amendment audit (round 2, cascade fix)

**Cascade-check test strategy tables when correcting numeric claims:**
When a review finding corrects the scope of a regex match (e.g., "42 codes → 30 codes;
27 match; 3 are short-code gaps"), grep the spec files for test assertions that claim
exhaustive coverage ("Every code is matched"). Test strategy tables are common locations
for stale exhaustiveness claims because they often predate implementation-facing
reality and don't get re-checked during corrections passes. The fix: update the test
assertion to explicitly acknowledge the documented exceptions ("Every code is matched
except the 3 short-code gap: TNG, GQ5, GQ7"). Use the same phrasing as the research
acknowledgment for consistency (mirrors research.md § R4: "3 short-code gap: TNG, GQ5,
GQ7"). This ensures the test strategy is truth-equivalent to the implementer's reality
from day one and prevents silent test weakening.

### 2026-05-13 — Learnings from v1.3.0 amendment audit (round 2 addendum)

**Re-auditing your own corrections requires a hat-switch:**
When round 2 asks "did my corrections break anything?", the verification habit is
structurally different from the editing habit. As editor, the instinct is to check that
each replacement text is internally correct. As auditor, the instinct must be to check
that each replacement text is *externally consistent* — grep for the old string across
the entire feature directory, not just the file you edited. Round 2 confirmed the
corrections pass was clean, but only because the corrections memo already included a
cross-reference section. Without that section, the auditor would need to independently
reconstruct the blast radius of each edit. Lesson: when wearing the editor hat, always
produce a cross-reference note; when wearing the audit hat, always verify that note
against a fresh grep rather than trusting it.

### 2026-05-13 — Learnings from v1.3.0 amendment audit

**Templates that depend on constitution principles:**
- `.specify/templates/plan-template.md` — Constitution Check table (lines 38–49) references all nine principles by name and includes guidance text per principle. Principle V guidance (line 44) enumerates durable inputs and secret custody obligations verbatim. This template is the most amendment-sensitive: any change to a principle's scope, name, or enumerated lists will stale the guidance text.
- `.specify/templates/spec-template.md` — API Contract section (lines 103–152) references Principles III, VII, and VIII by name. Less amendment-sensitive unless those principles are renamed or their obligations change.
- `.specify/templates/tasks-template.md` — Header block (lines 11–17) references Principle IX by name and number. Stable unless Principle IX is amended.
- `.specify/templates/constitution-template.md` — Structural only; no principle-specific content.
- `.specify/templates/checklist-template.md` — No principle references.

**Cross-reference patterns confirmed:**
- The Sync Impact Report in the constitution's leading comment block is the canonical shape for amendment reports. Required fields: version change line, bump rationale, per-principle change summary (REVISED/KEPT/EXTENDED for each), templates needing re-sync (with status), open follow-ups, cross-check result.
- Known Tensions entries in the Governance section carry a "Resolution scheduled: vX.Y.Z" field. When that version ships, the Sync Impact Report must either resolve the tension or explicitly re-target it. Omission is a governance gap.
- `TODO(V1.3)` items in the v1.2.0 Sync Impact Report (helper-script redaction, SHA-pinning for squad-process workflows) are still open as of 2026-05-13.

### 2026-05-08T22:58:53-07:00 — Learnings from v1.2.0 editorial pass

**Redaction surface (`src/`):**
`src/lib/redact.ts` provides `redactString`, `redactValue`, and `redactForLog`. The logger
(`src/lib/logger.ts`) does NOT apply redaction itself — it is purely a pass-through emitter.
The actual redaction surface in `src/` is: (1) `src/api/client.ts` wraps thrown error
messages with `redactString` before re-throwing; (2) `src/cli.ts` applies `redactForLog` to
uncaught-skill failure detail and fatal errors. Informational log calls (account names, expiry
strings, usage messages) do not go through redact.ts and are not expected to. The obligation
applies only to strings derived from credential-bearing fields.

**`scripts/capture-token.mjs` known stderr surface:**
In interactive mode, if the existing `.env` STFC_ACCOUNTS value is not valid JSON,
`mergeIntoEnv` (lines 246–276) throws an Error whose message includes
`existingLine.trim()` — the raw STFC_ACCOUNTS line, which can contain the token JSON
array. This error is caught in the outer try/catch (lines 611–617) and printed to stderr.
This is a known gap; remediation is to re-run with `--force` or fix `.env` manually.
The v1.3 fix is to thread `redactString` through that error path.

**`run-all` exit-code contract — schema-mismatch carve-out:**
`src/skills/runAll.ts`'s `finalize` function (line 276) sets `exitCode = report.errors.length
> 0 ? 1 : 0`. Token expiry, already-claimed, transient, and unclassified HTTP failures are
classified as per-account outcomes and do NOT push to `report.errors`. Schema-mismatch
failures (`SchemaMismatchError`) DO push to `report.errors` and produce `exitCode = 1`.
This is intentional — schema mismatches signal an upstream API-shape change requiring
developer action.

**Artifact-hygiene CI gate — actual scope and bypass:**
`scripts/check-artifact-hygiene.mjs` watches `WATCHED_PREFIXES`: `specs/`, `plans/`,
`tasks/`, `.specify/memory/`, `.specify/templates/`, `docs/`, `.github/`. It does NOT scan
`src/` code comments or `tests/fixtures/`. The `.github/workflows/squad-artifact-hygiene.yml`
workflow: triggers on PRs touching those paths; reads the PR body (not title) for
`[skip-token-scan]`; fails the CI job on match — but merge-blocking depends on GitHub
branch-protection settings outside the repository. There is no in-repo branch protection
configuration file.

**`/tmp/captured.json` cleanup — success-path only:**
In `.github/workflows/refresh-token.yml`, the `rm -f /tmp/captured.json` line (line 124) is
at the end of the "Merge with existing STFC_ACCOUNTS and update secret" step's `run:` block,
inside `set -euo pipefail`. If any earlier command in that block exits non-zero, the cleanup
is skipped. The only `if: always()` step in the job is `Summary` (post-run reporting), which
does not clean up the file. An unconditional cleanup step is a v1.3 follow-up.

### 2026-05-08T21:29:58-07:00 — Learnings from v1.2.0 Path D acceptance (Known Tensions transcription)

**The transcription-vs-authoring line in editorial work:**
When a reviewer's verdict contains factual findings about the codebase, the
editorial mandate is to transcribe those findings verbatim (or near-verbatim)
into the governance artifact — not to paraphrase, soften, or adjudicate them.
"Accepted technical debt" entries must preserve the auditor's voice precisely:
the finding text that goes into a Known Tension entry should read as the
reviewer said it, not as the editor wishes it had been said.

**Path D as a valid governance exit:**
Not every revision cycle ends in a clean pass. When a reviewer rejects at
partial-resolution on a third pass, continuing to iterate risks compounding
edits that introduce new inaccuracies. Documented acceptance (Path D) is a
legitimate outcome: it freezes the overclaim exactly where it stands, assigns
it a version, attributes the decision to a named decision-maker, and queues
the real fix for the next minor. The constitution remains true about its own
known limits.

**Overclaims are not symmetric:**
The two Pass 3 overclaims were structurally different:
- Principle III: the overclaim was *introduced by a prior editorial fix* — the
  schema-mismatch carve-out created a new false-negative for auth/me failures.
- Principle VII: the overclaim was *residual from the assembled text* — the
  editorial fix narrowed the gate claim but left the trigger-path claim too
  broad.
Both required the same treatment (document and defer), but tracing them back
to their origin matters for v1.3 remediation: one is a principle-text precision
problem; the other may require either a text narrowing or a workflow change.

---

## v1.2.0 Amendment Cycle — Deadlock Breaker / Editorial Specialist (2026-05-08 → 2026-05-09)

### Session: speckit-v1.2.0-ratification-with-known-tensions

**Status:** COMPLETE. v1.2.0 ratified with Known Tensions (Path D acceptance).

**Tuvok's role:** Process Auditor / Editorial Specialist. Cast mid-cycle to break 3-author deadlock (Picard, Uhura, Scotty, Bashir all locked out after two rejection passes).

**Mandate:** Apply 5 surgical edits per Borg Queen Pass 2 findings. Do not author new principles. Do not address tangential issues. Scope discipline critical (locked-out authors cannot do further work; new author must stay within bounds).

**Edits applied (with cross-check against live repo):**
1. Principle I: Scoped redaction obligation to credential-bearing strings; acknowledged malformed-`.env` stderr surface
2. Principle III: Narrowed failure taxonomy (schema-mismatch carve-out documented)
3. Principle VII + Security: Removed "hard gate" fiction; corrected bypass mechanism (PR body, not title); acknowledged scope limits
4. Principle V: Added "Known stderr surface" note
5. Principle V: Changed cleanup guarantee to success-path-only; marked v1.3 follow-up

**Borg Queen Pass 3 verdict:** 3 of 5 findings fully resolved; 2 partially resolved (new overclaims introduced in replacement text). Partial resolution acceptable under Path D (Known Tensions ratification).

**Path D transition:** After Pass 3, cyrusj accepted Known Tensions path. Tuvok transcribed 3 Known Tensions for v1.3.0 backlog:
1. Principle III auth/me failure taxonomy overclaim (new in Tuvok's edit)
2. Principle VII / Security `.github/` scan path overclaim (new in Tuvok's edit)
3. Redeem/refresh concurrency lock un-principled (carryover from Pass 2)

**Lesson — editorial vs. authoring boundary:** When a reviewer's findings contain factual claims about the codebase, editorial mandate is to transcribe findings verbatim (or near-verbatim) into governance artifacts, not to paraphrase or soften. Accepted technical debt (Known Tensions) must preserve the reviewer's voice exactly.

**Diegetic expansion note:** Tuvok joined the squad as a specific role (Process Auditor / Editorial Specialist) and as a consequence of Star Trek metaphor extension (seven agents covering specialities; deadlock resolver as a new character type). This role — eligible to work on locked-out artifacts precisely because not involved in prior revision cycle — became reusable for future deadlocks.

**Lockout reset:** Per v1.3.0 backlog notes, Tuvok (and all prior revision authors: Picard, Uhura, Scotty, Bashir) are eligible for re-evaluation. Coordinator to decide at v1.3.0 spawn time whether lockouts carry forward or reset.

