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

## Latest Work (2026-05-16)

**Documentation audit & squad page creation (cyrusj request):**
- Audited README against main@caa2d14: redeem cadence was stale (hourly → every 15 min); Discord monitor feature not documented at all.
- Updated README with accurate cadence, added Discord monitor section framing (Phases 0-3 shipped, Phase 4+ in-flight), added link to Discord monitor quickstart.
- Created `docs/squad.md` listing all 8 team members (7 agents + Ralph work monitor) with role, capabilities, charter link, and how to address.
- Updated `.github/workflows/` entries in project layout to include discord-monitor.yml; also linked new specs/ subdirectory.
- Updated CONTRIBUTING.md to link to docs/squad.md + .squad/routing.md for reviewer context.
- Updated SETUP.md: fixed stale "every hour" → "every 15 minutes"; added optional Discord monitor section linking to quickstart.md.
- Audited docs/stfc-game-knowledge.md (read-only); confirmed current (last updated May 2026, covers Update 90 from May 4, 2026).

**Documentation conventions observed (codebase patterns):**
- README uses heading hierarchy (# → ##), section breaks with horizontal rules (---), inline code backticks, and markdown tables.
- Link style: relative `[text](path)` for local docs, absolute `https://...` for external + `<https://...>` format for inline URLs.
- Code blocks use language tags: ```bash, ```json, ```typescript, ```diff.
- Numbered lists for procedural steps; bullet lists for feature enumerations.
- Admonition callouts: `> **Note:**` or `> **Optional:**` for asides.
- Cross-references use backticks for file/folder paths, preserve full paths for clarity (`.squad/`, `.github/workflows/`).

**No edits to out-of-scope artifacts:**
- Preserved all `.squad/` files (routing, decisions, team registry — coordinator-owned).
- Preserved `.specify/memory/constitution.md` (governance; only changes via /speckit.constitution).
- Preserved all `.squad/agents/*/charter.md` (charters are read-only).
- Preserved `docs/redeem-history.md` (machine-appended log).
- Preserved all source code and workflow files (not in this task's scope).

