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

