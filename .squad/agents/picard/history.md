# Project Context

- **Owner:** cyrusj
- **Project:** stfc-gift-redeemer — a headless TypeScript CLI that automatically redeems web-store gifts and promo codes from the Star Trek Fleet Command store. Runs on a GitHub Actions cron schedule (every 4 hours).
- **Stack:** TypeScript, Node.js, GitHub Actions
- **Created:** 2026-05-08

## Learnings

### Constitution v1.1.0 → v1.2.0 Amendment Cycle (2026-05-08 → 2026-05-09)

**Cycle Summary:**
- **v1.1.0 proposal:** Incorporated Phase 1 briefing feedback from Scotty (trigger threshold, checkpoints), Uhura (artifact hygiene), Bashir (test-first gates), Borg Queen (prerequisites).
- **Blocking defect found:** Principle IV/IX contradiction (Principle IV claims "no automated test suite" while Principle IX mandates tests). Fixed by amending Principle IV rationale to acknowledge Principle IX requirement.
- **v1.2.0 assembly:** Parallel lanes coordinated—Uhura built artifact hygiene scanner, Scotty built npm test gate, Bashir built test-first reviewer gates.
- **Verification cycle:** Borg Queen performed 4 passes; v1.2.0 ratified with Path D acceptance (Known Tensions documented).

**Critical Lesson Learned:** Critique framing matters. "Verify my concerns are defused" (too narrow) vs. "Does every concrete claim match the repository?" (broader, catches inherited baseline overclaims). Full-document verification against live repo code is the distinguishing factor between real governance and hollow process.

**Post-Ratification Roadmap:**
- **Blocking (pre-first-speckit-merge):** Artifact hygiene CI gate (Uhura) + smoke-test runbook (WHO/WHEN/HOW).
- **Within 30 days:** Scope-assessment rubric for "scope creep" gate; adoption meter script for 50% annual review.
- **v1.3.0 cycle:** Resolve 3 Known Tensions (Principle III/IX/VII accuracy issues).

**Status:** v1.2.0 ratified and operational. Constitution is now the source of truth for governance in stfc-gift-redeemer.

---

### Plan review gate — 001-discord-monitor (2026-05-13)

**Architecture confirmed:**
- The "only `src/cli.ts` calls `process.exit`" invariant is real and verifiable (`src/cli.ts:1`, `src/cli.ts:108`, `src/cli.ts:111`). Any new skill that needs to be callable from another skill MUST be invoked as a function import — never spawned as a subprocess and never routed back through `src/cli.ts`. This is the load-bearing rule that makes the in-process redeemer seam clean rather than coupled.
- Existing skill contract: every skill in `src/skills/` returns `{ result, exitCode }` (see `RedeemCodesOutput` at `src/skills/redeemCodes.ts:33-38`). New skills MUST follow this shape. Exit code 1 is reserved for *infrastructure-class* failures only; per-source failures (auth fail on one channel, one account, one code) return 0 with the failure surfaced in the result/health payload.
- Concurrency safety on `main` is enforced by a *string-equal* `concurrency.group` across every workflow that does `git push`. The group string is `stfc-gift-redeemer` (`.github/workflows/redeem.yml:31`). Any new workflow that writes to the repo MUST use this exact string — the shared group is the only thing preventing `git push` collisions.
- Typed-error / zod-validated upstream client posture (`src/api/client.ts`) is the codebase's house style for ANY external HTTP. New API clients should mirror it: named error classes per status class, zod-validated responses, GET-only retry, `AbortSignal` timeouts, redaction on every error path that may surface a credential.
- Additive-arg seam pattern: when extending an existing function for a new caller, prefer ONE optional named arg with deterministic order semantics (`loadPromoCodes({ extraCandidates })`) over a new public function or a new module. This kept the redeemer-Discord seam to two function signatures touched, total.

**Constitution principles I challenged but upheld:**
- Principle V's literal enumeration of "secrets" and "durable inputs" was originally written tightly bound to STFC-only surfaces. A new feature that adds a third-party credential or new committed durable inputs REQUIRES a v1.x.0 amendment — it cannot be smuggled in under "Complexity Tracking." This pattern will repeat: any future skill that adds a new outbound destination, a new credential, or new committed state files must follow the same amend-first-then-implement ordering.
- Bundling a constitutional amendment with the first feature PR (Option 2) is tempting but wrong. Amendment PRs need their own reviewer set (Borg Queen for claim verification, Tuvok for process audit) and their own rollback semantics, separate from feature code review.

**Reviewer process patterns confirmed:**
- The "name a different agent on rejection" lockout rule is real (`.specify/memory/constitution.md` Speckit Reviewer Gates section); applies even when not invoked.
- Plan review gate scope is narrow: architecture + dep audit + Constitution Check completeness + (when present) amendment ordering decision. NOT a code review, NOT a spec re-review.
- Hostile verification of every concrete claim against the live repo is delegated to Borg Queen — Picard's gate is architecture and governance ordering, not file-level claim audit.

## Session History (Current)

*For detailed session logs, see `.squad/log/` and `.squad/orchestration-log/`.*
