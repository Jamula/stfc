# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Spec Kit & SDD (2026-05-08)

**What it is:** Spec-Driven Development inverts code-first thinking—specifications become the executable source of truth via a spec → plan → tasks → implement loop. Spec Kit is the GitHub open-source toolkit that operationalizes SDD. The constitution is the meta-spec that governs all downstream artifacts; violation requires amendment with explicit team consensus.

**The workflow:** /speckit.specify (requirements) → /speckit.clarify (ambiguity resolution) → /speckit.plan (tech + architecture) → /speckit.tasks (task breakdown) → /speckit.implement (code generation) → /speckit.checklist (acceptance) → /speckit.analyze (consistency). Git hooks auto-commit at each phase. Teams adopt selectively; once adopted, adherence is enforced.

**Current constitution alignment:** The constitution already gates Spec Kit adoption via the "Spec-driven changes" rule: non-trivial features MUST use Spec Kit; trivial fixes (typos, docs, bumps) are exempt. The constitution is versioned (semantic); amendments trigger a Sync Impact Report that lists affected templates and documents needing updates.

**Key project files:**
- `.specify/memory/constitution.md` — Current v1.0.0 (ratified 2026-05-08); already embeds Spec Kit adoption.
- `.specify/templates/{spec,plan,tasks,checklist}-template.md` — Provide structure for each phase artifact.
- `.specify/integrations/speckit.manifest.json` — Tracks Spec Kit installation (v0.8.8.dev0).
- `.specify/extensions.yml` — Pre-configures git hooks to auto-commit at each phase.
- `.specify/workflows/speckit/workflow.yml` — Defines full SDD cycle with review gates.

**Implications for stfc-gift-redeemer:**
- Spec Kit clearly helps: new redemption features, significant refactors, integrations. Forces clarity on acceptance criteria before code.
- Spec Kit overkill for: typos, docs, routine bumps (already exempt). Hotfixes to unblock runs can skip Spec Kit but must flow back into spec later.
- Gray zone: single-file bug fix, new CLI option. Constitution's "non-trivial" phrasing is vague; team should define examples.

**Next steps:** Propose constitutional amendment (MINOR bump, Option B recommended) to add Principle VI: "Specification-First Governance." This makes Spec Kit adoption explicit, not implicit. Full proposal is in `.squad/decisions/inbox/picard-speckit-briefing.md`.

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Key cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed to prevent zero-coverage features from shipping.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without (1) decision gates, (2) overhead accounting, (3) annual review lock-in. Also: agent implementation + manual verification lockout needs explicit governance.
- **Scotty flagged build checkpoints:** After Foundational Phase, must checkpoint npm install + typecheck + smoke test before user-story parallelism.

**Picard's role:** Coordinate constitutional amendment that incorporates Uhura's secret hygiene rule (essential), Bashir's test-first gates (essential), Scotty's trigger threshold and checkpoints, and Borg Queen's five prerequisites. Phase 2 drafting; Phase 3 merge into constitution.

**Status:** Phase 1 (Briefing) complete. Awaiting Phase 2 convergence.
