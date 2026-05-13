# Skill: Constitution Amendment Audit

**Owner:** Tuvok (Process Auditor / Editorial Specialist)
**Created:** 2026-05-13

## When to use

Before any constitutional amendment PR is drafted or merged. This audit
verifies that the proposal is correctly scoped and that all cross-references
are accounted for.

## Inputs

1. The current constitution (`.specify/memory/constitution.md`) — read the
   full Sync Impact Report and all principle/section text.
2. The proposal (typically in a `plan.md` § Constitution Impact section).
3. The template directory (`.specify/templates/`) — every file.
4. The reviewer runbook (`.specify/memory/reviewer-runbook.md`).

## Audit checklist

### 1. Versioning rule

- Read the constitution's Governance § Versioning policy (MAJOR / MINOR / PATCH).
- For each proposed edit, classify: does it remove, rename, or redefine a
  principle (MAJOR)? Add new obligations (MINOR)? Clarify only (PATCH)?
- If ANY edit is MAJOR, the entire bump is MAJOR.
- Watch for open-ended category language that shifts governance model
  (e.g., closed enumerated list → unbounded category).

### 2. Sync Impact Report shape

Compare the proposed report against the prior version's report. Required
fields (per v1.2.0 precedent):

- Version change line (X.Y.Z → A.B.C, level)
- Bump rationale
- Per-principle change summary (REVISED / KEPT / EXTENDED for each)
- Templates needing re-sync (with ✅/⚠️/❌ status)
- Open follow-ups (including disposition of prior-version TODOs)
- Cross-check result (if applicable)

### 3. Dependent templates

For every file in `.specify/templates/`:
- Grep for principle names, numbers, and enumerated lists.
- If a proposed edit changes content that a template's guidance text
  references, the template is amendment-sensitive and must be listed.
- `plan-template.md` is the most sensitive (Constitution Check table
  includes per-principle guidance text with concrete enumerations).

### 4. Cross-reference discipline

- Check Known Tensions entries for "Resolution scheduled: vX.Y.Z" where
  X.Y.Z matches the proposed version. If the amendment does not resolve
  them, require explicit deferral.
- Check prior Sync Impact Report for `TODO(vX.Y.Z)` items. Same rule.
- Verify every sub-section the amendment touches is acknowledged in the
  proposal's impact enumeration.

### 5. Reviewer-runbook compliance

- Check whether the runbook prescribes an order of operations for
  amendments. If silent, note that.
- Verify the proposed amendment order (relative to speckit stages) is
  compatible with the constitution's Governance § Amendments procedure.

## Output format

Write to `.squad/decisions/inbox/tuvok-{feature}-amendment-audit.md` using
the structured memo format (Verdict, five audit sections, findings sorted
by severity, "What I did NOT do").
