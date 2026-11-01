# Plan: 005-web-control-panel

**Status:** Placeholder — plan lives in session state pending
`/speckit.plan` migration in a Phase 0 follow-up issue.

**Source of truth (v3 plan):**
`~/.copilot/session-state/d40435a0-d735-463b-887e-e5f586f7369b/plan.md`

The v3 plan is the plan-of-record for 005. Its approved scope covers all
9 phases, state-change-only persistence, and 5 standing rules codified
as Rules 14–18.

## Why this file is a placeholder

Issue #106 opens the speckit feature and clarifies the spec. Migration
of the v3 plan into `specs/005-web-control-panel/plan.md` via the
`/speckit.plan` template is intentionally **out of scope for #106** to
keep wave 2 of Phase 0 small and reviewable. The migration will land in
a follow-up Phase 0 issue once the platform spike (#109) and threat
model (#107) have populated their inputs.

## Until then, consult

1. The v3 plan (path above) for the full phased breakdown, reviewer-gate
   matrix, shared-file ownership table, acceptance budgets, and open
   decisions.
2. `spec.md` (this directory) for the testable user stories, functional
   requirements, edge cases, key entities, and resolved clarifications.
3. `research.md` (issue #109) for the platform spike
   findings on SWA custom-role mechanism, GitHub App org-policy, and
   GitHub Models availability.
4. `threat-model.md` (issue #107) for STRIDE-lite
   threat analysis.
5. `contracts/` (issue #108) for the
   three JSON Schema contracts.
6. `data-model.md` (this directory) for the schema inventory placeholder.
