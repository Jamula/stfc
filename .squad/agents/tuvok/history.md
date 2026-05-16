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

