# Data — History

## Core Context

- **Role:** Code Reviewer
- **Joined:** 2026-11-01

## Learnings

<!-- Append new learnings below -->

## Repository orientation

Root npm tests use tests/index.test.ts as an explicit suite inventory; test and typecheck are independent. CI tests the root and Worker, and the SWA workflow validates the API on its own Node version (.github/workflows/test-gate.yml, .github/workflows/swa-deploy.yml).

Review degraded outcomes, exit-code semantics, non-replayed gift claims, persistence on automation-state, Discord signature and guild checks, privacy, and regression tests (src/skills/runAll.ts, src/api/client.ts, worker/src/index.ts). Main pushes can create releases (.github/workflows/release.yml); never infer release or deployment authority merely from opening a PR.
