# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08
- **Joined:** 2026-05-08 (Process Auditor / Editorial Specialist; recruited to break 3-author deadlock)

## Initial Mandate

Surgical editorial pass on `.squad/.scratch/constitution-v1.2.0-assembled.md` per Borg Queen's 5 specific findings. Apply minimal edits only; do not author new principles.

## Learnings Summary (Condensed)

**v1.3.0 Amendment Work (2026-05-13 → 2026-05-15):**
- Use `squad/governance-*` branch naming for constitutional amendments (signals governance prerequisite, not feature).
- Tracker P1 findings from reviewer rounds in PR body checklists (labeled by source).
- Worktree pre-commit hooks require node_modules symlink before first commit.
- Process auditor P0 findings must encode into tasks.md acceptance criteria (each P0 → checkbox-style criterion).
- P1 findings risk silent dropout across phase boundaries; explicitly flag carry-forward vs. defer items.

**Plan Corrections & Verification (2026-05-13):**
- Always verify corrected numbers against committed files BEFORE writing replacement text.
- Grep entire document post-replacement for OLD string to catch secondary occurrences.
- Function-name seam corrections: introduce NEW wrapper name rather than silently renaming if signatures incompatible.
- Cross-check cron expressions against workflow files before accepting "same cadence" claims.
- Transcribe Borg Queen's unstated assumptions verbatim with "Failure mode:" lines.
- Cascade-check test strategy tables when correcting numeric scope claims ("Every code matches" → must name documented exceptions).

**Amendment Audit Patterns (2026-05-13):**
- Constitution-check table (plan-template.md:38–49) is amendment-sensitive: Principle V guidance text will stale on durable-input enumeration changes.
- Sync Impact Report required fields: version line, rationale, per-principle change summary (REVISED/KEPT/EXTENDED), templates needing re-sync, follow-ups.
- Known Tensions carry "Resolution scheduled: vX.Y.Z" field; when version ships, SIR must resolve or re-target (omission = governance gap).
- Re-auditing corrections requires hat-switch: editor (check internal correctness) → auditor (check external consistency).

**v1.2.0 Editorial Pass (2026-05-08):**
- Redaction surfaces: `src/api/client.ts` + `src/cli.ts` only (credential-bearing strings).
- `scripts/capture-token.mjs` known stderr surface: malformed `.env` STFC_ACCOUNTS exposes raw token (v1.3 fix).
- Schema-mismatch failures DO push to report.errors; per-account failures do not (intentional carve-out).
- Artifact-hygiene scanner watches: specs/, plans/, tasks/, .specify/memory/, .specify/templates/, docs/, .github/ (NOT src/ or tests/).
- `/tmp/captured.json` cleanup is success-path-only; unconditional cleanup is v1.3 follow-up.

**Path D Governance Exit (2026-05-09):**
- Known Tensions ratification is valid outcome when further iteration risks compounding inaccuracies.
- Overclaims are not symmetric: trace origin for v1.3 remediation (editorial-introduced vs. residual).
- Transcription discipline: editorial work preserves reviewer voice exactly, does not paraphrase.

**Lockout Resolution:**
- New auditor role (Process Auditor / Editorial Specialist) can work on locked-out artifacts because not involved in prior cycle.
- Reusable pattern for future deadlocks; coordinator to reset/carry-forward at v1.3.0 spawn.

---

## Status

**v1.2.0 Amendment Cycle:** COMPLETE. Ratified with 3 Known Tensions (Path D). v1.3.0 amendment PR (squad/governance-v1.3.0-amendment, PR #6) now in final review.
