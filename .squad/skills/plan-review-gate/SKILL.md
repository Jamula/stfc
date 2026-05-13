# Skill: Plan Review Gate (Lead/Architect)

**Owner:** Picard. Reusable by any future Lead/Architect role.

**When to invoke:** Before `/speckit.tasks` runs on any non-trivial feature. The plan-review gate is the architecture + governance checkpoint mandated by the Speckit Reviewer Gates section of the constitution.

## Scope (do this)

1. **Architecture honors existing principles.** For each principle, name the file(s) in the live repo that prove the new design respects the existing posture. Don't take the plan's word for it — verify the cited paths exist.
2. **No unapproved deps.** List EVERY new runtime dep proposed (read `package.json` baseline; cross-check Technical Context section; flag any transitive). Verify each license against `npm view <pkg> license` if possible — plans frequently misstate Apache-2.0 vs MIT.
3. **Constitution Check section is complete.** Every principle row must be PASS / CONDITIONAL PASS / FAIL with notes that map to concrete file paths or contracts. CONDITIONAL PASS rows MUST point at either a Complexity Tracking entry or a proposed amendment.
4. **Amendment-ordering decision (if proposed).** Decide explicitly: land amendment BEFORE implementation, BUNDLED with implementation, or DEFER under Complexity Tracking. Default answer is BEFORE.

## Out of scope (do NOT do this)

- Don't re-review the spec (that gate already happened).
- Don't review tasks (that gate is downstream).
- Don't audit every concrete claim against the live repo — that is the critic-reviewer's job (Borg Queen). Architecture review is about *whether the design is sound assuming the claims are true*.
- Don't write code.

## Decision framework: amendment ordering

| Option | When right | When wrong |
|--------|-----------|------------|
| **BEFORE implement (default)** | New credential, new outbound destination, new committed durable input, new secret writer, new sanctioned surface | Almost never wrong — choose this unless the amendment is genuinely trivial *and* the implementation is genuinely tiny |
| **BUNDLED with implement** | Single-line text fix that has no reviewer-set difference, e.g., correcting a typo a feature surfaces | When governance reviewers (Tuvok, Borg Queen) and code reviewers are different sets — bundling forces both reviews onto the same PR and conflates rollback semantics |
| **DEFER under Complexity Tracking** | One isolated, bounded, time-limited exception (e.g., one skipped test for one release) | Anything multi-section or multi-file. NEVER for credentials, outbound destinations, or durable inputs — those are exactly what governance exists for |

## Verdict shapes

- **APPROVE** — architecture sound, no new deps to flag, Constitution Check complete, no amendment needed (or amendment already landed).
- **APPROVE WITH CONDITIONS** — architecture sound but verifications need to happen before implement. Each condition MUST be a single actionable bullet assigned to a NAMED agent. Conditions may not require Lead's own further work.
- **REJECT** — architecture would actively harm the codebase or violate a principle the proposed amendment doesn't legitimize. Per lockout rule, name a DIFFERENT agent (not the plan's author) to revise.

## Memo template

See `.squad/decisions/inbox/picard-001-discord-monitor-plan-review.md` for a worked example. Required sections:

- Verdict (1 line, top)
- Architecture review (per-principle bullets, citing live-repo paths)
- Dependency review (complete list of new deps, license per dep, model/runtime artifact disposition)
- Constitution amendment decision (with reasoning, even if "no amendment needed")
- Conditions (each assigned to a named agent, each verifiable)
- Open questions for the user (only items that block forward motion)

## Anti-patterns to refuse

- Plans that put a credential or outbound destination in Complexity Tracking instead of proposing an amendment.
- Plans that introduce a new skill via subprocess invocation of `src/cli.ts` instead of importing the function — breaks the exit-code contract.
- Plans that add a new workflow that does `git push` without joining the existing `concurrency.group`.
- Plans whose new error types don't follow the typed-error pattern from `src/api/client.ts`.
- "Plan review" verdicts that approve without naming a single file or contract — generic approvals are governance theater.
