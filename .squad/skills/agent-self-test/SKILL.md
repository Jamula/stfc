---
name: "agent-self-test"
description: "How to design a regression-detection self-test harness for any squad member, sized to their role surface"
domain: "squad-quality"
confidence: "medium"
source: "extracted from picard self-test epic batch 2026-05-17 (#24–#32)"
---

## Context

When a squad member's `charter.md`, `history.md`, or any cited skill in `.squad/skills/` evolves, there is no automated check that the member's outputs on KNOWN INPUTS still match expectations. Today regressions are only caught via real-session failure — an expensive feedback loop.

The motivating frame (cyrusj, 2026-05-17): *"as we enhance their capability, we don't regress functionality."*

This skill captures the **per-role taxonomy** for designing a self-test surface, so the analysis doesn't have to be re-derived for the 10th, 11th, ... agent the squad eventually grows.

## When to use

- Filing a self-test epic for a new agent added to the roster
- Reviewing an existing self-test harness for coverage gaps
- Sub-triaging a "this member regressed last session, can we detect it earlier?" report

## Per-role surface taxonomy

The "self-test surface" is NOT uniform across roles. Identify the member's primary surface first, then design tests against it.

| Role type | Members (as of 2026-05-17) | Primary surface | Test shape |
|-----------|---------------------------|------------------|------------|
| **Reviewer** | Kirk, Picard (governance), Garak | Verdict semantics on synthetic input | Fixtures of KNOWN GOOD / KNOWN BAD inputs → assert APPROVE / REQUEST_CHANGES / CLOSE matches expected. Include reviewer-rejection lockout cases and approval-gate preservation. |
| **Implementer** | Scotty, Uhura | Code change on a small synthetic spec | Provide failing tests + 1-task spec → assert (a) tests pass after impl; (b) only the named files are modified (scope adherence); (c) test-first discipline when the spec says so; (d) phase-boundary commit shape. |
| **Tester** | Bashir | Tests derived from a spec | Provide a spec with N acceptance bullets → assert test count anchors to bullets, edge cases cover the documented hostile set, no impl-detail coupling (no private-helper calls), uses existing test stack. |
| **Editorial** | Tuvok | Mirror-fidelity edit application | Provide (source, finding, edit) → assert the edit applies ONLY the finding (no new claims, no adjacent paragraphs touched). Include SIR re-sync verification by literal grep, not structural shortcut. |
| **Mechanical** | Scribe | git/file operations on synthetic fixtures | Sandbox git repo → assert idempotency (second run is a no-op), per-file `git add`, write-boundary enforcement (refuse memos proposing writes outside owned paths). MUST NOT touch real `.git/` or real `.squad/`. |
| **Loop / monitor** | Ralph | Loop logic, NOT LLM output | Seed synthetic repo state → assert scan-cycle categorization, termination on idle signal, surface coverage is exactly the documented set, bounded iteration on degenerate input. No prompt-output assertions. |
| **M2 / EM** | Picard | Triage classification on issue text | Fixture of N synthetic issues spanning all sibling routes → assert assigned `squad:{member}` label matches expected. Include re-triage on bot overcorrection patterns. |

## Cross-cutting checks (apply to EVERY member)

Regardless of role, every self-test harness should include at least one assertion against the operating rules that bind all members:

- **Rule 2 (`.squad/` write boundary):** member does not stage or commit `.squad/` paths in non-Scribe roles. Refuses `git add .squad/` or broad globs.
- **Rule 3 (workflow YAML + pinning tests):** if the member edits `.github/workflows/*.yml`, pinning tests in `tests/` are updated in the same commit.
- **Rule 5 (phase-boundary commits):** multi-phase work produces phase-boundary commits with the `feat(NNN-feature): Phase N — {name}` subject; no mega-commits.
- **Project quick reference:** no `--no-verify` on pre-commit failures; uses the pinned node:test/tsx stack rather than introducing new tooling.

Pick the cross-cutting checks **relevant to the member's surface** — don't apply all 4 to every member. Ralph (loop) doesn't run pre-commit; Scribe (mechanical) doesn't author multi-phase work; etc.

## Harness shape (open)

Two options, decision deferred to the first self-test issue that lands implementation:

- **Option A:** `tests/agents/` — single repo-wide harness (TypeScript, node:test) that drives the agent via the same `task` tool the Coordinator uses, then asserts on the agent's outputs (file writes, decision memos, history appends, label assignments).
- **Option B:** `.squad/agents/{name}/tests/` — per-member fixtures + runner script, each member's tests colocated with their charter.

Constraint either way: **adding a new skill to `.squad/skills/` should not require updating ALL member self-tests** — only those whose charter cites that skill family. Otherwise the harness becomes a maintenance tax.

## Coordination with #15 (token-usage telemetry)

Both this skill family and #15 need a **scriptable `task`-tool driver** that invokes an agent and captures its outputs (token counts for #15, file diffs / decision memos / label assignments for self-tests). Build it once, share it. Whichever epic lands implementation first owns the driver design.

## Anti-patterns

- ❌ **Treating every member as a reviewer.** Implementer, mechanical, and loop members need DIFFERENT test shapes. The reviewer-style "synthetic input → expected verdict" pattern does not generalize.
- ❌ **Asserting on prompt-output text for Ralph.** Ralph is a loop, not an LLM-driven generator. Assert on state transitions, not on generated text.
- ❌ **Running Scribe tests against the real `.git/` or real `.squad/`.** Always sandbox in a TEMP git repo fixture, or the test pollutes the very paths it's meant to protect.
- ❌ **Self-test FIRST, refactor SECOND — never the reverse.** The point is regression detection on existing behavior. Changing the member's behavior in the same PR as the self-test invalidates the regression anchor.
- ❌ **Treating the self-test as a replacement for human review.** It's a complement — catches the known-bad cases cheaply, doesn't catch novel failure modes.

## Acceptance criteria template (for any self-test epic)

When filing a self-test issue for a new member, the issue should include:

- [ ] Self-test harness exists for the member
- [ ] At least 3 test cases (per the role-type surface taxonomy above) covering the core capability
- [ ] Test cases pass against the current charter + history + cited skills
- [ ] Failure modes produce a diagnostic readable by a human (not just "diff differs")
- [ ] CI runs the harness on changes to `.squad/agents/{member}/` OR the cited cross-cutting files
- [ ] Adding a new skill to `.squad/skills/` doesn't require updating ALL member self-tests
- [ ] Any role-specific acceptance (e.g. sandbox isolation for Scribe; loop bound for Ralph; mirror-fidelity anchor for Tuvok)

## Reference

- The motivating batch: #24 (Picard) · #25 (Kirk) · #26 (Scotty) · #27 (Uhura) · #28 (Bashir) · #29 (Garak) · #30 (Tuvok) · #31 (Scribe) · #32 (Ralph). Hub comment on #24.
- Related: #15 (Tuvok token-usage telemetry) shares the `task`-tool driver substrate.
- Source memo: `.squad/decisions/inbox/picard-self-test-epic-2026-05-17.md`.
