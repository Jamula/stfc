# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Spec Kit Integration Analysis (2026-05-08)

**Build System & TS Configuration:**
- Project uses `tsx` for runtime + `tsc --noEmit` for typechecking; no build step needed
- `tsconfig.json` has strict mode enabled with aggressive checks (noUncheckedIndexedAccess, noImplicitOverride)
- Tests use native Node.js test runner (`node --import tsx --test`)
- Package.json has skill-based CLI scripts (run-all, check-auth, list-gifts, claim-gifts, redeem-codes)
- Minimal deps: tsx, zod, playwright (for automation), devDeps: types/node, typescript
- No existing build pipeline stress — Spec Kit spec/plan/tasks won't add compile complexity

**Spec Kit Footprint:**
- Templates are lightweight; no breaking structure changes needed in `src/`
- `specs/` directory is isolated and won't interfere with source layout
- Sequential branch numbering already enabled in git extension (001-NNN-feature format)
- Auto-commit hooks available but disabled by default — good for opt-in model
- Constitution model fits our skill-based architecture well

**Git & Feature Branch Integration:**
- `create-new-feature.sh` auto-generates feature branches and specs/ subdirs
- Branches use semantic naming: `001-user-auth`, `002-oauth-integration`, etc.
- No fetch-on-dry-run mode prevents surprise delays for lightweight planning
- Graceful degradation if git not available (specs still created in specs/ dir)

**Commands That Matter for Core Dev:**
- `/speckit.git.feature` — auto-generates branch + specs/ dir on specify phase
- `/speckit.plan` — creates plan.md with tech context; must check post-plan to catch architecture issues early
- `/speckit.tasks` — breaks down into impl phases; review deps before dev starts
- `/speckit.implement` — triggers parallel task execution; I own build validation
- `/speckit.git.commit` — optional auto-commit after each phase; currently disabled (good)

**Key Friction Points (Low, but real):**
- Specs directory grows with every feature — no built-in cleanup/archival yet
- Tasks.md generation depends on good user stories in spec.md; garbage in = garbage out
- If tasks reference build changes (tsconfig, package.json updates), they need explicit review
- Typescript type checking runs per-task; cumulative slowdown if tasks spawn independently

---

### Cross-Agent Sync: Speckit Briefing Phase 1 Complete (2026-05-08T21:20Z)

**Team briefing delivered:** Picard, Scotty, Uhura, Bashir, Borg Queen all submitted specialized input on speckit adoption implications.

**Scotty's key contribution:** Proposes Trigger Threshold (use speckit for >4-hour multi-file work; skip for one-liners) and build checkpoints (npm install + typecheck after Foundational Phase). Tech context gate post-plan to catch architecture issues early.

**Cross-cutting themes:**
- **Uhura flagged secret-leakage risk:** Constitutional Principle VI (Artifact Hygiene) + CI pre-commit check for tokens in specs/plans/tasks is HIGH urgency blocker.
- **Bashir flagged optional-test-tasks footgun:** Tests are optional in speckit templates; mandatory test-first discipline + reviewer gates needed.
- **Borg Queen flagged overhead & governance collision:** "When possible" is vague; adoption will be abandoned in 6 months without decision gates, overhead accounting, annual review lock-in.

**Status:** Phase 1 (Briefing) complete. Phase 2: Picard coordinates constitutional amendment incorporating Uhura's secret hygiene (essential), Bashir's test-first gates (essential), Scotty's trigger threshold + checkpoints, Borg Queen's five prerequisites.
