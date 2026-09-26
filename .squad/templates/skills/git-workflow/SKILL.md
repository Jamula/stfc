---
name: "git-workflow"
description: "Pointer to Jamula/stfc's canonical main-only git workflow"
domain: "version-control"
confidence: "high"
source: "team-decision"
---

## Canonical Source

The canonical git workflow skill for Jamula/stfc lives at `.github/skills/git-workflow/SKILL.md`. Keep this template as a pointer instead of duplicating the full workflow so the supported branch model cannot drift between copies.

## Supported Branch Model

Jamula/stfc uses a **main-only** branch model. Issue branches use `squad/{issue-number}-{kebab-case-slug}` and pull requests target `main`.

## Recorded Decision Summary

- **Scope:** `main` is the supported branch model for this repository.
- **Technical:** Do not implement code or workflow paths that depend on persistent `dev`, `preview`, `insider`, or `insiders` refs unless a future architecture decision first defines branch creation, protection, validation, rollback, and ownership.
- **Operations:** Keep CI and release workflows aligned with refs that actually exist on the remote, and keep retired promotion, preview, docs, insider, and legacy CI workflow templates absent.
