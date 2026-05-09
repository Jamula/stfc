# Scotty — History Archive

**Agent:** Scotty (CLI/runtime/build engineer, gpt-5.5)  
**Archived:** 2026-05-09  
**Purpose:** Summarized from history.md after file exceeded 15KB

## Summary

Scotty contributed to speckit adoption briefing and v1.1.0 enforcement infrastructure build, then led the CLI/runtime/build lane in v1.2.0 parallel-lane revision.

### v1.1.0 Phase 2 & Phase 3
- **Phase 2 critique:** Proposed build checkpoints (after Foundational Phase, checkpoint npm install + typecheck + smoke test)
- **Phase 3 delivery:** Built Principle IX enforcement gate—npm test blocked commits via pre-commit hook (simple-git-hooks, cross-platform via Node.js wrapper) + CI required check workflow (squad-test-gate.yml)
- End-to-end verification: 87/87 tests pass; deliberately broken test → hook exits 1, commit aborted ✅

### v1.2.0 Parallel Lane (CLI/runtime/build governance)
- **Context:** Picard's v1.1.1 draft rejected; parallel-lane revision authorized
- **Scotty's lane:** Principles II, IV + Development Workflow section. Did not touch Principles I, III, V, VI–IX, Security, or Governance
- **Key revision:** Replaced obsolete Dual-Platform Parity (II) with truthful Skill-Isolated CLI Architecture; rewrote Principle IV from Component-First UI to Type-Safe Headless TypeScript CLI
- **Lane discipline maintained:** No read of Picard's v1.1.1 draft (to prevent bias); independent repo cross-check; no overlap with Uhura's patches
- **Result:** Borg Queen rejected parallel-lane assembly (9 findings). Scotty locked out per protocol. Coordinator escalated to Path D (Known Tensions ratification).

### Key Learnings
- **Cross-platform hook implementation:** simple-git-hooks is lighter than husky (no postinstall surprises, no nested config files) and runs via Node.js so no shell dependency on Windows
- **Emergency bypass pattern:** `git commit --no-verify` documented as auditable escape hatch for emergencies (requires message annotation)
- **Parallel lanes work for draft speed but less for catching accuracy issues** — two independent authors both miss the same repo fact (need cross-provider verification to catch baseline overclaims)

### Outstanding Manual Steps
- cyrusj must configure GitHub branch protection rule for `npm test (required)` job name after first PR merge

---

## v1.0 & v1.1 Context (Archived — Preserved for Reference)

All prior speckit briefing input, enforcement infrastructure decisions, and test-gate implementation details archived; preserved for reference if needed for v1.3 cycle.
